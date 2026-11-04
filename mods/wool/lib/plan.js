// Turns a validated workspace into the ordered steps main.js runs as Herdr
// commands. Refs (t<tab>p<pane>, "setup") name panes before they exist;
// main.js maps them to real ids as each one appears.

import { runArgv, waitArgv, bgArgv, withEnv } from "./shell.js";

const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const NO_AGENT = "No installed agent found; the Agent tab is a plain shell.";

// pane.split {argv} runs argv bare and closes the pane when it exits, so a
// split's command is wrapped the way Herdr wraps tab.new's: run it, then the shell.
export function keepShell(argv, shell) {
  const base = shell.split("/").pop();
  if (POSIX_SHELLS.has(base)) return [shell, "-lic", '"$@"; exec "$0" -li', shell, ...argv];
  return ["sh", "-c", '"$@"; exec "$0" -l', shell, ...argv];
}

const setupTab = (ctx) => ({ op: "tab", ref: "setup", name: "Setup", argv: runArgv(ctx.binDir, ctx.stateDir, null), task: null });

function paneArgv(pane, hasSetup, ctx) {
  if (pane.kind === "shell") return pane.setup && hasSetup ? runArgv(ctx.binDir, ctx.stateDir, null) : null;
  if (pane.kind === "agent") return ctx.agentArgv;
  if (pane.setup && hasSetup) return runArgv(ctx.binDir, ctx.stateDir, pane.command);
  if (pane.waitForSetup && hasSetup) return waitArgv(ctx.binDir, ctx.stateDir, pane.command);
  return ["sh", "-c", pane.command];
}

export function planLayout(ws, hasSetup, ctx) {
  const steps = [];
  const warnings = [];
  const warn = (w) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  let focusRef = null;
  let agentRef = null;

  ws.tabs.forEach((tab, ti) => {
    tab.panes.forEach((pane, pi) => {
      const ref = `t${ti}p${pi}`;
      if (pane.kind === "agent" && ctx.agentArgv === null) warn(NO_AGENT);
      const env = { ...ws.env, ...pane.env };
      const hasEnv = Object.keys(env).length > 0;
      let argv = paneArgv(pane, hasSetup, ctx);
      const isShell = argv === null;
      if (hasEnv) argv = withEnv(argv ?? [ctx.shell, "-l"], env);
      const agentRuns = pane.kind === "agent" && ctx.agentArgv !== null;

      if (pi === 0) {
        steps.push({ op: "tab", ref, name: tab.title, argv, task: agentRuns ? pane.prompt : null });
      } else {
        if (agentRuns && pane.prompt !== null) {
          warn(`tabs[${ti}].panes[${pi}]: a prompt can only be sent to an agent in a tab's first pane; it was left out.`);
        }
        steps.push({ op: "split", ref, from: `t${ti}p${pi - 1}`, direction: pane.split, argv: argv === null || isShell ? argv : keepShell(argv, ctx.shell) });
      }
      if (pane.focus) focusRef = ref;
      if (pane.kind === "agent" && agentRef === null) agentRef = ref;
    });
  });

  if (hasSetup && !ws.tabs.some((t) => t.panes.some((p) => p.setup))) steps.push(setupTab(ctx));

  ws.background.forEach((b, n) => {
    const argv = bgArgv(ctx.binDir, ctx.stateDir, n, b.waitForSetup && hasSetup, b.command);
    steps.push({ op: "background", argv: withEnv(argv, { ...ws.env, ...b.env }) });
  });

  steps.push({ op: "closeOriginal" });
  steps.push({ op: "focus", ref: focusRef ?? agentRef ?? "t0p0" });
  return { steps, warnings };
}

export function planSetupOnly(hasSetup, ctx) {
  return { steps: hasSetup ? [setupTab(ctx)] : [], warnings: [] };
}
