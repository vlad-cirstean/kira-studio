<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import type { CustomScript, ScriptCollection, ScriptKind } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { colorMarkClass } from '@theme/connColor';
import { useEventListener, useLocalStorage } from '@vueuse/core';
import InlineRenameInput from '@workbench/components/InlineRenameInput.vue';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { moveToCollectionMenu } from '@workbench/util/collectionMenu';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, ref, useTemplateRef } from 'vue';
import { useAutomationsModule } from './module';
import { useRerun, useRunScript } from './runScript';
import RunElapsed from './runs/RunElapsed.vue';
import RunsSection from './runs/RunsSection.vue';
import { useScriptRuns } from './runs/runsQueries';
import ScriptDialog from './ScriptDialog.vue';
import { useScheduleConfirmStore } from './schedule/confirmDialog';
import ScriptScheduleLine from './schedule/ScriptScheduleLine.vue';
import { toggleSchedule, useRemoveScript } from './scriptActions';
import SmartBadge from './smart/SmartBadge.vue';

const contextMenuStore = useContextMenuStore();
const confirmDialogStore = useConfirmDialogStore();
const ctx = useAutomationsModule();
const removeScript = useRemoveScript();

// The Automations module's own left panel: a view over the custom_scripts store through the
// `ctx.scripts` seam, both apps. The header `+` is the one way to add a script; a row's context
// menu edits it. Both open `ScriptDialog.vue`.
const scripts = ctx.scripts;

// Dialog visibility is this component's own local state: nothing else reads it. `collectionId`
// presets a new script's collection (added from a collection's own menu).
const editor = ref<{
  script: CustomScript | null;
  kind: ScriptKind;
  collectionId: string | null;
  schedule?: boolean;
} | null>(null);

const search = ref('');
const actionError = ref<string | null>(null);
// The collection whose name is being edited inline, if any.
const renamingId = ref<string | null>(null);

interface ScriptGroup {
  collection: ScriptCollection;
  rows: readonly CustomScript[];
}

function matches(script: CustomScript, q: string): boolean {
  return script.name.toLowerCase().includes(q) || script.command.toLowerCase().includes(q);
}

// §11.1: panel search filters rows by name and command; a collection shows when its name matches
// (all its rows) or any of its rows does.
const view = computed(() => {
  const q = search.value.trim().toLowerCase();
  const known = new Set(scripts.collections().map((c) => c.id));
  const records = scripts.records();
  const ungrouped = records.filter(
    (s) => (s.collectionId === null || !known.has(s.collectionId)) && (q === '' || matches(s, q)),
  );
  const groups: ScriptGroup[] = [];
  for (const collection of scripts.collections()) {
    const own = records.filter((s) => s.collectionId === collection.id);
    const nameHit = q !== '' && collection.name.toLowerCase().includes(q);
    const rows = q === '' || nameHit ? own : own.filter((s) => matches(s, q));
    if (q === '' || nameHit || rows.length > 0) groups.push({ collection, rows });
  }
  return { ungrouped, groups };
});

// Renamed from kira.quickCommands.collapsedCollections: copy the old value once.
const COLLAPSED_KEY = 'kira.automations.collapsedCollections';
const LEGACY_COLLAPSED_KEY = 'kira.quickCommands.collapsedCollections';
try {
  const legacy = localStorage.getItem(LEGACY_COLLAPSED_KEY);
  if (legacy !== null && localStorage.getItem(COLLAPSED_KEY) === null) {
    localStorage.setItem(COLLAPSED_KEY, legacy);
  }
  localStorage.removeItem(LEGACY_COLLAPSED_KEY);
} catch {
  // storage unavailable: start with nothing collapsed
}
const collapsed = useLocalStorage<string[]>(COLLAPSED_KEY, []);

// A search shows every matching row, collapsed or not.
function isOpen(id: string): boolean {
  return search.value.trim() !== '' || !collapsed.value.includes(id);
}

function toggleGroup(id: string): void {
  collapsed.value = collapsed.value.includes(id)
    ? collapsed.value.filter((n) => n !== id)
    : [...collapsed.value, id];
}

