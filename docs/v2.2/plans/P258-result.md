# P258 result

Git module mirrors Studio recipes. Nothing taken from Agents/ADE or Space explorer. Plan: `P258-git-ui-studio-language.md`.

Commits: badges and lanes; single-line rows; detail panes and file tree; popovers and menus; dialogs, banners, review; view head; Space host views; `kv-` removal; specs; baselines; docs.

## What changed

- Ref badges use Studio `Badge` tones (branch `ok`, remote `info`, tag/stash default, detached `warn`, PR open/draft/closed per `prBadgeClass`). Lanes use `--kira-conn-*`.
- Commit rows are one line, one height (`--kira-graph-row-h`). Variable-height machinery deleted. Author/date muted. HEAD row not bold, no band.
- New `GitViewHead` (colour dot, repo name, branch, ahead/behind, operation badge) above graph and review. Host passes `repoHead`.
- Detail head, review headers, Space diff toolbar and multi-diff file header are `ViewToolbar`.
- Section heads, empty lines, list rows, menus follow `SavedListMenu`. Row menu sizes to its labels (`w-max`).
- Dialogs: `size="kira-lg"` controls, `FieldDescription`/`FieldError`. Banners: `Alert`-style with 16px icon.
- Fake `Alert` empty states replaced by `Empty`/`EmptyMedia`/`EmptyTitle`.
- `kv-` marker layer removed. Read hooks are `data-testid`, runtime grid classes `kira-*`.
- Lint: `check_no_kv_layer` bans `kv-` anywhere; `check_git_ui_type_scale` bans `font-semibold|font-bold|text-graph-lg` in git-ui.
- Deleted: `--color-git-merged`, `--text-graph-lg`, `--kira-graph-t-lg`, `--kira-graph-row-h-compact`.

## Fixes found by specs

- `handleChunkLayout` now calls `invalidateAllRows` + `render`. With uniform heights `invalidateRowHeights` no longer redrew rows, so graph SVGs stayed empty after late layout.
- `FileTree` root lost its `file-tree` testid to `DetailPane`'s override. Override removed.
- `review-row-` prefix selector now excludes `-header` and `-actions`.
- Tag badge spec asserts a filled Studio Badge with matching icon, not a 15% tint.

## Verified

- `test:ui:space`: 414 passed.
- Visual `git-module`: 6 passed after re-record. Settings and ade-workflow-graph visuals unchanged.
- Baselines changed: `git-graph`, `git-graph-detail`, `git-stash-dialog`, `git-repo-settings-dialog`, `git-branch-picker`. New: `git-row-menu`.
- Typecheck, biome and all check scripts pass in every commit hook.
