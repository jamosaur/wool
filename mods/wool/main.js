// wool: gets a freshly created git worktree space ready to work in.
//
// Runs as an invisible kept window (mod.json): it draws nothing and watches
// spaces(). When a new space shows up for a linked worktree made in the last
// few minutes, it claims it (bin/wool-claim.sh), runs the repo's setup steps
// in a terminal, and lays out plain-shell spaces from .herdr/workspace.yml(.dist).
// All decisions live in lib/ (tested with node --test); this file is glue.

import { View, div } from "gpui-kit";
import {
  spaces, panes, terminals, focused, machines, run, exec, notify, knownAgents, readTextFile, appHome, home,
} from "herdr";
import { loadConfig } from "./lib/config.js";
import { classifySpace, newSpaces, parseClaim, FRESH_MINUTES, PENDING_LIMIT_MS } from "./lib/detect.js";
import { setupScript } from "./lib/shell.js";
import { planLayout, planSetupOnly, pickAgent } from "./lib/plan.js";

const STEP_TIMEOUT_MS = 5000;
const STATUS_POLL_MS = 2000;
const BG_POLL_MS = 5000;
const BG_WATCH_MS = 30 * 60 * 1000;

const tilde = (p) => (p && p.startsWith(home()) ? "~" + p.slice(home().length) : p);
const localReady = () => (machines().find((m) => m.name === null)?.layout ?? "ready") !== "loading";

export default class Wool extends View {
  init(_props, _cx) {
    this.known = null; // space ids wool has decided about (seeded on the first ready render)
    this.firstSeen = new Map(); // space id -> ms when first seen, while pending
    this.binDir = `${appHome()}/mods/wool/bin`;
  }

  render(cx) {
    try {
      this.scan(cx);
    } catch (e) {
      console.log(`wool: ${e?.stack ?? e}`);
    }
    return div();
  }

  scan(cx) {
    const all = spaces();
    if (this.known === null) {
      // Spaces that exist when wool starts (or reloads) are never handled.
      if (!localReady()) return;
      this.known = new Set(all.map((s) => s.id));
      return;
    }
    const fresh = newSpaces(this.known, all);
    if (fresh.length === 0) return;
    const now = Date.now();
    const ps = panes();
    const ts = terminals();
    for (const space of fresh) {
      if (!this.firstSeen.has(space.id)) {
        this.firstSeen.set(space.id, now);
        // Re-check once the pending window is over, in case nothing re-renders.
        cx.timer.after(PENDING_LIMIT_MS + 250, (cx) => this.scan(cx));
      }
      const kind = classifySpace(space, ps, ts, this.firstSeen.get(space.id), now);
      if (kind === "pending") continue;
      this.known.add(space.id);
      this.firstSeen.delete(space.id);
      if (kind === "remote") continue;
      const shell = this.shellOf(space, ps, ts);
      cx.spawn(async (cx) => {
        try {
          await this.handle(cx, space, kind, shell);
        } catch (e) {
          notify({ title: "wool: something went wrong", body: String(e?.message ?? e), level: "error" });
        }
      });
    }
  }

  shellOf(space, ps, ts) {
    const p = ps.find((x) => x.tab === space.tabs[0]?.id && x.terminal);
    const t = p && ts.find((x) => x.address === p.terminal);
    return Array.isArray(t?.argv) && t.argv[0] ? t.argv[0] : null;
  }

