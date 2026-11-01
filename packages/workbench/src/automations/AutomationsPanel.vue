<script setup lang="ts">
import type { CustomScript, ScriptCollection, ScriptKind } from '@shared/domain/scripts';
import EmptyState from '@theme/components/EmptyState.vue';
import InlineState from '@theme/components/InlineState.vue';
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { FieldError } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import { useEventListener } from '@vueuse/core';
import { useCopy } from '@workbench/behaviour/clipboard';
import { useListNavigation } from '@workbench/behaviour/listNavigation';
import { matchesQuery } from '@workbench/behaviour/match';
import { usePanelHeaderSearch } from '@workbench/behaviour/panelSearch';
import { usePersistedState } from '@workbench/behaviour/persisted';
import { moveId } from '@workbench/behaviour/sortableReorder';
import { useTreeShortcuts } from '@workbench/behaviour/treeShortcuts';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import SortableList from '@workbench/components/SortableList.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, ref, useTemplateRef } from 'vue';
import { errorText } from '../bridge/codedError';
import { useAutomationsModule } from './module';
import {
  type CollectionMenuActions,
  collectionMenu,
  newScriptItems,
  type ScriptMenuActions,
  scriptMenu,
} from './panelMenus';
import RunsRestoreBanner from './restore/RunsRestoreBanner.vue';
import { useRunScript } from './runScript';
import RunsSection from './runs/RunsSection.vue';
import { useLiveRunByScript } from './runs/runsQueries';
import ScriptDialog from './ScriptDialog.vue';
import ScriptGroupHeader from './ScriptGroupHeader.vue';
import ScriptRow from './ScriptRow.vue';
import { useScheduleConfirmStore } from './schedule/confirmDialog';
import { useRemoveScript } from './scriptActions';
import type { EditorTab } from './scriptErrors';
import { useScriptTabs } from './scriptTabs';

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

// A search shows a filtered subset, so it pauses drag, Alt+arrow and the Move up/down items.
const reorderOff = computed(() => search.value.trim() !== '');
const ungroupedIds = computed(() => view.value.ungrouped.map((s) => s.id));
// Scripts drag between the ungrouped list and every open collection; the lists share this group.
const SCRIPT_GROUP = 'automation-scripts';
function scriptIdOf(el: HTMLElement): string | null {
  return el.dataset.navKey?.replace(/^script:/, '') ?? null;
}
function dropScript(collectionId: string | null, id: string, beforeId: string | null): void {
  void guarded(() => scripts.move(id, collectionId, beforeId));
}
const groupIds = computed(() => view.value.groups.map((g) => g.collection.id));

function reorderScripts(
  collectionId: string | null,
  ids: readonly string[],
  from: string,
  to: string,
): void {
  void guarded(() => scripts.reorder(collectionId, moveId(ids, from, to)));
}

function reorderGroups(from: string, to: string): void {
  void guarded(() => scripts.reorderCollections(moveId(groupIds.value, from, to)));
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

function openEditor(kind: ScriptKind, collectionId: string | null): void {
  editor.value = { script: null, kind, collectionId };
}

// The header "+" opens a dropdown under the button, the tab strip "+" pattern.
function onAddClick(e: MouseEvent): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  contextMenuStore.openContextMenuAt(rect.left, rect.bottom + 2, newScriptItems(openEditor, null));
}

interface NavItem {
  key: string;
  kind: 'script' | 'group';
  id: string;
  depth: 0 | 1;
}

const navItems = computed<NavItem[]>(() => [
  ...view.value.ungrouped.map(
    (s): NavItem => ({ key: `script:${s.id}`, kind: 'script', id: s.id, depth: 0 }),
  ),
  ...view.value.groups.flatMap(({ collection, rows }): NavItem[] => [
    { key: `group:${collection.id}`, kind: 'group', id: collection.id, depth: 0 },
    ...(isOpen(collection.id)
      ? rows.map((s): NavItem => ({ key: `script:${s.id}`, kind: 'script', id: s.id, depth: 1 }))
      : []),
  ]),
]);

const treeEl = useTemplateRef<HTMLElement>('treeEl');
const activeKey = ref<string | null>(null);

function scriptById(id: string): CustomScript | undefined {
  return scripts.records().find((s) => s.id === id);
}
function collectionById(id: string): ScriptCollection | undefined {
  return scripts.collections().find((c) => c.id === id);
}

function openItem(item: NavItem): void {
  if (item.kind === 'group') toggleGroup(item.id);
  else {
    const script = scriptById(item.id);
    if (script) editScript(script);
  }
}

function editScript(script: CustomScript): void {
  editor.value = { script, kind: script.kind, collectionId: null };
}

