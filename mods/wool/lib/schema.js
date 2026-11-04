// Validates the two config files after YAML parsing and normalises them into
// the shapes the planner uses. Strict on purpose: an unknown field or a wrong
// type is an error that names the field, never a guess.

export class ConfigError extends Error {
  constructor(file, message) {
    super(message);
    this.name = "ConfigError";
    this.file = file;
  }
}

export const SETUP_FIELDS = ["version", "worktrees"];
export const WORKTREES_FIELDS = ["setup"];
export const SETUP_STEP_FIELDS = ["name", "run", "env"];
export const WORKSPACE_FIELDS = ["version", "env", "tabs", "background"];
export const TAB_FIELDS = ["title", "panes"];
export const PANE_FIELDS = ["title", "command", "agent", "prompt", "env", "split", "size", "setup", "waitForSetup", "focus"];
export const BACKGROUND_FIELDS = ["command", "env", "waitForSetup"];

const SPLITS = { right: "right", down: "down", vertical: "right", horizontal: "down" };

function checker(file) {
  const fail = (path, msg) => {
    throw new ConfigError(file, path ? `${path}: ${msg}` : msg);
  };
  const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const map = (v, path, fields) => {
    if (!isMap(v)) fail(path, "expected a map of fields");
    for (const k of Object.keys(v)) if (!fields.includes(k)) fail(path, `unknown field "${k}" (allowed: ${fields.join(", ")})`);
    return v;
  };
  const join = (path, k) => (path ? `${path}.${k}` : k);
  const str = (v, path, { required = false, nonEmpty = false } = {}) => {
    if (v === undefined || v === null) {
      if (required) fail(path.replace(/\.([^.]+)$/, ""), `"${path.split(".").pop()}" is required`);
      return null;
    }
    if (typeof v !== "string") fail(path, "expected text");
    if (nonEmpty && v.trim() === "") fail(path, "can't be empty");
    return v;
  };
  const bool = (v, path) => {
    if (v === undefined || v === null) return false;
    if (typeof v !== "boolean") fail(path, "expected true or false");
    return v;
  };
  const env = (v, path) => {
    if (v === undefined || v === null) return {};
    if (!isMap(v)) fail(path, "expected a map of NAME: value");
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) fail(`${path}.${k}`, "isn't a valid environment variable name");
      if (typeof x === "string") out[k] = x;
      else if (typeof x === "number" || typeof x === "boolean") out[k] = String(x);
      else fail(`${path}.${k}`, "expected text, a number or true/false");
    }
    return out;
  };
  const version = (v) => {
    if (v.version === undefined || v.version === null) fail("", '"version" is required (version: 1)');
    if (v.version !== 1) fail("version", "only version 1 is supported");
  };
  return { fail, map, join, str, bool, env, version };
}

export function validateSetup(value, file) {
  const c = checker(file);
  c.map(value, "", SETUP_FIELDS);
  c.version(value);
  if (value.worktrees === undefined || value.worktrees === null) c.fail("", '"worktrees.setup" is required');
  c.map(value.worktrees, "worktrees", WORKTREES_FIELDS);
  const list = value.worktrees.setup;
  if (!Array.isArray(list)) c.fail("worktrees", '"worktrees.setup" is required and must be a list');
  const steps = list.map((s, i) => {
    const path = `worktrees.setup[${i}]`;
    c.map(s, path, SETUP_STEP_FIELDS);
    if (s.run === undefined || s.run === null) c.fail(path, '"run" is required');
    return {
      name: c.str(s.name, `${path}.name`, { nonEmpty: true }),
      run: c.str(s.run, `${path}.run`, { required: true, nonEmpty: true }),
      env: c.env(s.env, `${path}.env`),
    };
  });
  return { steps };
}

export function validateWorkspace(value, file) {
  const c = checker(file);
  c.map(value, "", WORKSPACE_FIELDS);
  c.version(value);
  const env = c.env(value.env, "env");
  if (!Array.isArray(value.tabs) || value.tabs.length === 0) c.fail("tabs", "needs at least one tab");
  let setupAt = null;
  let focusAt = null;
  const tabs = value.tabs.map((t, ti) => {
    const tpath = `tabs[${ti}]`;
    c.map(t, tpath, TAB_FIELDS);
    if (!Array.isArray(t.panes) || t.panes.length === 0) c.fail(`${tpath}.panes`, "needs at least one pane");
    const panes = t.panes.map((p, pi) => {
      const path = `${tpath}.panes[${pi}]`;
      c.map(p, path, PANE_FIELDS);
      const command = c.str(p.command, `${path}.command`, { nonEmpty: true });
      const agent = c.str(p.agent, `${path}.agent`, { nonEmpty: true });
      if (command !== null && agent !== null) c.fail(path, '"command" and "agent" can\'t both be set');
      const prompt = c.str(p.prompt, `${path}.prompt`);
      if (prompt !== null && agent === null) c.fail(path, '"prompt" needs "agent"');
      const kind = command !== null ? "command" : agent !== null ? "agent" : "shell";

      let split = null;
      if (pi === 0) {
        if (p.split !== undefined && p.split !== null) c.fail(path, '"split" can\'t be set on a tab\'s first pane');
      } else if (p.split === undefined || p.split === null) {
        split = "right";
      } else {
        split = SPLITS[p.split];
        if (!split) c.fail(`${path}.split`, "expected right, down, vertical or horizontal");
      }

      let size = null;
      if (p.size !== undefined && p.size !== null) {
        const ok = (typeof p.size === "number" && p.size > 0) || (typeof p.size === "string" && /^\d+(\.\d+)?%$/.test(p.size));
        if (!ok) c.fail(`${path}.size`, 'expected cells (40), a fraction (0.3) or a percentage ("30%")');
        size = p.size;
      }

      const setup = c.bool(p.setup, `${path}.setup`);
      if (setup && kind === "agent") c.fail(path, '"setup: true" can\'t be on an agent pane');
      if (setup) {
        if (setupAt) c.fail(path, `only one pane can have "setup: true" (${setupAt} has it too)`);
        setupAt = path;
      }
      const wait = c.bool(p.waitForSetup, `${path}.waitForSetup`);
      if (wait && kind !== "command") c.fail(path, '"waitForSetup" needs "command"');
      const focus = c.bool(p.focus, `${path}.focus`);
      if (focus) {
        if (focusAt) c.fail(path, `only one pane can have "focus: true" (${focusAt} has it too)`);
        focusAt = path;
      }
      return {
        title: c.str(p.title, `${path}.title`),
        kind,
        command,
        agent,
        prompt,
        env: c.env(p.env, `${path}.env`),
        split,
        size,
        setup,
        waitForSetup: wait || setup,
        focus,
      };
    });
    return { title: c.str(t.title, `${tpath}.title`), panes };
  });

  let background = [];
  if (value.background !== undefined && value.background !== null) {
    if (!Array.isArray(value.background)) c.fail("background", "expected a list");
    background = value.background.map((b, i) => {
      const path = `background[${i}]`;
      c.map(b, path, BACKGROUND_FIELDS);
      if (b.command === undefined || b.command === null) c.fail(path, '"command" is required');
      return {
        command: c.str(b.command, `${path}.command`, { nonEmpty: true }),
        env: c.env(b.env, `${path}.env`),
        waitForSetup: c.bool(b.waitForSetup, `${path}.waitForSetup`),
      };
    });
  }
  return { env, tabs, background };
}
