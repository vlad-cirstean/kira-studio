<script setup lang="ts">
import type { ApiEnvironment } from '@shared/domain/variables';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { Input } from '@theme/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import RunState from '@theme/RunState.vue';
import { useEventListener } from '@vueuse/core';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { useDragReorder } from '@workbench/util/useDragReorder';
import { computed, reactive, ref, useTemplateRef, watch } from 'vue';
import { useConnectionsStore } from '../state/connections';
import { useRunState } from '../state/runState';
import type { EnvironmentsTabRecord } from '../state/tabDomain';
import { mergeDrafts } from './state/draftMerge';
import { useVariablesStore } from './state/variables';
import { openVariableSetTab } from './tabs';

const confirmDialogStore = useConfirmDialogStore();
const variablesStore = useVariablesStore();
const connectionsStore = useConnectionsStore();

// P28 D16(c): the environment list, re-hosted in a tab. Every behaviour below is
// EnvironmentsDialog.vue's, ported unchanged — name/description inline editing committed together
// on blur (P17 D14), *Edit variables…*, delete behind a confirm, an *Active* radio, drag/keyboard
// reordering refused while filtered (D14), Duplicate (P17 D17) and *New environment*. What changed
// is the chrome: this view's own head/toolbar bands instead of DialogFrame, the filter in the
// toolbar band every other view puts its filter in, *New environment* in the trailing action
// group, and no Close button — a tab is closed the way every other tab is.
//
// `showRunControls: false`'s own reasoning (D16a) still holds — there is no operation here to
// refresh or stop, and two permanently-disabled buttons say something different from "not right
// now" — so the refresh/stop group below is omitted outright rather than rendered disabled.
//
// P104 §3: ViewChrome/ViewHeader/RunState inlined at this call site (no library counterpart).
const props = defineProps<{ tab: EnvironmentsTabRecord }>();

const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));
const railColor = computed(() => (connRecord.value ? (connRecord.value.color ?? null) : undefined));
const runState = useRunState(() => props.tab.id);

interface EnvDraft {
  name: string;
  description: string;
}

function equalEnvDraft(a: EnvDraft, b: EnvDraft): boolean {
  return a.name === b.name && a.description === b.description;
}

function envDraftFromRow(env: ApiEnvironment): EnvDraft {
  return { name: env.name, description: env.description };
}

const nameDrafts = reactive<Record<string, string>>({});
const descriptionDrafts = reactive<Record<string, string>>({});
// P112: the snapshot each row's draft was last reseeded from — see draftMerge.ts. Templates bind
// nameDrafts/descriptionDrafts directly (v-model), so those stay two plain string records; seeds
// and the merge itself work over the combined { name, description } shape.
const seeds = reactive<Record<string, EnvDraft>>({});
const order = ref<string[]>([]);

// D14: the same drag/keyboard reorder the variable rows use. Declared here, ahead of syncDrafts
// below, so dragIndex already exists before that first immediate watch fires (canReorder/onReorder
// close over isFiltered/variablesStore lazily, so declaring this early is safe even though both are
// defined further down).
const { dragIndex, onDragStart, onDragOver, onDragEnd } = useDragReorder(order, {
  canReorder: () => !isFiltered.value,
  onReorder: (next) => variablesStore.reorderEnvironmentsList(next),
});

// P112 §6.5: keep a row's draft that has changed since it was seeded and still differs from what
// the row now is (an in-progress edit); reseed everything else. Order reseeds from the incoming
// list too, unless a drag is in progress.
function syncDrafts(): void {
  const current: Record<string, EnvDraft> = {};
  for (const id of Object.keys(nameDrafts)) {
    current[id] = { name: nameDrafts[id] ?? '', description: descriptionDrafts[id] ?? '' };
  }
  const merged = mergeDrafts(seeds, current, variablesStore.environments, {
    rowId: (env) => env.id,
    toDraft: envDraftFromRow,
    equalDraft: equalEnvDraft,
  });
  for (const key of Object.keys(nameDrafts)) delete nameDrafts[key];
  for (const key of Object.keys(descriptionDrafts)) delete descriptionDrafts[key];
  for (const [id, draft] of Object.entries(merged.drafts)) {
    nameDrafts[id] = draft.name;
    descriptionDrafts[id] = draft.description;
  }
  for (const key of Object.keys(seeds)) delete seeds[key];
  Object.assign(seeds, merged.seeds);
  if (dragIndex.value === null) order.value = merged.order;
}
watch(() => variablesStore.environments, syncDrafts, { immediate: true });

