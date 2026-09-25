<script setup lang="ts">
// P63 §2.2: the body KeyValueView.vue used to own outright, now shared with the browse split's
// preview pane (BrowseView.vue). One component renders both, addressed through host.ts's seam
// (`viewKey`) rather than a real KeyValueTabRecord everywhere.
//
// Lives under views/shared/keyvalue/, not views/keyvalue/ (a deviation from the plan's own §6
// wording, taken during implementation, not guessed at in advance): BrowseView.vue is a different
// "kind" than KeyValueView.vue, and biome.json's own SPEC §11 rule ("views/<kind>/* must not
// import another views/<kind>/* — use views/shared/ instead") rejects a views/browse/* file
// importing views/keyvalue/* directly, checked and confirmed by running `bun run lint` against
// the straightforward layout — not assumed. This component's own transitive dependencies
// (state.ts/mutations.ts/page.ts/search.ts/menu.ts/host.ts) moved alongside it for the same
// reason: KeyValueView.vue (still in views/keyvalue/) reaching into views/shared/keyvalue/ for all
// of them is exactly what the rule's own "use views/shared/ instead" is for.
//
// `tab` (optional) is the one thing that genuinely differs between the two hosts: present, this
// component wraps itself in its own ViewChrome — the icon/path/name/refresh/stop/reconnect chrome
// every other main-tab view opens with (KeyValueView.vue's own precedent, byte-identical to
// before this extraction). Absent (the browse split's preview pane), it renders the same badges/
// toolbar/strips/table/cell-editor content un-chromed, styled to match — BrowseView.vue's own
// ReconnectGate already replaces its *whole* split (list + splitter + detail) while disconnected
// (§2.1), so this component never reconnect-gates itself in that mode.
//
// Deliberately not ViewChrome's own #badges/#toolbar slots wrapping this component from the
// outside (KeyValueView.vue nesting <KeyValuePane> as ViewChrome's child three separate times, one
// per slot): Vue can't fill three of an ancestor's named slots from one child instance without
// duplicating the badges/toolbar markup at each call site — exactly the "type-specific header"
// duplication §2.2 rules out. Rendering ViewChrome as a thin header (icon/name/refresh/stop only)
// and this component's own badges/toolbar bands as its next sibling keeps every line of that
// markup in one place, at the cost of badges no longer sitting inline with the header name —
// still one coherent toolbar-styled band, immediately below it.
import type { PageSize } from '@shared/domain/tabs';
import { decodePath, pathParent, pathTail } from '@shared/domain/tree';
import {
  type ColumnDescriptor,
  OBJECT_BODY_EDIT_BYTES,
  OBJECT_BODY_PREVIEW_BYTES,
} from '@shared/protocol/page';
import { useVirtualizer } from '@tanstack/vue-virtual';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@theme/components/ui/popover';
import { ResizableHandle } from '@theme/components/ui/resizable';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import RunState from '@theme/RunState.vue';
import { registerCommand } from '@workbench/shortcuts/commands';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { formatBytes } from '@workbench/util/format';
import { SplitterGroup, SplitterPanel } from 'reka-ui';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { type SelectedCell, useCellSelectionStore } from '../../../state/cellSelection';
import { useConnectionsStore } from '../../../state/connections';
import { useObjectStoreStore } from '../../../state/objectStore';
import { useRunState } from '../../../state/runState';
import { useSettingsStore } from '../../../state/settings';
import type { KeyValueTabRecord } from '../../../state/tabDomain';
import { browseInvalidate } from '../../../state/viewCommands';
import EngineIcon from '../../../theme/EngineIcon.vue';
import CellEditorDock from '../celleditor/CellEditorDock.vue';
import { datasetNumber } from '../eventCoords';
import SearchToolbar from '../page/SearchToolbar.vue';
import { createMatchIndex } from '../page/search';
import { usePageSearchFilterStore } from '../page/searchFilter';
import { pageSizeOptions } from '../page/sizes';
import { setVisibleRows } from '../page/visibleRows';
import { refreshOrReconnect, useConnectionGate } from '../useConnectionGate';
import { keyValueHost } from './host';
import { rowMenu } from './menu';
import { addKey, deleteKey, saveValueEdit } from './mutations';
import { getPage, keyValueRow, pageVersion, setVisibleWindow } from './page';
import { type Match, matchedRows, pageSearchApi, searchState } from './search';
import { useKeyValueViewStore } from './state';

const cellSelectionStore = useCellSelectionStore();
const confirmDialogStore = useConfirmDialogStore();
const contextMenuStore = useContextMenuStore();
const objectStoreStore = useObjectStoreStore();
const pageSearchFilterStore = usePageSearchFilterStore();
const connectionsStore = useConnectionsStore();
const settingsStore = useSettingsStore();
const keyValueViewStore = useKeyValueViewStore();

const props = defineProps<{
  viewKey: string;
  tab?: KeyValueTabRecord;
}>();

const host = computed(() => keyValueHost(props.viewKey));

// P104: CellEditorDock.vue is now a plain SplitterPanel (its own header comment) — the resize
// handle beside it must be this view's own direct SplitterGroup child, gated on the same
// condition CellEditorDock's own `v-if` uses, or the handle would sit next to nothing.
const hasCellDock = computed(() => cellSelectionStore.selectedCellFor(props.viewKey) !== null);

// Reconnect gating only applies in tab mode (see the module doc comment above) — useConnectionGate
// needs a stable {id, connectionId}, which only a real tab record's lifetime guarantees.
const gate = props.tab
  ? useConnectionGate(
      () => props.tab as KeyValueTabRecord,
      () => keyValueViewStore.load(props.viewKey),
    )
  : null;
const needsReconnect = computed(() => gate?.needsReconnect.value ?? false);
function onReconnectAndLoad(): Promise<boolean> {
  return gate ? gate.onReconnectAndLoad() : Promise.resolve(false);
}

const rt = computed(() => keyValueViewStore.runtime[props.viewKey]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(host.value?.path ?? ''));
// The full redis key name (namespace-joined, e.g. "user:1:profile") — the path's own 'key'
// segment always carries it verbatim (redis/catalog.ts), regardless of how many ':'-namespace
// segments precede it in the tree. Every mutation below (edit/delete) targets this, never a
// row's own `field`.
const keyName = computed(() => targetTail.value?.name ?? '');

const connRecord = computed(() => connectionsStore.connectionRecord(host.value?.connectionId ?? null));

