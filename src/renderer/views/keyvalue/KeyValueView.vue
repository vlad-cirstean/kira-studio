<script setup lang="ts">
import type { KeyValueTabRecord, KeyValueTabState } from '@shared/domain/tabs';
import { decodePath, pathParent, pathTail } from '@shared/domain/tree';
import {
  type ColumnDescriptor,
  OBJECT_BODY_EDIT_BYTES,
  OBJECT_BODY_PREVIEW_BYTES,
} from '@shared/protocol/page';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { formatBytes } from '../../format';
import { registerCommand } from '../../shortcuts/commands';
import { publishSelectedCell, type SelectedCell } from '../../state/cellSelection';
import { connectConnection, connectionsState } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { deleteObject, downloadObject, openUploadDialog } from '../../state/objectStore';
import { isHydrated, markHydrated } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import { setSearchFiltering } from '../shared/searchFilter';
import KeyValueSearchToolbar from './KeyValueSearchToolbar.vue';
import { keyValueMenu } from './keyValueMenu';
import { addKey, deleteKey, saveValueEdit } from './keyValueMutations';
import { getPage, keyValueRow, pageVersion } from './kvPage';
import { matchedRows, searchState } from './kvSearch';
import { goNext, goPrev, load, reload, runCount, runtime, setPageSize, stop } from './state';

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/DocumentView.vue.
const props = defineProps<{ tab: KeyValueTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));
// The full redis key name (namespace-joined, e.g. "user:1:profile") — the path's own 'key'
// segment always carries it verbatim (redis/catalog.ts), regardless of how many ':'-namespace
// segments precede it in the tree. Every mutation below (edit/delete) targets this, never a
// row's own `field`.
const keyName = computed(() => targetTail.value?.name ?? '');

const connRecord = computed(() =>
  props.tab.connectionId
    ? connectionsState.records.find((r) => r.id === props.tab.connectionId)
    : undefined,
);

// P16 design system LAW: connection colour reaches the view as a 2px rail (the toolbar cap)
// plus a dot (the view header) — never a tint or a full border. Mirrors Toolbar.vue/TreeRow.vue.
const connColor = computed(() => connRecord.value?.color);
const iconColor = computed(() => connColorVar(connColor.value) ?? 'var(--kira-info)');

