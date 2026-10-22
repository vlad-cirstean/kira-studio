# P325 Part 2: Documents, KeyValue and Browse keep data on drop

Base: Part 1 landed (`useStaleDataStore`, `tabNeedsReconnect`, `StaleDataStrip`,
`writeDisabledReason(cap, stale)`, `KEEPS_DATA_ON_DROP`, dock `'connection-lost'`). One
sequential Sonnet implementer. Frontend only.

No stream split. All three views share `createImmediateMutator`, `objectStore` and the keyvalue
host seam, and Browse embeds `KeyValuePane`.

Read Part 1's "Shared audit facts" and "Design" first. Everything there applies here.

## Audit (CodeGraph)

**Documents** (`views/documents/`):
- Page store dropped on disconnect (document kind's `dropResources`).
- `DocumentView.vue`:
  - Gate at `:420`.
  - Write gates: `canInsert` (`:75`), `canDelete` (`:76`), `editGateFor(row)` (`:93`).
  - Toolbar add goes through the `DocumentToolbar` `canInsert` prop (`:379`).
  - Row menu (`documents/menu.ts` `rowMenu` `editGate`/`deleteGate`, `:298-299`).
  - Row Edit/Delete icons (`:515-526`).
  - `onDeleteRow` (`:309`).
  - Editor Save `@save="commitCreate"`/`commitEdit` (`:445`, `:554`).
- `useDocumentEdit.ts`: `commitCreate` (`:51`) and `commitEdit` (`:75`) call
  `saveNewDocument`/`saveDocumentEdit`.
- `documents/mutations.ts`: all three writes go through `createImmediateMutator`.

**KeyValue** (`views/shared/keyvalue/`, Redis/S3):
- Page store dropped on disconnect.
- `KeyValuePane.vue`: gate at `:188`, only with `tab`. The browse preview pane has no gate, and
  `BrowseView` gates the split.
- `useKeyValueGate.ts`: `canUpdate`/`canDelete`/`canInsert` (`:41-43`) and `objectEditGate`
  (`:68`), which feeds `useKeyValueActions.selectRow`'s `onEdit` (`:58-73`). It also drives:
  - `KeyValueToolbar` Add (`:155`, `KeyValueAddPopover` and `addKey`), Delete (`:175`) and the
    Edit popover (`KeyValueEditPopover`, `saveValueEdit`);
  - the object-draft Save (`KeyValuePane.vue:250-258`, `saveObjectEdit`);
  - `onDeleteKey` (`useKeyValueActions.ts:91`, `deleteKey` or `objectStore.deleteObject`);
  - Upload (`onUpload`, opens `UploadObjectDialog`).
- `keyvalue/mutations.ts`: `saveValueEdit` and `deleteKey` go through `createImmediateMutator`.
  `addKey` calls `data.mutate` directly (`:54-72`).
- Host seam `host.ts`: `KeyValueHost` resolves a tab or the browse preview
  (`${tabId}::preview`).

**Browse** (`views/browse/`):
- No page store. `rt.nodes` survives on drop. `browse/state.ts:120` keeps nodes on a
  disconnected read and unhydrates.
- Gate at `BrowseView.vue:421`. It hides the list and the preview split.
- Writes:
  - Upload toolbar button: `canUpload`, `:251-255`.
  - Container-row Upload: `browse/menu.ts:45`, `objectStore.uploadMenuItem`. It is shared with
    the project tree, which shows no stale data.
  - Object-row Delete: `browse/menu.ts:94-119`, `objectStore.deleteObject`.
  - `UploadObjectDialog.vue:42` runs `objectStore.uploadObject`.
- Download is a read; it stays.

## Design

- **Stamps.**
  - Documents `load` apply calls `useStaleDataStore().stamp(tabId, connectionId)`; KeyValue
    `load` apply calls `stamp(viewKey, host.connectionId)`.
  - Browse `load` success (`browse/state.ts:114`) calls `stamp(tabId, connectionId)`.
- **Gate tab.** `KeyValueHost` gets `gateTabId: string`. `resolveTabHost` sets it to the viewKey.
  BrowseView's registered preview host sets it to the browse tab id. A per-view helper
  `isStale(viewKey)` in `useKeyValueGate` uses
  `useStaleDataStore().isStale(viewKey, host.gateTabId, host.connectionId)`.
- **Browse preview.** The split stays visible while stale. Browse shows one `StaleDataStrip` at
  the top of its content. The preview pane shows none, since the browse strip covers the split.
  The preview's writes lock through the browse tab's gate. The preview counts as stale when
  either the browse tab or the preview data is stale, so `isStale(preview)` must also check the
  browse key.
- **Keep pages.** Add `'document'` and `'keyvalue'` to `KEEPS_DATA_ON_DROP`. Browse needs no entry
  (`noDrop`).
- **Immediate-write backstop.** Built here, in `views/shared/immediateMutation.ts`.
  `createImmediateMutator` gets an option `isStale?(tabId): boolean`. When it returns true, the
  mutator throws `new Error(t('studio.common.connectionLost.error'))` before `data.mutate`.
  Callers already route a thrown error to their action-error slot.
  - Documents and keyvalue pass real checks.
  - Stream is wired in Part 3, which then makes the option required.
  - `addKey` and the `objectStore` writes are not mutator calls. Their callers check stale before
    calling, so the gated UI is backed in the same tick.
- **Open editors at the drop keep their buffer.** The Documents edit/create buffer and the KeyValue
  edit popover or object draft stay open and copyable. Only Save is blocked: disabled, with the
  connection-lost tooltip. Nothing the user typed is discarded.
- **Delete confirm racing a drop.** `onDeleteRow`, `onDeleteKey` and the browse object Delete
  re-check stale after the confirm resolves, before mutating.

## Changes

1. **`views/shared/immediateMutation.ts`**: the `isStale` option and throw, per Design.
2. **`views/documents/state.ts`**: stamp in `load` apply. Add store method
   `isStale(tabId)` as `useStaleDataStore().isStale(tabId, tabId, tab.connectionId)`.
3. **`views/documents/mutations.ts`**: `isStale: (id) => useDocumentViewStore(pinia).isStale(id)`.
4. **`views/documents/DocumentView.vue`**:
   - `stale` computed. `hasPage` computed (`pageVersion.n` plus `getPage`).
   - The gate becomes `needsReconnect && !hasPage`. Add
     `<StaleDataStrip v-if="stale" testid="document-stale" …/>` above the existing error strips.
   - `canInsert` and `canDelete` get `&& !stale`. `insertTitle`/`deleteTitle` pass `stale` to
     `writeDisabledReason`.
   - `editGateFor` returns `{ editable: false, label: t('studio.common.connectionLost.tooltip') }`
     first when stale.
   - The editor Save controls (`DocumentEditor` save at `:445`/`:554`, via its existing
     disabled/pending prop) get `|| stale`.
   - `onDeleteRow` re-checks stale after confirm.
5. **`views/documents/useDocumentEdit.ts`**: take `isStale: () => boolean`. `commitCreate` and
   `commitEdit` return early, setting the action error to the connection-lost error, when stale.
   `startEdit` already goes through `isEditable` (`editGateFor`).
6. **`views/shared/keyvalue/host.ts`**: add `gateTabId` to `KeyValueHost` and `resolveTabHost`.
   `BrowseView.vue`'s `registerKeyValueHost` supplies the browse tab id.
7. **`views/shared/keyvalue/state.ts`**: stamp in `load` apply. Add `isStale(viewKey)`. It checks
   the viewKey's own stamp and, when `gateTabId !== viewKey`, the gate tab's stamp too.
8. **`views/shared/keyvalue/useKeyValueGate.ts`**:
   - Add a `stale` computed. `canUpdate`, `canDelete` and `canInsert` get `&& !stale`.
   - `objectEditGate` returns `{ editable: false, reason: t('studio.common.connectionLost.tooltip') }`
     first when stale. The other reasons pass `stale` to `writeDisabledReason`.
   - Return `stale`.
9. **`views/shared/keyvalue/useKeyValueActions.ts`**:
   - `saveObjectEdit` returns early when stale.
   - `onDeleteKey` re-checks stale after confirm.
   - `selectRow` publishes `stale` on `SelectedCell`.
   - Add `gate.stale` to the republish trigger, so a selected row's dock locks at the drop.
10. **`views/shared/keyvalue/mutations.ts`**:
    - Mutator gets `isStale: (k) => useKeyValueViewStore(pinia).isStale(k)`.
    - `addKey` throws the connection-lost error before `data.mutate` when stale.
11. **`views/shared/keyvalue/KeyValuePane.vue`**:
    - The gate becomes `needsReconnect && !hasPage`, using `gate.page`.
    - Add `<StaleDataStrip v-if="tab && gate.stale.value" testid="keyvalue-stale" …/>` for a
      real tab only.
    - Object-draft Save `:disabled="gate.stale.value"`.
    - The `watch` at `:123-131` stays: it already refuses to load while `needsReconnect`.
12. **`views/shared/keyvalue/KeyValueToolbar.vue`**, **`KeyValueEditPopover.vue`**,
    **`KeyValueAddPopover.vue`**:
    - Labels come from the gate, so they pick up the stale reason.
    - Each popover's Save gets `:disabled` when its `disabled` prop turns true while open. Pass
      the gate's stale through the existing `disabled` prop.
13. **`views/browse/state.ts`**: stamp in `load` success. Add `isStale(tabId)`.
14. **`views/browse/BrowseView.vue`**:
    - `stale` computed.
    - The gate becomes `needsReconnect && !hasNodes`, where `hasNodes` means `rt.nodes.length > 0`.
    - Show `<StaleDataStrip v-if="stale" testid="browse-stale" …/>` above the split.
    - `canUpload` gets `&& !stale`, and its tooltip passes `stale`.
    - Pass `stale` into `menuForNode`.
15. **`views/browse/menu.ts`**:
    - `menuForNode(tabId, connectionId, node, stale)`.
    - `containerRowMenu` omits the upload item when stale. Follow the item's existing
      omit-not-disable rule (`objectStore.ts:32-36`).
    - `objectRowMenu`'s Delete gets `disabled: stale` with the tooltip. After the confirm it
      re-checks `useBrowseViewStore().isStale(tabId)`.
16. **`workbench/UploadObjectDialog.vue`**: the submit refuses when the originating container's
    tab is stale.
    - `objectStore.openUploadDialog` gets an optional `tabId`, stored on its state. Browse and
      KeyValue callers pass theirs; the tree passes none.
    - The dialog checks `useStaleDataStore().isStale(tabId, tabId, connectionId)` when `tabId`
      is set.
17. **`state/tabs.ts`**: add `'document'` and `'keyvalue'` to `KEEPS_DATA_ON_DROP`.
18. **`packages/theme/src/i18n/en.json`**: add `studio.common.connectionLost.error`:
    "Can’t save: the connection was lost."
19. **`docs/ARCHITECTURE.md`**: extend Part 1's line with Documents, KeyValue and Browse.

## Tests

- **Backend flow test: none.** There is no backend change.
- **Unit test: none.**
- **UI spec** `apps/kira-studio/tests/ui/immediate-write-connection-drop.spec.ts`. Use
  `mongoFixture.ts` and `redisFixture.ts`, and disconnect through the tree menu as in Part 1.
  Three tests:
  1. **Documents:** open a collection and start editing a document. Disconnect.
     - `document-stale` visible, rows still render, the edit buffer is still open.
     - Save, Add and the row Delete are disabled.
     - Reconnect through the strip: Save enabled.
     - No `mutate` before the reconnect.
  2. **KeyValue tab (Redis string key):** disconnect.
     - `keyvalue-stale` visible, value still shown.
     - Edit, Add and Delete are disabled. The dock chip reads "Connection lost".
     - Reconnect: enabled.
  3. **Browse (Redis or S3):** load a level and select a leaf so the preview shows. Disconnect.
     - `browse-stale` visible, the list and the preview still shown.
     - Upload is disabled and the object Delete item is disabled. The preview Delete is disabled.
     - No `mutate`.

## Verification

1. `bun run typecheck` and `bun run lint` pass.
2. `bun run test:ui:studio -- immediate-write-connection-drop grid-connection-drop document-new-save-double-submit document-view-readonly tree copy-coverage`
   passes, plus every spec whose name holds `keyvalue`, `browse` or `redis`, as found by grep.
   Fix any spec that assumed the page drops.
3. Grep checks for the orchestrator:
   - `useStaleDataStore().stamp` appears in `documents/state.ts`, `keyvalue/state.ts` and
     `browse/state.ts`.
   - `StaleDataStrip` appears in `DocumentView.vue`, `KeyValuePane.vue` and `BrowseView.vue`.
   - `isStale:` appears in `documents/mutations.ts` and `keyvalue/mutations.ts`.
   - `KEEPS_DATA_ON_DROP` holds `document` and `keyvalue`.

## Result

(Implementer fills in.)