// P16 design system LAW: connection colour reaches the view as a 2px rail (the toolbar cap)
// plus a dot (the view header) — never a tint or a full border. Mirrors Toolbar.vue/TreeRow.vue.
const connColor = computed(() => connRecord.value?.color);
const iconColor = computed(() => connColorVar(connColor.value) ?? 'var(--kira-info)');

// P104 §3: ViewChrome/ViewHeader/RunState inlined (no library counterpart).
const runState = useRunState(() => props.tab?.id);

// The view header's breadcrumb: "connection / dbN / " for redis, "connection / bucket / " for
// s3 — each engine's tree roots a key's/object's path at its own top-level segment kind (redis's
// `database`, see redis/catalog.ts; s3's `bucket`, see s3/catalog.ts), so this just reads whichever
// one exists in the path — no new state.
const dbLabel = computed(() => {
  const connectionId = host.value?.connectionId;
  const path = host.value?.path;
  if (!connectionId || path === undefined) return null;
  try {
    return (
      decodePath(connectionId, path).segments.find(
        (s) => s.kind === 'database' || s.kind === 'bucket',
      )?.name ?? null
    );
  } catch {
    return null;
  }
});

const pathPrefix = computed(() =>
  dbLabel.value
    ? `${connRecord.value?.name ? `${connRecord.value.name} / ` : ''}${dbLabel.value} / `
    : '',
);

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.viewKey);
});

// A cursor-strategy page (hash/set/zset/stream — SCAN-family) is forward-only: there is no
// reliable way to seek a SCAN cursor backward, so "Prev" only ever applies to a list key's plain
// LRANGE offset strategy.
const prevDisabled = computed(
  () => (host.value?.pageIndex ?? 0) === 0 || page.value?.position.strategy !== 'offset',
);

// P31 D17/D18: the same "hide non-matching rows" toggle grid/documents/stream share (P24 D2) —
// filtered rows keep their real row number (the `i + 1` gutter below), same as those views.
const displayRows = computed<number[] | null>(() => matchedRows(props.viewKey));
const rowIndices = computed(() => {
  void pageVersion.n;
  if (displayRows.value) return displayRows.value;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

function rowAt(i: number) {
  void pageVersion.n;
  return keyValueRow(props.viewKey, i);
}

// P49 F7/D5: matches the density this row's own CSS (`--kira-row-height`) already resolves to —
// the virtualizer needs the pixel value in JS for its offset math, the CSS var alone isn't
// reachable from there.
const rowHeight = computed(() => (settingsStore.appearance.rowDensity === 'compact' ? 22 : 28));

// P104 §3.4: @tanstack/vue-virtual replaces VirtualList.vue directly at this call site — the
// scroll container (below, in the template) is now this component's own, not a wrapper's.
// overscan: 8 matches VirtualList's own former default.
const scrollRef = ref<HTMLElement | null>(null);
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: rowIndices.value.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => rowHeight.value,
    overscan: 8,
  })),
);
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
const totalSize = computed(() => rowVirtualizer.value.getTotalSize());
// A virtual item's own `index` is its position in rowIndices (0..count-1), not the page-row
// number the rest of this file works in (rowAt/isSearchMatch/data-row) — resolved once per row
// here rather than at every one of the template's own uses of it.
const visibleRows = computed(() =>
  virtualRows.value.map((row) => ({ row, i: rowIndices.value[row.index] })),
);

