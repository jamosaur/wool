// Decides what a newly seen space is. Herdr reports a new space's pane before
// its terminal, and a space started with an agent first reports its program as
// a shell, so the terminal's launch argv is what tells a plain shell apart.

export const PENDING_LIMIT_MS = 10000;
export const FRESH_MINUTES = 3;

// Herdr starts a plain shell as e.g. ["/bin/zsh", "-l"]; anything it launches
// with argv runs as [shell, "-lic", '"$@"; exec "$0" -li', shell, ...argv].
export function isPlainShellArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return false;
  return argv.slice(1).every((a) => typeof a === "string" && /^-[A-Za-z]+$/.test(a) && !a.includes("c"));
}

export function classifySpace(space, panes, terminals, firstSeenAt, now) {
  if (space.machine !== null && space.machine !== undefined) return "remote";
  const waiting = now - firstSeenAt < PENDING_LIMIT_MS;
  const pending = () => (waiting ? "pending" : "other");
  if (space.tabs.length === 0) return pending();
  if (space.tabs.length > 1) return "other";
  const tab = space.tabs[0];
  const mine = panes.filter((p) => p.tab === tab.id);
  if (mine.length === 0) return pending();
  if (mine.length > 1 || tab.panes > 1) return "other";
  const p = mine[0];
  if (p.terminal === null || p.terminal === undefined) return "other";
  if (p.status !== null && p.status !== undefined) return "other";
  const t = terminals.find((x) => x.address === p.terminal);
  if (!t || !Array.isArray(t.argv)) return pending();
  return isPlainShellArgv(t.argv) ? "plain-shell" : "other";
}

export function newSpaces(known, spaces) {
  return spaces.filter((s) => !known.has(s.id));
}
