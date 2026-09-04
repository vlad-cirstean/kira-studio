<script setup lang="ts">
import { reactive, watch } from 'vue';
import { confirmDialog } from '../state/confirmDialog';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';
import {
  closeEnvironmentsDialog,
  createEnvironment,
  deleteEnvironment,
  environmentsDialogState,
  openVariablesDialog,
  renameEnvironment,
  setActiveEnvironment,
  variablesState,
} from './state/variables';

// P5 D3/D11: the environment list — name (inline-editable), *Edit variables…*, delete, an
// *Active* radio, and *New environment*. Reordering (D14) and the grip handle land in a later
// commit on this same file.
const nameDrafts = reactive<Record<string, string>>({});

function syncDrafts(): void {
  for (const key of Object.keys(nameDrafts)) delete nameDrafts[key];
  for (const env of variablesState.environments) nameDrafts[env.id] = env.name;
}
watch(() => variablesState.environments, syncDrafts, { immediate: true });

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
    <div class="environments-body">
      <div
        v-for="env in variablesState.environments"
        :key="env.id"
        class="environment-row"
        data-testid="environment-row"
      >
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
          kind="dialog"
          data-testid="environment-edit-variables"
          @click="onEditVariables(env.id, env.name)"
        >
          Edit variables…
        </AppButton>
        <IconButton
          icon="trash"
          tone="danger"
          v-tooltip="'Delete'"
          data-testid="environment-remove"
          @click="onDelete(env.id, env.name)"
        />
      </div>
      <div v-if="variablesState.environments.length === 0" class="empty" data-testid="environments-empty">
        No environments yet.
      </div>
    </div>
    <template #footer>
      <AppButton kind="dialog" variant="primary" data-testid="new-environment" @click="onNewEnvironment">
        New environment
      </AppButton>
    </template>
  </DialogFrame>
</template>

<style scoped>
.environments-body {
  display: flex;
  flex-direction: column;
  padding: var(--kira-s-2);
  gap: var(--kira-s-1);
}

.environment-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
}

.name-field {
  flex: 1;
  min-width: 0;
}

.empty {
  padding: var(--kira-s-4);
  color: var(--kira-fg-dim);
  text-align: center;
}
</style>
