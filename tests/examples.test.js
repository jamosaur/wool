import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../mods/wool/lib/yaml.js";
import { validateSetup, validateWorkspace } from "../mods/wool/lib/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");

for (const ex of readdirSync(root)) {
  test(`example ${ex} validates`, () => {
    const dir = join(root, ex, ".herdr");
    const s = join(dir, "worktrees.yml.dist");
    const w = join(dir, "workspace.yml.dist");
    assert.ok(existsSync(s) || existsSync(w));
    if (existsSync(s)) validateSetup(parseYaml(readFileSync(s, "utf8")), s);
    if (existsSync(w)) validateWorkspace(parseYaml(readFileSync(w, "utf8")), w);
  });
}
