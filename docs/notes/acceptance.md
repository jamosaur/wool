# Acceptance run

2026-11-04, Herdr app 0.1.12 on macOS, `svenluijten/quiz` (Laravel + Inertia +
Vite) with `examples/laravel/.herdr/*.dist` copied into its main checkout,
uncommitted. wool linked into `~/.config/herdr-app/mods/wool` and started once
with `herdr-app do mod.open --name wool`.

New worktrees were made the way the shipped worktree mod's New worktree does
it (`mods/worktree/main.js` `create()`): `git worktree add -b <branch>
~/.herdr/worktrees/quiz/<branch> HEAD`, then `space.new {folder}` (here from
the shell: `herdr-app do space.new --folder …`). The dialog itself was not
clicked through.

| # | Check | Result |
|---|---|---|
| 1 | New worktree → Agent (focused, running), Shell, Dev; Dev shows `.env` copy, `composer install`, `npm ci`, then `composer run dev`; `.env` matches main's | **Pass.** Tabs `Agent, Shell, Dev`, the original shell tab gone, focus on the Agent pane (Claude Code started). Status `ok`; `.env` byte-identical to main's (`cmp`); `vendor/` and `node_modules/` present; `composer run dev` running inside `wool-run.sh` (php `-S 127.0.0.1:8000`, vite). |
| 2 | Typing into the agent works before setup finishes | **Pass.** With a personal `worktrees.yml` adding a `sleep 15` step, text sent to the Agent terminal (`hc send`) while status was `running` arrived and Claude answered it. |
| 3 | A failing step stops setup, error stays visible in Dev, `composer run dev` doesn't start, error notification | **Pass.** Personal `worktrees.yml` with `exit 1` as step 3 of 4: Dev shows `==> Fail on purpose`, `this step fails`, `wool: step 'Fail on purpose' failed (exit 1)`, `wool: setup failed at step 'Fail on purpose'; not starting: sh -c composer run dev`, then a shell prompt. Step 4's file was never created; no php/composer process for that worktree. Toast: "wool: setup failed — Step 'Fail on purpose' failed in wool-acc-2." The toast's click action (`pane.focus` on the setup pane) was not clicked by hand. |
| 4 | Restarting the app or saving `main.js` doesn't re-run setup or re-add tabs | **Reload: pass. Restart: not run.** Saving `main.js` (in a real-folder copy, see note) re-ran wool in place; every existing worktree space kept its tabs and no worktree got a new claim. The app restart was blocked in this session (no permission to quit the person's app), so it is left to the person; `windows.json` does record `kept.main.wool`, which Herdr reopens on start. |
| 5 | Open worktree on an existing checkout does nothing | **Pass.** `space.new --folder` on `fix-phpstan-errors` (made the day before): one plain tab, no `wool` marker in its git dir. |
| 5a | `git worktree add` + `space.new --argv '["claude"]' --task …`: setup in an added, unfocused Setup tab; agent tab untouched and focused | **Pass.** Tabs `1` (the briefed Claude, still active and focused) and `Setup` (not active). Setup finished `ok`. |
| 6 | A personal `workspace.yml` replaces the `.dist` (only a Shell tab gives only a Shell tab) | **Pass** (with `setup: []` in a personal `worktrees.yml`, so there is no setup to show): one tab, `Shell`. With the `.dist` setup still in force, wool adds its Setup tab next to it, as the spec says. |
| 7 | A repo with no `.herdr/` files behaves like Herdr without wool | **Pass.** A throwaway repo + worktree: one plain tab, `git status` clean. wool's only trace is the empty claim folder inside the worktree's private git dir. |
| 8 | A malformed config file produces an error notification naming the file | **Pass.** Personal `worktrees.yml` with `run: |`: toast "wool: .herdr/worktrees.yml is invalid — line 4: block scalars (\| and >) aren't supported; …" (full path on the body's second line), and nothing else happened to the space. |
| 9 | `herdr-app check` passes; logic tests pass | **Pass.** `herdr-app check ~/.config/herdr-app/mods/wool` → `check passed`; `npm test` → all pass. |

## Found and fixed during the run

- The first toast for a bad file put the whole path in the title, which the
  toast truncates before the file name. Now the title is
  `wool: .herdr/<file> is invalid` and the full path is in the body.
- `setup: []` added an empty Setup tab. An empty list now counts as no setup.

## Notes for development

- **Hot reload doesn't follow the symlink.** With `mods/wool` linked to this
  repo, saving files in the repo did not reload the running copy (three tries;
  the old build kept handling new spaces). A real folder reloads at once.
  After editing through the link, restart wool: `herdr-app do mod.open --name
  wool` twice (the first closes it).
- Each check's worktree, branch and space was removed afterwards.
