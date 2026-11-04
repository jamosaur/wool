import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../mods/wool/lib/yaml.js";
import { validateConfig } from "../mods/wool/lib/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");

for (const ex of readdirSync(root)) {
  test(`example ${ex} validates`, () => {
    const dir = join(root, ex, ".herdr");
    assert.deepEqual(readdirSync(dir), ["wool.yml.dist"]);
    const f = join(dir, "wool.yml.dist");
    validateConfig(parseYaml(readFileSync(f, "utf8")), f);
  });
}
