<script setup lang="ts">
import type { CustomScript } from '@shared/domain/scripts';
import { computed, ref } from 'vue';
import { useConfirmDialogStore } from '../state/confirmDialog';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';
import { useCustomScriptsStore } from '../state/customScripts';
import { openSettingsAt } from '../state/settings';
import { terminalDefaults } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { connColorVar } from '../theme/connColor';
import AppButton from '../theme/primitives/AppButton.vue';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import PanelShell from '../theme/primitives/PanelShell.vue';
import TextField from '../theme/primitives/TextField.vue';

const confirmDialogStore = useConfirmDialogStore();

const contextMenuStore = useContextMenuStore();

// P91 §11: the Terminal module's own left panel — a second *view* over P85's custom_scripts store
// (§10, decided against a second, module-scoped list), not a second data store. Add/remove are
// inline; full editing (rename, re-command, working directory, colour) deep-links to the Settings
// section P85 already built (§11.3) — a 180-480px panel cannot hold four labelled fields legibly,
// and this stays the one place those rules live.

const customScriptsStore = useCustomScriptsStore();

const search = ref('');
const adding = ref(false);
const newName = ref('');
const newCommand = ref('');
const addError = ref<string | null>(null);

const canAdd = computed(() => newName.value.trim() !== '' && newCommand.value.trim() !== '');

// §11.1: panel search filters rows by name and command.
const filteredRecords = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (q === '') return customScriptsStore.records;
  return customScriptsStore.records.filter(
    (s) => s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
  );
});

const empty = computed(() => customScriptsStore.records.length === 0 && !adding.value);

function openAddRow(): void {
  adding.value = true;
}

function cancelAdd(): void {
  adding.value = false;
  newName.value = '';
  newCommand.value = '';
  addError.value = null;
}

// §11.3: staged locally, committed with createCustomScript — SettingsDialog.vue's own posture,
// including trimming both fields before building CustomScriptFields (P85's own late fix). Left at
// workingDir '' / color 'none' — a quick command added here runs in the module's default cwd
// until the user sets one in Settings.
async function onAdd(): Promise<void> {
  if (!canAdd.value) return;
  addError.value = null;
  try {
    await customScriptsStore.createCustomScript({
      name: newName.value.trim(),
      command: newCommand.value.trim(),
      workingDir: '',
      color: 'none',
    });
    cancelAdd();
  } catch (err) {
    addError.value = err instanceof Error ? err.message : String(err);
  }
}

// §11.2: the tab therefore titles itself with the script's name and paints its rail with the
// script's colour, through tabKinds.ts's existing title()/railColor() — no new title or colour
// logic needed here.
function runScript(script: CustomScript): void {
  openTerminalTab({
    workspaceId: 'terminal',
    cwd: script.workingDir || terminalDefaults.cwd,
    launch: { command: script.command, label: script.name, color: script.color, kind: 'script' },
  });
}

// §10.4: both surfaces named — a script removed here also stops launching from the tab strip.
async function onRemove(script: CustomScript): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Remove "${script.name}"? It will no longer launch from the tab strip or the Terminal panel.`,
    { danger: true },
  );
  if (ok) await customScriptsStore.removeCustomScript(script.id);
}

function onContextMenu(e: MouseEvent, script: CustomScript): void {
  const items: MenuItem[] = [
    { type: 'item', id: 'run', label: 'Run', icon: 'play', run: () => runScript(script) },
    {
      type: 'item',
      id: 'edit',
      label: 'Edit…',
      icon: 'edit',
      run: () => openSettingsAt('Scripts'),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      danger: true,
      run: () => onRemove(script),
    },
  ];
  contextMenuStore.openContextMenu(e, items);
}
</script>

<template>
  <div data-testid="terminal-panel" class="terminal-panel">
    <PanelShell
      :search="search"
      :empty="empty"
      :searchable="true"
      @update:search="search = $event"
    >
      <template #title>
        <span class="panel-title">Quick commands</span>
      </template>
      <template #actions>
        <IconButton
          icon="add"
          aria-label="Add a quick command"
          v-tooltip="'Add a quick command'"
          data-testid="quick-command-add"
          @click="openAddRow"
        />
        <IconButton
          icon="settings-gear"
          aria-label="Manage scripts"
          v-tooltip="'Manage scripts…'"
          data-testid="quick-commands-manage"
          @click="openSettingsAt('Scripts')"
        />
      </template>
      <template #body>
        <div class="terminal-panel-body">
          <div v-if="adding" class="quick-command-add" data-testid="quick-command-add-row">
            <TextField
              v-model="newName"
              placeholder="Name"
              size="md"
              data-testid="quick-command-add-name"
            />
            <TextField
              v-model="newCommand"
              placeholder="Command"
              size="md"
              class="mono"
              data-testid="quick-command-add-command"
            />
            <div class="quick-command-add-actions">
              <AppButton kind="dialog" @click="cancelAdd">Cancel</AppButton>
              <AppButton
                kind="dialog"
                variant="primary"
                :disabled="!canAdd"
                data-testid="quick-command-add-confirm"
                @click="onAdd"
                >Add</AppButton
              >
            </div>
            <span v-if="addError" class="field-error">{{ addError }}</span>
          </div>

          <div
            v-if="filteredRecords.length > 0"
            class="quick-command-list"
            data-testid="quick-command-list"
          >
            <div
              v-for="script in filteredRecords"
              :key="script.id"
              class="quick-command-row"
              :data-testid="`quick-command-${script.id}`"
              @click="runScript(script)"
              @contextmenu.prevent="onContextMenu($event, script)"
            >
              <span
                v-if="script.color !== 'none'"
                class="swatch"
                :style="{ background: connColorVar(script.color) }"
              />
              <CodiconIcon v-else name="play" :size="13" class="run-icon" />
              <div class="quick-command-text">
                <span class="quick-command-name">{{ script.name }}</span>
                <span class="quick-command-command">{{ script.command }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #empty>
        <EmptyState icon="terminal-bash" label="No quick commands">
          <button
            type="button"
            class="p-dlgbtn primary"
            data-testid="quick-command-empty-add"
            @click="openAddRow"
          >
            Add a quick command
          </button>
        </EmptyState>
      </template>
    </PanelShell>
  </div>
</template>

<style scoped>
.panel-title {
  font-weight: 600;
}

.terminal-panel-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.quick-command-list {
  display: flex;
  flex-direction: column;
}

.quick-command-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  cursor: default;
  user-select: none;
}

.quick-command-row:hover {
  background: var(--kira-hover);
}

.run-icon {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.quick-command-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.quick-command-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-command-command {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
}

.quick-command-add {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.quick-command-add-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--kira-s-2);
}

.field-error {
  color: var(--kira-error);
  font-size: var(--kira-t-xs);
}
</style>
