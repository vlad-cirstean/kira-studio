<script setup lang="ts">
import type { NodeKind } from '@shared/domain/tree';
import { EMPTY_VISIBILITY, type TreeVisibility } from '@shared/domain/tree-filter';
import { computed, nextTick, ref, watch } from 'vue';
import { connectionRecord } from '../state/connections';
import CodiconIcon from '../theme/CodiconIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import Checkbox from '../theme/primitives/Checkbox.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import TextField from '../theme/primitives/TextField.vue';
import {
  type FilterNodeRow,
  kindRows,
  nodeRows,
  previewCounts,
  toggleKind,
  toggleNode,
} from './filterTree';
import { closeFiltersDialog, filtersDialogState, saveVisibility, treeState } from './state/tree';

// P28 D10-D19: checkboxes, not rules. Two sections over the same cached-node model — Object
// types (kind, flat) and Objects (path, expandable) — plus a live-consequence strip. Nothing here
// fetches; the dialog offers exactly what the tree has already cached (D21).

const draft = ref<TreeVisibility>(EMPTY_VISIBILITY);
const expandedPaths = ref<Set<string>>(new Set());
const nameFilter = ref('');

// D20: every ancestor segment of `path`, outermost first — mirrors state/tree.ts's own
// revealPath() accumulation, since a dialog row and a tree row share the same path encoding.
function ancestorsOf(path: string): Set<string> {
  const segments = path.split('/');
  const out = new Set<string>();
  let acc = '';
  for (let i = 0; i < segments.length - 1; i++) {
    acc = acc ? `${acc}/${segments[i]}` : segments[i];
    out.add(acc);
  }
  return out;
}

watch(
  () => filtersDialogState.connectionId,
  async (connectionId) => {
    const focusPath = filtersDialogState.focusPath;
    expandedPaths.value = focusPath ? ancestorsOf(focusPath) : new Set();
    nameFilter.value = '';
    if (!connectionId) return;
    const existing = treeState.visibility[connectionId] ?? EMPTY_VISIBILITY;
    draft.value = {
      hiddenKinds: [...existing.hiddenKinds],
      hiddenPaths: [...existing.hiddenPaths],
    };
    if (!focusPath) return;
    await nextTick();
    document
      .querySelector(`[data-testid="filter-object-row"][data-path="${CSS.escape(focusPath)}"]`)
      ?.scrollIntoView({ block: 'center' });
  },
  { immediate: true },
);

const kinds = computed(() =>
  filtersDialogState.connectionId ? kindRows(filtersDialogState.connectionId, draft.value) : [],
);

const objects = computed(() =>
  filtersDialogState.connectionId
    ? nodeRows(filtersDialogState.connectionId, draft.value, expandedPaths.value, nameFilter.value)
    : { rows: [], truncated: false },
);

// A live preview computed from the same filterTree.ts previewCounts() the tree itself is
// evaluated with, so this dialog cannot disagree with what the tree will actually show.
const preview = computed(() => {
  const connectionId = filtersDialogState.connectionId;
  if (!connectionId) return { shown: 0, total: 0 };
  return previewCounts(connectionId, draft.value);
});

function onToggleKind(kind: NodeKind): void {
  draft.value = toggleKind(draft.value, kind);
}

function onToggleNode(row: FilterNodeRow): void {
  if (row.disabled) return;
  draft.value = toggleNode(draft.value, row);
}