function openGroup(id: string): void {
  collapsed.value = collapsed.value.filter((n) => n !== id);
}

const empty = computed(() => scripts.records().length === 0 && scripts.collections().length === 0);

async function guarded(fn: () => Promise<void>): Promise<void> {
  actionError.value = null;
  try {
    await fn();
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  }
}

// Creates the collection with a placeholder name, then opens it for inline naming (the API tree's
// own flow); returns its id, or null on failure.
async function newCollection(): Promise<string | null> {
  let id: string | null = null;
  await guarded(async () => {
    const created = await scripts.createCollection('New collection');
    openGroup(created.id);
    renamingId.value = created.id;
    id = created.id;
  });
  return id;
}

async function moveToNewCollection(script: CustomScript): Promise<void> {
  await guarded(async () => {
    const created = await scripts.createCollection('New collection');
    await scripts.move(script.id, created.id);
    openGroup(created.id);
    renamingId.value = created.id;
  });
}

function commitRename(collection: ScriptCollection, name: string): void {
  renamingId.value = null;
  void guarded(() => scripts.renameCollection(collection.id, name));
}

async function confirmDeleteCollection(collection: ScriptCollection): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Delete collection "${collection.name}" and everything inside it?`,
    { danger: true, confirmLabel: 'Delete' },
  );
  if (!ok) return;
  await guarded(() => scripts.removeCollection(collection.id));
}

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

function newScriptItems(collectionId: string | null): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'new-script',
      label: 'New script',
      icon: 'add',
      run: () => {
        editor.value = { script: null, kind: 'script', collectionId };
      },
    },
    {
      type: 'item',
      id: 'new-smart-script',
      label: 'New smart script',
      icon: 'sparkle',
      run: () => {
        editor.value = { script: null, kind: 'smart', collectionId };
      },
    },
    {
      type: 'submenu',
      id: 'new-recurring',
      label: 'New recurring script',
      icon: 'watch',
      items: [
        {
          type: 'item',
          id: 'new-recurring-script',
          label: 'Script',
          icon: 'add',
          run: () => {
            editor.value = { script: null, kind: 'script', collectionId, schedule: true };
          },
        },
        {
          type: 'item',
          id: 'new-recurring-smart-script',
          label: 'Smart script',
          icon: 'sparkle',
          run: () => {
            editor.value = { script: null, kind: 'smart', collectionId, schedule: true };
          },
        },
      ],
    },
  ];
}

// The header "+" opens a dropdown under the button, the tab strip "+" pattern.
function onAddClick(e: MouseEvent): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  contextMenuStore.openContextMenuAt(rect.left, rect.bottom + 2, newScriptItems(null));
}

function firstLine(command: string): string {
  const [first = '', ...rest] = command.split('\n');
  return rest.length > 0 ? `${first}…` : first;
}

const confirmStore = useScheduleConfirmStore();
const startScript = useRunScript();
async function runScript(script: CustomScript): Promise<void> {
  actionError.value = await startScript(script);
}

const rerunRun = useRerun();
async function rerun(run: ScriptRun): Promise<void> {
  actionError.value = await rerunRun(run);
}

const { data: runs } = useScriptRuns();
const liveRunByScript = computed(() => {
  const m = new Map<string, ScriptRun>();
  for (const r of runs.value ?? []) if (r.state === 'running' && !m.has(r.scriptId)) m.set(r.scriptId, r);
  return m;
});

// §10.4: both surfaces named — a script removed here also stops launching from the tab strip.
async function onRemove(script: CustomScript): Promise<void> {
  await guarded(async () => {
    await removeScript(scripts, script);
  });
}

function onContextMenu(e: MouseEvent, script: CustomScript): void {
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'run',
      label: 'Run',
      icon: 'play',
      run: () => runScript(script),
    },
    ...(script.schedule
      ? ([
          {
            type: 'item',
            id: 'run-now',
            label: 'Run now',
            icon: 'debug-start',
            run: () => confirmStore.openNow(script.id),
          },
          {
            type: 'item',
            id: 'toggle-schedule',
            label: script.schedule.enabled ? 'Turn schedule off' : 'Turn schedule on',
            icon: 'watch',
            run: () => guarded(() => toggleSchedule(scripts, script)),
          },
        ] satisfies MenuItem[])
      : []),
    {
      type: 'item',
      id: 'edit',
      label: 'Edit…',
      icon: 'edit',
      run: () => {
        editor.value = { script, kind: script.kind, collectionId: null };
      },
    },
    moveToCollectionMenu({
      collections: scripts.collections(),
      current: script.collectionId,
      allowNone: true,
      onMove: (id) => guarded(() => scripts.move(script.id, id)),
      onNew: () => moveToNewCollection(script),
    }),
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

function onCollectionContextMenu(e: MouseEvent, collection: ScriptCollection): void {
  contextMenuStore.openContextMenu(e, [
    ...newScriptItems(collection.id),
    {
      type: 'item',
      id: 'rename',
      label: 'Rename',
      icon: 'edit',
      run: () => {
        renamingId.value = collection.id;
      },
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'delete',
      label: 'Delete',
      icon: 'trash',
      danger: true,
      run: () => confirmDeleteCollection(collection),
    },
  ]);
}

// Right-click on empty space (the empty state included), the API tree's own P105 §5.1 pattern.
const bodyEl = useTemplateRef<HTMLElement>('bodyEl');
useEventListener(bodyEl, 'contextmenu', (e: MouseEvent) => {
  e.preventDefault();
  contextMenuStore.openContextMenu(e, [
    ...newScriptItems(null),
    {
      type: 'item',
      id: 'new-collection',
      label: 'New collection',
      icon: 'new-folder',
      run: async () => {
        await newCollection();
      },
    },
  ]);
});
</script>

<template>
  <div data-testid="automations-panel">
    <div ref="rootEl" class="flex h-full flex-col">
      <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
        <span class="font-semibold">Automations</span>
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
          label="New…"
          aria-label="New script"
          data-testid="automations-add"
          @click="onAddClick"
        />
        <TooltipIconButton
          icon="new-folder"
          label="New collection"
          data-testid="automations-new-collection"
          @click="newCollection"
        />
      </div>
      <div v-if="!empty && showSearch" class="shrink-0 border-b border-border px-1.5 py-1">
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
      <div ref="bodyEl" class="flex min-h-0 flex-1 flex-col" data-testid="automations-body">
        <div v-if="!empty" class="flex h-full flex-col overflow-y-auto">
          <span v-if="actionError" class="px-1.5 py-1 text-error text-kira-sm leading-normal" data-testid="script-error">{{ actionError }}</span>
          <div class="flex flex-col" data-testid="script-list">
            <template v-for="script in view.ungrouped" :key="script.id">
              <button
                type="button"
                                class="relative flex items-center gap-1 py-1 px-1.5 text-left cursor-default select-none hover:bg-hover disabled:opacity-50"
                :title="script.command"
                :data-testid="`script-${script.id}`"
                @click="runScript(script)"
                @contextmenu.prevent.stop="onContextMenu($event, script)"
              >
                <span :class="colorMarkClass('rail', script.color)" data-testid="script-rail" aria-hidden="true" />
                <span
                  v-if="liveRunByScript.get(script.id)"
                  class="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-r-transparent"
                  data-testid="script-running"
                />
                <CodiconIcon v-else name="play" :size="13" class="shrink-0 text-muted-foreground" />
                <div class="flex-1 min-w-0 flex flex-col">
                  <span class="flex min-w-0 items-center gap-1">
                    <SmartBadge v-if="script.kind === 'smart'" />
                    <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ script.name }}</span>
                  </span>
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-kira-sm">{{ firstLine(script.command) }}</span>
                  <ScriptScheduleLine v-if="script.schedule" :script="script" />
                </div>
                <RunElapsed
                  v-if="liveRunByScript.get(script.id)"
                  :run="liveRunByScript.get(script.id)!"
                  class="shrink-0 text-kira-sm text-muted-foreground"
                />
              </button>
            </template>
            <template v-for="group in view.groups" :key="group.collection.id">
              <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only; the header button toggles by keyboard. -->
              <div
                class="flex items-center gap-1 py-1 px-1.5 cursor-default select-none hover:bg-hover"
                data-testid="script-group"
                :data-id="group.collection.id"
                :data-name="group.collection.name"
                @contextmenu.prevent.stop="onCollectionContextMenu($event, group.collection)"
              >
                <TreeTwisty
                  :expanded="isOpen(group.collection.id)"
                  :has-children="group.rows.length > 0"
                  @toggle="toggleGroup(group.collection.id)"
                />
                <CodiconIcon name="folder-library" :size="13" class="shrink-0 text-muted-foreground" />
                <InlineRenameInput
                  v-if="renamingId === group.collection.id"
                  :name="group.collection.name"
                  data-testid="script-collection-rename-input"
                  @commit="(name) => commitRename(group.collection, name)"
                  @cancel="renamingId = null"
                />
                <button
                  v-else
                  type="button"
                  class="flex-1 min-w-0 cursor-default overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left font-semibold text-inherit"
                  :aria-expanded="isOpen(group.collection.id)"
                  @click="toggleGroup(group.collection.id)"
                >{{ group.collection.name }}</button>
                <span class="text-muted-foreground text-kira-sm">{{ group.rows.length }}</span>
              </div>
              <div v-if="isOpen(group.collection.id)" class="flex flex-col">
                <button
                  v-for="script in group.rows"
                  :key="script.id"
                  type="button"
                                    class="relative flex items-center gap-1 py-1 pl-5 pr-1.5 text-left cursor-default select-none hover:bg-hover disabled:opacity-50"
                  :title="script.command"
                  :data-testid="`script-${script.id}`"
                  @click="runScript(script)"
                  @contextmenu.prevent.stop="onContextMenu($event, script)"
                >
                  <span :class="colorMarkClass('rail', script.color)" data-testid="script-rail" aria-hidden="true" />
                  <span
                  v-if="liveRunByScript.get(script.id)"
                  class="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-r-transparent"
                  data-testid="script-running"
                />
                <CodiconIcon v-else name="play" :size="13" class="shrink-0 text-muted-foreground" />
                  <div class="flex-1 min-w-0 flex flex-col">
                    <span class="flex min-w-0 items-center gap-1">
                    <SmartBadge v-if="script.kind === 'smart'" />
                    <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ script.name }}</span>
                  </span>
                    <span class="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-kira-sm">{{ firstLine(script.command) }}</span>
                  <ScriptScheduleLine v-if="script.schedule" :script="script" />
                  </div>
                  <RunElapsed
                    v-if="liveRunByScript.get(script.id)"
                    :run="liveRunByScript.get(script.id)!"
                    class="shrink-0 text-kira-sm text-muted-foreground"
                  />
                </button>
              </div>
            </template>
          </div>
        </div>
        <div
          v-else
          class="side-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-4 p-6 text-center"
        >
          <span v-if="actionError" class="text-error text-kira-sm leading-normal" data-testid="script-error">{{ actionError }}</span>
          <Alert class="w-auto flex-col items-center gap-1.5 border-0 bg-transparent text-center">
            <CodiconIcon name="terminal-bash" :size="24" class="text-subtle" />
            <AlertTitle class="text-kira-md font-normal text-muted-foreground">No scripts</AlertTitle>
            <AlertDescription class="text-kira-sm text-muted-foreground">
              Add one with + above.
            </AlertDescription>
          </Alert>
        </div>
      </div>
      <RunsSection @rerun="rerun" />
      <ScriptDialog
        v-if="editor"
        :scripts="scripts"
        :script="editor.script"
        :kind="editor.kind"
        :collection-id="editor.collectionId"
        :choose-folder="ctx.chooseFolder"
        :resolve-dir="ctx.runs.resolveDir"
        :ade="ctx.ade"
        :schedule="editor.schedule"
        @close="editor = null"
      />
    </div>
  </div>
</template>
