<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import type { CustomScript, ScriptCollection, ScriptKind } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import InlineState from '@theme/components/InlineState.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import Spinner from '@theme/components/Spinner.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { FieldError } from '@theme/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { colorMarkClass } from '@theme/connColor';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { useEventListener } from '@vueuse/core';
import { matchesQuery } from '@workbench/behaviour/match';
import { usePanelHeaderSearch } from '@workbench/behaviour/panelSearch';
import { usePersistedState } from '@workbench/behaviour/persisted';
import InlineEditInput from '@workbench/components/InlineEditInput.vue';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import { moveToCollectionMenu } from '@workbench/lib/collectionMenu';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, ref, useTemplateRef } from 'vue';
import { errorText } from '../bridge/codedError';
import { useAutomationsModule } from './module';
import { useRerun, useRunScript } from './runScript';
import RunElapsed from './runs/RunElapsed.vue';
import RunsSection from './runs/RunsSection.vue';
import { useScriptRuns } from './runs/runsQueries';
import ScriptDialog from './ScriptDialog.vue';
import { useScheduleConfirmStore } from './schedule/confirmDialog';
import ScriptScheduleLine from './schedule/ScriptScheduleLine.vue';
import { useRemoveScript } from './scriptActions';
import type { EditorTab } from './scriptErrors';
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
  initialTab?: EditorTab;
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
  return matchesQuery(script.name, q) || matchesQuery(script.command, q);
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
    const nameHit = q !== '' && matchesQuery(collection.name, q);
    const rows = q === '' || nameHit ? own : own.filter((s) => matches(s, q));
    if (q === '' || nameHit || rows.length > 0) groups.push({ collection, rows });
  }
  return { ungrouped, groups };
});

// Renamed from kira.quickCommands.collapsedCollections: the old value is copied once.
const collapsed = usePersistedState<string[]>('kira.automations.collapsedCollections', [], {
  migrateFrom: 'kira.quickCommands.collapsedCollections',
});

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
    actionError.value = errorText(err);
  }
}

// Creates the collection with a placeholder name, then opens it for inline naming (the API tree's
// own flow); returns its id, or null on failure.
async function newCollection(): Promise<string | null> {
  let id: string | null = null;
  await guarded(async () => {
    const created = await scripts.createCollection(t('common.newCollection.label'));
    openGroup(created.id);
    renamingId.value = created.id;
    id = created.id;
  });
  return id;
}

