<script setup lang="ts">
import type { ApiEnvironment } from '@shared/domain/variables';
import { computed, reactive, ref, watch } from 'vue';
import { confirmDialog } from '../state/confirmDialog';
import CodiconIcon from '../theme/CodiconIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';
import {
  closeEnvironmentsDialog,
  createEnvironment,
  deleteEnvironment,
  environmentsDialogState,
  openVariablesDialog,
  renameEnvironment,
  reorderEnvironmentsList,
  setActiveEnvironment,
  variablesState,
} from './state/variables';

// P5 D3/D11/D14: the environment list — name (inline-editable), *Edit variables…*, delete, an
// *Active* radio, drag/keyboard reordering, and *New environment*.
const nameDrafts = reactive<Record<string, string>>({});
const order = ref<string[]>([]);

function syncDrafts(): void {
  for (const key of Object.keys(nameDrafts)) delete nameDrafts[key];
  for (const env of variablesState.environments) nameDrafts[env.id] = env.name;
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

async function onNameBlur(id: string): Promise<void> {
  const name = (nameDrafts[id] ?? '').trim();
  const current = variablesState.environments.find((e) => e.id === id);
  if (!current) return;
  if (name === '') {
    nameDrafts[id] = current.name;
    return;
  }
  if (name === current.name) return;
  await renameEnvironment(id, name);
}

async function onNewEnvironment(): Promise<void> {
  await createEnvironment('New environment');
}

function onEditVariables(id: string, name: string): void {
  void openVariablesDialog('environment', id, `Environment — ${name}`);
}

async function onSetActive(id: string): Promise<void> {
  await setActiveEnvironment(id);
}

async function onDelete(id: string, name: string): Promise<void> {
  if (!(await confirmDialog(`Delete environment "${name}"? Its variables go with it.`))) return;
  await deleteEnvironment(id);
}

// D14: the same drag/keyboard reorder VariablesDialog.vue's own rows use.
const dragIndex = ref<number | null>(null);
function onDragStart(index: number): void {
  dragIndex.value = index;
}
function onDragOver(index: number): void {
  const from = dragIndex.value;
  if (from === null || from === index) return;
  const next = [...order.value];
  const [moved] = next.splice(from, 1);
  next.splice(index, 0, moved);
  order.value = next;
  dragIndex.value = index;
}
async function onDragEnd(): Promise<void> {
  dragIndex.value = null;
  await reorderEnvironmentsList(order.value);
}
async function onMove(id: string, direction: 'up' | 'down'): Promise<void> {
  const from = order.value.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= order.value.length) return;
  const next = [...order.value];
  [next[from], next[to]] = [next[to], next[from]];
  order.value = next;
  await reorderEnvironmentsList(order.value);
}
function onKeydown(e: KeyboardEvent, id: string): void {
  if (!e.altKey) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    void onMove(id, 'up');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    void onMove(id, 'down');
  }
}

function close(): void {
  closeEnvironmentsDialog();
}
</script>

<template>
  <DialogFrame
    title="Environments"
    :width="480"
    max-height="80vh"
    test-id="environments-dialog"
    close-test-id="environments-dialog-close"
    @close="close"
  >
    <div class="p-dialog-body list">
      <div
        v-for="(env, i) in orderedEnvironments"
        :key="env.id"
        class="environment-row"
        :class="{ 'is-dragging': dragIndex === i }"
        draggable="true"
        data-testid="environment-row"
        :data-id="env.id"
        @keydown="onKeydown($event, env.id)"
        @dragstart="onDragStart(i)"
        @dragover.prevent="onDragOver(i)"
        @dragend="onDragEnd"
      >
        <span class="drag-handle" aria-hidden="true" data-testid="environment-grip">
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
        <TextField
          v-model="nameDrafts[env.id]"
          class="name-field"
          data-testid="environment-name"
          @blur="onNameBlur(env.id)"
        />
        <AppButton
          data-testid="environment-edit-variables"
          @click="onEditVariables(env.id, env.name)"
        >
          Edit variables…
        </AppButton>
        <IconButton
          icon="trash"
          v-tooltip="'Delete'"
          data-testid="environment-remove"
          @click="onDelete(env.id, env.name)"
        />
      </div>
      <EmptyState
        v-if="variablesState.environments.length === 0"
        icon="settings-gear"
        label="No environments yet"
        data-testid="environments-empty"
      />
    </div>
    <template #footer>
      <span class="p-dialog-actions">
        <AppButton kind="dialog" variant="primary" data-testid="new-environment" @click="onNewEnvironment">
          New environment
        </AppButton>
        <AppButton kind="dialog" data-testid="environments-close" @click="close">Close</AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
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

.name-field {
  flex: 1;
  min-width: 0;
}

</style>