  async handle(cx, space, kind, shellHint) {
    const folder = space.folder || panes().find((p) => p.tab === space.tabs[0]?.id)?.cwd;
    if (!folder) return;
    const claimed = await exec("sh", [`${this.binDir}/wool-claim.sh`, folder, String(FRESH_MINUTES)]);
    if (claimed.code !== 0) {
      notify({ title: "wool: couldn't check the worktree", body: (claimed.stderr || claimed.stdout).trim(), level: "error" });
      return;
    }
    const wt = parseClaim(claimed.stdout);
    if (!wt) return; // not a linked worktree, made a while ago, or already handled

    const config = await loadConfig({ main: wt.main, worktree: wt.worktree }, (p) => readTextFile(p));
    if (config.setup.error) {
      // A broken setup file: no half setup, nothing else for this worktree.
      this.configError(config.setup.error);
      if (config.workspace.error) this.configError(config.workspace.error);
      return;
    }
    if (config.workspace.error) this.configError(config.workspace.error);
    // An empty setup list is nothing to run: no Setup tab, nothing waits.
    const hasSetup = config.setup.value !== null && config.setup.value.steps.length > 0;
    const layout = kind === "plain-shell" && config.workspace.value !== null;
    if (!hasSetup && !layout) return;

    if (hasSetup) {
      const script = setupScript(config.setup.value.steps, {
        HERDR_WORKTREE: wt.worktree, HERDR_MAIN_WORKTREE: wt.main, HERDR_BRANCH: wt.branch,
      });
      const w = await exec("sh", ["-c", 'printf %s "$1" > "$2"', "sh", script, `${wt.stateDir}/setup.sh`]);
      if (w.code !== 0) throw new Error(`couldn't write ${wt.stateDir}/setup.sh: ${w.stderr.trim()}`);
    }

    let shell = shellHint;
    if (!shell) {
      const r = await exec("sh", ["-c", 'printf %s "${SHELL:-/bin/sh}"']);
      shell = r.stdout.trim() || "/bin/sh";
    }
    const ctx = { binDir: this.binDir, stateDir: wt.stateDir, shell, agentArgv: null };
    if (layout && config.workspace.value.tabs.some((t) => t.panes.some((p) => p.kind === "agent"))) {
      const known = await knownAgents();
      ctx.agentArgv = (name) => pickAgent(known, name);
    }
    const plan = layout ? planLayout(config.workspace.value, hasSetup, ctx) : planSetupOnly(hasSetup, ctx);
    if (plan.warnings.length > 0) {
      notify({ title: `wool: ${wt.branch || tilde(wt.worktree)}`, body: plan.warnings.join("\n"), level: "warning" });
    }

    await this.execute(cx, space, wt, plan.steps);
    if (hasSetup) await this.watchSetup(cx, wt);
    const bg = plan.steps.filter((s) => s.op === "background").length;
    if (bg > 0) await this.watchBackground(cx, wt, bg);
  }

  configError(error) {
    // Toast titles are short: lead with .herdr/<file>, the full path goes in the body.
    const short = error.file.split("/").slice(-2).join("/");
    notify({ title: `wool: ${short} is invalid`, body: `${error.message}\n${tilde(error.file)}`, level: "error" });
  }

