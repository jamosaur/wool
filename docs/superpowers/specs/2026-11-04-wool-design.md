# wool — design

A mod for the **Herdr app** (the desktop window, `~/.config/herdr-app`) that
gets a freshly created git worktree ready to work in: it runs the repo's setup
commands once, and lays out the new space's tabs and commands, both described
by files committed to the repo.

Status: design, approved 2026-11-04. Not yet built.

## Why

Creating a worktree in Herdr (space menu or + menu → New worktree) gives a bare
shell in a bare checkout: no `.env`, no `vendor/`, no `node_modules/`, one tab.
Every time, the person does the same chores by hand (copy `.env`, `composer
install`, `npm ci`, open tabs, start the dev server) before they can work.
They usually jump straight into a coding agent, so the space should be ready
for that the moment it opens.

The Herdr **TUI** has a plugin for the setup half (prior art:
[herdr-dog](https://github.com/nickspaargaren/herdr-dog), which runs commands
from `.herdr/worktrees.yml` on the TUI's `worktree.created` event). The Herdr
**app** has no plugin events; wool fills that gap for the app, and adds the
workspace layout half.

Other prior art (surveyed 2026-11-04): on the TUI side,
[razajamil/herdr-plugin-workspace-manager](https://github.com/razajamil/herdr-plugin-workspace-manager)
does setup + layout but from a global config. On the app side,
[BowgartField/herdr-layout-worktree-bootstrap](https://github.com/BowgartField/herdr-layout-worktree-bootstrap)
does repo-local setup but ships as a whole layout and has no tab layout (read
it for how it docks and how it keeps the first terminal waiting on setup);
[cgill27/project-presets](https://github.com/cgill27/project-presets) and
[geooff/herdr-one-agent-one-worktree](https://github.com/geooff/herdr-one-agent-one-worktree)
do setup + tabs only for worktrees made through their own dialogs. None is an
app mod that reacts to any new worktree, does both halves, and reads committed
`.dist` files with personal overrides. That's wool.

It is meant to be shared with the community at herdr.dev/mods, so it must be
generic: nothing about any one repo, stack or agent is baked in.

## Goals

1. When a new worktree space is created in the Herdr app, however it was
   created, run that repo's setup steps in it, once.
2. When that space arrives as a plain shell (the New worktree dialog's
   default), lay it out as the repo (or the person) describes: tabs, splits,
   and commands running in them. Spaces that arrive with something else in
   them (e.g. a briefed agent) are never rearranged.
3. The agent tab opens **immediately**, focused, while setup runs alongside it.
4. Commands that need setup (a dev server) wait for setup to succeed.
5. Setup output is visible while it runs; a failure is visible and stays visible.
6. Shareable: a public GitHub repo with the `herdr-mod` topic, `RECIPE.md`,
   `preview.png`, README, MIT license.

## Non-goals

- Changing how Herdr creates worktrees (the shipped `worktree` mod stays as is;
  wool does not clone or replace `worktree`, `menu` or `new-menu`).
- Re-running setup or rebuilding the layout for a worktree that already exists
  and is merely opened again, or for the main checkout.
- Partial merging of an override with its `.dist` file.
- Supporting the Herdr TUI (herdr-dog covers that).

## Anti-goals (would make it a failure even if it "works")

- Running setup twice for the same worktree (e.g. after an app restart or mod
  reload), or running it on a checkout someone has been working in.
- Making `git worktree add` or Herdr's New worktree dialog fail, hang, or wait
  for setup.
- Silently swallowing a failed setup step, then starting the dev server anyway.
- Hardcoding Claude, Laravel, npm, or the person's own paths.

## Configuration (decided by the person)

Four files, all in a repo's `.herdr/` folder:

| Purpose | Committed (shared) | Personal override (gitignored) |
|---|---|---|
| Setup steps | `.herdr/worktrees.yml.dist` | `.herdr/worktrees.yml` |
| Workspace layout | `.herdr/workspace.yml.dist` | `.herdr/workspace.yml` |

- If the plain `.yml` exists, it **replaces its `.dist` entirely**; the `.dist`
  is not read. No merging.
- The two pairs are independent: a repo can have setup without a workspace
  file, or the reverse. With neither, wool does nothing for that repo.

### Where the files are read from (builder's guidance, my call)

Resolved **per file pair**, each pair independently (my call):

1. Personal `.yml`: the **main checkout** (`git rev-parse --git-common-dir`,
   minus `/.git`) first, then the new worktree. Overrides are gitignored, so
   they normally exist only in the main checkout; a new worktree never has them.
2. Otherwise the committed `.yml.dist`: the **new worktree** first (so a branch
   that adds or changes its `.dist` gets its own version, and the main
   checkout's current branch or uncommitted edits don't leak in), then the main
   checkout.
3. Neither: that half (setup or workspace) is off for this worktree.

Write this as one pure function with tests covering each case. The README
documents the order and how it differs from herdr-dog (which reads the new
checkout's `.yml` first).

### Setup file schema

Identical to herdr-dog's `.herdr/worktrees.yml`, so a repo's setup is portable
between the TUI plugin and this mod:

```yaml
version: 1
worktrees:
  setup:
    - run: cp "$HERDR_MAIN_WORKTREE/.env" .env
    - name: Install PHP dependencies
      run: composer install --no-interaction
    - name: Install JS dependencies
      run: npm ci
      env:
        CI: "1"
```

- `version` (required, `1`), `worktrees.setup` (required list, `[]` valid).
- Per step: `run` (required, non-empty string, run as `/bin/sh -c <run>` in the
  new worktree), `name` (optional label), `env` (optional string map).
- Environment for every step: `HERDR_WORKTREE` (new checkout), 
  `HERDR_MAIN_WORKTREE` (main checkout), `HERDR_BRANCH` (its branch).
- Steps run in order; the first failing step stops setup.
- Reject unknown fields and wrong types with a clear message (as herdr-dog
  does), rather than guessing.

Interaction with herdr-dog: herdr-dog also reads `.herdr/worktrees.yml`, so a
person using both the TUI plugin and wool gets their personal override in both.
That is intended.

### Workspace file schema

Decided by the person: use the vocabulary of
[razajamil/herdr-plugin-workspace-manager](https://github.com/razajamil/herdr-plugin-workspace-manager)
(a Herdr TUI plugin, `schema.json` at its repo root) **wherever it fits**, so
people coming from the TUI recognise it. Where wool needs something it lacks,
add a field in the same style and mark it as a wool extension in the README.

A workspace file is **one** of razajamil's `layouts[]` entries, minus `id`
(the repo decides which layout applies, so there's no `workspaces:` matching):

```yaml
version: 1                 # wool extension
env:                       # razajamil: layout env, merged under pane env
  APP_ENV: local
tabs:
  - title: Agent
    panes:
      - agent: default     # wool extension value: the person's own agent
  - title: Shell
    panes:
      - title: shell       # no command, no agent: a plain shell
  - title: Dev
    panes:
      - command: composer run dev
        setup: true        # this pane shows setup, then runs its command
```

Taken from razajamil (same names and meaning):
- `tabs[]`: `title` (optional), `panes` (required, at least one).
- `panes[]`: a flat list; the first is the tab's root pane, each later one
  splits from the previous one. `split`: `right | down`, also accepting
  razajamil's `vertical` (= `right`, side by side) and `horizontal` (= `down`,
  stacked). `size` (cells, 0–1 fraction, or `"30%"`) and `title` if Herdr's
  app commands can honour them; otherwise accept and ignore with a README note.
- Pane `command` (string) **or** `agent`, never both. Neither: a plain shell.
- Pane `env` (merged over the top-level `env`).
- Pane `prompt` (requires `agent`): the agent's first message (`task` in
  Herdr's `tab.new`).
- Pane `setup: true`: the one pane (at most one per file) that shows setup's
  output and runs its own `command` only after setup succeeds. In razajamil
  the setup commands live in the layout; in wool they live in the separate
  `worktrees.yml(.dist)` file (herdr-dog schema), so there is no `setup:`
  block here.

Wool extensions (my calls; builder may adjust the spelling, not the capability):
- `agent: default` — the person's agent: the first installed entry from Herdr's
  `knownAgents()` (most-picked first). Shared `.dist` files should use this.
  Any other value names an agent (`claude`, `codex`, …, matching a
  `knownAgents()`/`programs.json` entry), for personal overrides. **The shared
  file never needs to name an agent.**
- `waitForSetup: true` on a pane with a `command`: that command also waits for
  setup to succeed and doesn't run if it fails (for a second pane that needs
  `vendor/`, e.g. a queue worker). The `setup: true` pane implies it.
- `focus: true` on a pane: the pane that has the keyboard when the space
  opens. Default: the first `agent` pane, else the first pane of the first tab.
- `background:` top-level list of `{ command, env?, waitForSetup? }`: commands
  with no pane. Wanted by the person ("or the background"). How they're
  surfaced (e.g. a Herdr terminal without a pane that the agents list can peek
  at, plus a toast on nonzero exit) is the builder's call; a failure must be
  visible.

Validation is strict like razajamil's (`additionalProperties: false`): reject
unknown fields, `command` + `agent` together, more than one `setup: true`,
`prompt` without `agent`. Ship a JSON schema for the workspace file in the
repo (`schema/workspace.schema.json`) so editors can validate with a
`# yaml-language-server: $schema=…` line, as razajamil does.

Commands in panes run in the person's interactive shell and the shell stays
open when the command exits (Herdr's `tab.new {argv}` does this), so a dev
server crash leaves its output on screen.

With no workspace file (or a space wool doesn't lay out; see Detecting a new
worktree), setup still runs, in a tab of its own named "Setup" that does not
take focus.

### Validation errors

A broken config file shows a Herdr notification (`notify`, level error) naming
the file and the problem, and wool does nothing else for that worktree (no
half setup). Exception: if only the workspace file is broken, setup still runs.

## The person's own target (acceptance example)

For `svenluijten/quiz` (Laravel + Inertia + Vite), creating a worktree gives a
space with three tabs:

1. **Agent** — their agent (Claude Code), focused, usable immediately.
2. **Shell** — a plain shell in the worktree.
3. **Dev** — setup output (`.env` copied from main, `composer install`, `npm
   ci`), then `composer run dev` once setup succeeds. On failure the error
   stays on screen and the dev server does not start.

Its files (these go in `examples/laravel/.herdr/` and, committed, in `quiz`):

```yaml
# .herdr/worktrees.yml.dist
version: 1
worktrees:
  setup:
    - name: Copy .env
      run: cp "$HERDR_MAIN_WORKTREE/.env" .env
    - name: Install PHP dependencies
      run: composer install --no-interaction
    - name: Install JS dependencies
      run: npm ci
```

```yaml
# .herdr/workspace.yml.dist
version: 1
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
```

## Behaviour

### Setup output

Setup runs **in a visible terminal**, never hidden: in the pane marked
`setup: true` when wool lays out the space (the Dev tab shows `composer
install` scrolling by, then becomes the dev server), otherwise in an added
"Setup" tab that doesn't take focus. Exact mechanics are the builder's (e.g. a
runner script shipped in the mod folder that runs the steps with herdr-dog's
env vars, records the result, then `exec`s the pane's command on success).

Other commands that wait (`waitForSetup`, background ones) need to learn when
setup finished and whether it succeeded: e.g. a status file in the worktree's
private git dir that they wait on. Builder's call.

On success and on failure, post one Herdr notification (`notify`): "wool:
<branch> is ready" / "wool: setup failed at step '<name>'", with an action that
focuses the setup pane on failure.

### Detecting a new worktree

Herdr's mods get no event when a worktree is created. The shipped `worktree`
mod runs `git worktree add` (checkouts land in `~/.herdr/worktrees/<repo>/<branch>`),
then `space.new {folder: <path>}`. wool must notice new spaces by watching
`spaces()` (render re-runs when spaces change; no polling needed for that).

**Which spaces get what (decided by the person):**

| New space for a fresh linked worktree… | Setup | Layout |
|---|---|---|
| arriving as a single tab with a single plain shell (the New worktree dialog's default) | yes | yes |
| arriving any other way (the `worktree` mod's `{branch, tab, argv}` form, scripts or agents running `git worktree add` then `herdr-app do space.new --argv '["claude"]' --task …`) | yes | **no**: wool never closes, replaces or reorders existing tabs, and never starts a second agent |

In the second case setup may run while a briefed agent is also installing
dependencies; the person accepted that. Setup's "Setup" tab is added without
taking focus.

A space is a **fresh linked worktree** when:

- its folder is a **linked** worktree (git-dir ≠ common git-dir), and
- wool has never handled it: a marker file in the worktree's **private git dir**
  (`git rev-parse --git-dir`, e.g. `<main>/.git/worktrees/<name>/wool`), which
  survives restarts, is per-worktree, and never shows in `git status`, and
- it was created just now, so that installing wool, or using Open worktree on
  an old checkout, does not set up existing worktrees. E.g. the private git
  dir's creation time is within the last couple of minutes. Spaces that
  already exist when wool starts are never handled. Builder's call; must
  satisfy the anti-goal above.

Accepted edge: a worktree made with `git worktree add` in a terminal and opened
via Open worktree within that window counts as fresh and gets setup (and the
layout, since Open worktree gives a plain shell space). That's fine.

Do not depend on the `~/.herdr/worktrees` path (it's a constant in Herdr's
mod); linked-worktree + marker + freshness is the test.

Write the marker **before** starting anything, so a reload mid-setup or a
second Herdr window's copy of wool can't start setup twice (create it
atomically, e.g. `mkdir`, and treat "already exists" as "someone else has it").

"Single plain shell" is judged from what the space looks like when wool first
sees it: one tab, one pane, its program a `shell` (Herdr's `program` info on
`panes()`/`terminals()`), no agent. Builder handles the race where the space
appears before its first terminal is reported.

### Building the layout

Only for plain-shell spaces (above). Herdr's commands (`run(name, args)`)
return nothing, so new tab/pane ids must be found by diffing `spaces()` /
`panes()` after each command. Reuse the space's existing shell tab for a plain
shell pane, or close it, so the result is exactly the configured tabs in the
configured order (`tab.move`, `tab.select`, `pane.split`, `pane.focus`).
Builder's call how.

### Where wool runs

A mod only runs while its block is in the layout. wool needs to be running
whenever spaces are created but should be invisible when idle. Builder decides
how to dock it (e.g. `mod.json` `"place"` with a tiny size, a floating block
that renders nothing when idle and a small "setting up <branch>…" pill while
busy) and documents in the README/RECIPE how to add it to a layout, including
the shipped `main` layout (which is read-only: check what `layout.set` allows,
or document cloning it). This is the biggest open technical risk; resolve it
first with a spike.

### Remote machines

Spaces can live on other machines (`space.machine`). Out of scope for v1 unless
it falls out naturally from passing `on: space.machine` to `exec`/`readTextFile`
and `machine` to commands; if unsupported, skip remote spaces silently.

## Trust and security

A repo's `.herdr/*.dist` files run commands as the person when they create a
worktree. Same trust model as herdr-dog, `composer` scripts or npm
`postinstall`; say so plainly in the README's "Security and trust" section.
Herdr's own guidance says to tell people before installing a mod that it runs
programs and reads files outside its folder: the README and RECIPE must say it
does both.

## Deliverables

Repo at `~/Code/github.com/svenluijten/wool`, public on GitHub as
`svenluijten/wool`, topic `herdr-mod`:

- `mods/wool/main.js`, `mod.json`, any helper modules/scripts it needs.
- A YAML reader. Mods can't install npm packages at run time; vendor a small
  parser as a local module or implement the subset the two schemas need (maps,
  lists, strings, numbers, booleans, quoted strings). Must reject what it
  doesn't understand rather than misread it.
- `RECIPE.md` in Herdr's required order (Name + preview, What you see, How it
  behaves, Built from, Watch out, Done when), `preview.png`.
- `README.md`: what it does, install, config reference for both files, env
  vars, examples (Laravel, Node-only, setup-only), errors, security and trust,
  relationship to herdr-dog, license.
- `examples/` with `.herdr/` files for a Laravel app (the quiz target above)
  and a Node app.
- `LICENSE` (MIT).
- Tests for the parts that are plain logic (YAML reading, schema validation,
  `.yml`-over-`.dist` resolution, new-worktree decision), runnable without
  Herdr.
- `herdr-app check mods/wool` passes.

## Done when

1. In `quiz`, with the example `.herdr/` files in place, New worktree → branch
   name → the space opens with Agent (focused, agent running), Shell, and Dev
   tabs; Dev shows `.env` copy, `composer install`, `npm ci`, then `composer
   run dev`; `.env` matches main's.
2. Typing into the agent works before setup finishes.
3. A setup step that fails (e.g. `exit 1` as a step) stops setup, leaves the
   error visible in the Dev tab, does not start `composer run dev`, and posts an
   error notification.
4. Restarting the Herdr app or saving `main.js` (hot reload) does not re-run
   setup or re-add tabs to existing worktree spaces.
5. Open worktree on an existing (not fresh) checkout does nothing.
5a. `git worktree add` from a shell, then `herdr-app do space.new --folder <it>
   --argv '["claude"]' --task "…"`: setup runs in an added, unfocused "Setup"
   tab; the briefed agent's tab is untouched and keeps focus; no other tabs
   are added.
6. A `.herdr/workspace.yml` replaces the `.dist` entirely (e.g. a personal file
   with only a Shell tab gives only a Shell tab).
7. A repo with no `.herdr/` files behaves exactly like Herdr without wool.
8. A malformed config file produces an error notification naming the file.
9. `herdr-app check mods/wool` passes; logic tests pass.

## Left to the builder

Spelling of the wool extensions (keep razajamil's names where they exist); how setup
completion is signalled to waiting commands; how wool is docked; freshness test;
YAML implementation; notification wording; file layout inside the mod.
