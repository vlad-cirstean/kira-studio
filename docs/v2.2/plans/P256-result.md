# P256 result

git-ui now speaks the app's shadcn-vue vocabulary. Design facts live in `docs/ARCHITECTURE.md`
("Two font-size settings", "Git module follows the app look").

Commits: dialog forms on `Field`; detail tree and meta; toolbar and search on workbench parts; chips,
notices and secondary text; lint guard; visual baselines; docs.

## Mismatches

Fixed, confirmed in re-recorded PNGs or by a probe:

- V1 repo settings: `FieldSet`/`FieldLegend` sections, 12px gaps, muted labels, `NumberStepperInput`, auto-stash note
  in a warn `Alert` (`git-repo-settings-dialog.png`).
- V2 stash dialog: `(-u)` no longer splits into flex items, `<code>` is `font-data` (`git-stash-dialog.png`).
- V3 detail tree: `TreeTwisty`, folder icon, normal weight, status-letter filters dropped (`git-graph-detail.png`).
- V4 detail meta: `3h · 0202020` spaced (`git-graph-detail.png`).
- V5 empty detail pane: vertically centred (probe screenshot with detail open and no selection).
- V6 toolbar separators: `Separator` with `bg-border-strong`, computed `rgb(49, 49, 49)`. `git-graph.png` stayed
  inside the diff threshold, so not re-recorded.
- V7 branch picker: secondary text on `text-kira-sm`, "worktree" chip is a `Badge`, force-delete strip is a warn
  `Alert`. The mock repo has no worktree or force-delete row, so those two are by code only
  (`git-branch-picker.png` covers the text scale).
- V8 search: `SearchOptionToggles` with the app labels "Whole word"/"Regular expression" (probe read
  `aria-label`s; testids unchanged); empty and footer copy `text-subtle`.

Kept by default: V9 (menus already matched), V10 (D5 HEAD tint + inset bar, D6 no column headers), D8 added-file
`text-ok`. Kept `<button>` rows, `<details>` in `ForcePushDialog`, `KuiColumnResizeHandle`, SlickGrid rules in
`theme/git.css`.

## Deviations and plan gaps

- StashRows "auto" chip also became a `Badge` (same solid-pill pattern as the origin pill).
- Blocker lists in dialogs (Checkout, CherryPick, Stash pop, Worktree) became `Alert variant="warn"`
  (`destructive` for Worktree blockers). Plan named only data-loss lines.
- `Alert` is always `role="alert"`, so dialogs announce their warnings. No spec depends on the old plain `<p>`.
- Plan step 6 listed a `git-graph.png` re-record; the pixel diff was under threshold.
- `ReviewCommitRow` twisty emits `focus-row` + `toggle`, because `TreeTwisty` stops click propagation to the
  header listener.

## Verification

- `playwright --project=visual git-module --update-snapshots`: 5 pass (2 new, 2 re-recorded, 1 unchanged); PNGs read by hand.
- `playwright --project=ui repo-`: 80 pass. `ade-v2-base-rebase ade-v2-force-push ade-v2-panel git-`: 47 pass.
  `ade-v2-review`: 24 pass.
- `bun test packages/git-ui/src`: 241 pass.
- `bun run lint`, `bun run typecheck` clean (hook, every commit).