  // Runs the planned steps as Herdr commands. run() returns nothing, so each
  // new tab or pane is found by diffing spaces()/panes() afterwards.
  async execute(cx, space, wt, steps) {
    const refs = new Map(); // ref -> { tab, pane }
    const before = focused();
    const personElsewhere = !before || before.space !== space.id;
    const originalTab = space.tabs[0]?.id ?? null;
    let focusedAtEnd = false;

    const tabIds = () => new Set((spaces().find((s) => s.id === space.id)?.tabs ?? []).map((t) => t.id));
    const paneIds = (tab) => new Set(panes().filter((p) => p.tab === tab).map((p) => p.pane));
    const waitFor = async (find) => {
      for (let waited = 0; waited <= STEP_TIMEOUT_MS; waited += 100) {
        const hit = find();
        if (hit) return hit;
        await cx.sleep(100);
      }
      return null;
    };

    for (const step of steps) {
      if (step.op === "tab") {
        const old = tabIds();
        run("tab.new", { space: space.id, name: step.name, folder: wt.worktree, argv: step.argv, task: step.task });
        const tab = await waitFor(() => [...tabIds()].find((id) => !old.has(id)));
        const pane = tab && (await waitFor(() => panes().find((p) => p.tab === tab)?.pane));
        if (!tab || !pane) return this.stepFailed(step, refs);
        refs.set(step.ref, { tab, pane });
      } else if (step.op === "split") {
        const from = refs.get(step.from);
        if (!from) return this.stepFailed(step, refs);
        const old = paneIds(from.tab);
        run("pane.split", { pane: from.pane, direction: step.direction, argv: step.argv });
        const pane = await waitFor(() => [...paneIds(from.tab)].find((id) => !old.has(id)));
        if (!pane) return this.stepFailed(step, refs);
        refs.set(step.ref, { tab: from.tab, pane });
      } else if (step.op === "background") {
        const r = await exec("sh", ["-c", 'nohup "$@" >/dev/null 2>&1 &', "sh", ...step.argv], { cwd: wt.worktree });
        if (r.code !== 0) notify({ title: "wool: a background command didn't start", body: step.argv.join(" "), level: "error" });
      } else if (step.op === "closeOriginal") {
        if (originalTab) run("tab.close", { id: originalTab, confirmed: true });
      } else if (step.op === "focus") {
        const target = refs.get(step.ref);
        if (!personElsewhere && target) {
          run("pane.focus", { pane: target.pane });
          focusedAtEnd = true;
        }
      }
    }
    // tab.new takes focus and shows its space; give it back unless the plan
    // chose where focus goes and the person is still in this space.
    if (!focusedAtEnd && before?.pane) run("pane.focus", { pane: before.pane });
    return refs;
  }

  stepFailed(step, refs) {
    const what = step.op === "tab" ? `the tab "${step.name ?? step.ref}"` : `the pane ${step.ref}`;
    notify({ title: "wool: layout stopped", body: `Herdr didn't create ${what} within ${STEP_TIMEOUT_MS / 1000} s.`, level: "error" });
    return refs;
  }

  async watchSetup(cx, wt) {
    const name = wt.branch || tilde(wt.worktree);
    let missing = 0;
    for (;;) {
      await cx.sleep(STATUS_POLL_MS);
      const text = await readTextFile(`${wt.stateDir}/status`);
      const status = (text ?? "").split("\n")[0].trim();
      if (status === "" || status === "running") {
        if (status === "" && ++missing * STATUS_POLL_MS > 60000) return; // the runner never started
        continue;
      }
      if (status === "ok") {
        notify({ title: `wool: ${name} is ready`, level: "success" });
      } else {
        const step = status.replace(/^failed\s*/, "");
        const pane = this.setupPaneOf(wt);
        notify({
          title: "wool: setup failed",
          body: step === "interrupted" ? `Setup in ${name} was interrupted.` : `Step '${step}' failed in ${name}.`,
          level: "error",
          ...(pane ? { action: { name: "pane.focus", args: { pane } } } : {}),
        });
      }
      return;
    }
  }

  // The pane running wool-run.sh for this worktree, found through its terminal.
  setupPaneOf(wt) {
    const t = terminals().find((x) => Array.isArray(x.argv) && x.argv.includes(`${this.binDir}/wool-run.sh`) && x.argv.includes(wt.stateDir));
    return t ? panes().find((p) => p.terminal === t.address)?.pane ?? null : null;
  }

  async watchBackground(cx, wt, count) {
    const done = new Set();
    const name = wt.branch || tilde(wt.worktree);
    for (let waited = 0; waited < BG_WATCH_MS && done.size < count; waited += BG_POLL_MS) {
      await cx.sleep(BG_POLL_MS);
      for (let n = 0; n < count; n++) {
        if (done.has(n)) continue;
        const text = await readTextFile(`${wt.stateDir}/bg-${n}.exit`);
        if (text === null) continue;
        done.add(n);
        const code = text.trim();
        if (code !== "0" && code !== "skipped") {
          notify({
            title: `wool: a background command failed in ${name}`,
            body: `Exit ${code}. Its output is in ${tilde(`${wt.stateDir}/bg-${n}.log`)}.`,
            level: "error",
          });
        }
      }
    }
  }
}
