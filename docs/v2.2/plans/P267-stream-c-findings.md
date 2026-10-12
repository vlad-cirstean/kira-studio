# P267 Stream C findings

Base: foundation tip 795948768. Branch p267-c. Chunks C1-C10 committed in order.

## Needs from other streams (foundation / R)

- `docs/ARCHITECTURE.md` ~4059: stale `dateFormat` path. Foundation owns it.
- PERMANENT `U47` lines for `SearchBox.vue` and `SearchResults.vue` go stale once R extends U47 to accept `useActiveDescendant`. R deletes them.
- `scripts/check-theme-classes.sh`: false positive when `split="path"` shares a line with a `class` attribute. Workaround: keep `split="path"` on its own line.
- `scripts/check-conventions.ts` N1 forces camelCase `.ts` names. Plan §5.3 names `automations-{editor,recurring,smart,runs}.ts`. Shipped as `automationsEditor.ts`, `automationsRecurring.ts`, `automationsSmart.ts`, `automationsRuns.ts`. R either keeps camelCase or exempts `scenarios/` in N1.
- `LogLines` has no follow control and no `scrollToIndex`. Docker Follow / jump-to-end controls dropped in C4. Foundation adds both to restore them.
- git-ui has no vue-query provider. `PullStrategyPicker` preview stays on its own async state (TanStack declined: no client in the git-ui mount, Space `GitPanel` owns the host).
- Space `GitPanel` does not consume git-ui emits. Stream B owns the fix.
- `TabStrip` chip `el.focus()` after a keyboard move: chip is not focusable, inner button holds focus. Foundation's `useSortableReorder` should focus the inner button.

## Named exemptions (worklist hits kept)

- `LogLevelField.vue` `selectTestId` prop (U97, `TestId`): callers in Studio and Space pass `select-test-id`. Rename needs A and B edits. Foundation owns the file.
- `TextPromptDialog` emits `cancel`; B10 wants `close`. Callers live in the apps.
- `packages/workbench/src/behaviour/persisted.ts` (U43), `asyncAction.ts`, `inlineEdit.ts` (U51), `bridge/log.ts`, `bridge/fireAndForget.ts` (U99): foundation files.
- `UncommittedChangesStrip.vue` (U91): tooltip text differs from the visible label; `TruncatedText` only shows its own text.
- `git-ui/src/lib/badgeClass.ts`, `linkify.ts` (U89): named built-ins.
- PERMANENT group C lines (LogsView U11, OriginIcon U34, App.vue U41, CommitGrid U62, SearchBox/SearchResults U47, layoutClient U46, gridKeyboard U47) stay: each is a real requirement.

## Results

- C7 (shared state / lib dedupe) found nothing real in owned dirs. No commit.
- `BranchPickerBranches` dead tag arms dropped in C8.
- C3 split a/b (more than 25 files).
- `FileTree` row templates merged into one container (role by `listMode`).
- `.vue` over 600 lines left: `CommitGrid.vue`, `App.vue` (hosts, exempt).

## Worklist (§5.4)

U21v, U43-U53, U83-U103 regexes over owned dirs: 0 hits in owned files apart from the exemptions above. `useFocusableInteractive` ignores: 0. `TestId\b|'update:modelValue'`: 0 apart from `LogLevelField`.
