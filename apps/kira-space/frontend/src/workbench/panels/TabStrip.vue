<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { connColorVar } from '@theme/connColor';
import { computed, nextTick, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { fileIconStyle } from '../../repo/fileIcon';
import { useCodeReposStore } from '../../state/coderepos';
import { useContextMenuStore } from '../../state/contextMenu';
import { openRepoTerminalTab } from '../../state/repoTabs';
import { type SpaceTabKind, TAB_KINDS } from '../../state/tabKinds';
import { tabsForWorkspace, useTabsStore } from '../../state/tabs';
import { GENERAL_WORKSPACE, useWorkspaceStore } from '../../state/workspace';
import { wheelToHorizontal } from '../../wheelScroll';

// P100 Part 2: Kira Studio's own workbench/panels/TabStrip.vue, trimmed — this app has no
// AgentSessions store (no Claude Code hook integration, apps/kira-space/internal/terminal's own
// doc comment) so there is no attention-dot affordance, and no TabIncognito store (a Studio-only
// privacy feature never ported). One workspace at a time (useWorkspaceStore().active) replaces
// useModeStore().active — this app's own single-module design (state/workspace.ts's own header
// comment).
const contextMenuStore = useContextMenuStore();
const tabsStore = useTabsStore();
const workspaceStore = useWorkspaceStore();
const codeReposStore = useCodeReposStore();

function isPinned(tab: TabRecord): boolean {
  return TAB_KINDS[tab.kind as SpaceTabKind].pinned === true;
}

function colorFor(tab: TabRecord): string | undefined {
  return TAB_KINDS[tab.kind as SpaceTabKind].railColor(tab);
}

function titleFor(tab: TabRecord): string {
  return TAB_KINDS[tab.kind as SpaceTabKind].title(tab);
}

function onClick(tab: TabRecord): void {
  tabsStore.activateTab(tab.id);
}

function onMiddleClick(tab: TabRecord): void {
  if (isPinned(tab)) return;
  tabsStore.closeTab(tab.id);
}

function onClose(e: MouseEvent, tab: TabRecord): void {
  e.stopPropagation();
  tabsStore.closeTab(tab.id);
}

function onContextMenu(e: MouseEvent, tab: TabRecord): void {
  if (isPinned(tab)) {
    contextMenuStore.openContextMenu(e, [
      {
        type: 'item',
        id: 'copy-name',
        label: 'Copy name',
        icon: 'copy',
        run: () => copyText(titleFor(tab)),
      },
    ]);
    return;
  }
  contextMenuStore.openContextMenu(e, [
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'close',
      shortcut: 'tab.close',
      run: () => tabsStore.closeTab(tab.id),
    },
    {
      type: 'item',
      id: 'close-others',
      label: 'Close others',
      run: () => tabsStore.closeOthers(tab.id),
    },
    {
      type: 'item',
      id: 'close-to-the-right',
      label: 'Close to the right',
      run: () => tabsStore.closeToTheRight(tab.id),
    },
    {
      type: 'item',
      id: 'close-all',
      label: 'Close all',
      run: () => tabsStore.closeAll(workspaceStore.active),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'duplicate-tab',
      label: 'Duplicate tab',
      icon: 'copy',
      run: () => void tabsStore.duplicateTab(tab.id),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(titleFor(tab)),
    },
    ...TAB_KINDS[tab.kind as SpaceTabKind].menuExtras(tab),
  ]);
}

const tabs = computed(() => tabsForWorkspace(workspaceStore.active));

// A tab kind's icon() returns either a codicon name or a `{ filePath }` marker (only 'repo-file',
// state/tabKinds.ts's own doc comment) — resolved here into the two disjoint render shapes the
// template below actually needs, the same split RepoTreeRow.vue's own fileIconStyle call site uses
// for the identical marker.
function resolveIcon(tab: TabRecord): { codicon: string } | { fileStyle: Record<string, string> } {
  const icon = TAB_KINDS[tab.kind as SpaceTabKind].icon(tab);
  return typeof icon === 'string' ? { codicon: icon } : { fileStyle: fileIconStyle(icon.filePath) };
}

