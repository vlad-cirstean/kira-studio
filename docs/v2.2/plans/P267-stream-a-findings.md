# P267 Stream A findings

Branch `p267-a`, base 795948768. Commits: A1 ff7f966a4, A2 d595f0af3, A3 592fc23c9, A4 8c1a14c03,
A5 44e46c650, A6 65fee51ed, A7 50ab94102, A8a 9c407c42f, A8b 936d75297, A8c edb01ad29,
A8d 74feb65fe, A8e aceb1e1c3, A9 7085261eb. A10 sweep in the commit carrying this file.

## Sweep result

- §3 worklists U83-U103 over `frontend/src`: 0 hits except U100 `api/CopyAsCurlDialog.vue`
  (below).
- `biome-ignore lint/a11y/useFocusableInteractive`: 0. `TestId\b` and `'update:modelValue'`: 0.
- `.vue` over 600 lines: `views/grid/SlickGridHost.vue` 2751, `views/console/ConsoleSlickGrid.vue`
  881, `editor/MonacoHost.vue` 786. All engine hosts, named exemptions in the lint script.
- Specs written, not run: `apps/kira-studio/tests/ui/ui-leftovers.spec.ts` (all §5.3 A items).
  Updated: `connection-dialog-tabs.spec.ts` (Save stays enabled; invalid throttle refused on
  Save), `connections.spec.ts` (`.uri-note` to `connection-uri-note`).
- Not run: UI, e2e, flow suites. Go tests of A4 touched packages ran green in that commit.

## Deviations from the plan

- B9: `useResponseBody` timer removed; `InlineState` owns the 300 ms delay.
- `Button :pending` bound to query `isFetching` in SchemaBrowser. FiltersDialog uses
  `:pending="loading || saving"` plus `:disabled="!!loadError"`.
- `TreeTwisty` keeps `cursor-pointer` and `tabindex -1`; document twisties are no longer tab
  stops.
- Phase-history comments stripped in the big split files.
- `DocumentRow`/`DocumentTree` keep the `@toggle-path` template attribute.
- `FieldRowsTable`, `DateTimePicker`, `TimestampPane` converted to `defineModel`.
- `EnvironmentSelect`, `MethodSelect` are `PickerTrigger` (size kira).
- `isPrimaryModifier` type widened.
- `CopyAsCurlDialog`: read-only fields only; no `dirty` on `DialogContent` (U100 hit kept).
- Store busy flags (`ref` pending in Pinia stores) not converted to `useAsyncAction`.
- s3 `formatBytes` has no conformance text; Go test updated only where text exists.
- `editDirty` now published by `DocumentView` and `KeyValuePane` through `usePublishEditDirty`.
- Keyvalue edit-popover error is an `Alert` (testid `keyvalue-edit-error`); add popover gets
  `keyvalue-add-error` and a new `keyvalue-add-name-error`.
- Connection dialog: Save is always enabled; `useFormErrors` shows the error, focuses the field,
  switches tab. Credential note uses `FieldDescription`. Engine-picker search resets on step
  change. `uriNote` resets on tab switch; it now has testid `connection-uri-note`.
- Stream search toolbar renders only when not reconnect-gated.
- Saved filter pin button gets testid `saved-entry-pin` (needed by the filter-history spec).
- `isError`/`isFetching` chains replaced by `QueryState` in `StreamFilterRow`.
- U6 allowlist in `check-ui-primitives.sh` gains `ConsoleResultStrip.vue`.
- Tooltip changes follow V6 `TruncatedText` rule; virtual rows keep the three-class spelling
  where `TruncatedText` cannot wrap.

## Needs from other streams

- C: `AdvancedPane` must expose `select-test-id` (kebab-case) for `LogLevelField`; Stream A
  `selectTestId` consumers use the new name.
- PERMANENT lines for `ConnectionEnginePicker.vue` U36/U37 (moved from `ConnectionDialog.vue`)
  stay: engine tile is a radio card, not a content box or row.

## Spec caveats (written blind)

- Tooltip z-index spec probes `--kira-z-tooltip` on a detached node; a tooltip cannot be hovered
  behind the prompt scrim.
- Response-formatting `InlineState` spec relies on a body over 65 536 chars reaching the worker
  and taking over 300 ms.
- Key-value and Browse specs reuse the redis fixture; the copyName expectation `user:1:bighash`
  assumes the key leaf name.