const nav = useListNavigation<NavItem>({
  container: treeEl,
  items: () => navItems.value,
  key: (i) => i.key,
  activeKey,
  onOpen: openItem,
  tree: {
    depth: (i) => i.depth,
    isExpanded: (i) => i.kind === 'group' && isOpen(i.id),
    hasChildren: (i) => i.kind === 'group' && (collectionById(i.id) ? groupSize(i.id) > 0 : false),
    expand: (i) => openGroup(i.id),
    collapse: (i) => {
      if (!collapsed.value.includes(i.id)) collapsed.value = [...collapsed.value, i.id];
    },
  },
  rendered: () => navItems.value,
});

function groupSize(id: string): number {
  return view.value.groups.find((g) => g.collection.id === id)?.rows.length ?? 0;
}

const { copy } = useCopy();
useTreeShortcuts(
  { container: treeEl, activeKey },
  {
    'tree.copyName': (key) => {
      const item = navItems.value.find((i) => i.key === key);
      const name =
        item?.kind === 'group' ? collectionById(item.id)?.name : scriptById(item?.id ?? '')?.name;
      if (name !== undefined) void copy(name);
    },
    'tree.rename': (key) => {
      const item = navItems.value.find((i) => i.key === key);
      if (item?.kind === 'group') renamingId.value = item.id;
    },
    'tree.delete': (key) => {
      const item = navItems.value.find((i) => i.key === key);
      if (!item) return;
      if (item.kind === 'group') {
        const collection = collectionById(item.id);
        if (collection) void confirmDeleteCollection(collection);
      } else {
        const script = scriptById(item.id);
        if (script) void onRemove(script);
      }
    },
  },
);

const confirmStore = useScheduleConfirmStore();
const startScript = useRunScript();
const scriptTabs = useScriptTabs();
async function runScript(script: CustomScript): Promise<void> {
  actionError.value = await startScript(script);
}

const liveRunByScript = useLiveRunByScript();

// §10.4: both surfaces named — a script removed here also stops launching from the tab strip.
async function onRemove(script: CustomScript): Promise<void> {
  await guarded(async () => {
    await removeScript(scripts, script);
  });
}

function openMenu(item: NavItem, e: MouseEvent, items: MenuItem[]): void {
  void nav.focusKey(item.key);
  nav.contextMenu(item, e, items);
}

function navItemOf(kind: 'script' | 'group', id: string): NavItem {
  return (
    navItems.value.find((i) => i.kind === kind && i.id === id) ?? {
      key: `${kind}:${id}`,
      kind,
      id,
      depth: 0,
    }
  );
}

// Alt+arrow stays on the lists' keyboard handling; these items run the same swap by menu.
function setIdsOf(script: CustomScript): readonly string[] {
  const group = view.value.groups.find((g) => g.collection.id === script.collectionId);
  return group ? group.rows.map((r) => r.id) : ungroupedIds.value;
}

function stepIds(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
  const neighbour = ids[ids.indexOf(id) + step];
  return ids.includes(id) && neighbour ? moveId(ids, id, neighbour) : null;
}

const scriptActions: ScriptMenuActions = {
  run: runScript,
  runNow: (script) => {
    const { taskId, branchId } = script.schedule ?? { taskId: '', branchId: '' };
    if (!scriptTabs.focusLive({ scriptId: script.id, taskId, branchId })) {
      confirmStore.openNow(script.id);
    }
  },
  editSchedule: (script) => {
    editor.value = { script, kind: script.kind, collectionId: null, initialTab: 'schedule' };
  },
  edit: editScript,
  collections: () => scripts.collections(),
  moveTo: (script, id) => guarded(() => scripts.move(script.id, id)),
  moveToNew: moveToNewCollection,
  remove: onRemove,
  canMoveStep: (script, step) =>
    !reorderOff.value && stepIds(setIdsOf(script), script.id, step) !== null,
  moveStep: (script, step) => {
    const order = stepIds(setIdsOf(script), script.id, step);
    if (order) void guarded(() => scripts.reorder(script.collectionId, order));
  },
};

const collectionActions: CollectionMenuActions = {
  newScript: openEditor,
  rename: (collection) =>
    contextMenuStore.afterClose(() => {
      renamingId.value = collection.id;
    }),
  remove: confirmDeleteCollection,
  canMoveStep: (collection, step) =>
    !reorderOff.value && stepIds(groupIds.value, collection.id, step) !== null,
  moveStep: (collection, step) => {
    const order = stepIds(groupIds.value, collection.id, step);
    if (order) void guarded(() => scripts.reorderCollections(order));
  },
};

function onContextMenu(e: MouseEvent, script: CustomScript): void {
  openMenu(navItemOf('script', script.id), e, scriptMenu(script, scriptActions));
}

