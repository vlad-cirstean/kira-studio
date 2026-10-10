# P254 result

Done. Commits on `p254-P` (base: v2.0 at `12b0c71e0`, rebased onto current v2.0 at finish).

Landed per plan: hoist `AutocompleteField` and helpers to `packages/workbench` (D5); multiline, `autoClose`, `openOnEmptyToken` (D6); `braceToken`/`envToken` and `scriptVars.ts` (D7-D9); three force-mounted tabs, Collection after Name, "Uses:" chips with resolved values, per-tab error badges (`scriptErrors.ts`, D10-D14); `new-recurring` submenu, `ScriptDialog` prop `schedule` and `toggleSchedule` removed, row menu "Edit schedule…" (D1-D3). No backend change.

Tests: `termflow/editor_test.go` + contract `script-editor` and `automations-editor.spec.ts` per app (IPC split); `braceToken`/`envToken` unit cases; `automations-recurring`, `automations-smart` and both `prompts-two-windows` e2e-real specs updated; `script-dialog-visual-linux.png` re-recorded.

Deviations and notes:
- Contract names use `CustomScriptsService.Create` / `ScriptRunsService.Preview` (plan wrote `CustomScripts.Create`). Contract args hold a nil-free param (`options: []`) so the UI payload matches. UI spec compares a subset (name, kind, command, collection, params, cron, enabled, confirm): the schedule zone depends on the browser.
- Empty-field errors show once the field is edited; Save is disabled from the start (full error set), so no "save attempt" state exists.
- Visual baseline is the empty new-script dialog: no badge or Uses chips appear there by design.
- `automations-module`, `automations-runs`, `automations-scripts` needed no change (still pass).
- P250 had not landed on v2.0 at finish. Whoever lands second updates the other's lines: P250's added `new-recurring` use in the Space recurring spec, and any param/schedule interaction in its specs now needs a tab click (`script-dialog-tab-params` / `script-dialog-tab-schedule`).
