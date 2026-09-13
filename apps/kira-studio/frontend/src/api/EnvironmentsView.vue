<script setup lang="ts">
import type { EnvironmentsTabRecord } from '@shared/domain/tabs';
import type { ApiEnvironment } from '@shared/domain/variables';
import { computed, reactive, ref, watch } from 'vue';
import { confirmDialog } from '../state/confirmDialog';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { connColorVar } from '../theme/connColor';
import AppButton from '../theme/primitives/AppButton.vue';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import PanelSearchBox from '../theme/primitives/PanelSearchBox.vue';
import TextField from '../theme/primitives/TextField.vue';
import ViewChrome from '../theme/primitives/ViewChrome.vue';
import {
  createEnvironment,
  deleteEnvironment,
  duplicateEnvironment,
  reorderEnvironmentsList,
  setActiveEnvironment,
  updateEnvironment,
  variablesState,
} from './state/variables';
import { openVariableSetTab } from './tabs';

// P28 D16(c): the environment list, re-hosted in a tab. Every behaviour below is
// EnvironmentsDialog.vue's, ported unchanged — name/description inline editing committed together
// on blur (P17 D14), *Edit variables…*, delete behind a confirm, an *Active* radio, drag/keyboard
// reordering refused while filtered (D14), Duplicate (P17 D17) and *New environment*. What changed
// is the chrome: ViewChrome instead of DialogFrame, the filter in the toolbar band every other view
// puts its filter in, *New environment* in the trailing action group, and no Close button — a tab
// is closed the way every other tab is.
//
// `showRunControls: false` for the same reason VariableSetView passes it (D16a): there is no
// operation here to refresh or stop, and two permanently-disabled buttons say something different
// from "not right now".
defineProps<{ tab: EnvironmentsTabRecord }>();

const nameDrafts = reactive<Record<string, string>>({});
const descriptionDrafts = reactive<Record<string, string>>({});
const order = ref<string[]>([]);

function syncDrafts(): void {
  for (const key of Object.keys(nameDrafts)) delete nameDrafts[key];
  for (const key of Object.keys(descriptionDrafts)) delete descriptionDrafts[key];
  for (const env of variablesState.environments) {
    nameDrafts[env.id] = env.name;
    descriptionDrafts[env.id] = env.description;
  }
  order.value = variablesState.environments.map((env) => env.id);
}
watch(() => variablesState.environments, syncDrafts, { immediate: true });

