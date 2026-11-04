# Herdr facts wool relies on

Observed 2026-11-04 in the live Herdr app **0.1.12** (macOS) with a throwaway
spike mod (`mods/wool-spike`, deleted afterwards). Everything here was seen,
not assumed, unless marked otherwise.

## Docking decision: a kept, frameless window overlay

wool runs as a **kept window overlay that renders nothing**. It needs no
layout edit and works in the shipped, read-only `main` layout.

`mods/wool/mod.json`:

```json
{ "place": "none", "overlay": { "kind": "window", "key": "wool", "keep": true, "frame": "none" } }
```

`render()` returns an empty `div()`; the window sizes to its content, so
nothing is drawn and nothing takes clicks or the keyboard.

Install steps for the README:

1. Copy or link `mods/wool` into `~/.config/herdr-app/mods/` (`mod.json`
   first: a folder seen without it gets docked by its default).
2. Start it once: `herdr-app do mod.open --name wool` (or the palette).
3. That's it: Herdr records the window in `windows.json` under
   `kept.<layout>.wool` and reopens it on every start while that layout shows.

Caveats:

- **Per layout.** Kept windows belong to the layout they were opened in
  (`windows.json` → `kept.main.wool`). Someone who switches to another layout
  runs `mod.open --name wool` there too.
- **`mod.open` toggles.** Running it a second time closes wool. To turn wool
  off: run it again. A closed kept window stays closed.
- A hot reload (saving any file in the mod) re-runs `init` and the first
  `render` in the same window; the window stays open.

What didn't work (in order tried):

1. `mod.json` `{ "place": "bottom", "size": 0 }`: Herdr did not dock the new
   folder into the shown layout at all while running (no node, not in
   `seen.json`, `layout.show {id}` → `no node "wool-spike"`). `mod.open` on it
   ran `init` and one render, then the copy died (no timer ticks).
2. A floating block in `main` via `layout.set`: refused with
   `Only supported click/look fields can change on Herdr's own layouts: clone one for other changes`.
3. Cloning `main` would work but makes the person give up the shipped,
   updated layout; the window overlay makes it unnecessary.

## How a new worktree space first appears

The worktree mod's New worktree runs `git worktree add`, then
`run("space.new", { folder, machine, tab, argv })` (tab/argv only in the
`{branch, tab, argv}` form). Simulated exactly from a mod:

- `render` sees the new space in the **same tick** `space.new` returns:
  `tabs.length === 1`, and `panes()` already lists its one pane with a
  terminal address (`t11`), `cwd: null`, `status: null`,
  `program: { key: "shell", name: "Shell", shell: true, agent: false }`.
- ~80 ms later `cwd` becomes the folder and `program.name` the real shell
  (`zsh`).
- **A space started with an agent looks identical at first sight.**
  `space.new { folder, argv: ["claude"], task }` showed
  `program.key: "shell", shell: true` for ~120 ms, then `key: "claude"`,
  then `status: "working"` ~1.7 s in. A `sh -c` command space keeps
  `program.shell: true` (`sh` is a shell). So `program` alone can't tell a
  plain shell from a briefed agent.
- **The terminal's argv tells them apart.** `terminals()` (by `address`)
  lists the terminal one or two renders after the pane (~80 ms):
  - plain shell: `argv: ["/bin/zsh", "-l"]`
  - any `argv` given to `space.new`/`tab.new`:
    `["/bin/zsh", "-lic", "\"$@\"; exec \"$0\" -li", "/bin/zsh", <argv...>]`
    (Herdr runs it in the interactive shell, which stays after it exits)
  So: plain shell = argv known, and every argument after `argv[0]` is a flag
  without `c`. Until `terminals()` has the argv, the space is **pending**.
- `space.new` selects the new space.

## Commands, as observed from a mod's `run(...)`

`run()` returns `null` for every command; effects show in `spaces()` /
`panes()` within the next render or two.

- `tab.new { space, name, folder?, argv?, task? }`: tab appears **at the end**,
  becomes the space's active tab, **takes focus, and switches the window to
  that space** even when another space was shown. With `argv` the command runs
  wrapped in the interactive shell (above); the shell stays when it exits.
  Without `folder` it started in the space's folder here; wool always passes
  `folder` anyway.