// The view header's breadcrumb: "connection / dbN / " for redis, "connection / bucket / " for
// s3 — each engine's tree roots a key's/object's path at its own top-level segment kind (redis's
// `database`, see redis/catalog.ts; s3's `bucket`, see s3/catalog.ts), so this just reads whichever
// one exists in the path — no new state.
const dbLabel = computed(() => {
  if (!props.tab.connectionId) return null;
  try {
    return (
      decodePath(props.tab.connectionId, props.tab.path).segments.find(
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
  return getPage(props.tab.id);
});

// A cursor-strategy page (hash/set/zset/stream — SCAN-family) is forward-only: there is no
// reliable way to seek a SCAN cursor backward, so "Prev" only ever applies to a list key's plain
// LRANGE offset strategy.
const prevDisabled = computed(
  () => props.tab.state.pageIndex === 0 || page.value?.position.strategy !== 'offset',
);

// P31 D17/D18: the same "hide non-matching rows" toggle grid/documents/stream share (P24 D2) —
// filtered rows keep their real row number (the `i + 1` gutter below), same as those views.
const displayRows = computed<number[] | null>(() => matchedRows(props.tab.id));
const rowIndices = computed(() => {
  void pageVersion.n;
  if (displayRows.value) return displayRows.value;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

function rowAt(i: number) {
  void pageVersion.n;
  return keyValueRow(props.tab.id, i);
}

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
const PAGE_SIZE_OPTIONS: { value: KeyValueTabState['pageSize']; label: string; testid: string }[] =
  [
    { value: 10, label: '10', testid: 'keyvalue-page-size-10' },
    { value: 100, label: '100', testid: 'keyvalue-page-size-100' },
    { value: 1000, label: '1k', testid: 'keyvalue-page-size-1000' },
    { value: 10000, label: '10k', testid: 'keyvalue-page-size-10000' },
  ];
function onPageSize(size: KeyValueTabState['pageSize']): void {
  void setPageSize(props.tab.id, size);
}

// --- write gating: the granular caps (§ caps.ts's canInsert/canUpdate/canDelete), narrowed by
// the connection record's own readOnly flag — the same two-part gate DataToolbar's isWritable
// applies, just per-action instead of one coarse boolean. ------------------------------------
const caps = computed(() =>
  props.tab.connectionId ? (connectionsState.states[props.tab.connectionId]?.caps ?? null) : null,
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
// immediately on Save (no staged/pending edit set — mirrors documentMutations.ts). -----------
const editOpen = ref(false);
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
    await saveValueEdit(props.tab.id, keyName.value, editDraft.value);
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
// draft that a later Save could silently commit over newer data.
watch(page, () => {
  objectDraft.value = null;
  objectSaveError.value = null;
});

async function saveObjectEdit(): Promise<void> {
  if (objectDraft.value === null || !keyName.value) return;
  objectSaving.value = true;
  objectSaveError.value = null;
  try {
    await saveValueEdit(props.tab.id, keyName.value, objectDraft.value);
    objectDraft.value = null;
  } catch (err) {
    objectSaveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    objectSaving.value = false;
  }
}

// --- delete: type-agnostic (DEL works for any of the six types) — confirmed inline, mirrors
// documentMenu.ts's window.confirm() precedent for a destructive, un-staged action. S3's object
// delete rides state/objectStore.ts's deleteObject() instead of keyValueMutations' deleteKey(),
// since it needs the object's whole path (not just its key name) to satisfy s3/mutate.ts's
// bucket-rooted MutationPlan.path. ----------------------------------------------------------
async function onDeleteKey(): Promise<void> {
  if (!canDelete.value || !keyName.value) return;
  const label = isSingleObjectPage.value ? 'object' : 'key';
  if (!window.confirm(`Delete ${label} "${keyName.value}"? This removes the entire ${label}.`)) {
    return;
  }
  if (isSingleObjectPage.value) {
    if (!props.tab.connectionId) return;
    await deleteObject(props.tab.connectionId, props.tab.path, props.tab.id);
    await reload(props.tab.id);
    return;
  }
  await deleteKey(props.tab.id, keyName.value);
}

// --- download: a read, never blocked by read-only (D18) — enabled regardless of canUpdate/
// canDelete/canInsert, gated only on caps.fileTransfer. ---------------------------------------
async function onDownload(): Promise<void> {
  if (!canDownload.value || !props.tab.connectionId) return;
  await downloadObject(props.tab.connectionId, props.tab.path, props.tab.id);
}

// --- add key popover: name + initial value, string-typed only (same D2 as edit). On success
// the new key opens in its own tab — this tab is still showing a different, still-live key.
// For an S3 object page, Add instead opens the upload dialog (state/objectStore.ts) targeting
// this object's own container — pathParent(tab.path), the bucket or prefix it lives under. ---
const addOpen = ref(false);
const addName = ref('');
const addValue = ref('');
const addSaving = ref(false);
const addError = ref<string | null>(null);

function openAdd(): void {
  if (!canInsert.value) return;
  if (isSingleObjectPage.value) {
    if (!props.tab.connectionId) return;
    openUploadDialog(props.tab.connectionId, pathParent(props.tab.path) ?? '');
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
    await addKey(props.tab.id, name, addValue.value);
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
  openContextMenu(
    e,
    keyValueMenu({
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
    tabId: props.tab.id,
    connectionId: props.tab.connectionId,
    path: props.tab.path,
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
  publishSelectedCell(selected);
}

// --- search: filters the already-loaded page only, never a new query (mirrors
// views/grid/search.ts's discipline exactly — see kvSearch.ts). ------------------------------
function onToggleSearch(): void {
  const r = rt.value;
  if (r) r.searchOpen = !r.searchOpen;
}
function onCloseSearch(): void {
  const r = rt.value;
  if (r) r.searchOpen = false;
}

const tbodyRef = ref<HTMLElement | null>(null);
function onGoToMatch(row: number): void {
  tbodyRef.value?.querySelector(`[data-row="${row}"]`)?.scrollIntoView({ block: 'nearest' });
}

// Rebuilt only when the search result changes (a completed scan or prev/next), not per row.
const matchIndex = computed(() => {
  const entry = searchState[props.tab.id];
  if (!entry) return null;
  const set = new Set<string>();
  for (const m of entry.matches) set.add(`${m.row}:${m.col}`);
  return { set, current: entry.index >= 0 ? entry.matches[entry.index] : undefined };
});
function isSearchMatch(row: number, col: 'field' | 'value'): boolean {
  return matchIndex.value?.set.has(`${row}:${col}`) ?? false;
}
function isCurrentSearchMatch(row: number, col: 'field' | 'value'): boolean {
  const current = matchIndex.value?.current;
  return !!current && current.row === row && current.col === col;
}

function onStop(): void {
  stop(props.tab.id);
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

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', () => void reload(props.tab.id));
  unregisterFindCommand = registerCommand('view.find', onToggleSearch);
});

onUnmounted(() => {
  unregisterCommand?.();
  unregisterFindCommand?.();
});
</script>

<template>
  <div class="keyvalue-view" data-testid="keyvalue-view" :data-path="tab.path">
    <ReconnectGate
      v-if="needsReconnect"
      container-testid="keyvalue-reconnect"
      button-testid="keyvalue-reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <ViewChrome
      v-else
      :tab="tab"
      :icon="page?.redisType === 'object' ? 'file' : 'key'"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      target-testid="keyvalue-target"
      refresh-testid="keyvalue-refresh"
      stop-testid="keyvalue-stop"
      :can-stop="running"
      @refresh="reload(tab.id)"
      @stop="onStop"
    >
      <template #badges>
        <template v-if="page">
          <span class="p-badge" data-testid="keyvalue-type">{{ page.redisType }}</span>
          <!-- TTL is a Redis-only concept (always null for an S3 object — read.ts never computes
               it) — showing "no expiry" for every object would be a permanently-meaningless chip,
               not real information. Memory/size (P33 D5) is real for both: read.ts now sets
               memoryBytes to the object's own ContentLength. -->
          <template v-if="!isSingleObjectPage">
            <!-- TTL is styled as a warning chip, not a neutral badge: a key that is about to
                 vanish should look like one (see the mockup's KeyValue.html). -->
            <span class="p-chip" :class="{ warn: page.ttlMs !== null }" data-testid="keyvalue-ttl">
              <CodiconIcon name="history" :size="13" />
              {{ page.ttlMs !== null ? `expires in ${ttlText(page.ttlMs)}` : 'no expiry' }}
            </span>
          </template>
          <span class="p-badge" data-testid="keyvalue-memory">{{ memoryText(page.memoryBytes) }}</span>
          <span v-if="connRecord" class="p-badge">{{ connRecord.readOnly ? 'read-only' : 'read-write' }}</span>
        </template>
      </template>

      <template #toolbar>
        <div class="sep" />
        <div class="group">
          <!-- Prev/Next are meaningless for a single-object page (readObject's own doc comment:
               "there is nothing to paginate") — hidden rather than shown permanently disabled,
               same call StreamView.vue's isBatch makes for SQS. The status text stays: it's the
               only place the Count button's result (below) ever gets shown, for every engine. -->
          <IconButton
            v-if="!isSingleObjectPage"
            icon="arrow-left"
            data-testid="keyvalue-prev"
            :disabled="prevDisabled"
            v-tooltip="'Previous page'"
            @click="goPrev(tab.id)"
          />
          <span class="mono p-sm muted" data-testid="keyvalue-status">{{ statusLine }}</span>
          <IconButton
            v-if="!isSingleObjectPage"
            icon="arrow-right"
            data-testid="keyvalue-next"
            :disabled="!rt?.hasMore"
            v-tooltip="'Next page'"
            @click="goNext(tab.id)"
          />
        </div>

        <template v-if="!isSingleObjectPage">
          <div class="sep" />

          <!-- Page-size sits right after the pager, before the count/mutation groups — same slot
               DataToolbar.vue's own page-size segmented control occupies. -->
          <SegmentedControl
            :model-value="tab.state.pageSize"
            :options="PAGE_SIZE_OPTIONS"
            data-testid="keyvalue-page-size-picker"
            @update:model-value="onPageSize"
          />
        </template>

        <div class="sep" />

        <!-- DataToolbar's [count, columns] group — Redis has no columns/fields equivalent
             (a key has no schema), so this group is count alone, same slot as SQL/Document. -->
        <div class="group">
          <IconButton
            icon="symbol-number"
            data-testid="keyvalue-count"
            v-tooltip="'Exact count'"
            @click="runCount(tab.id)"
          />
        </div>

        <div class="sep" />

        <!-- Canonical [add, edit/delete, search] group — add leads (DataToolbar.vue's own
             add-before-delete order), search trails, same as every other view. -->
        <div class="group">
          <div class="add-anchor">
            <IconButton
              icon="add"
              data-testid="keyvalue-add"
              :disabled="!canInsert"
              v-tooltip="addTitle"
              @click="openAdd"
            />
            <PopoverPanel v-if="addOpen" test-id="keyvalue-add-popover" :width="320" @close="closeAdd">
              <div class="popover-form">
                <div class="popover-title p-sm muted">Add key (string value)</div>
                <TextField v-model="addName" placeholder="Key name" data-testid="keyvalue-add-name" />
                <TextField
                  v-model="addValue"
                  placeholder="Initial value"
                  data-testid="keyvalue-add-value"
                  @keydown.enter="submitAdd"
                  @keydown.escape="closeAdd"
                />
                <div v-if="addError" class="p-xs popover-error" data-testid="keyvalue-add-error">
                  {{ addError }}
                </div>
                <div class="popover-actions">
                  <AppButton kind="dialog" data-testid="keyvalue-add-cancel" @click="closeAdd">Cancel</AppButton>
                  <AppButton
                    kind="dialog"
                    variant="primary"
                    data-testid="keyvalue-add-save"
                    :disabled="addSaving"
                    @click="submitAdd"
                  >Save</AppButton>
                </div>
              </div>
            </PopoverPanel>
          </div>

          <div class="edit-anchor">
            <IconButton
              icon="edit"
              data-testid="keyvalue-edit"
              :disabled="editDisabled"
              v-tooltip="editTitle"
              @click="openEdit"
            />
            <PopoverPanel
              v-if="editOpen && !isSingleObjectPage"
              test-id="keyvalue-edit-popover"
              :width="320"
              @close="closeEdit"
            >
              <div class="popover-form">
                <div class="popover-title p-sm muted">Edit value</div>
                <TextField
                  v-model="editDraft"
                  data-testid="keyvalue-edit-input"
                  @keydown.enter="saveEdit"
                  @keydown.escape="closeEdit"
                />
                <div v-if="editError" class="p-xs popover-error" data-testid="keyvalue-edit-error">
                  {{ editError }}
                </div>
                <div class="popover-actions">
                  <AppButton kind="dialog" data-testid="keyvalue-edit-cancel" @click="closeEdit">Cancel</AppButton>
                  <AppButton
                    kind="dialog"
                    variant="primary"
                    data-testid="keyvalue-edit-save"
                    :disabled="editSaving"
                    @click="saveEdit"
                  >Save</AppButton>
                </div>
              </div>
            </PopoverPanel>
          </div>

          <IconButton
            icon="trash"
            data-testid="keyvalue-delete"
            :disabled="!canDelete"
            v-tooltip="deleteTitle"
            @click="onDeleteKey"
          />

          <IconButton
            v-if="canDownload"
            icon="cloud-download"
            data-testid="keyvalue-download"
            v-tooltip="downloadTitle"
            @click="onDownload"
          />

          <IconButton
            icon="search"
            :active="!!rt?.searchOpen"
            v-tooltip="'Search this page'"
            data-testid="keyvalue-search"
            @click="onToggleSearch"
          />
        </div>
      </template>

      <template #strips>
        <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="keyvalue-error">
          {{ rt.error.message }}
        </MessageStrip>
        <!-- P33 D4: an object over OBJECT_BODY_PREVIEW_BYTES has no Body row at all — this is the
             renderer's own honest explanation of that absence, gated on the same shared constant
             the adapter used, not a parsed string. -->
        <MessageStrip
          v-if="isSingleObjectPage && page && objectBodyRow === null && page.memoryBytes !== null"
          tone="warn"
          data-testid="keyvalue-object-too-large"
        >
          Too large to preview ({{ formatBytes(page.memoryBytes) }}, over the
          {{ formatBytes(OBJECT_BODY_PREVIEW_BYTES) }} limit) — use Download to save it locally.
        </MessageStrip>
        <!-- The S3 object body is edited through the docked cell editor below (onRowClick's
             onEdit stages into objectDraft, never writing to S3 directly) — this strip is the
             explicit Save/Discard step that turns the staged draft into a real PutObject. -->
        <MessageStrip v-if="objectDraft !== null" tone="warn" data-testid="keyvalue-object-edit-pending">
          <span data-testid="keyvalue-object-edit-note"
            >Unsaved changes to this object's body<template v-if="objectSaveError">
              — {{ objectSaveError }}</template
            ></span
          >
          <AppButton
            class="strip-action"
            variant="primary"
            data-testid="keyvalue-object-edit-save"
            :disabled="objectSaving"
            @click="saveObjectEdit"
          >
            Save
          </AppButton>
        </MessageStrip>
      </template>

      <KeyValueSearchToolbar
        v-if="rt?.searchOpen"
        :tab-id="tab.id"
        @go-to-match="onGoToMatch"
        @close="onCloseSearch"
      />

      <div class="p-panel table-panel">
        <div class="p-thead">
          <div class="p-th gutter kv-col-gutter"></div>
          <div class="p-th kv-col-field">
            <span class="name">{{
              page?.redisType === 'string' ? '' : page?.redisType === 'list' ? 'index' : 'field'
            }}</span>
          </div>
          <div class="p-th kv-col-value">
            <span class="name">{{ page?.redisType === 'zset' ? 'score' : 'value' }}</span>
          </div>
        </div>
        <div class="tbody" ref="tbodyRef" data-testid="keyvalue-list">
          <EmptyState
            v-if="!rt || rt.rowCount === 0"
            :icon="rt ? 'database' : 'loading'"
            :label="rt ? 'No data' : 'Loading…'"
          />
          <!-- P31 D19 (P24 D8's precedent): filtering to zero matches is a distinct empty state
               from "no data loaded". -->
          <EmptyState
            v-else-if="displayRows && displayRows.length === 0"
            icon="search"
            label="No matching rows"
            data-testid="keyvalue-no-matching-rows"
          >
            <AppButton data-testid="keyvalue-show-all-rows" @click="setSearchFiltering(tab.id, false)">
              Show all rows
            </AppButton>
          </EmptyState>
          <template v-else>
            <div
              v-for="i in rowIndices"
              :key="i"
              class="kv-row"
              data-testid="keyvalue-row"
              :data-row="i"
              @click="onRowClick(i)"
              @contextmenu="rowAt(i) && onRowContextMenu($event, rowAt(i)!.field, rowAt(i)!.value)"
            >
              <div class="p-td gutter kv-col-gutter">{{ i + 1 }}</div>
              <div
                class="p-td kv-col-field"
                :class="{
                  'search-match': isSearchMatch(i, 'field'),
                  'search-match-current': isCurrentSearchMatch(i, 'field'),
                }"
                v-tooltip="rowAt(i)?.field"
                data-testid="keyvalue-field"
              >
                {{ rowAt(i)?.field }}
              </div>
              <div
                class="p-td kv-col-value"
                :class="{
                  'search-match': isSearchMatch(i, 'value'),
                  'search-match-current': isCurrentSearchMatch(i, 'value'),
                }"
                v-tooltip="rowAt(i)?.value"
                data-testid="keyvalue-value"
              >
                {{ rowAt(i)?.value }}
                <span v-if="rowAt(i)?.isTruncated" class="p-chip truncated-chip" v-tooltip="'value truncated'"
                  >truncated</span
                >
              </div>
            </div>
          </template>
        </div>
      </div>
    </ViewChrome>
    <CellEditorDock :tab-id="tab.id" />
  </div>
</template>

<style scoped>
.keyvalue-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-panel {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
}

.tbody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.kv-col-gutter {
  width: 40px;
  flex-shrink: 0;
}

.kv-col-field {
  width: 220px;
  flex-shrink: 0;
}

.kv-col-value {
  flex: 1;
  min-width: 0;
}

.kv-row {
  height: var(--kira-row-height);
  display: flex;
  cursor: pointer;
}

.kv-row:hover {
  background: var(--kira-hover);
}

.truncated-chip {
  margin-left: var(--kira-s-3);
  flex-shrink: 0;
  background: var(--kira-bg-input);
  color: var(--kira-fg-disabled);
}

.search-match {
  background: color-mix(in srgb, var(--kira-warn) 25%, transparent);
}

.search-match-current {
  background: var(--kira-warn);
  color: var(--kira-bg);
}

.edit-anchor,
.add-anchor {
  position: relative;
}

.popover-form {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
  padding: var(--kira-s-3);
}

.popover-title {
  padding: 0;
}

.popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--kira-s-2);
}

.popover-error {
  color: var(--kira-error);
}
</style>
