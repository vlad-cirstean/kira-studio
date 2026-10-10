# P245 result

Plan: `P245-plan.md`. All 12 planner defaults approved.

## Delivered

- Space root compiles git-ui. git-ui `kv:` root, `--vscode-*`/`--kv-*` layer, `vscode-bridge.css` removed.
- `packages/git-ui/src/theme/git.css`: graph scale (`--kira-graph-*`), `@theme` entries, SlickGrid rules in `@layer components`.
- tailwind-merge registers `graph-xs..lg` text and `graph-row`, `graph-row-compact`, `graph-h-xs` spacing (`packages/theme/src/lib/utils.ts`).
- Components converted to app utilities and shadcn-vue: `Button variant="link"` for inline links, `ViewToolbar` for `AppToolbar`.
- Lint: `check_no_kv_layer` bans `kv:`, `--kv-`, `--vscode-` in git-ui and `packages/theme/src`. Token and class-conflict checks updated.
- New UI test: graph font size scales grid text and decorated row height.
- Docs: ARCHITECTURE theme sections rewritten, vscode-bridge/Monaco open item deleted, SPEC row Done.

## Baseline deltas

Only the two git visual baselines regenerated. Visible changes:

- File tree indent 8px to 14px per level (approved).
- Uncommitted-strip glyph is now a hollow dashed ring. `fill-none` previously lost to unlayered `.kv-lane-N` fill.

## Notes

- `.kv-*` class names stay as DOM hooks (test locators, click delegation), no styling, except slick rules in `git.css`.
- `codicon.css` is unlayered. Its `font` shorthand beats layered utilities, so badge and chevron icons render at 16px, as before. No `text-graph-*!` overrides added.

## Deviations

- `ReviewCommentsPane` raw button converted to `Button variant="link"`.
- `CommitMeta` PR icon uses `CodiconIcon` at default 16px.
- Extra fix commit between planned commits 7 and 8 (badge icon size, meta line size).