const orderedEnvironments = computed<ApiEnvironment[]>(() => {
  const byId = new Map(variablesStore.environments.map((env) => [env.id, env]));
  return order.value.flatMap((id) => {
    const env = byId.get(id);
    return env ? [env] : [];
  });
});

// P16 D14/§5: filters by name only — the same rule (and the same reasoning) as the variable
// table's own filter.
const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');
const displayEnvironments = computed<ApiEnvironment[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  return q
    ? orderedEnvironments.value.filter((env) => env.name.toLowerCase().includes(q))
    : orderedEnvironments.value;
});

// P17 D14: renaming and describing are one row update — both fields' drafts commit together
// whichever one blurred, rather than two separate IPC calls for two cells of one row.
async function onFieldBlur(id: string): Promise<void> {
  const name = (nameDrafts[id] ?? '').trim();
  const description = descriptionDrafts[id] ?? '';
  const current = variablesStore.environments.find((e) => e.id === id);
  if (!current) return;
  if (name === '') {
    nameDrafts[id] = current.name;
    return;
  }
  if (name === current.name && description === current.description) return;
  // updateEnvironment writes name/description/color as one row update (D19) — the colour picker
  // lives in VariableSetView.vue's own tab (P18 D17), so a blur here passes the colour through
  // unchanged.
  await variablesStore.updateEnvironment(id, name, description, current.color);
}

async function onNewEnvironment(): Promise<void> {
  await variablesStore.createEnvironment('New environment');
}

// P17 D16: opens that environment's own variable-set tab. It no longer has a dialog to close
// behind it — both are tabs now, and having the list still open is useful, not clutter.
function onEditVariables(id: string, name: string): void {
  openVariableSetTab('environment', id, name);
}

async function onSetActive(id: string): Promise<void> {
  await variablesStore.setActiveEnvironment(id);
}

async function onDelete(id: string, name: string): Promise<void> {
  if (!(await confirmDialogStore.confirmDialog(`Delete environment "${name}"? Its variables go with it.`))) return;
  await variablesStore.deleteEnvironment(id);
}

// P17 D17: "Duplicate" is this app's existing vocabulary (connections.Service.Duplicate, the
// tree menu's own duplicate item) — not a synonym invented for this one surface.
async function onDuplicate(id: string): Promise<void> {
  await variablesStore.duplicateEnvironment(id);
}

// D14: the same refusal while filtered as elsewhere (both splice `order` by the rendered index,
// which a filter can move, but the deeper reason is semantic: "move up" past a filter-hidden
// neighbour has no defined result).
async function onMove(id: string, direction: 'up' | 'down'): Promise<void> {
  if (isFiltered.value) return;
  const from = order.value.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= order.value.length) return;
  const next = [...order.value];
  [next[from], next[to]] = [next[to], next[from]];
  order.value = next;
  await variablesStore.reorderEnvironmentsList(order.value);
}
function onKeydown(e: KeyboardEvent, id: string): void {
  if (isFiltered.value || !e.altKey) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    void onMove(id, 'up');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    void onMove(id, 'down');
  }
}

