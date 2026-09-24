<script setup lang="ts">
import type { NodeKind } from '@shared/domain/tree';
import { EMPTY_VISIBILITY, type TreeVisibility } from '@shared/domain/tree-filter';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, nextTick, ref, watch } from 'vue';
import { useConnectionsStore } from '../state/connections';
import {
  type FilterNodeRow,
  kindRows,
  nodeRows,
  previewCounts,
  toggleKind,
  toggleNode,
} from './filterTree';
import { useFiltersDialogStore, useTreeStore } from './state/tree';

// P28 D10-D19: checkboxes, not rules. Two sections over the same cached-node model — Object
// types (kind, flat) and Objects (path, expandable) — plus a live-consequence strip. Nothing here
// fetches; the dialog offers exactly what the tree has already cached (D21).

const connectionsStore = useConnectionsStore();
const filtersDialogStore = useFiltersDialogStore();
const treeStore = useTreeStore();
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
  () => filtersDialogStore.connectionId,
  async (connectionId) => {
    const focusPath = filtersDialogStore.focusPath;
    expandedPaths.value = focusPath ? ancestorsOf(focusPath) : new Set();
    nameFilter.value = '';
    if (!connectionId) return;
    const existing = treeStore.visibility[connectionId] ?? EMPTY_VISIBILITY;
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
  filtersDialogStore.connectionId ? kindRows(filtersDialogStore.connectionId, draft.value) : [],
);

const objects = computed(() =>
  filtersDialogStore.connectionId
    ? nodeRows(filtersDialogStore.connectionId, draft.value, expandedPaths.value, nameFilter.value)
    : { rows: [], truncated: false },
);

// A live preview computed from the same filterTree.ts previewCounts() the tree itself is
// evaluated with, so this dialog cannot disagree with what the tree will actually show.
const preview = computed(() => {
  const connectionId = filtersDialogStore.connectionId;
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
  const connectionId = filtersDialogStore.connectionId;
  if (!connectionId) return;
  await treeStore.saveVisibility(connectionId, draft.value);
  filtersDialogStore.closeFiltersDialog();
}

// Title identity (FiltersDialog.html: "Tree filters — prod-analytics") — reads the name off
// the store that already has it, same as ConnectionDialog.vue does; adds no new state.
const connectionName = computed(
  () => connectionsStore.connectionRecord(filtersDialogStore.connectionId)?.name ?? '',
);
</script>

<template>
  <Dialog v-if="filtersDialogStore.open" :open="true" @update:open="(v) => !v && filtersDialogStore.closeFiltersDialog()">
    <DialogContent
      :show-close-button="false"
      data-testid="filters-dialog"
      class="flex flex-col p-0 gap-0 w-140 max-h-4/5"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <span class="icon-box muted"><CodiconIcon name="filter" :size="13" /></span>
        <DialogTitle class="text-kira-lg font-normal"
          >Tree filters<template v-if="connectionName"> — {{ connectionName }}</template></DialogTitle
        >
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="filters-dialog-close"
            @click="filtersDialogStore.closeFiltersDialog"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="overflow-auto">
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
          <Label
            v-for="row in kinds"
            :key="row.kind"
            class="kind-row"
            :data-testid="`filter-kind-row-${row.kind}`"
            :data-state="row.hidden ? 'off' : 'on'"
          >
            <Checkbox
              :model-value="!row.hidden"
              class="size-3.5"
              @update:model-value="onToggleKind(row.kind)"
            >
              <CodiconIcon name="check" :size="10" />
            </Checkbox>
            <span class="kind-label">{{ row.label }}</span>
            <span class="kind-count">{{ row.count }}</span>
          </Label>
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
          <Input
            v-model="nameFilter"
            class="name-filter h-control w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
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
            <Tooltip :disabled="!row.disabledReason">
              <TooltipTrigger as-child>
                <Label class="object-checkbox-label">
                  <Checkbox
                    :model-value="row.state === 'partial' ? 'indeterminate' : row.state !== 'off'"
                    :disabled="row.disabled"
                    class="size-3.5"
                    @update:model-value="onToggleNode(row)"
                  >
                    <template #default="{ state }">
                      <CodiconIcon :name="state === 'indeterminate' ? 'dash' : 'check'" :size="10" />
                    </template>
                  </Checkbox>
                  <span class="object-name">{{ row.name }}</span>
                </Label>
              </TooltipTrigger>
              <TooltipContent v-if="row.disabledReason">{{ row.disabledReason }}</TooltipContent>
            </Tooltip>
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
      </div>

      <DialogFooter class="border-t border-border">
        <span class="help">Applies to <span class="font-data">{{ connectionName }}</span> only</span>
        <span class="flex items-center gap-1 ml-auto">
          <Button variant="dialog" size="kira-lg" @click="filtersDialogStore.closeFiltersDialog">Cancel</Button>
          <Button variant="dialog-primary" size="kira-lg" @click="onSave">Save filters</Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
@reference "@theme/base.css";

.help {
  @apply leading-normal;
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-subtle);
}

.filter-section {
  @apply flex flex-col;
  gap: var(--kira-s-2);
}

.section-head {
  @apply flex items-center justify-between;
}

.section-title {
  @apply font-semibold;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg);
}

.section-links {
  @apply flex;
  gap: var(--kira-s-2);
}

.link-btn {
  @apply bg-none border-none p-0 cursor-pointer;
  font-size: var(--kira-t-xs);
  color: var(--kira-accent);
}

.link-btn:hover {
  @apply underline;
}

.kind-list,
.object-list {
  @apply flex flex-col gap-px max-h-56 overflow-y-auto rounded-kira-sm;
  border: var(--kira-border-width) solid var(--kira-border);
  padding: var(--kira-s-2);
}

.kind-row,
.object-row {
  @apply flex items-center cursor-default;
  gap: var(--kira-s-2);
  height: var(--kira-h-md);
}

.kind-label,
.object-name {
  @apply flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap;
  font-size: var(--kira-t-sm);
}

.kind-count,
.object-count {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-subtle);
}

.object-checkbox-label {
  @apply flex items-center flex-1 min-w-0 cursor-pointer;
  gap: var(--kira-s-2);
}

.twisty-btn {
  @apply flex items-center justify-center w-4 h-4 shrink-0 bg-none border-none p-0 cursor-pointer;
  color: var(--kira-fg-muted);
}

.twisty-spacer {
  @apply w-4 shrink-0;
}

.empty-note {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-subtle);
  padding: var(--kira-s-2);
}

.truncated-note {
  @apply italic;
}

.name-filter-wrap {
  @apply w-full;
}

/* the live-consequence strip is boxed rather than full-bleed, since it sits inside the
   dialog body rather than spanning a whole view */
.preview-strip {
  @apply self-stretch rounded-kira-sm;
  border: var(--kira-border-width) solid var(--kira-border);
}

.cached-note {
  @apply self-start;
}
</style>
