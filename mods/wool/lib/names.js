// Names derived from a worktree's branch, for things setup creates outside
// the worktree (a Compose project, a database) that teardown must find again.

const SLUG_MAX = 40;

// FNV-1a over the UTF-16 code units: small, stable, and needs no runtime APIs.
export function shortHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

// Lowercase letters, digits and single dashes. A branch that is already such a
// name is kept as is; any other gets a hash of the real name appended, so two
// branches never share a slug (feat/a and feat-a). Empty when detached.
export function branchSlug(branch) {
  if (!branch) return "";
  const clean = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (clean === branch && clean.length <= SLUG_MAX) return clean;
  const head = clean.slice(0, SLUG_MAX).replace(/-+$/, "");
  return head ? `${head}-${shortHash(branch)}` : shortHash(branch);
}
