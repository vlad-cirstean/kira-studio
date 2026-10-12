<script setup lang="ts">
import type { ApiEnvironment } from '@shared/domain/variables';
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertAction, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { colorMarkClass } from '@theme/connColor';
import { t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import RunState from '@theme/RunState.vue';
import { useEventListener } from '@vueuse/core';
import { matchesQuery } from '@workbench/behaviour/match';
import { moveId, useSortableReorder } from '@workbench/behaviour/sortableReorder';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, reactive, ref, useTemplateRef, watch } from 'vue';
import { useConnectionsStore } from '../state/connections';
import { useRunState } from '../state/runState';
import type { EnvironmentsTabRecord } from '../state/tabDomain';
import { mergeDrafts, reconcileOrder } from './state/draftMerge';
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
  if (!dragging.value) order.value = merged.order;
}

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
  return orderedEnvironments.value.filter((env) => matchesQuery(env.name, filterQuery.value));
});

// D14: drag by the grip, or Alt+Arrow below. Declared ahead of the first syncDrafts run (the
// immediate watch below) so `dragging` exists when it reads it. The grip is the drag handle: rows
// hold text inputs and a radio, which a whole-row drag would start from.
const listEl = useTemplateRef<HTMLElement>('listEl');
const { dragging } = useSortableReorder(
  listEl,
  () => displayEnvironments.value.map((env) => env.id),
  (from, to) => {
    order.value = moveId(reconcileOrder(order.value, environmentIds()), from, to);
    void persistOrder();
  },
  {
    draggable: '[data-testid="environment-row"]',
    handle: '[data-testid="environment-grip"]',
    direction: 'vertical',
    disabled: () => isFiltered.value,
  },
);
watch(() => variablesStore.environments, syncDrafts, { immediate: true });

const environmentIds = () => variablesStore.environments.map((e) => e.id);
// syncDrafts skips the order reseed during a drag: replay it once the drag ends.
watch(dragging, (isDragging) => {
  if (!isDragging) order.value = reconcileOrder(order.value, environmentIds());
});
// Go never stored a failed reorder: show the server's order again.
async function persistOrder(): Promise<void> {
  if (!(await variablesStore.reorderEnvironmentsList(order.value))) order.value = environmentIds();
}

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
  await variablesStore.createEnvironment(t('studio.api.environments.new.label'));
}

// P17 D16: opens that environment's own variable-set tab. It no longer has a dialog to close
// behind it — both are tabs now, and having the list still open is useful, not clutter.
function onEditVariables(id: string, name: string): void {
  openVariableSetTab('environment', id, name);
}

// The group is controlled by the store's active row, so a failed activation leaves the radio on
// the previous environment.
const activeEnvironmentId = computed(
  () => variablesStore.environments.find((e) => e.isActive)?.id ?? '',
);
async function onSetActive(id: string): Promise<void> {
  await variablesStore.setActiveEnvironment(id);
}

