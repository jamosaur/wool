import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFile, loadConfig } from "../mods/wool/lib/config.js";
import { ConfigError } from "../mods/wool/lib/schema.js";

const roots = { main: "/code/app", worktree: "/wt/app/feat" };
const has = (...paths) => {
  const set = new Set(paths);
  return (p) => set.has(p);
};
const reader = (files) => async (p) => (p in files ? files[p] : null);

const SETUP = "version: 1\nworktrees:\n  setup:\n    - run: echo hi\n";
const WORKSPACE = "version: 1\ntabs:\n  - panes:\n      - title: shell\n";

test("personal yml in main wins over everything", () => {
  const exists = has(
    "/code/app/.herdr/worktrees.yml", "/wt/app/feat/.herdr/worktrees.yml",
    "/wt/app/feat/.herdr/worktrees.yml.dist", "/code/app/.herdr/worktrees.yml.dist",
  );
  assert.equal(resolveFile("worktrees", roots, exists), "/code/app/.herdr/worktrees.yml");
});

test("worktree yml wins over dist files", () => {
  const exists = has("/wt/app/feat/.herdr/worktrees.yml", "/wt/app/feat/.herdr/worktrees.yml.dist", "/code/app/.herdr/worktrees.yml.dist");
  assert.equal(resolveFile("worktrees", roots, exists), "/wt/app/feat/.herdr/worktrees.yml");
});

test("worktree dist wins over main dist", () => {
  const exists = has("/wt/app/feat/.herdr/workspace.yml.dist", "/code/app/.herdr/workspace.yml.dist");
  assert.equal(resolveFile("workspace", roots, exists), "/wt/app/feat/.herdr/workspace.yml.dist");
});

test("falls back to main dist", () => {
  assert.equal(resolveFile("workspace", roots, has("/code/app/.herdr/workspace.yml.dist")), "/code/app/.herdr/workspace.yml.dist");
});

test("returns null when no file exists", () => {
  assert.equal(resolveFile("worktrees", roots, has()), null);
});

test("setup and workspace resolve independently", () => {
  const exists = has("/code/app/.herdr/worktrees.yml", "/wt/app/feat/.herdr/workspace.yml.dist", "/code/app/.herdr/workspace.yml.dist");
  assert.equal(resolveFile("worktrees", roots, exists), "/code/app/.herdr/worktrees.yml");
  assert.equal(resolveFile("workspace", roots, exists), "/wt/app/feat/.herdr/workspace.yml.dist");
});

test("loadConfig loads and validates both files", async () => {
  const c = await loadConfig(roots, reader({
    "/code/app/.herdr/worktrees.yml.dist": SETUP,
    "/wt/app/feat/.herdr/workspace.yml.dist": WORKSPACE,
  }));
  assert.equal(c.setup.file, "/code/app/.herdr/worktrees.yml.dist");
  assert.deepEqual(c.setup.value, { steps: [{ name: null, run: "echo hi", env: {} }] });
  assert.equal(c.setup.error, null);
  assert.equal(c.workspace.file, "/wt/app/feat/.herdr/workspace.yml.dist");
  assert.equal(c.workspace.value.tabs[0].panes[0].kind, "shell");
  assert.equal(c.workspace.error, null);
});

test("loadConfig reports a YAML error with file and line, and still loads the other file", async () => {
  const c = await loadConfig(roots, reader({
    "/code/app/.herdr/worktrees.yml.dist": SETUP,
    "/code/app/.herdr/workspace.yml": "version: 1\ntabs:\n\t- x\n",
  }));
  assert.ok(c.workspace.error instanceof ConfigError);
  assert.equal(c.workspace.error.file, "/code/app/.herdr/workspace.yml");
  assert.match(c.workspace.error.message, /line 3: /);
  assert.equal(c.workspace.value, null);
  assert.equal(c.workspace.file, "/code/app/.herdr/workspace.yml");
  assert.equal(c.setup.error, null);
  assert.equal(c.setup.value.steps.length, 1);
});

test("loadConfig reports a schema error with its file", async () => {
  const c = await loadConfig(roots, reader({ "/wt/app/feat/.herdr/worktrees.yml.dist": "version: 2\nworktrees:\n  setup: []\n" }));
  assert.ok(c.setup.error instanceof ConfigError);
  assert.equal(c.setup.error.file, "/wt/app/feat/.herdr/worktrees.yml.dist");
  assert.match(c.setup.error.message, /version/);
});

test("loadConfig with no files returns both null without errors", async () => {
  const c = await loadConfig(roots, reader({}));
  assert.deepEqual(c, {
    setup: { file: null, value: null, error: null },
    workspace: { file: null, value: null, error: null },
  });
});

test("loadConfig turns a failing read into an error for that file", async () => {
  const c = await loadConfig(roots, async (p) => {
    if (p === "/code/app/.herdr/worktrees.yml") throw new Error("permission denied");
    return null;
  });
  assert.ok(c.setup.error instanceof ConfigError);
  assert.equal(c.setup.error.file, "/code/app/.herdr/worktrees.yml");
  assert.match(c.setup.error.message, /permission denied/);
});