async function moveToNewCollection(script: CustomScript): Promise<void> {
  await guarded(async () => {
    const created = await scripts.createCollection(t('common.newCollection.label'));
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
  const ok = await confirmDialogStore.confirm({
    title: t('common.deleteCollectionConfirm.title'),
    message: t('automations.collection.deleteConfirm.body', { name: collection.name }),
    confirmLabel: t('common.action.delete.label'),
    tone: 'danger',
  });
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
      label: t('automations.script.new.label'),
      icon: 'add',
      run: () => {
        editor.value = { script: null, kind: 'script', collectionId };
      },
    },
    {
      type: 'item',
      id: 'new-smart-script',
      label: t('automations.script.newSmart.label'),
      icon: 'sparkle',
      run: () => {
        editor.value = { script: null, kind: 'smart', collectionId };
      },
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
      label: t('common.action.run.label'),
      icon: 'play',
      run: () => runScript(script),
    },
    ...(script.schedule
      ? ([
          {
            type: 'item',
            id: 'run-now',
            label: t('automations.script.runNow.label'),
            icon: 'debug-start',
            run: () => confirmStore.openNow(script.id),
          },
          {
            type: 'item',
            id: 'edit-schedule',
            label: t('automations.script.editSchedule.label'),
            icon: 'watch',
            run: () => {
              editor.value = { script, kind: script.kind, collectionId: null, initialTab: 'schedule' };
            },
          },
        ] satisfies MenuItem[])
      : []),
    {
      type: 'item',
      id: 'edit',
      label: t('common.action.edit.label'),
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
      label: t('common.action.remove.label'),
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
      label: t('common.action.rename.label'),
      icon: 'edit',
      run: () =>
        contextMenuStore.afterClose(() => {
          renamingId.value = collection.id;
        }),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'delete',
      label: t('common.action.delete.label'),
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
      label: t('common.newCollection.label'),
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
      <PanelHeader>
        {{ t('common.module.automations.label') }}
        <template #actions>
          <TooltipIconButton
            icon="search"
            :label="showSearch ? t('common.action.hideSearch.label') : t('common.action.search.label')"
            :pressed="showSearch"
            data-testid="toggle-search"
            @click="toggleSearch"
          />
          <TooltipIconButton
            icon="add"
            :label="t('automations.panel.add.tooltip')"
            :aria-label="t('automations.script.new.label')"
            data-testid="automations-add"
            @click="onAddClick"
          />
          <TooltipIconButton
            icon="new-folder"
            :label="t('common.newCollection.label')"
            data-testid="automations-new-collection"
            @click="newCollection"
          />
        </template>
      </PanelHeader>
      <PanelBar v-if="!empty && showSearch">
        <SearchField v-model="search" data-testid="tree-search" />
      </PanelBar>
      <div ref="bodyEl" class="flex min-h-0 flex-1 flex-col" data-testid="automations-body">
        <div v-if="!empty" class="flex h-full flex-col overflow-y-auto">
          <InlineState v-if="actionError" kind="error" data-testid="script-error">{{ actionError }}</InlineState>
          <div class="flex flex-col" data-testid="script-list">
            <template v-for="script in view.ungrouped" :key="script.id">
              <Tooltip>
                <TooltipTrigger as-child>
                <button
                type="button"
                :class="cn(rowVariants({ layout: 'double' }), 'w-full items-center text-left disabled:opacity-50')"
                :style="rowIndent(0)"
                :data-testid="`script-${script.id}`"
                @click="runScript(script)"
                @contextmenu.prevent.stop="onContextMenu($event, script)"
              >
                <span :class="colorMarkClass('rail', script.color)" data-testid="script-rail" aria-hidden="true" />
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
                <span class="flex w-5 shrink-0 items-center justify-center" data-testid="script-run-slot">
                  <Spinner
                    v-if="liveRunByScript.get(script.id)"
                    label=""
                    data-testid="script-running"
                  />
                  <CodiconIcon v-else name="play" :size="13" class="text-muted-foreground" />
                </span>
              </button>
                </TooltipTrigger>
                <TooltipContent class="whitespace-pre-wrap">{{ script.command }}</TooltipContent>
              </Tooltip>
            </template>
            <template v-for="group in view.groups" :key="group.collection.id">
              <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only; the header button toggles by keyboard. -->
              <div
                
                :class="rowVariants({ layout: 'tree' })"
                :style="rowIndent(0)"
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
                <InlineEditInput
                  v-if="renamingId === group.collection.id"
                  :name="group.collection.name"
                  data-testid="script-collection-rename-input"
                  @commit="(name) => commitRename(group.collection, name)"
                  @cancel="renamingId = null"
                />
                <button
                  v-else
                  type="button"
                  class="flex-1 min-w-0 cursor-default overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left font-medium text-inherit"
                  :aria-expanded="isOpen(group.collection.id)"
                  @click="toggleGroup(group.collection.id)"
                >{{ group.collection.name }}</button>
                <span class="text-muted-foreground text-kira-sm">{{ group.rows.length }}</span>
              </div>
              <div v-if="isOpen(group.collection.id)" class="flex flex-col">
                <Tooltip v-for="script in group.rows" :key="script.id">
                  <TooltipTrigger as-child>
                  <button
                  type="button"
                  :class="cn(rowVariants({ layout: 'double' }), 'w-full items-center text-left disabled:opacity-50')"
                  :style="rowIndent(1)"
                  :data-testid="`script-${script.id}`"
                  @click="runScript(script)"
                  @contextmenu.prevent.stop="onContextMenu($event, script)"
                >
                  <span :class="colorMarkClass('rail', script.color)" data-testid="script-rail" aria-hidden="true" />
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
                  <span class="flex w-5 shrink-0 items-center justify-center" data-testid="script-run-slot">
                    <Spinner
                      v-if="liveRunByScript.get(script.id)"
                      label=""
                      data-testid="script-running"
                    />
                    <CodiconIcon v-else name="play" :size="13" class="text-muted-foreground" />
                  </span>
                </button>
                  </TooltipTrigger>
                  <TooltipContent class="whitespace-pre-wrap">{{ script.command }}</TooltipContent>
                </Tooltip>
              </div>
            </template>
          </div>
        </div>
        <EmptyState
          v-else
          class="h-full"
          icon="terminal-bash"
          :title="t('automations.panel.none.empty')"
          :description="t('automations.panel.none.emptyHint')"
        >
          <FieldError v-if="actionError" data-testid="script-error">{{ actionError }}</FieldError>
        </EmptyState>
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
        :initial-tab="editor.initialTab"
        @close="editor = null"
      />
    </div>
  </div>
</template>
