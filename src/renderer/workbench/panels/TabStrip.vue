<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { tabTitle } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed } from 'vue';
import { copyText } from '../../clipboard';
import { revealPath } from '../../project/state/tree';
import { connectionsState } from '../../state/connections';
import {
  activateTab,
  closeAll,
  closeOthers,
  closeTab,
  closeToTheRight,
  duplicateTab,
  openConsoleTab,
  tabsState,
} from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import { openContextMenu } from '../state/contextMenu';

// The tabstrip's own "New console" button (Empty.html/FirstRun.html: it stays visible even
// with no tabs open) targets the first connected connection — there is no active tab to infer
// one from once every tab has closed.
const firstConnectedId = computed(
  () =>
    connectionsState.records.find((r) => connectionsState.states[r.id]?.status === 'connected')?.id,
);

function onNewConsole(): void {
  if (firstConnectedId.value) openConsoleTab(firstConnectedId.value, '');
}

function colorFor(tab: TabRecord): string | undefined {
  return connectionsState.records.find((r) => r.id === tab.connectionId)?.color;
}

function iconFor(tab: TabRecord): string {
  if (tab.kind === 'ddl') return 'file-code';
  if (tab.kind === 'console') return 'terminal';
  if (tab.kind === 'document') return 'json';
  if (tab.kind === 'keyvalue') return 'symbol-key';
  if (tab.kind === 'stream') return 'broadcast';
  const tail = pathTail(tab.path);
  const KIND_ICON: Record<string, string> = {
    table: 'table',
    view: 'eye',
    matview: 'symbol-structure',
  };
  return (tail && KIND_ICON[tail.kind]) || 'table';
}

function onClick(tab: TabRecord): void {
  activateTab(tab.id);
}

function onMiddleClick(tab: TabRecord): void {
  closeTab(tab.id);
}

function onClose(e: MouseEvent, tab: TabRecord): void {
  e.stopPropagation();
  closeTab(tab.id);
}

// §8.10's Tab row: Close · Close others · Close to the right · Close all · — · Duplicate tab ·
// Copy name · Reveal in project panel (D22).
function onContextMenu(e: MouseEvent, tab: TabRecord): void {
  openContextMenu(e, [
    { type: 'item', id: 'close', label: 'Close', icon: 'close', run: () => closeTab(tab.id) },
    {
      type: 'item',
      id: 'close-others',
      label: 'Close others',
      run: () => closeOthers(tab.id),
    },
    {
      type: 'item',
      id: 'close-to-the-right',
      label: 'Close to the right',
      run: () => closeToTheRight(tab.id),
    },
    { type: 'item', id: 'close-all', label: 'Close all', run: () => closeAll() },
    { type: 'separator' },
    {
      type: 'item',
      id: 'duplicate-tab',
      label: 'Duplicate tab',
      icon: 'copy',
      run: () => duplicateTab(tab.id),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(tabTitle(tab)),
    },
    {
      type: 'item',
      id: 'reveal-in-project-panel',
      label: 'Reveal in project panel',
      icon: 'target',
      run: () => {
        if (tab.connectionId) void revealPath(tab.connectionId, tab.path);
      },
    },
  ]);
}

const tabs = computed(() => tabsState.tabs);
</script>

<template>
  <div v-if="tabs.length > 0" class="tab-strip" data-testid="tab-strip-row">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="tab"
      :class="{ active: tab.active }"
      data-testid="tab"
      :data-tab-id="tab.id"
      :data-tab-kind="tab.kind"
      :data-active="tab.active"
      :data-color="colorFor(tab)"
      :style="{ '--kira-rail': colorFor(tab) ? `var(--kira-conn-${colorFor(tab)})` : undefined }"
      @click="onClick(tab)"
      @auxclick.middle="onMiddleClick(tab)"
      @contextmenu.prevent="onContextMenu($event, tab)"
    >
      <span class="p-tab-rail" />
      <Codicon :name="iconFor(tab)" :size="13" class="tab-icon" />
      <span class="tab-title">{{ tabTitle(tab) }}</span>
      <span
        class="tab-close"
        role="button"
        aria-label="Close tab"
        data-testid="tab-close"
        @click="onClose($event, tab)"
      >
        <Codicon name="close" :size="12" />
      </span>
    </button>
  </div>
  <!-- Empty.html: with no tab open the strip is not hidden — it keeps its height and shows
       the one control that still applies, so the layout does not jump the moment the first
       tab appears. -->
  <div v-else class="tab-strip is-empty" data-testid="tab-strip-empty">
    <span class="p-sm dim empty-label">No tabs open</span>
    <button
      type="button"
      class="p-iconbtn p-push"
      title="New console"
      :disabled="!firstConnectedId"
      @click="onNewConsole"
    >
      <Codicon name="add" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.tab-strip {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 24px;
  max-width: 220px;
  padding: 0 8px 0 6px;
  border: var(--kira-border-width) solid transparent;
  border-radius: var(--kira-radius-sm);
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
  font-size: 12px;
}

.tab.active {
  background: var(--kira-bg-elevated);
  color: var(--kira-fg);
  border-color: var(--kira-border-strong);
}

.tab:hover:not(.active) {
  background: var(--kira-hover);
}

.tab-icon {
  flex-shrink: 0;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.tab-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--kira-radius-sm);
  opacity: 0;
}

.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--kira-hover);
}

.tab-strip.is-empty {
  padding: 0 var(--kira-s-2);
}

.empty-label {
  padding-left: var(--kira-s-2);
}
</style>