function onCollectionContextMenu(e: MouseEvent, collection: ScriptCollection): void {
  openMenu(navItemOf('group', collection.id), e, collectionMenu(collection, collectionActions));
}

// Right-click on empty space (the empty state included), the API tree's own P105 §5.1 pattern.
const bodyEl = useTemplateRef<HTMLElement>('bodyEl');
useEventListener(bodyEl, 'contextmenu', (e: MouseEvent) => {
  e.preventDefault();
  contextMenuStore.openContextMenu(e, [
    ...newScriptItems(openEditor, null),
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
  <div class="h-full" data-testid="automations-panel">
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
      <RunsRestoreBanner />
      <PanelBar v-if="!empty && showSearch">
        <SearchField v-model="search" data-testid="tree-search" />
      </PanelBar>
      <div ref="bodyEl" class="flex min-h-0 flex-1 flex-col" data-testid="automations-body">
        <div v-if="!empty" class="flex h-full flex-col overflow-y-auto">
          <InlineState v-if="actionError" kind="error" data-testid="script-error">{{
            actionError
          }}</InlineState>
          <div ref="treeEl" class="flex flex-col" data-testid="script-list">
            <SortableList
              :ids="ungroupedIds"
              draggable='[data-nav-key^="script:"]'
              :group="SCRIPT_GROUP"
              :item-id="scriptIdOf"
              :disabled="reorderOff"
              :class="['flex flex-col', ungroupedIds.length === 0 && 'min-h-2']"
              @move="(from, to) => reorderScripts(null, ungroupedIds, from, to)"
              @add="(id, beforeId) => dropScript(null, id, beforeId)"
            >
              <ScriptRow
                v-for="script in view.ungrouped"
                :key="script.id"
                :script="script"
                :depth="0"
                :live-run="liveRunByScript.get(script.id)"
                v-bind="nav.rowProps(`script:${script.id}`)"
                :selected="activeKey === `script:${script.id}`"
                :live="scriptTabs.isLive({ scriptId: script.id, taskId: '', branchId: '' })"
                @run="runScript(script)"
                @open="editScript(script)"
                @menu="onContextMenu($event, script)"
              />
            </SortableList>
            <SortableList
              :ids="groupIds"
              draggable="[data-group-entry]"
              handle='[data-testid="script-group"]'
              keyboard-handle='[data-testid="script-group"]'
              :disabled="reorderOff"
              class="flex flex-col"
              @move="reorderGroups"
            >
              <div
                v-for="group in view.groups"
                :key="group.collection.id"
                data-group-entry
                class="flex flex-col"
              >
                <ScriptGroupHeader
                  :collection="group.collection"
                  :count="group.rows.length"
                  :open="isOpen(group.collection.id)"
                  :renaming="renamingId === group.collection.id"
                  v-bind="nav.rowProps(`group:${group.collection.id}`)"
                  @toggle="toggleGroup(group.collection.id)"
                  @commit="(name) => commitRename(group.collection, name)"
                  @cancel="renamingId = null"
                  @menu="onCollectionContextMenu($event, group.collection)"
                />
                <SortableList
                  v-if="isOpen(group.collection.id)"
                  :ids="group.rows.map((s) => s.id)"
                  draggable='[data-nav-key^="script:"]'
                  :group="SCRIPT_GROUP"
                  :item-id="scriptIdOf"
                  :disabled="reorderOff"
                  :class="['flex flex-col', group.rows.length === 0 && 'min-h-2']"
                  @add="(id, beforeId) => dropScript(group.collection.id, id, beforeId)"
                  @move="
                  (from, to) =>
                    reorderScripts(
                      group.collection.id,
                      group.rows.map((s) => s.id),
                      from,
                      to,
                    )
                "
                >
                  <ScriptRow
                    v-for="script in group.rows"
                    :key="script.id"
                    :script="script"
                    :depth="1"
                    :live-run="liveRunByScript.get(script.id)"
                    v-bind="nav.rowProps(`script:${script.id}`)"
                    :selected="activeKey === `script:${script.id}`"
                    :live="scriptTabs.isLive({ scriptId: script.id, taskId: '', branchId: '' })"
                    @run="runScript(script)"
                    @open="editScript(script)"
                    @menu="onContextMenu($event, script)"
                  />
                </SortableList>
              </div>
            </SortableList>
          </div>
        </div>
        <EmptyState
          v-else
          fill
          icon="terminal-bash"
          :title="t('automations.panel.none.empty')"
          :description="t('automations.panel.none.emptyHint')"
        >
          <FieldError v-if="actionError" data-testid="script-error">{{ actionError }}</FieldError>
        </EmptyState>
      </div>
      <RunsSection />
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