function onToggleExpand(path: string): void {
  const next = new Set(expandedPaths.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expandedPaths.value = next;
}

// D18: All/None act on the currently listed subset only — under a name filter, that is just the
// matching rows and their ancestors, not the whole cached tree.
function allObjects(): void {
  let v = draft.value;
  for (const row of objects.value.rows) {
    if (row.state !== 'on' && !row.disabled) v = toggleNode(v, row);
  }
  draft.value = v;
}

function noneObjects(): void {
  let v = draft.value;
  for (const row of objects.value.rows) {
    if (row.state !== 'off' && !row.disabled) v = toggleNode(v, row);
  }
  draft.value = v;
}

function allKinds(): void {
  draft.value = { ...draft.value, hiddenKinds: [] };
}

function noneKinds(): void {
  draft.value = { ...draft.value, hiddenKinds: kinds.value.map((r) => r.kind) };
}

async function onSave(): Promise<void> {
  const connectionId = filtersDialogState.connectionId;
  if (!connectionId) return;
  await saveVisibility(connectionId, draft.value);
  closeFiltersDialog();
}

// Title identity (FiltersDialog.html: "Tree filters — prod-analytics") — reads the name off
// the store that already has it, same as ConnectionDialog.vue does; adds no new state.
const connectionName = computed(
  () => connectionRecord(filtersDialogState.connectionId)?.name ?? '',
);
</script>

<template>
  <DialogFrame
    v-if="filtersDialogState.open"
    title="Tree filters"
    :width="560"
    max-height="80vh"
    test-id="filters-dialog"
    close-test-id="filters-dialog-close"
    @close="closeFiltersDialog"
  >
    <template #header>
      <span class="icon-box muted"><CodiconIcon name="filter" :size="13" /></span>
      <span>Tree filters<template v-if="connectionName"> — {{ connectionName }}</template></span>
    </template>

    <div class="p-dialog-body">
      <span class="help">
        Ticked types and objects are shown; unticking one hides it and everything under it.
        Nothing you have not unticked is ever hidden — an object created later shows up too.
      </span>

      <section class="filter-section">
        <div class="section-head">
          <span class="section-title">Object types</span>
          <span class="section-links">
            <button type="button" class="link-btn" @click="allKinds">All</button>
            <button type="button" class="link-btn" @click="noneKinds">None</button>
          </span>
        </div>
        <div class="kind-list" data-testid="filter-kind-list">
          <label
            v-for="row in kinds"
            :key="row.kind"
            class="kind-row"
            :data-testid="`filter-kind-row-${row.kind}`"
            :data-state="row.hidden ? 'off' : 'on'"
          >
            <Checkbox
              :model-value="!row.hidden"
              @update:model-value="onToggleKind(row.kind)"
            />
            <span class="kind-label">{{ row.label }}</span>
            <span class="kind-count">{{ row.count }}</span>
          </label>
          <span v-if="kinds.length === 0" class="empty-note">Nothing cached yet.</span>
        </div>
      </section>

      <section class="filter-section">
        <div class="section-head">
          <span class="section-title">Objects</span>
          <span class="section-links">
            <button type="button" class="link-btn" @click="allObjects">All</button>
            <button type="button" class="link-btn" @click="noneObjects">None</button>
          </span>
        </div>
        <div class="name-filter-wrap">
          <TextField
            v-model="nameFilter"
            class="name-filter"
            placeholder="Filter objects by name"
            data-testid="filter-name-input"
          />
        </div>
        <div class="object-list" data-testid="filter-object-list">
          <div
            v-for="row in objects.rows"
            :key="row.path"
            class="object-row"
            data-testid="filter-object-row"
            :data-path="row.path"
            :data-state="row.state"
            :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          >
            <button
              v-if="row.hasChildren"
              type="button"
              class="twisty-btn"
              :aria-label="expandedPaths.has(row.path) ? 'Collapse' : 'Expand'"
              @click="onToggleExpand(row.path)"
            >
              <CodiconIcon :name="expandedPaths.has(row.path) ? 'chevron-down' : 'chevron-right'" :size="12" />
            </button>
            <span v-else class="twisty-spacer" />
            <label class="object-checkbox-label" v-tooltip="row.disabledReason ?? undefined">
              <Checkbox
                :model-value="row.state !== 'off'"
                :indeterminate="row.state === 'partial'"
                :disabled="row.disabled"
                @update:model-value="onToggleNode(row)"
              />
              <span class="object-name">{{ row.name }}</span>
            </label>
            <span v-if="row.hasChildren" class="object-count">{{ row.childCount }}</span>
          </div>
          <span v-if="objects.rows.length === 0" class="empty-note">Nothing cached yet.</span>
          <span v-if="objects.truncated" class="empty-note truncated-note" data-testid="filter-object-truncated">
            Showing the first 500 rows — type to narrow.
          </span>
        </div>
      </section>

      <div class="p-strip note preview-strip" data-testid="filters-preview">
        <span class="icon-box"><CodiconIcon name="info" :size="13" /></span>
        <span>
          Will show <b>{{ preview.shown }}</b> of <b>{{ preview.total }}</b> cached nodes.
        </span>
      </div>

      <span class="help cached-note">
        Only cached nodes are listed here — expand more of the tree to include them.
      </span>
    </div>

    <template #footer>
      <span class="help">Applies to <span class="mono">{{ connectionName }}</span> only</span>
      <span class="p-dialog-actions p-push">
        <AppButton kind="dialog" @click="closeFiltersDialog">Cancel</AppButton>
        <AppButton kind="dialog" variant="primary" @click="onSave">Save filters</AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>

.help {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-disabled);
  line-height: 1.5;
}

.mono {
  font-family: var(--kira-font-family);
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: var(--kira-t-sm);
  font-weight: 600;
  color: var(--kira-fg);
}

.section-links {
  display: flex;
  gap: var(--kira-s-2);
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--kira-t-xs);
  color: var(--kira-accent);
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.kind-list,
.object-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 220px;
  overflow-y: auto;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  padding: var(--kira-s-2);
}

.kind-row,
.object-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  height: var(--kira-h-md);
  cursor: default;
}

.kind-label,
.object-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--kira-t-sm);
}

.kind-count,
.object-count {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-disabled);
}

.object-checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.twisty-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 0;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.twisty-spacer {
  width: 16px;
  flex-shrink: 0;
}

.empty-note {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-disabled);
  padding: var(--kira-s-2);
}

.truncated-note {
  font-style: italic;
}

.name-filter-wrap {
  width: 100%;
}

.name-filter-wrap :deep(.p-input) {
  width: 100%;
}

/* the live-consequence strip is boxed rather than full-bleed, since it sits inside the
   dialog body rather than spanning a whole view */
.preview-strip {
  align-self: stretch;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
}

.cached-note {
  align-self: flex-start;
}
</style>