const orderedEnvironments = computed<ApiEnvironment[]>(() => {
  const byId = new Map(variablesState.environments.map((env) => [env.id, env]));
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
  const current = variablesState.environments.find((e) => e.id === id);
  if (!current) return;
  if (name === '') {
    nameDrafts[id] = current.name;
    return;
  }
  if (name === current.name && description === current.description) return;
  // updateEnvironment writes name/description/color as one row update (D19) — the colour picker
  // lives in VariableSetView.vue's own tab (P18 D17), so a blur here passes the colour through
  // unchanged.
  await updateEnvironment(id, name, description, current.color);
}

async function onNewEnvironment(): Promise<void> {
  await createEnvironment('New environment');
}

// P17 D16: opens that environment's own variable-set tab. It no longer has a dialog to close
// behind it — both are tabs now, and having the list still open is useful, not clutter.
function onEditVariables(id: string, name: string): void {
  openVariableSetTab('environment', id, name);
}

async function onSetActive(id: string): Promise<void> {
  await setActiveEnvironment(id);
}

async function onDelete(id: string, name: string): Promise<void> {
  if (!(await confirmDialog(`Delete environment "${name}"? Its variables go with it.`))) return;
  await deleteEnvironment(id);
}

// P17 D17: "Duplicate" is this app's existing vocabulary (connections.Service.Duplicate, the
// tree menu's own duplicate item) — not a synonym invented for this one surface.
async function onDuplicate(id: string): Promise<void> {
  await duplicateEnvironment(id);
}

// D14: the same drag/keyboard reorder the variable rows use — and the same refusal while filtered
// (both splice `order` by the rendered index, which a filter can move, but the deeper reason is
// semantic: "move up" past a filter-hidden neighbour has no defined result).
const dragIndex = ref<number | null>(null);
function onDragStart(index: number): void {
  if (isFiltered.value) return;
  dragIndex.value = index;
}
function onDragOver(index: number): void {
  if (isFiltered.value) return;
  const from = dragIndex.value;
  if (from === null || from === index) return;
  const next = [...order.value];
  const [moved] = next.splice(from, 1);
  next.splice(index, 0, moved);
  order.value = next;
  dragIndex.value = index;
}
async function onDragEnd(): Promise<void> {
  if (isFiltered.value) {
    dragIndex.value = null;
    return;
  }
  dragIndex.value = null;
  await reorderEnvironmentsList(order.value);
}
async function onMove(id: string, direction: 'up' | 'down'): Promise<void> {
  if (isFiltered.value) return;
  const from = order.value.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= order.value.length) return;
  const next = [...order.value];
  [next[from], next[to]] = [next[to], next[from]];
  order.value = next;
  await reorderEnvironmentsList(order.value);
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
</script>

<template>
  <div class="environments-view" data-testid="environments-dialog">
    <ViewChrome
      :tab="tab"
      icon="server-environment"
      name="Environments"
      :show-run-controls="false"
      target-testid="environments-target"
    >
      <template #toolbar>
        <PanelSearchBox
          v-if="variablesState.environments.length > 0"
          v-model="filterQuery"
          placeholder="Filter by name"
          testid="environments-filter"
        />
      </template>
      <template #toolbar-end>
        <AppButton variant="primary" data-testid="new-environment" @click="onNewEnvironment">
          New environment
        </AppButton>
      </template>

      <div class="p-dialog-body list">
        <div
          v-for="(env, i) in displayEnvironments"
          :key="env.id"
          class="environment-row"
          :class="{ 'is-dragging': dragIndex === i }"
          :draggable="!isFiltered"
          data-testid="environment-row"
          :data-id="env.id"
          @keydown="onKeydown($event, env.id)"
          @dragstart="onDragStart(i)"
          @dragover.prevent="onDragOver(i)"
          @dragend="onDragEnd"
        >
          <span
            class="p-conn-dot"
            :class="{ none: env.color === 'none' }"
            :style="{ '--kira-rail': connColorVar(env.color) }"
            data-testid="environment-color-dot"
          />
          <span
            class="drag-handle"
            aria-hidden="true"
            data-testid="environment-grip"
            v-tooltip="isFiltered ? 'Clear the filter to reorder' : undefined"
          >
            <CodiconIcon name="gripper" :size="13" />
          </span>
          <input
            type="radio"
            name="active-environment"
            :checked="env.isActive"
            v-tooltip="'Active'"
            data-testid="environment-active"
            @change="onSetActive(env.id)"
          />
          <!-- P22b D9 (remainder): a bare TextField with a `flex:1` class of its own sizes to its
               content, not the row's available space — `class` falls through onto TextField's
               inner <input> (inheritAttrs:false), never onto the outer .p-input box that actually
               participates in this row's flex layout. -->
          <div class="name-field">
            <TextField
              v-model="nameDrafts[env.id]"
              data-testid="environment-name"
              @blur="onFieldBlur(env.id)"
            />
          </div>
          <div class="description-field">
            <TextField
              v-model="descriptionDrafts[env.id]"
              placeholder="description"
              data-testid="environment-description"
              @blur="onFieldBlur(env.id)"
            />
          </div>
          <AppButton
            data-testid="environment-edit-variables"
            @click="onEditVariables(env.id, env.name)"
          >
            Edit variables…
          </AppButton>
          <IconButton
            icon="copy"
            v-tooltip="'Duplicate'"
            data-testid="environment-duplicate"
            @click="onDuplicate(env.id)"
          />
          <IconButton
            icon="trash"
            v-tooltip="'Delete'"
            data-testid="environment-remove"
            @click="onDelete(env.id, env.name)"
          />
        </div>
        <EmptyState
          v-if="variablesState.environments.length === 0"
          icon="server-environment"
          label="No environments yet"
          data-testid="environments-empty"
        />
        <EmptyState
          v-else-if="isFiltered && displayEnvironments.length === 0"
          icon="search"
          label="No matches"
          data-testid="environments-filter-empty"
        />
      </div>
    </ViewChrome>
  </div>
</template>

<style scoped>
.environments-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.environment-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
}

.environment-row.is-dragging {
  opacity: 0.5;
}

.drag-handle {
  display: flex;
  align-items: center;
  cursor: grab;
  color: var(--kira-fg-subtle);
}

.name-field,
.description-field {
  flex: 1;
  min-width: 0;
}
.name-field :deep(.p-input),
.description-field :deep(.p-input) {
  width: 100%;
}
</style>
