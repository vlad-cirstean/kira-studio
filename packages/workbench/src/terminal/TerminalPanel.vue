<script setup lang="ts">
import type { CustomScript } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertAction, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { connColorVar } from '@theme/connColor';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, ref, useTemplateRef } from 'vue';
import { useNewTerminal, useTerminalModule } from './module';
import QuickCommandsDialog from './QuickCommandsDialog.vue';
import { useRemoveScript } from './scriptActions';

const contextMenuStore = useContextMenuStore();
const ctx = useTerminalModule();
const { open: openNewTerminal } = useNewTerminal();
const removeScript = useRemoveScript();

// P91 §11: the Terminal module's own left panel — a second *view* over P85's custom_scripts store
// (§10, decided against a second, module-scoped list), not a second data store. Add/remove are
// inline; full editing (rename, re-command, working directory, colour) opens
// `QuickCommandsDialog.vue` (P133 §2.2), the shared module's own manager dialog. P128 §2.4: moved
// to the shared terminal module — `ctx.scripts` (module.ts) is the optional custom-scripts seam;
// Kira Space injects none, so its panel below shows only a header and one "New terminal" action.
const scripts = computed(() => ctx.scripts);

// P133 §2.4: dialog visibility is this one component's own local state, not a Pinia store —
// CLAUDE.md's Pinia rule is for *shared* client state, and nothing else reads this.
const editor = ref<{ focusId: string | null } | null>(null);

const search = ref('');
const adding = ref(false);
const newName = ref('');
const newCommand = ref('');
const addError = ref<string | null>(null);
const removeError = ref<string | null>(null);

const canAdd = computed(() => newName.value.trim() !== '' && newCommand.value.trim() !== '');

// §11.1: panel search filters rows by name and command.
const filteredRecords = computed(() => {
  const records = scripts.value?.records() ?? [];
  const q = search.value.trim().toLowerCase();
  if (q === '') return records;
  return records.filter(
    (s) => s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
  );
});

const empty = computed(() => (scripts.value?.records().length ?? 0) === 0 && !adding.value);

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

// §11.3: staged locally, committed with ctx.scripts.create — including trimming both fields
// before building CustomScriptFields (P85's own late fix). Left at workingDir '' / color 'none' —
// a quick command added here runs in the module's default cwd until the user sets one in the
// Quick commands dialog.
async function onAdd(): Promise<void> {
  if (!canAdd.value || !scripts.value) return;
  addError.value = null;
  try {
    await scripts.value.create({
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
function scriptCwd(script: CustomScript): string {
  return script.workingDir || ctx.defaultCwd();
}

function runScript(script: CustomScript): void {
  const cwd = scriptCwd(script);
  if (cwd === '') return;
  ctx.openTerminalTab({
    cwd,
    launch: { command: script.command, label: script.name, color: script.color, kind: 'script' },
  });
}

// §10.4: both surfaces named — a script removed here also stops launching from the tab strip.
async function onRemove(script: CustomScript): Promise<void> {
  if (!scripts.value) return;
  removeError.value = null;
  try {
    await removeScript(scripts.value, script);
  } catch (err) {
    removeError.value = err instanceof Error ? err.message : String(err);
  }
}

function onContextMenu(e: MouseEvent, script: CustomScript): void {
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'run',
      label: 'Run',
      icon: 'play',
      disabled: scriptCwd(script) === '',
      run: () => runScript(script),
    },
    {
      type: 'item',
      id: 'edit',
      label: 'Edit…',
      icon: 'edit',
      run: () => {
        editor.value = { focusId: script.id };
      },
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
    <div v-if="scripts" ref="rootEl" class="flex h-full flex-col">
      <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
        <span class="font-semibold">Quick commands</span>
        <TooltipIconButton
          icon="search"
          :label="showSearch ? 'Hide search' : 'Search'"
          class="ml-auto"
          :data-active="showSearch"
          data-testid="toggle-search"
          @click="toggleSearch"
        />
        <TooltipIconButton
          icon="add"
          label="Add a quick command"
          data-testid="quick-command-add"
          @click="openAddRow"
        />
        <TooltipIconButton
          icon="settings-gear"
          label="Manage quick commands…"
          aria-label="Manage quick commands"
          data-testid="quick-commands-manage"
          @click="editor = { focusId: null }"
        />
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
              <span v-if="addError" class="text-error text-kira-sm leading-normal">{{ addError }}</span>
            </div>

            <span v-if="removeError" class="px-1.5 py-1 text-error text-kira-sm leading-normal" data-testid="quick-command-remove-error">{{ removeError }}</span>
            <div
              v-if="filteredRecords.length > 0"
              class="flex flex-col"
              data-testid="quick-command-list"
            >
              <button
                v-for="script in filteredRecords"
                :key="script.id"
                type="button"
                :disabled="scriptCwd(script) === ''"
                class="flex items-center gap-1 py-1 px-1.5 cursor-default select-none hover:bg-hover disabled:opacity-50"
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
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-kira-sm">{{ script.command }}</span>
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
      <QuickCommandsDialog
        v-if="editor"
        :scripts="scripts"
        :focus-id="editor.focusId"
        @close="editor = null"
      />
    </div>
    <!-- P128 §2.4: no scripts seam (Kira Space) — just a header and one "New terminal" action,
         the same one the tab strip's own "+" menu opens (useNewTerminal). -->
    <div v-else class="flex h-full flex-col">
      <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
        <span class="font-semibold">Terminal</span>
      </div>
      <div class="side-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-4 p-6 text-center">
        <Alert class="w-auto flex-col items-center gap-1.5 border-0 bg-transparent text-center">
          <CodiconIcon name="terminal-bash" :size="24" class="text-subtle" />
          <AlertTitle class="text-kira-md font-normal text-muted-foreground">No terminal open</AlertTitle>
          <AlertAction class="static mt-1">
            <Button
              variant="dialog-primary"
              size="kira-lg"
              data-testid="terminal-panel-new"
              @click="openNewTerminal"
            >
              New terminal
            </Button>
          </AlertAction>
        </Alert>
      </div>
    </div>
  </div>
</template>
