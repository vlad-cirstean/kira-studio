# P164 Small UI fixes

Not a plan. What changed and how verified.

## Result

**Status bar (both apps).** Removed "no selection" (`packages/workbench/src/components/StatusBar.vue`) and
Kira Studio's engine-status item (`apps/kira-studio/frontend/src/workbench/StatusBar.vue`). Deleted
`workbench/state/engine.ts` and its `App.vue` init. Shared bar now renders the left group only when the
`left-extra` slot is filled; right group uses `ml-auto`. Dropped `engine-status` assertions from UI and
e2e-real specs. `lint:dead` clean.

**New connection dialog.**
Root cause of the greyed tiles: `:data-off="!SUPPORTED_KINDS.has(kind)"` renders `data-off="false"` (Vue
keeps `false` on non-boolean attributes). Tailwind `data-[off]` matches attribute presence, so every tile got
`opacity-40`, `cursor-default` and no hover. Fix: bind `undefined` when supported. Step 1/Step 2 breadcrumbs
removed. UI test added in `connection-dialog-tabs.spec.ts`; confirmed failing before the fix.

**ADE user step without prompt.** `adeflow/parse.go`: prompt optional on a `session: true` user stage.
Writer omits the `prompt` key when empty. No TS validation required a prompt. Run engine already copes:
`composeStageMessage` always sends the header lines and skips an empty prompt; compose.ts guards the same.
Tests: Parse row flipped to valid, writer subtest for empty prompt. Placeholder marked optional.

**SQL colours.** Root cause of the dark-on-dark filter text: `AutocompleteField` paints via
`monaco.editor.colorize()`, which uses the global theme. `defineKiraTheme` only defined `kira-editor`; the
global theme stayed default light `vs` until an editor mounted. WHERE/ORDER BY text rendered with `vs`
colours (black identifiers, dark red strings) on the dark field. Fix: `setTheme(KIRA_EDITOR_THEME)` at
definition, so inputs and the console use one theme built from the `--kira-syntax-*` tokens (VS Code Dark+
values). No second colour table. App is dark-only (no light theme exists), so only dark verified, by Playwright
screenshot before/after.

**Visual baselines re-captured (studio):** workbench-shell, data-grid, console, schema-dialog (status bar
change), connection-dialog (breadcrumbs). Space baselines unchanged.

**Follow-up.** Dead `EngineService`/`engineStatus` removed (Go service, registration, bridge call, test mocks, ARCHITECTURE mention).
