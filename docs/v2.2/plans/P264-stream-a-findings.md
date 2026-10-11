# P264 Stream A findings

Base: foundation result `199cf88a8`. Branch `p264-a`, worktree `/home/user/kira-p264-a`.

## Status

- `scripts/ui-primitives-allowlist/stream-a.txt`: `permanent` lines only, each with reason. Guard green.
- Stream-end suites NOT run to completion (coordinator order): `test:ui:studio`, `test:visual:studio`.
- `test:unit`: 1827 pass, 1 fail (`beautify-depth.spec.ts` "extreme nesting", 5 s timeout under load; 3.3 s alone, passes). Not from this stream.
- Partial UI runs: A3/A4 sets, plus collections, console, document-view-readonly, slick-grid, list-keyboard (44 pass; `console.spec.ts` saved-queries failed once under load, passed alone).
- Full UI run aborted near test 409 of 433. Last visible failure: `slick-grid.spec.ts:1259` ("staged insert rows on screen"). Unverified; rerun serially.

## Deviations and open items

- Reveal expiry (`api/state/revealExpiry.ts`): VueUse `useTimeoutFn` gates `immediate` on `isClient`, false in bun unit env. Arm with `{ immediate: false }` plus `start()`. Fixed, 4 unit specs green.
- `cell-editor` spec fails with persist debounce 150 ms, passes with 300 ms. Kept 300 with permanent U46 on `grid/SlickGridHost.vue`.
- `list-keyboard.spec.ts` covers project tree, collections tree, HTTP history, gRPC history. Not covered (fixtures too heavy): Browse, KeyValuePane, Documents, Stream, console result grid, SavedListMenu type-ahead.
- Keyboard pass by hand not done.
- Known flakes, left: ui-timing console keystroke p50, scroll p95.
- Permanents: U47 `api/EnvironmentsView.vue`, `api/VariableRow.vue`, `shared/fields/FieldRowsTable.vue`; U62 `console/ConsoleView.vue`, `shared/fields/FieldRowsTable.vue`; U46 `grid/SlickGridHost.vue`; U41 pre-existing.
