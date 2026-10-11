# P264 foundation tests: notes

Source gaps found while writing the foundation specs. No source edited by the tests group.

- `package.json` `test:unit` lacks `packages/theme/src`. `paneResizeMath.spec.ts` (theme) runs only
  via `bun test packages/theme/src`; plan §3 table adds the path. Add it or the spec never runs in
  the hook.
- Only `ProjectTree` and `OpLogPanel` bind `useListNavigation` at this commit. Plan §3.6 list-keyboard
  surfaces not yet bound (Browse, HTTP/gRPC history, KeyValuePane, Documents, Stream, SavedListMenu
  type-ahead; Space repo tree, repo search list, GitPanel repo list, ReposDialog, Memory list) have
  no spec. Each stream binding a list extends `list-keyboard.spec.ts` for it.
- `ProjectTree`: `row.focus()` without a selection change leaves `activeKey` (selection) on the old
  row, so Shift+F10 on a merely focused row opens nothing (`rowSelector` is the tabindex=0 row).
  Arrows and clicks move both together; the spec uses arrows. Decide if focus should set selection.
- Space `list-keyboard.spec.ts` covers the Operations dock only (the sole bound Space list).
- `apps/kira-studio/tests/unit/document-byte-label.spec.ts` fails (2 tests): expects "208 bytes",
  the foundation's `formatBytes` now yields "208 B". Update the expectation to `formatBytes` output
  (existing spec, outside this tests group).
