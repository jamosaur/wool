// Finds and loads a worktree's two config files. Each pair resolves on its own:
// a personal `.yml` (main checkout first, then the worktree) replaces the
// committed `.yml.dist` (the worktree's own first, then the main checkout's).

import { parseYaml, YamlError } from "./yaml.js";
import { ConfigError, validateSetup, validateWorkspace } from "./schema.js";

export function candidates(base, roots) {
  return [
    `${roots.main}/.herdr/${base}.yml`,
    `${roots.worktree}/.herdr/${base}.yml`,
    `${roots.worktree}/.herdr/${base}.yml.dist`,
    `${roots.main}/.herdr/${base}.yml.dist`,
  ];
}

export function resolveFile(base, roots, exists) {
  return candidates(base, roots).find((p) => exists(p)) ?? null;
}

async function loadOne(base, roots, read, validate) {
  for (const file of candidates(base, roots)) {
    let text;
    try {
      text = await read(file);
    } catch (e) {
      return { file, value: null, error: new ConfigError(file, `couldn't read the file: ${e?.message ?? e}`) };
    }
    if (text === null || text === undefined) continue;
    try {
      return { file, value: validate(parseYaml(text), file), error: null };
    } catch (e) {
      if (e instanceof ConfigError) return { file, value: null, error: e };
      if (e instanceof YamlError) return { file, value: null, error: new ConfigError(file, e.message) };
      throw e;
    }
  }
  return { file: null, value: null, error: null };
}

export async function loadConfig(roots, read) {
  const setup = await loadOne("worktrees", roots, read, validateSetup);
  const workspace = await loadOne("workspace", roots, read, validateWorkspace);
  return { setup, workspace };
}
