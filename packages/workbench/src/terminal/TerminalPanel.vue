<script setup lang="ts">
import type { CustomScript } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { connBgClass } from '@theme/connColor';
import { useLocalStorage } from '@vueuse/core';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, ref, useTemplateRef } from 'vue';
import { useTerminalModule } from './module';
import QuickCommandsDialog from './QuickCommandsDialog.vue';
import { useRemoveScript } from './scriptActions';

const contextMenuStore = useContextMenuStore();
const ctx = useTerminalModule();
const removeScript = useRemoveScript();

// The Terminal module's own left panel: a view over the custom_scripts store through the
// `ctx.scripts` seam, both apps. The header `+` is the one way to add a command; a row's context
// menu edits it. Both open `QuickCommandsDialog.vue`.
const scripts = ctx.scripts;

// Dialog visibility is this component's own local state: nothing else reads it.
const editor = ref<{ script: CustomScript | null } | null>(null);

const search = ref('');
const removeError = ref<string | null>(null);

// §11.1: panel search filters rows by name and command.
const filteredRecords = computed(() => {
  const records = scripts.records();
  const q = search.value.trim().toLowerCase();
  if (q === '') return records;
  return records.filter(
    (s) => s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
  );
});

interface ScriptGroup {
  name: string;
  rows: CustomScript[];
}

// Ungrouped rows first and unlabelled, then collections by name; each group keeps list order.
const groups = computed<ScriptGroup[]>(() => {
  const byName = new Map<string, CustomScript[]>();
  for (const script of filteredRecords.value) {
    const rows = byName.get(script.collection) ?? [];
    rows.push(script);
    byName.set(script.collection, rows);
  }
  return [...byName.entries()]
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => (a.name === '' ? -1 : b.name === '' ? 1 : a.name.localeCompare(b.name)));
});

const collapsed = useLocalStorage<string[]>('kira.quickCommands.collapsed', []);

// A search shows every matching row, collapsed or not.
function isOpen(name: string): boolean {
  return name === '' || search.value.trim() !== '' || !collapsed.value.includes(name);
}

function toggleGroup(name: string): void {
  collapsed.value = collapsed.value.includes(name)
    ? collapsed.value.filter((n) => n !== name)
    : [...collapsed.value, name];
}

const empty = computed(() => scripts.records().length === 0);

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

// §11.2: the tab therefore titles itself with the script's name and paints its rail with the
// script's colour, through tabKinds.ts's existing title()/railColor() — no new title or colour
// logic needed here.
function scriptCwd(script: CustomScript): string {
  return script.workingDir || ctx.defaultCwd();
}

function firstLine(command: string): string {
  const [first = '', ...rest] = command.split('\n');
  return rest.length > 0 ? `${first}…` : first;
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
  removeError.value = null;
  try {
    await removeScript(scripts, script);
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
        editor.value = { script };
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
    <div ref="rootEl" class="flex h-full flex-col">
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
          label="Add quick command…"
          aria-label="Add quick command"
          data-testid="quick-commands-add"
          @click="editor = { script: null }"
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
            <span v-if="removeError" class="px-1.5 py-1 text-error text-kira-sm leading-normal" data-testid="quick-command-remove-error">{{ removeError }}</span>
            <div
              v-if="filteredRecords.length > 0"
              class="flex flex-col"
              data-testid="quick-command-list"
            >
              <template v-for="group in groups" :key="group.name">
                <div
                  v-if="group.name !== ''"
                  class="flex items-center gap-1 py-1 px-1.5 cursor-default select-none hover:bg-hover"
                  :data-testid="`quick-command-group-${group.name}`"
                >
                  <TreeTwisty :expanded="isOpen(group.name)" :has-children="true" @toggle="toggleGroup(group.name)" />
                  <button
                    type="button"
                    class="flex-1 min-w-0 cursor-default overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left font-semibold text-inherit"
                    :aria-expanded="isOpen(group.name)"
                    @click="toggleGroup(group.name)"
                  >{{ group.name }}</button>
                  <span class="text-muted-foreground text-kira-sm">{{ group.rows.length }}</span>
                </div>
                <div v-if="isOpen(group.name)" :class="{ 'pl-3.5': group.name !== '' }" class="flex flex-col">
                  <button
                    v-for="script in group.rows"
                    :key="script.id"
                    type="button"
                    :disabled="scriptCwd(script) === ''"
                    class="flex items-center gap-1 py-1 px-1.5 text-left cursor-default select-none hover:bg-hover disabled:opacity-50"
                    :title="script.command"
                    :data-testid="`quick-command-${script.id}`"
                    @click="runScript(script)"
                    @contextmenu.prevent="onContextMenu($event, script)"
                  >
                    <span
                      v-if="script.color !== 'none'"
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      :class="connBgClass(script.color)"
                    />
                    <CodiconIcon v-else name="play" :size="13" class="shrink-0 text-muted-foreground" />
                    <div class="flex-1 min-w-0 flex flex-col">
                      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ script.name }}</span>
                      <span class="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-kira-sm">{{ firstLine(script.command) }}</span>
                    </div>
                  </button>
                </div>
              </template>
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
          <AlertDescription class="text-kira-sm text-muted-foreground">
            Add one with + above.
          </AlertDescription>
        </Alert>
      </div>
      <QuickCommandsDialog
        v-if="editor"
        :scripts="scripts"
        :script="editor.script"
        @close="editor = null"
      />
    </div>
  </div>
</template>