async function onDelete(id: string, name: string): Promise<void> {
  const confirmed = await confirmDialogStore.confirm({
    title: t('studio.api.environments.deleteConfirm.title'),
    message: [
      t('studio.api.environments.deleteConfirm.body', { name }),
      t('common.confirm.irreversible.body'),
    ].join(' '),
    confirmLabel: t('common.action.delete.label'),
    tone: 'danger',
  });
  if (!confirmed) return;
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
  await persistOrder();
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

// P105 §5.1: the row divs carry no interactive role of their own, so the keydown listener binds
// once on the list container and resolves back to a row via its own data-id.
function rowIdFromEvent(e: Event): string | null {
  return (
    (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-testid="environment-row"]')
      ?.dataset.id ?? null
  );
}
useEventListener(listEl, 'keydown', (e) => {
  const id = rowIdFromEvent(e);
  if (id !== null) onKeydown(e as KeyboardEvent, id);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="environments-dialog">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined (no library counterpart). -->
    <ViewToolbar>
      <span v-if="railColor !== undefined" :class="colorMarkClass('dot', railColor)" />
      <span class="size-4 flex items-center justify-center shrink-0"
        ><CodiconIcon :name="ICON.environments" :size="13" /></span
      >
      <span class="text-kira-md text-fg truncate" data-testid="environments-target">{{
        t('studio.api.common.environments.label')
      }}</span>
      <span class="ml-auto flex items-center gap-1" />
    </ViewToolbar>
    <div :class="colorMarkClass('band', railColor)" />
    <ViewToolbar border="none">
      <div v-if="variablesStore.environments.length > 0" class="w-64"
        ><SearchField
          v-model="filterQuery"
          :placeholder="t('studio.api.common.filterByName.placeholder')"
          data-testid="environments-filter"
        /></div
      >
      <span class="ml-auto" />
      <RunState :state="runState" />
      <div class="flex items-center gap-1.5 shrink-0">
        <Button
          variant="toolbar-primary"
          size="kira"
          data-testid="new-environment"
          @click="onNewEnvironment"
        >
          {{ t('studio.api.environments.new.label') }}
        </Button>
      </div>
    </ViewToolbar>

    <Alert v-if="variablesStore.error" variant="error" strip data-testid="environments-error">
      <AlertDescription>{{ variablesStore.error }}</AlertDescription>
      <AlertAction>
        <Button
          variant="toolbar"
          size="kira-icon"
          :aria-label="t('common.action.dismiss.label')"
          data-testid="environments-error-dismiss"
          @click="variablesStore.dismissError"
        >
          <CodiconIcon :name="ICON.close" :size="13" />
        </Button>
      </AlertAction>
    </Alert>

    <RadioGroup
      class="contents"
      :aria-label="t('studio.api.environments.activeGroup.aria')"
      :model-value="activeEnvironmentId"
      @update:model-value="(id) => onSetActive(String(id))"
    >
      <div ref="listEl" class="flex flex-1 min-h-0 flex-col gap-0.5 overflow-y-auto p-1">
        <div
          v-for="env in displayEnvironments"
          :key="env.id"
          class="flex items-center gap-1 px-1.5 py-1"
          data-testid="environment-row"
          :data-id="env.id"
        >
          <span :class="colorMarkClass('dot', env.color)" data-testid="environment-color-dot" />
          <Tooltip v-if="isFiltered">
            <TooltipTrigger as-child>
              <span
                class="flex cursor-grab items-center text-subtle"
                aria-hidden="true"
                data-testid="environment-grip"
              >
                <CodiconIcon name="gripper" :size="13" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{{ t('studio.api.common.reorderBlocked.hint') }}</TooltipContent>
          </Tooltip>
          <span
            v-else
            class="flex cursor-grab items-center text-subtle"
            aria-hidden="true"
            data-testid="environment-grip"
          >
            <CodiconIcon name="gripper" :size="13" />
          </span>
          <Tooltip>
            <TooltipTrigger as-child>
              <RadioGroupItem
                :value="env.id"
                :aria-label="t('studio.api.environments.active.aria', { name: env.name })"
                data-testid="environment-active"
              />
            </TooltipTrigger>
            <TooltipContent>{{ t('studio.api.environments.active.tooltip') }}</TooltipContent>
          </Tooltip>
          <div class="min-w-0 flex-1">
            <Input
              v-model="nameDrafts[env.id]"
              size="kira"
              :aria-label="t('common.environmentName.aria')"
              data-testid="environment-name"
              @blur="onFieldBlur(env.id)"
            />
          </div>
          <div class="min-w-0 flex-1">
            <Input
              v-model="descriptionDrafts[env.id]"
              :placeholder="t('common.field.description.label')"
              :aria-label="t('studio.api.environments.description.aria')"
              size="kira"
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
            {{ t('studio.api.environments.editVariables.label') }}
          </Button>
          <TooltipIconButton
            :icon="ICON.duplicate"
            :label="t('common.action.duplicate.label')"
            data-testid="environment-duplicate"
            @click="onDuplicate(env.id)"
          />
          <TooltipIconButton
            :icon="ICON.delete"
            :label="t('common.action.delete.label')"
            data-testid="environment-remove"
            @click="onDelete(env.id, env.name)"
          />
        </div>
        <EmptyState
          v-if="variablesStore.environments.length === 0"
          data-testid="environments-empty"
          :icon="ICON.environments"
          :title="t('common.noEnvironments.empty')"
        />
        <EmptyState
          v-else-if="isFiltered && displayEnvironments.length === 0"
          data-testid="environments-filter-empty"
          :icon="ICON.search"
          :title="t('common.state.noMatches.empty')"
        />
      </div>
    </RadioGroup>
  </div>
</template>