function ttlText(ttlMs: number | null): string {
  if (ttlMs === null) return 'no expiry';
  const seconds = Math.ceil(ttlMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3600)}h`;
}

function memoryText(bytes: number | null): string {
  return bytes === null ? 'unknown' : formatBytes(bytes);
}

// --- page size (P24 D30: <SegmentedControl>, mirroring views/grid/DataToolbar.vue's own swap) -
const PAGE_SIZE_OPTIONS = pageSizeOptions('keyvalue-');
function onPageSize(size: PageSize): void {
  void keyValueViewStore.setPageSize(props.viewKey, size);
}

// --- write gating: the granular caps (§ caps.ts's canInsert/canUpdate/canDelete), narrowed by
// the connection record's own readOnly flag — the same two-part gate DataToolbar's isWritable
// applies, just per-action instead of one coarse boolean. ------------------------------------
const caps = computed(() =>
  host.value?.connectionId
    ? (connectionsStore.states[host.value.connectionId]?.caps ?? null)
    : null,
);
const canUpdate = computed(() => !!caps.value?.canUpdate && !connRecord.value?.readOnly);
const canDelete = computed(() => !!caps.value?.canDelete && !connRecord.value?.readOnly);
const canInsert = computed(() => !!caps.value?.canInsert && !connRecord.value?.readOnly);

// Edit is scoped to string-type keys in this version (redis/mutate.ts's assertEditableType) —
// a hash/list/set/zset/stream needs its own per-element mutation (HSET/LSET/SADD.../XADD), a
// materially bigger job than a single SET, so the action stays disabled with an explanatory
// tooltip for those types rather than attempting a lossy whole-key replace.
const editableType = computed(() => page.value?.redisType === 'string');
// "Connection is read-only" only actually explains the disabled state when the connection's own
// readOnly toggle is the reason — an adapter that structurally can't write at all (S3, this
// phase) would show the same tooltip on a control that toggle could never turn back on.
function writeDisabledReason(capFlag: boolean | undefined): string {
  return capFlag === false ? 'Not supported for this connection type' : 'Connection is read-only';
}
const editTitle = computed(() => {
  if (page.value?.redisType === 'object') return objectEditGate.value.reason;
  if (!canUpdate.value) return writeDisabledReason(caps.value?.canUpdate);
  if (!editableType.value) return 'Only string values are editable in this version';
  return 'Edit value';
});
const editDisabled = computed(() =>
  page.value?.redisType === 'object'
    ? !objectEditGate.value.editable
    : !canUpdate.value || !editableType.value,
);
const addTitle = computed(() => {
  if (page.value?.redisType === 'object') {
    return canInsert.value ? 'Upload a file' : writeDisabledReason(caps.value?.canInsert);
  }
  return canInsert.value ? 'Add a new key' : writeDisabledReason(caps.value?.canInsert);
});
const deleteTitle = computed(() => {
  if (page.value?.redisType === 'object') {
    return canDelete.value ? 'Delete this object' : writeDisabledReason(caps.value?.canDelete);
  }
  return canDelete.value ? 'Delete this key' : writeDisabledReason(caps.value?.canDelete);
});
const downloadTitle = computed(() =>
  canDownload.value ? 'Download this object' : 'Not supported for this connection type',
);

// The S3 object page's field/value listing is always exactly and only what read.ts pushed —
// there is never a second page to fetch (readObject's own doc comment: "there is nothing to
// paginate") — so the pager/page-size controls below would just be permanently-disabled dead
// chrome for it, the same call StreamView.vue's isBatch makes for SQS's own non-paginating mode.
const isSingleObjectPage = computed(() => page.value?.redisType === 'object');
const canDownload = computed(() => !!caps.value?.fileTransfer);

// P33 D4: the Body row is present only when the object is at or under OBJECT_BODY_PREVIEW_BYTES —
// scanning the small, already-loaded field list for it (never a second fetch) is how the view
// tells "too large to preview" apart from "this object genuinely has no readable body".
function objectBodyRowFor(p: typeof page.value): { value: string; isTruncated: boolean } | null {
  if (p?.redisType !== 'object') return null;
  for (let i = 0; i < p.rowCount; i++) {
    const row = rowAt(i);
    if (row?.field === 'Body') return { value: row.value, isTruncated: row.isTruncated };
  }
  return null;
}
const objectBodyRow = computed(() => objectBodyRowFor(page.value));

// P33 D6/D7: the whole of the edit-size decision, in one computed — every reason names the
// actual number or the actual condition, never a silently-disabled control with no explanation.
interface ObjectEditGate {
  editable: boolean;
  reason: string;
}
const objectEditGate = computed<ObjectEditGate>(() => {
  if (!canUpdate.value)
    return { editable: false, reason: writeDisabledReason(caps.value?.canUpdate) };
  const bodyRow = objectBodyRow.value;
  if (bodyRow === null) {
    return { editable: false, reason: 'Too large to edit — download it to open it locally' };
  }
  if (bodyRow.isTruncated) {
    return {
      editable: false,
      reason: 'Only part of this object was fetched — editing it would overwrite the rest',
    };
  }
  if (bodyRow.value.includes('�')) {
    return {
      editable: false,
      reason: "This object isn't valid UTF-8 text — download it to edit it locally",
    };
  }
  const size = page.value?.memoryBytes ?? null;
  if (size !== null && size > OBJECT_BODY_EDIT_BYTES) {
    return {
      editable: false,
      reason: `Too large to edit (${formatBytes(size)} — the limit is ${formatBytes(OBJECT_BODY_EDIT_BYTES)})`,
    };
  }
  return { editable: true, reason: 'Edit value' };
});

// --- edit popover: a single TextField pre-filled with the current string value, mutating
// immediately on Save (no staged/pending edit set — mirrors documents/mutations.ts). -----------
const editOpen = ref(false);
const editAnchorRef = ref<HTMLElement | null>(null);
const editDraft = ref('');
const editSaving = ref(false);
const editError = ref<string | null>(null);

// Task: S3's object body used to edit through a separate inline CodeMirrorHost band
// (ObjectBodyEditor.vue) with no format detection — the toolbar Edit button now instead selects
// the object's own "Body" row, which the docked cell editor (CellEditorDock, already mounted
// below) renders with the same JSON/XML/hex/base64/timestamp tooling every grid cell gets.
function objectBodyRowIndex(): number | null {
  const p = page.value;
  if (p?.redisType !== 'object') return null;
  for (let i = 0; i < p.rowCount; i++) {
    if (rowAt(i)?.field === 'Body') return i;
  }
  return null;
}

function openEdit(): void {
  if (isSingleObjectPage.value) {
    if (!objectEditGate.value.editable) return;
    const index = objectBodyRowIndex();
    if (index !== null) onRowClick(index);
    return;
  }
  if (!canUpdate.value || !editableType.value) return;
  addOpen.value = false;
  editDraft.value = rowAt(0)?.value ?? '';
  editError.value = null;
  editOpen.value = true;
}
function closeEdit(): void {
  editOpen.value = false;
  editError.value = null;
}
async function saveEdit(): Promise<void> {
  if (!keyName.value) return;
  editSaving.value = true;
  editError.value = null;
  try {
    await saveValueEdit(props.viewKey, keyName.value, editDraft.value);
    editOpen.value = false;
  } catch (err) {
    editError.value = err instanceof Error ? err.message : String(err);
  } finally {
    editSaving.value = false;
  }
}

// --- S3 object body edit: staged locally by the cell editor's onEdit (below, in onRowClick),
// never written to S3 on blur/Ctrl+Enter the way a SQL grid cell's onEdit stages a pending
// change — S3's PutObject is a real, immediate write with no undo, so an explicit Save here is
// the only thing that ever calls saveValueEdit for this row. onRevert (the cell editor panel's
// own Revert button) clears the draft the same way discarding a grid's pending edit would. -----
const objectDraft = ref<string | null>(null);
const objectSaving = ref(false);
const objectSaveError = ref<string | null>(null);

// A reload (this Save, a manual Refresh, a relaunch) means the row this draft was staged against
// no longer necessarily matches what's on screen — dropping it here rather than leaving a stale
// draft that a later Save could silently commit over newer data. P43 iter2 F20/D27: the cell
// editor's own published cell is the same case — a row index into a page that no longer exists
// identifies nothing, so it's cleared here too rather than left showing the previous page's value.
watch(page, () => {
  objectDraft.value = null;
  objectSaveError.value = null;
  cellSelectionStore.clearSelectedCellFor(props.viewKey);
});

async function saveObjectEdit(): Promise<void> {
  if (objectDraft.value === null || !keyName.value) return;
  objectSaving.value = true;
  objectSaveError.value = null;
  try {
    await saveValueEdit(props.viewKey, keyName.value, objectDraft.value);
    objectDraft.value = null;
  } catch (err) {
    objectSaveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    objectSaving.value = false;
  }
}

// --- delete: type-agnostic (DEL works for any of the six types) — confirmed inline, mirrors
// documents/menu.ts's confirmDialogStore.confirmDialog() precedent for a destructive, un-staged action. S3's object
// delete rides state/objectStore.ts's deleteObject() instead of mutations.ts's deleteKey(),
// since it needs the object's whole path (not just its key name) to satisfy s3/mutate.ts's
// bucket-rooted MutationPlan.path. ----------------------------------------------------------
async function onDeleteKey(): Promise<void> {
  if (!canDelete.value || !keyName.value) return;
  const label = isSingleObjectPage.value ? 'object' : 'key';
  if (
    !(await confirmDialogStore.confirmDialog(`Delete ${label} "${keyName.value}"? This removes the entire ${label}.`))
  ) {
    return;
  }
  const h = host.value;
  if (!h?.connectionId) return;
  try {
    if (isSingleObjectPage.value) {
      await objectStoreStore.deleteObject(h.connectionId, h.path, props.viewKey);
      await keyValueViewStore.reload(props.viewKey);
      // P43 F11/D15: the deleted object's own container level just lost a member.
      browseInvalidate(h.connectionId, pathParent(h.path) ?? '');
    } else {
      await deleteKey(props.viewKey, keyName.value);
    }
    keyValueViewStore.setActionError(props.viewKey, null);
  } catch (err) {
    keyValueViewStore.setActionError(props.viewKey, err instanceof Error ? err.message : String(err));
  }
}

// --- download: a read, never blocked by read-only (D18) — enabled regardless of canUpdate/
// canDelete/canInsert, gated only on caps.fileTransfer. ---------------------------------------
async function onDownload(): Promise<void> {
  const h = host.value;
  if (!canDownload.value || !h?.connectionId) return;
  await objectStoreStore.downloadObject(h.connectionId, h.path, props.viewKey);
}

// --- add key popover: name + initial value, string-typed only (same D2 as edit). On success
// the new key opens in its own tab — this tab is still showing a different, still-live key.
// For an S3 object page, Add instead opens the upload dialog (state/objectStore.ts) targeting
// this object's own container — pathParent(host.path), the bucket or prefix it lives under. ---
const addOpen = ref(false);
const addAnchorRef = ref<HTMLElement | null>(null);
const addName = ref('');
const addValue = ref('');
const addSaving = ref(false);
const addError = ref<string | null>(null);

function openAdd(): void {
  if (!canInsert.value) return;
  const h = host.value;
  if (isSingleObjectPage.value) {
    if (!h?.connectionId) return;
    objectStoreStore.openUploadDialog(h.connectionId, pathParent(h.path) ?? '');
    return;
  }
  addName.value = '';
  addValue.value = '';
  addError.value = null;
  addOpen.value = true;
}
function closeAdd(): void {
  addOpen.value = false;
  addError.value = null;
}
async function submitAdd(): Promise<void> {
  const name = addName.value.trim();
  if (!name) {
    addError.value = 'Key name is required';
    return;
  }
  addSaving.value = true;
  addError.value = null;
  try {
    await addKey(props.viewKey, name, addValue.value);
    addOpen.value = false;
  } catch (err) {
    addError.value = err instanceof Error ? err.message : String(err);
  } finally {
    addSaving.value = false;
  }
}

function onRowContextMenu(e: MouseEvent, field: string, value: string): void {
  e.preventDefault();
  const p = page.value;
  if (!p) return;
  const isObject = p.redisType === 'object';
  contextMenuStore.openContextMenu(
    e,
    rowMenu({
      field,
      value,
      redisType: p.redisType,
      canUpdate: canUpdate.value,
      canDelete: canDelete.value,
      canDownload: canDownload.value,
      editable: isObject ? objectEditGate.value.editable : p.redisType === 'string',
      editUnavailableLabel: isObject
        ? objectEditGate.value.reason
        : 'Edit value (string keys only)',
      onEdit: () => {
        if (isObject) {
          openEdit();
          return;
        }
        editDraft.value = value;
        editError.value = null;
        editOpen.value = true;
      },
      onDelete: () => void onDeleteKey(),
      onDownload: () => void onDownload(),
    }),
  );
}

// §11's cell-editor seam (state/cellSelection.ts): clicking a row previews its value read-only
// in the cell editor panel, regardless of type — a hash/list/etc. row is still viewable there
// even though only a string key's row is *editable* via the popover above. `hasPrimaryKey: true`
// because a redis key is always addressable by name (unlike a PK-less SQL table).
function onRowClick(i: number): void {
  const row = rowAt(i);
  const p = page.value;
  const h = host.value;
  if (!row || !p) return;
  const column: ColumnDescriptor = {
    name: p.redisType === 'string' ? 'value' : row.field,
    // P17: an s3 object's field/value rows aren't a "redis" anything — dataType is the cell
    // editor's own status-badge text, so this stays honest about which engine this page came from.
    dataType: p.redisType === 'object' ? 's3 object field' : `redis ${p.redisType}`,
    typeClass: 'text',
    nullable: false,
    isPrimaryKey: false,
    generated: false,
  };
  // The S3 object's Body row is the one row that can genuinely stage a write — every other row
  // here (redis hash/list/set/zset fields, an object's own metadata rows) has no onEdit at all,
  // so the panel stays read-only for them by cellSelection.ts's own "no onEdit -> read-only" rule.
  const isEditableBodyRow =
    p.redisType === 'object' && row.field === 'Body' && objectEditGate.value.editable;
  const selected: SelectedCell = {
    tabId: props.viewKey,
    connectionId: h?.connectionId ?? null,
    path: h?.path ?? '',
    columnIndex: 1, // the page's own `values` column (`fields` is 0) — KeyValuePage's fixed pair
    column,
    row: i,
    value: row.value,
    truncated: row.isTruncated,
    hasPrimaryKey: true,
    ...(isEditableBodyRow
      ? {
          onEdit: (newValue: string) => {
            objectDraft.value = newValue;
          },
          onRevert: () => {
            objectDraft.value = null;
          },
        }
      : {}),
  };
  cellSelectionStore.publishSelectedCell(selected);
}

// P2 R2 (task #98): `@click="onRowClick(i)"` closes over the v-for's `i`, so Vue's compiler can
// never cache the handler (hasScopeRef) — every row gets a fresh closure on every render, scroll
// included. These recover `i` from `data-row` on the element the event actually fired on instead,
// so the template can bind these two stable, module-scope functions directly.
function onRowClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'row');
  if (i !== null) onRowClick(i);
}
// P105 §5.2(c): Enter/Space mirror a single click.
function onRowKeydownFromEvent(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  const i = datasetNumber(e.currentTarget, 'row');
  if (i !== null) onRowClick(i);
}
function onRowContextMenuFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'row');
  if (i === null) return;
  const row = rowAt(i);
  if (row) onRowContextMenu(e, row.field, row.value);
}

// --- search: filters the already-loaded page only, never a new query (mirrors
// views/grid/search.ts's discipline exactly — see keyvalue/search.ts). ------------------------------
function onToggleSearch(): void {
  keyValueViewStore.toggleSearchOpen(props.viewKey);
}
function onCloseSearch(): void {
  keyValueViewStore.setSearchOpen(props.viewKey, false);
}

// P49 F7/D5: rowIndices is the *filtered* array when the filter toggle is on, so a match's page-row
// number has to be looked up by position rather than assumed to equal it — same as
// ConsoleResultGrid.vue's/DocumentView.vue's own goToMatch, now that this view's rows are
// virtualized too (a plain querySelector can no longer find an off-screen row's DOM node).
// `align: 'auto'` reproduces VirtualList's own scrollToIndex: a no-op if already visible,
// top-aligned above the viewport, bottom-aligned below it.
function onGoToMatch(match: Match): void {
  const index = rowIndices.value.indexOf(match.row);
  if (index >= 0) rowVirtualizer.value.scrollToIndex(index, { align: 'auto' });
}

// P49 F7/D5: closes the hole keyvalue/search.ts's own runSearch doc comment named — until this
// view virtualized its rows, nothing ever reported a visible window, so a find's priority scan
// always started from row 0 with no on-screen rows to prioritize first.
//
// P5 C3/F5: the same bounds also prune page.ts's decode cache (`setVisibleWindow`, mirrors
// grid/console) — already widened by the virtualizer's own overscan (getVirtualItems already
// includes it), so a fling never prunes a row about to be re-rendered.
watch(
  virtualRows,
  (rows) => {
    if (rows.length === 0) return;
    const list = rowIndices.value;
    const from = list[rows[0].index];
    const to = list[rows[rows.length - 1].index];
    if (from === undefined || to === undefined) return;
    setVisibleRows(props.viewKey, from, to + 1);
    setVisibleWindow(props.viewKey, from, to + 1);
  },
  { immediate: true },
);

// Rebuilt only when the search result changes (a completed scan or prev/next), not per row.
const matchIndex = createMatchIndex(searchState, () => props.viewKey);
function isSearchMatch(row: number, col: 'field' | 'value'): boolean {
  return matchIndex.value?.has(row, col) ?? false;
}
function isCurrentSearchMatch(row: number, col: 'field' | 'value'): boolean {
  return matchIndex.value?.isCurrent(row, col) ?? false;
}

function onStop(): void {
  keyValueViewStore.stop(props.viewKey);
}

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => keyValueViewStore.reload(props.viewKey));
}

// "row(s)" doesn't fit a keyspace — these are keys/fields, not table rows — and cursor-based
// pagination (the SCAN family) has no absolute "1-14 of 14" range to show, so this mirrors
// DocumentView's own "N loaded / of ~ total" pattern instead of Main.html's literal range.
const statusLine = computed(() => {
  const r = rt.value;
  if (!r) return '';
  const parts: string[] = [`${r.rowCount.toLocaleString()} loaded`];
  if (r.count) {
    parts.push(`${r.count.exact ? '' : '~'}${r.count.value.toLocaleString()} total`);
  }
  return parts.join(' · ');
});

let unregisterCommand: (() => void) | null = null;
let unregisterFindCommand: (() => void) | null = null;

// P63: a mount-time-only load (the original `onMounted` guard) covers a real tab, whose target
// path never changes for the tab's own lifetime — but the browse split's preview pane keeps one
// *constant* viewKey (`${tab.id}::preview`) across every row the user selects, with only the
// *resolved* target path changing underneath it. Watching the resolved path instead of mounting
// once covers both: for a tab it fires once, immediately, exactly like the old guard; for the
// preview pane it fires again every time BrowseView.vue's own host resolves a different path.
watch(
  () => (needsReconnect.value ? undefined : host.value?.path),
  (path) => {
    if (path === undefined) return;
    void keyValueViewStore.load(props.viewKey);
  },
  { immediate: true },
);

onMounted(() => {
  if (!props.tab) return;
  // Item 4 (regression pass, task batch P46-4): route through the same gate-aware onRefresh the
  // toolbar button uses — this used to call keyValueViewStore.reload() directly, a doomed no-op behind the gate.
  unregisterCommand = registerCommand('view.refresh', onRefresh);
  unregisterFindCommand = registerCommand('view.find', onToggleSearch);
});

onUnmounted(() => {
  unregisterCommand?.();
  unregisterFindCommand?.();
});
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col" data-testid="keyvalue-pane">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined (no library counterpart). -->
    <template v-if="tab">
      <div class="h-bar shrink-0 flex items-center gap-1.5 px-2 border-b border-border">
        <span
          v-if="connColor !== undefined"
          class="size-1.25 rounded-full shrink-0"
          :class="(!connColor || connColor === 'none') ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
          :style="{ '--kira-rail': connColorVar(connColor) }"
        />
        <span v-if="connRecord?.kind" class="size-4 flex items-center justify-center shrink-0">
          <EngineIcon :kind="connRecord.kind" :size="13" />
        </span>
        <span class="size-4 flex items-center justify-center shrink-0" :style="{ color: iconColor }">
          <CodiconIcon :name="page?.redisType === 'object' ? 'file' : 'key'" :size="13" />
        </span>
        <span class="text-kira-md text-fg truncate" data-testid="keyvalue-target"
          ><span v-if="pathPrefix" class="text-subtle">{{ pathPrefix }}</span
          >{{ targetTail?.name ?? tab.path }}</span
        >
        <span class="ml-auto flex items-center gap-1" />
      </div>
      <div class="h-0.5 shrink-0 bg-(--kira-rail)" :style="{ '--kira-rail': connColorVar(connColor) }" />
      <div class="h-bar shrink-0 flex items-center gap-1.5 px-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="toolbar" size="kira-icon" aria-label="Refresh" data-testid="keyvalue-refresh" @click="onRefresh">
                <CodiconIcon name="refresh" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <TooltipDisabledTrigger>
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  :class="{ 'is-live': !!running }"
                  aria-label="Stop"
                  data-testid="keyvalue-stop"
                  :disabled="!running"
                  @click="onStop"
                >
                  <CodiconIcon name="debug-stop" :size="13" />
                </Button>
              </TooltipDisabledTrigger>
            </TooltipTrigger>
            <TooltipContent>Stop</TooltipContent>
          </Tooltip>
        </div>
        <span class="ml-auto" />
        <RunState :state="runState" />
        <div class="flex items-center gap-1.5 min-w-0" />
      </div>
    </template>

    <!-- P104: the SplitterGroup wrapping the reconnect/main content + CellEditorDock.vue's own dock
         panel — the vertical split (row-resize) that used to be CellEditorDock's own internal
         PanelSplitter. -->
    <SplitterGroup direction="vertical" class="flex flex-1 min-h-0 flex-col">
    <!-- SplitterPanel's own inline style owns flex-grow/basis (it always wins over a class rule) —
         the badges/strips/table still stack in a column inside it, same as before. -->
    <SplitterPanel class="flex flex-col min-h-0" :order="1">
    <!-- Item 4: only the body swaps for the reconnect gate — ViewChrome (when present) always
         renders its own header, same discipline every other main-tab view follows.
         P104 §3: ReconnectGate inlined (no library counterpart). -->
    <Alert v-if="needsReconnect" class="empty-state" data-testid="keyvalue-reconnect">
      <Button variant="dialog-primary" size="kira-lg" data-testid="keyvalue-reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </Button>
    </Alert>
    <template v-else>
      <div v-if="page" class="h-bar shrink-0 flex items-center gap-1.5 px-2 border-b border-border" data-testid="keyvalue-badges">
        <Badge data-testid="keyvalue-type">{{ page.redisType }}</Badge>
        <!-- TTL is a Redis-only concept (always null for an S3 object — read.ts never computes
             it) — showing "no expiry" for every object would be a permanently-meaningless chip,
             not real information. Memory/size (P33 D5) is real for both: read.ts now sets
             memoryBytes to the object's own ContentLength. -->
        <template v-if="!isSingleObjectPage">
          <!-- TTL is styled as a warning chip, not a neutral badge: a key that is about to
               vanish should look like one (see the mockup's KeyValue.html). -->
          <Badge :variant="page.ttlMs !== null ? 'warn' : 'chip'" data-testid="keyvalue-ttl">
            <CodiconIcon name="history" :size="13" />
            {{ page.ttlMs !== null ? `expires in ${ttlText(page.ttlMs)}` : 'no expiry' }}
          </Badge>
        </template>
        <Badge data-testid="keyvalue-memory">{{ memoryText(page.memoryBytes) }}</Badge>
        <Badge v-if="connRecord">{{ connRecord.readOnly ? 'read-only' : 'read-write' }}</Badge>
      </div>

      <div class="h-bar shrink-0 flex items-center gap-1.5 px-2" data-testid="keyvalue-toolbar">
        <div class="flex items-center gap-1.5 min-w-0">
          <!-- Prev/Next are meaningless for a single-object page (readObject's own doc comment:
               "there is nothing to paginate") — hidden rather than shown permanently disabled,
               same call StreamView.vue's isBatch makes for SQS. The status text stays: it's the
               only place the Count button's result (below) ever gets shown, for every engine. -->
          <Tooltip v-if="!isSingleObjectPage">
            <TooltipTrigger as-child>
              <TooltipDisabledTrigger>
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  aria-label="Previous page"
                  data-testid="keyvalue-prev"
                  :disabled="prevDisabled"
                  @click="keyValueViewStore.goPrev(viewKey)"
                >
                  <CodiconIcon name="arrow-left" :size="13" />
                </Button>
              </TooltipDisabledTrigger>
            </TooltipTrigger>
            <TooltipContent>Previous page</TooltipContent>
          </Tooltip>
          <span class="font-data text-kira-sm text-muted-foreground" data-testid="keyvalue-status">{{ statusLine }}</span>
          <Tooltip v-if="!isSingleObjectPage">
            <TooltipTrigger as-child>
              <TooltipDisabledTrigger>
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  aria-label="Next page"
                  data-testid="keyvalue-next"
                  :disabled="!rt?.hasMore"
                  @click="keyValueViewStore.goNext(viewKey)"
                >
                  <CodiconIcon name="arrow-right" :size="13" />
                </Button>
              </TooltipDisabledTrigger>
            </TooltipTrigger>
            <TooltipContent>Next page</TooltipContent>
          </Tooltip>
        </div>

        <template v-if="!isSingleObjectPage">
          <div class="w-px h-3.5 bg-border-strong mx-0.5 shrink-0" />

          <!-- Page-size sits right after the pager, before the count/mutation groups — same slot
               DataToolbar.vue's own page-size segmented control occupies. -->
          <ToggleGroup
            type="single"
            :model-value="String(host?.pageSize ?? 100)"
            data-testid="keyvalue-page-size-picker"
            @update:model-value="(v) => v && onPageSize(Number(v) as PageSize)"
          >
            <ToggleGroupItem v-for="opt in PAGE_SIZE_OPTIONS" :key="opt.value" :value="String(opt.value)" :data-testid="opt.testid">
              {{ opt.label }}
            </ToggleGroupItem>
          </ToggleGroup>
        </template>

        <div class="w-px h-3.5 bg-border-strong mx-0.5 shrink-0" />

        <!-- DataToolbar's [count, columns] group — Redis has no columns/fields equivalent
             (a key has no schema), so this group is count alone, same slot as SQL/Document. -->
        <div class="flex items-center gap-1.5 min-w-0">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="toolbar" size="kira-icon" aria-label="Exact count" data-testid="keyvalue-count" @click="keyValueViewStore.runCount(viewKey)">
                <CodiconIcon name="symbol-number" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Exact count</TooltipContent>
          </Tooltip>
        </div>

        <div class="w-px h-3.5 bg-border-strong mx-0.5 shrink-0" />

        <!-- Canonical [add, edit/delete, search] group — add leads (DataToolbar.vue's own
             add-before-delete order), search trails, same as every other view. -->
        <div class="flex items-center gap-1.5 min-w-0">
          <Popover :open="addOpen" @update:open="(v) => !v && closeAdd()">
            <div ref="addAnchorRef" class="relative">
              <Tooltip>
                <TooltipTrigger as-child>
                  <TooltipDisabledTrigger>
                    <Button variant="toolbar" size="kira-icon" aria-label="Add" :disabled="!canInsert" data-testid="keyvalue-add" @click="openAdd">
                      <CodiconIcon name="add" :size="13" />
                    </Button>
                  </TooltipDisabledTrigger>
                </TooltipTrigger>
                <TooltipContent>{{ addTitle }}</TooltipContent>
              </Tooltip>
              <PopoverAnchor :reference="addAnchorRef ?? undefined" />
            </div>
            <PopoverContent align="start" class="w-80" data-testid="keyvalue-add-popover">
              <div class="flex flex-col gap-1.5 p-1.5">
                <div class="p-0 text-kira-sm text-muted-foreground">Add key (string value)</div>
                <Input v-model="addName" placeholder="Key name" class="w-full" data-testid="keyvalue-add-name" />
                <Input
                  v-model="addValue"
                  placeholder="Initial value"
                  class="w-full"
                  data-testid="keyvalue-add-value"
                  @keydown.enter="submitAdd"
                  @keydown.escape="closeAdd"
                />
                <div v-if="addError" class="text-kira-xs text-error" data-testid="keyvalue-add-error">
                  {{ addError }}
                </div>
                <div class="flex justify-end gap-1">
                  <Button variant="dialog" size="kira-lg" data-testid="keyvalue-add-cancel" @click="closeAdd">Cancel</Button>
                  <Button
                    variant="dialog-primary"
                    size="kira-lg"
                    data-testid="keyvalue-add-save"
                    :disabled="addSaving"
                    @click="submitAdd"
                  >Save</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Popover :open="editOpen && !isSingleObjectPage" @update:open="(v) => !v && closeEdit()">
            <div ref="editAnchorRef" class="relative">
              <Tooltip>
                <TooltipTrigger as-child>
                  <TooltipDisabledTrigger>
                    <Button variant="toolbar" size="kira-icon" aria-label="Edit" :disabled="editDisabled" data-testid="keyvalue-edit" @click="openEdit">
                      <CodiconIcon name="edit" :size="13" />
                    </Button>
                  </TooltipDisabledTrigger>
                </TooltipTrigger>
                <TooltipContent>{{ editTitle }}</TooltipContent>
              </Tooltip>
              <PopoverAnchor :reference="editAnchorRef ?? undefined" />
            </div>
            <PopoverContent align="start" class="w-80" data-testid="keyvalue-edit-popover">
              <div class="flex flex-col gap-1.5 p-1.5">
                <div class="p-0 text-kira-sm text-muted-foreground">Edit value</div>
                <Input
                  v-model="editDraft"
                  class="w-full"
                  data-testid="keyvalue-edit-input"
                  @keydown.enter="saveEdit"
                  @keydown.escape="closeEdit"
                />
                <div v-if="editError" class="text-kira-xs text-error" data-testid="keyvalue-edit-error">
                  {{ editError }}
                </div>
                <div class="flex justify-end gap-1">
                  <Button variant="dialog" size="kira-lg" data-testid="keyvalue-edit-cancel" @click="closeEdit">Cancel</Button>
                  <Button
                    variant="dialog-primary"
                    size="kira-lg"
                    data-testid="keyvalue-edit-save"
                    :disabled="editSaving"
                    @click="saveEdit"
                  >Save</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger as-child>
              <TooltipDisabledTrigger>
                <Button variant="toolbar" size="kira-icon" aria-label="Delete" :disabled="!canDelete" data-testid="keyvalue-delete" @click="onDeleteKey">
                  <CodiconIcon name="trash" :size="13" />
                </Button>
              </TooltipDisabledTrigger>
            </TooltipTrigger>
            <TooltipContent>{{ deleteTitle }}</TooltipContent>
          </Tooltip>

          <Tooltip v-if="canDownload">
            <TooltipTrigger as-child>
              <Button variant="toolbar" size="kira-icon" aria-label="Download" data-testid="keyvalue-download" @click="onDownload">
                <CodiconIcon name="cloud-download" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ downloadTitle }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="toolbar"
                size="kira-icon"
                :class="{ 'bg-field text-fg': !!rt?.searchOpen }"
                aria-label="Search this page"
                data-testid="keyvalue-search"
                @click="onToggleSearch"
              >
                <CodiconIcon name="search" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search this page</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Alert v-if="rt?.status === 'error' && rt.error" variant="destructive" data-testid="keyvalue-error">
        <AlertDescription>{{ rt.error.message }}</AlertDescription>
      </Alert>
      <!-- P43 F6/D7: a failed delete — the edit/add popovers already show their own failures
           inline (editError/objectSaveError/addError above); delete has no popover of its own
           to hold one, so it uses the shared per-tab field every other view's own strip does. -->
      <Alert v-if="rt?.actionError" variant="destructive" data-testid="keyvalue-action-error">
        <AlertDescription>{{ rt.actionError }}</AlertDescription>
      </Alert>
      <!-- P33 D4: an object over OBJECT_BODY_PREVIEW_BYTES has no Body row at all — this is the
           renderer's own honest explanation of that absence, gated on the same shared constant
           the adapter used, not a parsed string. -->
      <Alert
        v-if="isSingleObjectPage && page && objectBodyRow === null && page.memoryBytes !== null"
        variant="warn"
        data-testid="keyvalue-object-too-large"
      >
        <AlertDescription>
          Too large to preview ({{ formatBytes(page.memoryBytes) }}, over the
          {{ formatBytes(OBJECT_BODY_PREVIEW_BYTES) }} limit) — use Download to save it locally.
        </AlertDescription>
      </Alert>
      <!-- The S3 object body is edited through the docked cell editor below (onRowClick's
           onEdit stages into objectDraft, never writing to S3 directly) — this strip is the
           explicit Save/Discard step that turns the staged draft into a real PutObject. -->
      <Alert v-if="objectDraft !== null" variant="warn" data-testid="keyvalue-object-edit-pending">
        <AlertDescription class="flex items-start gap-1.5">
          <span data-testid="keyvalue-object-edit-note"
            >Unsaved changes to this object's body<template v-if="objectSaveError">
              — {{ objectSaveError }}</template
            ></span
          >
          <Button
            variant="toolbar-primary"
            size="kira"
            class="ml-auto shrink-0"
            data-testid="keyvalue-object-edit-save"
            :disabled="objectSaving"
            @click="saveObjectEdit"
          >
            Save
          </Button>
        </AlertDescription>
      </Alert>

      <SearchToolbar
        v-if="rt?.searchOpen"
        :tab-id="viewKey"
        testid-prefix="keyvalue-"
        row-noun="rows"
        :api="pageSearchApi"
        @go-to-match="onGoToMatch"
        @close="onCloseSearch"
      />

      <div class="border border-border rounded-kira bg-bg overflow-hidden flex flex-col min-h-0 flex-1 min-h-0 border-0 rounded-none">
        <div class="h-control-lg shrink-0 flex bg-elevated border-b border-border-strong">
          <div class="flex items-center gap-1 px-2 border-r border-border text-kira-sm text-muted-foreground overflow-hidden whitespace-nowrap w-10 shrink-0"></div>
          <div class="flex items-center gap-1 px-2 border-r border-border text-kira-sm text-muted-foreground overflow-hidden whitespace-nowrap w-56 shrink-0">
            <span class="text-fg overflow-hidden text-ellipsis">{{
              page?.redisType === 'string' ? '' : page?.redisType === 'list' ? 'index' : 'field'
            }}</span>
          </div>
          <div class="flex items-center gap-1 px-2 border-r border-border text-kira-sm text-muted-foreground overflow-hidden whitespace-nowrap flex-1 min-w-0">
            <span class="text-fg overflow-hidden text-ellipsis">{{ page?.redisType === 'zset' ? 'score' : 'value' }}</span>
          </div>
        </div>
        <!-- P49 D5/P104 §3.4: the virtualizer's own scroll container (kv-virtual-scroll below) owns
             scrolling now, against this flex:1/min-height:0 parent — EmptyState's two branches
             above never needed to scroll either. -->
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="keyvalue-list">
          <Alert v-if="!rt || rt.rowCount === 0" class="empty-state">
            <CodiconIcon :name="rt ? 'database' : 'loading'" :size="24" class="text-subtle" />
            <AlertTitle class="text-kira-md text-muted-foreground font-normal">{{ rt ? 'No data' : 'Loading…' }}</AlertTitle>
          </Alert>
          <!-- P31 D19 (P24 D8's precedent): filtering to zero matches is a distinct empty state
               from "no data loaded". -->
          <Alert
            v-else-if="displayRows && displayRows.length === 0"
            class="empty-state"
            data-testid="keyvalue-no-matching-rows"
          >
            <CodiconIcon name="search" :size="24" class="text-subtle" />
            <AlertTitle class="text-kira-md text-muted-foreground font-normal">No matching rows</AlertTitle>
            <Button
              variant="toolbar"
              size="kira"
              data-testid="keyvalue-show-all-rows"
              @click="pageSearchFilterStore.setSearchFiltering(viewKey, false)"
            >
              Show all rows
            </Button>
          </Alert>
          <!-- P104 §3.4: the scroll element @tanstack/vue-virtual measures and virtualizes against
               — this component owns it directly now, VirtualList.vue no longer wraps it. -->
          <div
            v-else
            ref="scrollRef"
            class="flex-1 min-h-0 overflow-auto"
            data-testid="virtual-list"
            role="listbox"
            aria-label="Rows"
          >
            <div class="relative w-full" :style="{ height: `${totalSize}px` }">
              <template v-for="entry in visibleRows" :key="entry.row.index">
                <div
                  class="kv-row flex cursor-pointer h-row absolute top-0 left-0 w-full"
                  data-testid="keyvalue-row"
                  :data-row="entry.i"
                  :style="{ transform: `translateY(${entry.row.start}px)` }"
                  role="option"
                  tabindex="0"
                  @click="onRowClickFromEvent"
                  @keydown="onRowKeydownFromEvent"
                  @contextmenu="onRowContextMenuFromEvent"
                >
                  <div class="flex items-center justify-end px-2 border-r border-b border-border border-r-border-strong bg-elevated font-data text-kira-xs text-subtle truncate relative w-10 shrink-0">{{ entry.i + 1 }}</div>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <div
                        class="flex items-center px-2 border-r border-b border-border font-data text-kira-md truncate w-56 shrink-0"
                        :class="[
                          {
                            'search-match bg-search-match': isSearchMatch(entry.i, 'field'),
                            'search-match-current bg-search-match-current': isCurrentSearchMatch(
                              entry.i,
                              'field',
                            ),
                          },
                          isCurrentSearchMatch(entry.i, 'field') ? 'text-bg' : 'text-fg',
                        ]"
                        data-testid="keyvalue-field"
                      >
                        {{ rowAt(entry.i)?.field }}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{{ rowAt(entry.i)?.field }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <div
                        class="flex items-center px-2 border-r border-b border-border font-data text-kira-md truncate flex-1 min-w-0"
                        :class="[
                          {
                            'search-match bg-search-match': isSearchMatch(entry.i, 'value'),
                            'search-match-current bg-search-match-current': isCurrentSearchMatch(
                              entry.i,
                              'value',
                            ),
                          },
                          isCurrentSearchMatch(entry.i, 'value') ? 'text-bg' : 'text-fg',
                        ]"
                        data-testid="keyvalue-value"
                      >
                        {{ rowAt(entry.i)?.value }}
                        <Tooltip v-if="rowAt(entry.i)?.isTruncated">
                          <TooltipTrigger as-child>
                            <Badge variant="chip" class="bg-field text-subtle ml-1.5 shrink-0">truncated</Badge>
                          </TooltipTrigger>
                          <TooltipContent>value truncated</TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{{ rowAt(entry.i)?.value }}</TooltipContent>
                  </Tooltip>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>
    </SplitterPanel>
    <ResizableHandle v-if="hasCellDock" class="cell-splitter" :hit-area-margins="{ coarse: 8, fine: 4 }" />
    <CellEditorDock :tab-id="viewKey" />
    </SplitterGroup>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";
/* P110 B40: every plain single-selector rule this file had moved onto the template as Tailwind
   utilities. `.kv-row` stays a bare marker to anchor this hover rule.

   P110 B32: the divider styling itself moved into ResizableHandle.vue's own shared component --
   `.cell-splitter` (template above) is a bare marker class, kept only because cell-editor.spec.ts
   polls its box-shadow via getComputedStyle (no rule of its own attaches to the name any more).

   P110 B34: `.search-match`/`.search-match-current` (template above) carry no rule of their own
   here any more -- kept as bare marker classes (the shared vocabulary name cellClass.ts/
   DocumentRow.vue/ConsoleResultGrid.vue also use). The actual tint/text-colour is
   `bg-search-match[-current] text-bg` alongside on the same element (--color-search-match[-current]
   already @theme-registered, base.css -- no new utility needed). `.empty-state` (template above)
   moved to base.css's own @utility empty-state (15-file duplicate). */
.kv-row:hover {
  @apply bg-hover;
}
</style>
