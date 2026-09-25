<script setup lang="ts">
import type { CustomScript } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, ref, useTemplateRef } from 'vue';
import { useCustomScriptsStore } from '../state/customScripts';
import { useSettingsStore } from '../state/settings';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

const confirmDialogStore = useConfirmDialogStore();

const contextMenuStore = useContextMenuStore();

// P91 §11: the Terminal module's own left panel — a second *view* over P85's custom_scripts store
// (§10, decided against a second, module-scoped list), not a second data store. Add/remove are
// inline; full editing (rename, re-command, working directory, colour) deep-links to the Settings
// section P85 already built (§11.3) — a 180-480px panel cannot hold four labelled fields legibly,
// and this stays the one place those rules live.

const customScriptsStore = useCustomScriptsStore();
const settingsStore = useSettingsStore();
const terminalsStore = useTerminalsStore();

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

// P104 §3: PanelShell's own header/search-reveal/type-ahead-redirect logic, inlined via the
// shared usePanelHeaderSearch composable -- this panel is always searchable (PanelShell's own
// `:searchable="true"`).
const rootEl = useTemplateRef<HTMLElement>('rootEl');
const { showSearch, toggleSearch } = usePanelHeaderSearch(rootEl, {
  searchable: () => true,
  getSearch: () => search.value,
  setSearch: (v) => {
    search.value = v;
  },
});

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
    cwd: script.workingDir || terminalsStore.terminalDefaults.cwd,
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
      run: () => settingsStore.openSettingsAt('Scripts'),
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
  <div data-testid="terminal-panel">
    <div ref="rootEl" class="flex h-full flex-col">
      <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
        <span class="font-semibold">Quick commands</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              class="ml-auto"
              :data-active="showSearch"
              :aria-label="showSearch ? 'Hide search' : 'Search'"
              data-testid="toggle-search"
              @click="toggleSearch"
            >
              <CodiconIcon name="search" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ showSearch ? 'Hide search' : 'Search' }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              aria-label="Add a quick command"
              data-testid="quick-command-add"
              @click="openAddRow"
            >
              <CodiconIcon name="add" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add a quick command</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              aria-label="Manage scripts"
              data-testid="quick-commands-manage"
              @click="settingsStore.openSettingsAt('Scripts')"
            >
              <CodiconIcon name="settings-gear" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Manage scripts…</TooltipContent>
        </Tooltip>
      </div>
      <template v-if="!empty">
        <div v-if="showSearch" class="shrink-0 border-b border-border px-1.5 py-1">
          <InputGroup>
            <InputGroupAddon>
              <CodiconIcon name="search" :size="13" />
            </InputGroupAddon>
            <InputGroupInput v-model="search" placeholder="Search" data-testid="tree-search" />
            <InputGroupAddon v-if="search" align="inline-end">
              <InputGroupButton aria-label="Clear search" @click="search = ''">
                <CodiconIcon name="close" :size="12" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div class="min-h-0 flex-1">
          <div class="flex flex-col h-full overflow-y-auto">
            <div v-if="adding" class="flex flex-col gap-1 p-1.5 border-b border-border" data-testid="quick-command-add-row">
              <Input
                v-model="newName"
                placeholder="Name"
                class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
                data-testid="quick-command-add-name"
              />
              <Input
                v-model="newCommand"
                placeholder="Command"
                class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
                data-testid="quick-command-add-command"
              />
              <div class="flex justify-end gap-1">
                <Button variant="dialog" size="kira-lg" @click="cancelAdd">Cancel</Button>
                <Button
                  variant="dialog-primary"
                  size="kira-lg"
                  :disabled="!canAdd"
                  data-testid="quick-command-add-confirm"
                  @click="onAdd"
                  >Add</Button
                >
              </div>
              <span v-if="addError" class="text-error text-kira-xs leading-normal">{{ addError }}</span>
            </div>

            <div
              v-if="filteredRecords.length > 0"
              class="flex flex-col"
              data-testid="quick-command-list"
            >
              <button
                v-for="script in filteredRecords"
                :key="script.id"
                type="button"
                class="flex items-center gap-1 py-1 px-1.5 cursor-default select-none hover:bg-hover"
                :data-testid="`quick-command-${script.id}`"
                @click="runScript(script)"
                @contextmenu.prevent="onContextMenu($event, script)"
              >
                <span
                  v-if="script.color !== 'none'"
                  class="w-2.5 h-2.5 rounded-full shrink-0"
                  :style="{ background: connColorVar(script.color) }"
                />
                <CodiconIcon v-else name="play" :size="13" class="shrink-0 text-muted-foreground" />
                <div class="flex-1 min-w-0 flex flex-col">
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ script.name }}</span>
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-kira-xs">{{ script.command }}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </template>
      <div
        v-else
        class="side-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <Alert class="w-auto flex-col items-center gap-1.5 border-0 bg-transparent text-center">
          <CodiconIcon name="terminal-bash" :size="24" class="text-subtle" />
          <AlertTitle class="text-kira-md font-normal text-muted-foreground">No quick commands</AlertTitle>
          <AlertAction class="static mt-1">
            <Button
              variant="dialog-primary"
              size="kira-lg"
              data-testid="quick-command-empty-add"
              @click="openAddRow"
            >
              Add a quick command
            </Button>
          </AlertAction>
        </Alert>
      </div>
    </div>
  </div>
</template>
