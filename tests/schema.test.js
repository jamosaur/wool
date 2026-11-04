import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseYaml } from "../mods/wool/lib/yaml.js";
import {
  ConfigError,
  validateSetup,
  validateWorkspace,
  SETUP_FIELDS,
  WORKTREES_FIELDS,
  SETUP_STEP_FIELDS,
  WORKSPACE_FIELDS,
  TAB_FIELDS,
  PANE_FIELDS,
  BACKGROUND_FIELDS,
} from "../mods/wool/lib/schema.js";

const FILE = "/repo/.herdr/file.yml";

function rejects(fn, value, pattern) {
  assert.throws(() => fn(value, FILE), (e) => {
    assert.ok(e instanceof ConfigError, `expected ConfigError, got ${e}`);
    assert.equal(e.file, FILE);
    assert.match(e.message, pattern);
    return true;
  });
}

const HERDR_DOG = parseYaml(`version: 1
worktrees:
  setup:
    - run: cp "$HERDR_MAIN_WORKTREE/.env" .env
    - name: Install dependencies
      run: pnpm install
    - name: Seed database
      run: pnpm db:seed
      env:
        NODE_ENV: development
`);

const QUIZ = parseYaml(`version: 1
tabs:
  - title: Agent
    panes:
      - agent: default
  - title: Shell
    panes:
      - title: shell
  - title: Dev
    panes:
      - command: composer run dev
        setup: true
`);

const ws = (tabs, extra = {}) => ({ version: 1, tabs, ...extra });
const one = (pane) => ws([{ panes: [pane] }]);

// ---- setup -------------------------------------------------------------

test("setup: the herdr-dog example validates", () => {
  assert.deepEqual(validateSetup(HERDR_DOG, FILE), {
    steps: [
      { name: null, run: 'cp "$HERDR_MAIN_WORKTREE/.env" .env', env: {} },
      { name: "Install dependencies", run: "pnpm install", env: {} },
      { name: "Seed database", run: "pnpm db:seed", env: { NODE_ENV: "development" } },
    ],
  });
});

test("setup: an empty list is valid", () => {
  assert.deepEqual(validateSetup({ version: 1, worktrees: { setup: [] } }, FILE), { steps: [] });
});

test("setup: env numbers and booleans become strings", () => {
  const v = validateSetup({ version: 1, worktrees: { setup: [{ run: "x", env: { CI: 1, B: true } }] } }, FILE);
  assert.deepEqual(v.steps[0].env, { CI: "1", B: "true" });
});

test("setup: rejects a missing version", () => rejects(validateSetup, { worktrees: { setup: [] } }, /version/));
test("setup: rejects version 2", () => rejects(validateSetup, { version: 2, worktrees: { setup: [] } }, /version.*1/));
test("setup: rejects an empty file", () => rejects(validateSetup, null, /map/));
test("setup: rejects a missing worktrees.setup", () => rejects(validateSetup, { version: 1, worktrees: {} }, /worktrees\.setup/));
test("setup: rejects a step without run", () =>
  rejects(validateSetup, { version: 1, worktrees: { setup: [{ name: "x" }] } }, /worktrees\.setup\[0\].*"run"/));
test("setup: rejects an empty run", () =>
  rejects(validateSetup, { version: 1, worktrees: { setup: [{ run: "" }] } }, /worktrees\.setup\[0\]\.run/));
test("setup: rejects an unknown step field", () =>
  rejects(validateSetup, { version: 1, worktrees: { setup: [{ run: "x", cwd: "y" }] } }, /unknown field "cwd"/));
test("setup: rejects an unknown top-level field", () =>
  rejects(validateSetup, { version: 1, worktrees: { setup: [] }, hooks: {} }, /unknown field "hooks"/));
test("setup: rejects a list in env", () =>
  rejects(validateSetup, { version: 1, worktrees: { setup: [{ run: "x", env: { A: [1] } }] } }, /env\.A/));

// ---- workspace -----------------------------------------------------------

test("workspace: the quiz example validates", () => {
  const w = validateWorkspace(QUIZ, FILE);
  assert.equal(w.tabs.length, 3);
  assert.deepEqual(w.env, {});
  assert.deepEqual(w.background, []);
  assert.deepEqual(w.tabs[0], {
    title: "Agent",
    panes: [{
      title: null, kind: "agent", command: null, agent: "default", prompt: null, env: {},
      split: null, size: null, setup: false, waitForSetup: false, focus: false,
    }],
  });
  assert.equal(w.tabs[1].panes[0].kind, "shell");
  assert.equal(w.tabs[1].panes[0].title, "shell");
  assert.deepEqual(
    { ...w.tabs[2].panes[0] },
    { title: null, kind: "command", command: "composer run dev", agent: null, prompt: null, env: {},
      split: null, size: null, setup: true, waitForSetup: true, focus: false },
  );
});

test("workspace: split names map to right and down", () => {
  const w = validateWorkspace(ws([{ panes: [{}, { split: "vertical" }, { split: "horizontal" }, { split: "down" }, { split: "right" }] }]), FILE);
  assert.deepEqual(w.tabs[0].panes.map((p) => p.split), [null, "right", "down", "down", "right"]);
});

test("workspace: a later pane without split splits right", () => {
  const w = validateWorkspace(ws([{ panes: [{}, {}] }]), FILE);
  assert.equal(w.tabs[0].panes[1].split, "right");
});

