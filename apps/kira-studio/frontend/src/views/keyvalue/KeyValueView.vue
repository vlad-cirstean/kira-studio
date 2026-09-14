<script setup lang="ts">
import type { KeyValueTabRecord, PageSize } from '@shared/domain/tabs';
import { decodePath, pathParent, pathTail } from '@shared/domain/tree';
import { OBJECT_BODY_PREVIEW_BYTES } from '@shared/protocol/page';
import { computed, ref } from 'vue';
import { formatBytes } from '../../format';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openUploadDialog } from '../../state/objectStore';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import KeyValuePane from '../shared/keyvalue/KeyValuePane.vue';
import { addKey } from '../shared/keyvalue/mutations';
import { getPage, pageVersion } from '../shared/keyvalue/page';
import {
  closeEdit,
  memoryText,
  objectBodyRowFor,
  objectEditGate,
  onDeleteKey,
  onDownload,
  openEdit,
  saveEdit,
  saveObjectEdit,
  ttlText,
  writeDisabledReason,
} from '../shared/keyvalue/pane';
import {
  goNext,
  goPrev,
  load,
  reload,
  runCount,
  runtime,
  setPageSize,
  stop,
  toggleSearchOpen,
} from '../shared/keyvalue/state';
import { pageSizeOptions } from '../shared/page/sizes';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/DocumentView.vue.
const props = defineProps<{ tab: KeyValueTabRecord }>();

const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => load(props.tab.id),
);

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));

const connRecord = computed(() => connectionRecord(props.tab.connectionId));

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

function ttlChipText(ttlMs: number | null): string {
  return ttlMs !== null ? `expires in ${ttlText(ttlMs)}` : 'no expiry';
}

// --- page size (P24 D30: <SegmentedControl>, mirroring views/grid/DataToolbar.vue's own swap) -
const PAGE_SIZE_OPTIONS = pageSizeOptions('keyvalue-');
function onPageSize(size: PageSize): void {
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
const editGate = computed(() => objectEditGate(props.tab.id));
const editTitle = computed(() => {
  if (page.value?.redisType === 'object') return editGate.value.reason;
  if (!canUpdate.value) return writeDisabledReason(caps.value?.canUpdate);
  if (!editableType.value) return 'Only string values are editable in this version';
  return 'Edit value';
});
const editDisabled = computed(() =>
  page.value?.redisType === 'object'
    ? !editGate.value.editable
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

// P33 D4: present only when the object is at or under OBJECT_BODY_PREVIEW_BYTES — pane.ts's own
// scan of the already-loaded field list, shared with the row-click cell-editor gate.
const objectBodyRow = computed(() => objectBodyRowFor(props.tab.id, page.value));

// --- edit popover: a single TextField pre-filled with the current string value, mutating
// immediately on Save (no staged/pending edit set — mirrors documents/mutations.ts). Backed by
// runtime[tab.id] (pane.ts), not a local ref: a row's own context menu (KeyValuePane's body) can
// also open this same popover, so the state can't be component-local any more (P63 §2.2). --------
function openEditFromToolbar(): void {
  addOpen.value = false;
  openEdit(props.tab.id);
}

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => reload(props.tab.id));
}

function onStop(): void {
  stop(props.tab.id);
}

// --- add key popover: name + initial value, string-typed only (same D2 as edit). On success
// the new key opens in its own tab — this tab is still showing a different, still-live key.
// For an S3 object page, Add instead opens the upload dialog (state/objectStore.ts) targeting
// this object's own container — pathParent(tab.path), the bucket or prefix it lives under. ---
// Toolbar-only: no other region ever opens or reads this popover, so (unlike edit/object-edit)
// it stays local component state.
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

function onToggleSearch(): void {
  toggleSearchOpen(props.tab.id);
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
</script>

<template>
  <div class="keyvalue-view" data-testid="keyvalue-view" :data-path="tab.path">
    <ViewChrome
      :tab="tab"
      :icon="page?.redisType === 'object' ? 'file' : 'key'"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      target-testid="keyvalue-target"
      refresh-testid="keyvalue-refresh"
      stop-testid="keyvalue-stop"
      :can-stop="running"
      :can-refresh="true"
      @refresh="onRefresh"
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
              {{ ttlChipText(page.ttlMs) }}
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
             add-before-delete order), search trails, same as every other view. Real-interaction
             fix: this group sits left-of-center in the toolbar (after the pager/page-size/count
             groups, before search), with room to its own right, not flush against the toolbar's
             right edge the way api/EnvironmentSelect.vue's trigger is — PopoverPanel's own
             default anchor (now 'left') is correct here without an explicit override. -->
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
              @click="openEditFromToolbar"
            />
            <PopoverPanel
              v-if="rt?.editOpen && !isSingleObjectPage"
              test-id="keyvalue-edit-popover"
              :width="320"
              @close="() => closeEdit(tab.id)"
            >
              <div class="popover-form">
                <div class="popover-title p-sm muted">Edit value</div>
                <TextField
                  :model-value="rt?.editDraft ?? ''"
                  data-testid="keyvalue-edit-input"
                  @update:model-value="(v: string) => { if (rt) rt.editDraft = v; }"
                  @keydown.enter="() => saveEdit(tab.id)"
                  @keydown.escape="() => closeEdit(tab.id)"
                />
                <div v-if="rt?.editError" class="p-xs popover-error" data-testid="keyvalue-edit-error">
                  {{ rt.editError }}
                </div>
                <div class="popover-actions">
                  <AppButton kind="dialog" data-testid="keyvalue-edit-cancel" @click="() => closeEdit(tab.id)">Cancel</AppButton>
                  <AppButton
                    kind="dialog"
                    variant="primary"
                    data-testid="keyvalue-edit-save"
                    :disabled="!!rt?.editSaving"
                    @click="() => saveEdit(tab.id)"
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
            @click="() => onDeleteKey(tab.id)"
          />

          <IconButton
            v-if="canDownload"
            icon="cloud-download"
            data-testid="keyvalue-download"
            v-tooltip="downloadTitle"
            @click="() => onDownload(tab.id)"
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
        <!-- P43 F6/D7: a failed delete — the edit/add popovers already show their own failures
             inline (rt.editError/rt.objectSaveError/addError below); delete has no popover of its
             own to hold one, so it uses the shared per-tab field every other view's own strip does. -->
        <MessageStrip v-if="rt?.actionError" tone="err" data-testid="keyvalue-action-error">
          {{ rt.actionError }}
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
        <!-- The S3 object body is edited through the docked cell editor (KeyValuePane's own
             onRowClick stages into runtime[tab.id].objectDraft, never writing to S3 directly) —
             this strip is the explicit Save/Discard step that turns the staged draft into a real
             PutObject. -->
        <MessageStrip v-if="!!rt && rt.objectDraft !== null" tone="warn" data-testid="keyvalue-object-edit-pending">
          <span data-testid="keyvalue-object-edit-note"
            >Unsaved changes to this object's body<template v-if="rt?.objectSaveError">
              — {{ rt.objectSaveError }}</template
            ></span
          >
          <AppButton
            class="strip-action"
            variant="primary"
            data-testid="keyvalue-object-edit-save"
            :disabled="!!rt?.objectSaving"
            @click="() => saveObjectEdit(tab.id)"
          >
            Save
          </AppButton>
        </MessageStrip>
      </template>

      <KeyValuePane :view-key="tab.id" />
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