const pinnedTabs = computed(() =>
  tabs.value.filter((tab) => isPinned(tab)).map((tab) => ({ tab, icon: resolveIcon(tab) })),
);
const scrollingTabs = computed(() =>
  tabs.value.filter((tab) => !isPinned(tab)).map((tab) => ({ tab, icon: resolveIcon(tab) })),
);

const activeTabId = computed(() => tabsStore.activeIdByWorkspace[workspaceStore.active]);
const stripRef = ref<HTMLElement | null>(null);

watch(
  activeTabId,
  (id) => {
    if (!id) return;
    void nextTick(() => {
      stripRef.value
        ?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
  { immediate: true },
);

function onWheel(e: WheelEvent): void {
  if (wheelToHorizontal(stripRef.value, e)) e.preventDefault();
}

const dragId = ref<string | null>(null);

function onDragStart(id: string): void {
  dragId.value = id;
}
function onDragOver(id: string): void {
  const from = dragId.value;
  if (from === null || from === id) return;
  tabsStore.moveTab(from, id);
  dragId.value = id;
}
function onDragEnd(): void {
  dragId.value = null;
}

const newTabBtn = ref<HTMLButtonElement | null>(null);

// The "+" opens a terminal at the active repository's own root — a no-op affordance (hidden) when
// no repository is open yet, since a GENERAL_WORKSPACE terminal has no workspace of its own to
// scope a tab strip to in this app (state/workspace.ts's own GENERAL_WORKSPACE doc comment).
const showNewTab = computed(() => workspaceStore.active !== GENERAL_WORKSPACE);

function onNewTab(): void {
  const btn = newTabBtn.value;
  const repoId = workspaceStore.active;
  if (!btn || repoId === GENERAL_WORKSPACE) return;
  // Not the pinned repo-graph tab's own `path` — that field holds the workspace key (== repoId,
  // state/tabs.ts's createPinnedRepoGraphTab doc comment), not a filesystem path. The repo's real
  // root lives on its own codeRepoRecord, the same source GitPanel.vue's row-menu "Open terminal"
  // reads (`repo.root`).
  const record = codeReposStore.records.find((r) => r.id === repoId);
  if (!record) return;
  openRepoTerminalTab(repoId, record.root);
}
</script>

<template>
  <div
    class="tab-strip-wrapper"
    :class="{ 'is-empty': tabs.length === 0 }"
    :data-testid="tabs.length > 0 ? 'tab-strip-wrapper' : 'tab-strip-empty'"
  >
    <div v-if="pinnedTabs.length > 0" class="tab-strip-pinned" data-testid="tab-strip-pinned">
      <button
        v-for="{ tab, icon } in pinnedTabs"
        :key="tab.id"
        type="button"
        class="p-tab is-pinned"
        :class="{ 'is-active': tab.active }"
        data-testid="tab"
        :data-tab-id="tab.id"
        :data-tab-kind="tab.kind"
        :data-active="tab.active"
        data-pinned="true"
        :draggable="false"
        :aria-label="titleFor(tab)"
        v-tooltip="titleFor(tab)"
        @click="onClick(tab)"
        @contextmenu.prevent="onContextMenu($event, tab)"
      >
        <CodiconIcon v-if="'codicon' in icon" :name="icon.codicon" :size="13" class="tab-icon" />
        <span v-else class="tab-icon tab-file-icon" :style="icon.fileStyle" aria-hidden="true" />
      </button>
      <span class="tab-strip-separator" aria-hidden="true"></span>
    </div>
    <div ref="stripRef" class="tab-strip" data-testid="tab-strip-row" @wheel="onWheel">
      <button
        v-for="{ tab, icon } in scrollingTabs"
        :key="tab.id"
        type="button"
        class="p-tab"
        :class="{
          'is-active': tab.active,
          'is-dragging': dragId === tab.id,
          'is-preview': tabsStore.isPreview(tab.id),
        }"
        data-testid="tab"
        :data-tab-id="tab.id"
        :data-tab-kind="tab.kind"
        :data-active="tab.active"
        :data-preview="tabsStore.isPreview(tab.id)"
        data-pinned="false"
        :data-color="colorFor(tab)"
        :style="{ '--kira-rail': connColorVar(colorFor(tab)) }"
        draggable="true"
        @click="onClick(tab)"
        @dblclick="tabsStore.promoteTab(tab.id)"
        @auxclick.middle="onMiddleClick(tab)"
        @contextmenu.prevent="onContextMenu($event, tab)"
        @dragstart="onDragStart(tab.id)"
        @dragover.prevent="onDragOver(tab.id)"
        @dragend="onDragEnd"
      >
        <span class="p-tab-rail" />
        <CodiconIcon v-if="'codicon' in icon" :name="icon.codicon" :size="13" class="tab-icon" />
        <span v-else class="tab-icon tab-file-icon" :style="icon.fileStyle" aria-hidden="true" />
        <span class="tab-title">{{ titleFor(tab) }}</span>
        <span
          class="tab-close"
          role="button"
          aria-label="Close tab"
          data-testid="tab-close"
          @click="onClose($event, tab)"
        >
          <CodiconIcon name="close" :size="13" />
        </span>
      </button>
    </div>
    <div v-if="showNewTab" class="tab-strip-actions" data-testid="tab-strip-actions">
      <button
        ref="newTabBtn"
        type="button"
        class="tab-new"
        aria-label="New terminal"
        data-testid="tab-strip-new"
        v-tooltip="'New terminal at repository root'"
        @click="onNewTab"
      >
        <CodiconIcon name="add" :size="13" />
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.tab-strip-wrapper {
  @apply h-full flex items-center min-w-0;
}

.tab-strip-wrapper.is-empty {
  padding: 0 var(--kira-s-2);
}

.tab-strip-pinned {
  @apply h-full flex items-center gap-0.5 shrink-0;
  padding: 2px 0 0 4px;
}

.p-tab.is-pinned {
  padding: 0 var(--kira-s-2);
}

.tab-strip-separator {
  @apply self-stretch shrink-0;
  width: var(--kira-border-width);
  margin: 4px 2px 4px 0;
  background: var(--kira-border);
}

.tab-strip {
  @apply h-full flex items-center gap-0.5 overflow-x-auto overflow-y-hidden min-w-0 [scrollbar-width:none];
  padding: 2px 4px 0;
}

.tab-strip::-webkit-scrollbar {
  @apply hidden;
}

.p-tab:hover:not(.is-active) {
  background: var(--kira-hover);
}

.p-tab.is-dragging {
  @apply opacity-50;
}

.tab-icon {
  @apply shrink-0;
}

/* RepoTreeRow.vue's own .node-icon, ported for the identical `{ filePath }` marker — a repo-file
   tab's own seti icon, not a codicon glyph. */
.tab-file-icon {
  @apply w-[13px] h-[13px] text-muted;
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}

.tab-title {
  @apply overflow-hidden text-ellipsis whitespace-nowrap min-w-0;
}

.p-tab.is-preview .tab-title {
  @apply italic;
}

.tab-close {
  @apply shrink-0 flex items-center justify-center w-4 h-4 opacity-0 rounded-[var(--kira-radius-sm)];
}

.p-tab:hover .tab-close,
.p-tab.is-active .tab-close {
  @apply opacity-100;
}

.tab-close:hover {
  background: var(--kira-hover);
}

.tab-strip-actions {
  @apply h-full flex items-center shrink-0;
  padding: 2px 4px 0 2px;
}
.tab-new {
  @apply flex items-center justify-center w-[22px] h-[22px] bg-transparent border-none cursor-pointer rounded-[var(--kira-radius-sm)];
  color: var(--kira-fg-muted);
}
.tab-new:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}
</style>