test("workspace: env values become strings and layout env is kept", () => {
  const w = validateWorkspace(ws([{ panes: [{ command: "x", env: { PORT: 3000 } }] }], { env: { APP_ENV: "local" } }), FILE);
  assert.deepEqual(w.env, { APP_ENV: "local" });
  assert.deepEqual(w.tabs[0].panes[0].env, { PORT: "3000" });
});

test("workspace: size is kept as given", () => {
  const w = validateWorkspace(ws([{ panes: [{}, { size: "30%" }, { size: 0.3 }, { size: 40 }] }]), FILE);
  assert.deepEqual(w.tabs[0].panes.map((p) => p.size), [null, "30%", 0.3, 40]);
});

test("workspace: prompt, focus and background", () => {
  const w = validateWorkspace(ws([{ panes: [{ agent: "claude", prompt: "hi", focus: true }] }], {
    background: [{ command: "npm run watch", waitForSetup: true, env: { A: "b" } }, { command: "redis-server" }],
  }), FILE);
  const p = w.tabs[0].panes[0];
  assert.equal(p.prompt, "hi");
  assert.equal(p.focus, true);
  assert.deepEqual(w.background, [
    { command: "npm run watch", env: { A: "b" }, waitForSetup: true },
    { command: "redis-server", env: {}, waitForSetup: false },
  ]);
});

test("workspace: rejects command with agent", () =>
  rejects(validateWorkspace, ws([{ panes: [{}] }, { panes: [{}] }, { panes: [{ command: "x", agent: "default" }] }]),
    /tabs\[2\]\.panes\[0\]: "command" and "agent" can't both be set/));
test("workspace: rejects two setup panes across tabs", () =>
  rejects(validateWorkspace, ws([{ panes: [{ command: "a", setup: true }] }, { panes: [{ command: "b", setup: true }] }]),
    /tabs\[1\]\.panes\[0\].*setup/));
test("workspace: rejects prompt without agent", () => rejects(validateWorkspace, one({ prompt: "hi" }), /"prompt" needs "agent"/));
test("workspace: rejects split on a tab's first pane", () => rejects(validateWorkspace, one({ split: "down" }), /tabs\[0\]\.panes\[0\].*split/));
test("workspace: rejects an unknown split", () => rejects(validateWorkspace, ws([{ panes: [{}, { split: "left" }] }]), /split/));
test("workspace: rejects no tabs", () => rejects(validateWorkspace, ws([]), /tabs/));
test("workspace: rejects a missing tabs", () => rejects(validateWorkspace, { version: 1 }, /tabs/));
test("workspace: rejects no panes", () => rejects(validateWorkspace, ws([{ panes: [] }]), /tabs\[0\]\.panes/));
test("workspace: rejects two focus panes", () =>
  rejects(validateWorkspace, ws([{ panes: [{ focus: true }] }, { panes: [{ focus: true }] }]), /focus/));
test("workspace: rejects setup on an agent pane", () => rejects(validateWorkspace, one({ agent: "default", setup: true }), /setup/));
test("workspace: rejects an unknown pane field", () => rejects(validateWorkspace, one({ cwd: "x" }), /tabs\[0\]\.panes\[0\]: unknown field "cwd"/));
test("workspace: rejects waitForSetup on a shell pane", () => rejects(validateWorkspace, one({ waitForSetup: true }), /waitForSetup/));
test("workspace: rejects waitForSetup on an agent pane", () => rejects(validateWorkspace, one({ agent: "default", waitForSetup: true }), /waitForSetup/));
test("workspace: rejects a non-boolean setup", () => rejects(validateWorkspace, one({ command: "x", setup: "yes" }), /setup.*true or false/));
test("workspace: rejects a bad size", () => rejects(validateWorkspace, ws([{ panes: [{}, { size: "big" }] }]), /size/));
test("workspace: rejects version 2", () => rejects(validateWorkspace, { version: 2, tabs: [{ panes: [{}] }] }, /version/));
test("workspace: rejects a background entry without command", () =>
  rejects(validateWorkspace, ws([{ panes: [{}] }], { background: [{ env: {} }] }), /background\[0\].*"command"/));
test("workspace: rejects an unknown top-level field", () =>
  rejects(validateWorkspace, ws([{ panes: [{}] }], { layouts: [] }), /unknown field "layouts"/));

// ---- JSON schemas ----------------------------------------------------------

test("json schemas list the same fields as the validators", () => {
  const load = (p) => JSON.parse(readFileSync(new URL(`../schema/${p}`, import.meta.url), "utf8"));
  const keys = (o) => Object.keys(o.properties).sort();
  const sorted = (a) => [...a].sort();

  const wt = load("worktrees.schema.json");
  assert.deepEqual(keys(wt), sorted(SETUP_FIELDS));
  assert.deepEqual(keys(wt.properties.worktrees), sorted(WORKTREES_FIELDS));
  assert.deepEqual(keys(wt.properties.worktrees.properties.setup.items), sorted(SETUP_STEP_FIELDS));

  const w = load("workspace.schema.json");
  assert.deepEqual(keys(w), sorted(WORKSPACE_FIELDS));
  assert.deepEqual(keys(w.properties.tabs.items), sorted(TAB_FIELDS));
  assert.deepEqual(keys(w.properties.tabs.items.properties.panes.items), sorted(PANE_FIELDS));
  assert.deepEqual(keys(w.properties.background.items), sorted(BACKGROUND_FIELDS));

  for (const s of [wt, w]) {
    const walk = (o) => {
      if (o && typeof o === "object") {
        if (o.type === "object" && o.properties) assert.equal(o.additionalProperties, false);
        Object.values(o).forEach(walk);
      }
    };
    walk(s);
  }
});
