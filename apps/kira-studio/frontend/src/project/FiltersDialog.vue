<script setup lang="ts">
import type { NodeKind } from '@shared/domain/tree';
import { EMPTY_VISIBILITY, type TreeVisibility } from '@shared/domain/tree-filter';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
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
      <DialogHeader>
        <span class="size-4 flex items-center justify-center shrink-0 text-muted-foreground"><CodiconIcon name="filter" :size="13" /></span>
        <DialogTitle
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
    <div class="flex flex-col gap-2 p-3">
      <span class="help text-kira-xs leading-normal text-subtle">
        Ticked types and objects are shown; unticking one hides it and everything under it.
        Nothing you have not unticked is ever hidden — an object created later shows up too.
      </span>

      <section class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-kira-sm text-fg">Object types</span>
          <span class="flex gap-1">
            <button type="button" class="bg-none border-none p-0 cursor-pointer text-kira-xs text-primary hover:underline" @click="allKinds">All</button>
            <button type="button" class="bg-none border-none p-0 cursor-pointer text-kira-xs text-primary hover:underline" @click="noneKinds">None</button>
          </span>
        </div>
        <div class="flex flex-col gap-px max-h-56 overflow-y-auto rounded-kira-sm border border-border p-1" data-testid="filter-kind-list">
          <Label
            v-for="row in kinds"
            :key="row.kind"
            class="flex items-center cursor-default gap-1 h-6.5"
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
            <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-kira-sm">{{ row.label }}</span>
            <span class="text-kira-xs text-subtle">{{ row.count }}</span>
          </Label>
          <span v-if="kinds.length === 0" class="text-kira-xs text-subtle p-1">Nothing cached yet.</span>
        </div>
      </section>

      <section class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-kira-sm text-fg">Objects</span>
          <span class="flex gap-1">
            <button type="button" class="bg-none border-none p-0 cursor-pointer text-kira-xs text-primary hover:underline" @click="allObjects">All</button>
            <button type="button" class="bg-none border-none p-0 cursor-pointer text-kira-xs text-primary hover:underline" @click="noneObjects">None</button>
          </span>
        </div>
        <div class="w-full">
          <Input
            v-model="nameFilter"
            class="name-filter h-control w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
            placeholder="Filter objects by name"
            data-testid="filter-name-input"
          />
        </div>
        <div class="flex flex-col gap-px max-h-56 overflow-y-auto rounded-kira-sm border border-border p-1" data-testid="filter-object-list">
          <div
            v-for="row in objects.rows"
            :key="row.path"
            class="flex items-center cursor-default gap-1 h-6.5"
            data-testid="filter-object-row"
            :data-path="row.path"
            :data-state="row.state"
            :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          >
            <button
              v-if="row.hasChildren"
              type="button"
              class="twisty-btn flex items-center justify-center w-4 h-4 shrink-0 bg-none border-none p-0 cursor-pointer text-muted-foreground"
              :aria-label="expandedPaths.has(row.path) ? 'Collapse' : 'Expand'"
              @click="onToggleExpand(row.path)"
            >
              <CodiconIcon :name="expandedPaths.has(row.path) ? 'chevron-down' : 'chevron-right'" :size="12" />
            </button>
            <span v-else class="w-4 shrink-0" />
            <Tooltip :disabled="!row.disabledReason">
              <TooltipTrigger as-child>
                <Label class="object-checkbox-label flex items-center flex-1 min-w-0 cursor-pointer gap-1">
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
                  <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-kira-sm">{{ row.name }}</span>
                </Label>
              </TooltipTrigger>
              <TooltipContent v-if="row.disabledReason">{{ row.disabledReason }}</TooltipContent>
            </Tooltip>
            <span v-if="row.hasChildren" class="text-kira-xs text-subtle">{{ row.childCount }}</span>
          </div>
          <span v-if="objects.rows.length === 0" class="text-kira-xs text-subtle p-1">Nothing cached yet.</span>
          <span v-if="objects.truncated" class="text-kira-xs text-subtle p-1 italic" data-testid="filter-object-truncated">
            Showing the first 500 rows — type to narrow.
          </span>
        </div>
      </section>

      <Alert variant="note" class="self-stretch rounded-kira-sm border border-border" data-testid="filters-preview">
        <AlertDescription class="flex items-start gap-1.5">
          <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="info" :size="13" /></span>
          <span>
            Will show <b>{{ preview.shown }}</b> of <b>{{ preview.total }}</b> cached nodes.
          </span>
        </AlertDescription>
      </Alert>

      <span class="help cached-note text-kira-xs leading-normal text-subtle self-start">
        Only cached nodes are listed here — expand more of the tree to include them.
      </span>
    </div>
      </div>

      <DialogFooter>
        <span class="help text-kira-xs leading-normal text-subtle">Applies to <span class="font-data">{{ connectionName }}</span> only</span>
        <span class="flex items-center gap-1 ml-auto">
          <Button variant="dialog" size="kira-lg" @click="filtersDialogStore.closeFiltersDialog">Cancel</Button>
          <Button variant="dialog-primary" size="kira-lg" @click="onSave">Save filters</Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