- `tab.new { …, argv: ["claude"], task: "Reply with just the word hi." }`
  started Claude Code with that first message (turn 1, status `done`).
- **`pane.split { pane, direction, argv }` runs argv bare.** No shell wrapper:
  when the program exits, its terminal finishes and **the pane closes**
  (`sh -c "echo split; sleep 1"` → pane gone after 1 s; `hc ls --all` shows it
  `finished`). From a mod, `pane.split` with a pane in a non-shown space
  worked the same (the pane was created, then closed when argv exited). The
  split starts in the source pane's folder (no `folder` argument exists).
  wool must wrap split commands itself to keep the shell.
- `tab.close { id, confirmed: true }` on a space's first tab, with other tabs
  present, closed just that tab; the space stayed.
- `tab.move { id, index: 1 }` moved a tab to first place.
- `tab.select { id }` switches to that tab (and its space).
- `pane.focus { pane }` alone restores space, tab and pane focus (used to
  give focus back after `tab.new` stole it).
- `notify({ …, action: { name: "pane.focus", args: { pane } } })` returns an
  id (`"o15"`). The shipped toast runs `run(p.action.name, p.action.args ?? {})`
  on click (`mods/toast/main.js:25`); `pane.focus {pane}` from a mod is
  verified above. The click itself was not clicked by hand.
- `herdr-app do pane.split …` from a shell prints `{ "pane", "terminal" }`;
  a mod gets nothing back and must diff `panes()`.

## knownAgents()

Most-picked first; each entry is a `Program` plus `run` and `installed`:

```json
{ "key": "claude", "name": "Claude Code", "icon": "icons/claude.svg", "tint": false,
  "tile": "#1c1d21", "color": "#ffffff", "shell": false, "agent": true,
  "run": ["claude"], "installed": true }
```

followed by `codex`, `pi`, `opencode`, `cursor`, … with `installed: false` on
this machine.

## exec environment

`exec("sh", ["-c", …])` gets the login shell's `PATH` (Homebrew, Herd's
`composer`, nvm's `npm` all found), `SHELL=/bin/zsh`, cwd = home. `PATH`
contains folders with spaces (`~/Library/Application Support/Herd/bin`).

## git

- In a linked worktree: `git rev-parse --git-dir` →
  `<main>/.git/worktrees/<name>` (absolute), `--git-common-dir` →
  `<main>/.git`.
- In the main checkout both print the **relative** `.git`: compare with
  `--absolute-git-dir` / `--path-format=absolute`.
- `<git-dir>/commondir` is written by `git worktree add` and never touched
  again: its mtime is the worktree's creation time (birth = mtime here).

## Prior art: BowgartField/herdr-layout-worktree-bootstrap

- Ships a cloned `main` layout with its mods as blocks; all its `mod.json`
  are `{ "place": "none" }`. wool avoids the clone (window overlay above).
- Detects worktrees by polling spaces every 250 ms plus `watchFolder`; only
  worktrees made through its own dialog run hooks.
- Keeps the first terminal waiting with a gate script as the terminal's
  program: ignores INT/QUIT, `stty -echo`, polls a job state file every
  200 ms, drains typed input (`stty -icanon min 0 time 0; cat >/dev/null`)
  before `exec "${SHELL:-/bin/sh}" -l`. wool's `wool-wait.sh` is the same
  idea without the input drain (a dev-server pane needs no typed input).
- Long work goes through `hc run --bg` because `exec` has a 30 s limit.
- Its RECIPE's watch-outs that apply to wool: install `mod.json` before
  `main.js`; claim before acting so two copies never act twice.

## What this changes in the plan

- **Task 6** `classifySpace` takes the terminals too:
  `classifySpace(space, panes, terminals, firstSeenAt, now)`; plain shell
  is decided by the terminal's argv (`isPlainShellArgv`), and a missing argv
  is `pending`. `wool-claim.sh` uses absolute git dirs.
- **Task 7** split panes with a command are wrapped so the shell stays:
  `keepShell(argv, shell)`; `Ctx` gains `shell` (the plain shell's
  `argv[0]`). Tab panes are not wrapped (Herdr does it).
- **Task 8** `mod.json` is the window overlay above; `tab.new` always gets
  `folder`; after adding a Setup tab to an "other" space, wool gives focus
  back with `pane.focus` to the pane that had it.