// P105 §5.1: the row divs carry no interactive role of their own, so the keydown/drag listeners
// bind once on the list container and resolve back to a row via its own data-id, rather than each
// row wiring the four handlers itself.
const listEl = useTemplateRef<HTMLElement>('listEl');
function rowIdFromEvent(e: Event): string | null {
  return (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-testid="environment-row"]')
    ?.dataset.id ?? null;
}
function rowIndexFromEvent(e: Event): number | null {
  const id = rowIdFromEvent(e);
  if (id === null) return null;
  const i = displayEnvironments.value.findIndex((env) => env.id === id);
  return i === -1 ? null : i;
}
useEventListener(listEl, 'keydown', (e) => {
  const id = rowIdFromEvent(e);
  if (id !== null) onKeydown(e as KeyboardEvent, id);
});
useEventListener(listEl, 'dragstart', (e) => {
  const i = rowIndexFromEvent(e);
  if (i !== null) onDragStart(i);
});
useEventListener(listEl, 'dragover', (e) => {
  e.preventDefault();
  const i = rowIndexFromEvent(e);
  if (i !== null) onDragOver(i);
});
useEventListener(listEl, 'dragend', onDragEnd);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="environments-dialog">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined (no library counterpart). -->
    <div class="h-bar shrink-0 flex items-center gap-1.5 px-2 border-b border-border">
      <span
        v-if="railColor !== undefined"
        class="size-1.25 rounded-full shrink-0"
        :class="(!railColor || railColor === 'none') ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="server-environment" :size="13" /></span>
      <span class="text-kira-md text-fg truncate" data-testid="environments-target">Environments</span>
      <span class="ml-auto flex items-center gap-1" />
    </div>
    <div class="h-0.5 shrink-0 bg-(--kira-rail)" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="h-bar shrink-0 flex items-center gap-1.5 px-2">
      <InputGroup v-if="variablesStore.environments.length > 0">
        <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
        <InputGroupInput v-model="filterQuery" placeholder="Filter by name" data-testid="environments-filter" />
        <InputGroupAddon v-if="filterQuery" align="inline-end">
          <InputGroupButton aria-label="Clear filter" @click="filterQuery = ''">
            <CodiconIcon name="close" :size="13" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <span class="ml-auto" />
      <RunState :state="runState" />
      <div class="flex items-center gap-1.5 min-w-0">
        <Button variant="toolbar-primary" size="kira" data-testid="new-environment" @click="onNewEnvironment">
          New environment
        </Button>
      </div>
    </div>

    <Alert v-if="variablesStore.error" variant="destructive" data-testid="environments-error">
      <AlertDescription class="flex items-start gap-1.5">
        <div class="flex-1">{{ variablesStore.error }}</div>
        <Button
          variant="toolbar"
          size="kira-icon"
          class="shrink-0"
          aria-label="Dismiss"
          data-testid="environments-error-dismiss"
          @click="variablesStore.dismissError"
        >
          <CodiconIcon name="close" :size="13" />
        </Button>
      </AlertDescription>
    </Alert>

    <div ref="listEl" class="flex flex-col gap-0.5 p-1">
        <div
          v-for="(env, i) in displayEnvironments"
          :key="env.id"
          class="flex items-center gap-1 px-1.5 py-1"
          :class="{ 'opacity-50': dragIndex === i }"
          :draggable="!isFiltered"
          data-testid="environment-row"
          :data-id="env.id"
        >
          <span
            class="size-1.25 rounded-full shrink-0"
            :class="(env.color === 'none') ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
            :style="{ '--kira-rail': connColorVar(env.color) }"
            data-testid="environment-color-dot"
          />
          <Tooltip v-if="isFiltered">
            <TooltipTrigger as-child>
              <span class="flex cursor-grab items-center text-subtle" aria-hidden="true" data-testid="environment-grip">
                <CodiconIcon name="gripper" :size="13" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Clear the filter to reorder</TooltipContent>
          </Tooltip>
          <span v-else class="flex cursor-grab items-center text-subtle" aria-hidden="true" data-testid="environment-grip">
            <CodiconIcon name="gripper" :size="13" />
          </span>
          <Tooltip>
            <TooltipTrigger as-child>
              <input
                type="radio"
                name="active-environment"
                :checked="env.isActive"
                data-testid="environment-active"
                @change="onSetActive(env.id)"
              />
            </TooltipTrigger>
            <TooltipContent>Active</TooltipContent>
          </Tooltip>
          <div class="min-w-0 flex-1">
            <Input
              v-model="nameDrafts[env.id]"
              data-testid="environment-name"
              @blur="onFieldBlur(env.id)"
            />
          </div>
          <div class="min-w-0 flex-1">
            <Input
              v-model="descriptionDrafts[env.id]"
              placeholder="description"
              data-testid="environment-description"
              @blur="onFieldBlur(env.id)"
            />
          </div>
          <Button
            variant="toolbar"
            size="kira"
            data-testid="environment-edit-variables"
            @click="onEditVariables(env.id, env.name)"
          >
            Edit variables…
          </Button>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="toolbar"
                size="kira-icon"
                aria-label="Duplicate"
                data-testid="environment-duplicate"
                @click="onDuplicate(env.id)"
              >
                <CodiconIcon name="copy" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="toolbar"
                size="kira-icon"
                aria-label="Delete"
                data-testid="environment-remove"
                @click="onDelete(env.id, env.name)"
              >
                <CodiconIcon name="trash" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
        <Empty v-if="variablesStore.environments.length === 0" data-testid="environments-empty">
          <EmptyMedia><CodiconIcon name="server-environment" :size="24" /></EmptyMedia>
          <EmptyTitle>No environments yet</EmptyTitle>
        </Empty>
        <Empty
          v-else-if="isFiltered && displayEnvironments.length === 0"
          data-testid="environments-filter-empty"
        >
          <EmptyMedia><CodiconIcon name="search" :size="24" /></EmptyMedia>
          <EmptyTitle>No matches</EmptyTitle>
        </Empty>
    </div>
  </div>
</template>
