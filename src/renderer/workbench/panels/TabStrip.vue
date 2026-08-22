<script setup lang="ts">
import { computed } from 'vue';
import { connectionsState } from '../../project/state/connections';
import { iconForKind } from '../../project/icons';
import { decodePath } from '@shared/tree';
import Codicon from '../../theme/Codicon.vue';
import { openContextMenu } from '../state/contextMenu';
import {
  activate,
  close,
  closeOthers,
  closeToRight,
  duplicate,
  move,
  tabsState,
  type AnyTab,
} from '../state/tabs';

// §8.4 tab strip. One button per tab, tinted with the connection's colour (3 px left rail),
// overflow scrolls horizontally with the active tab kept in view, middle-click closes, drag
// reorders. The D29 context menu is wired here (the one menu P2 owns for tabs). P2 renders every
// tab kind (a `ddl` tab from P4 is a tab too) — the strip is kind-agnostic.

function connectionColor(tab: AnyTab): string {
  return connectionsState.records.find((r) => r.id === tab.connectionId)?.color ?? 'grey';
}

function tabIcon(tab: AnyTab): string {
  const node = decodePath(tab.connectionId, tab.path).segments.at(-1);
  return iconForKind(node?.kind ?? 'table');
}

const tabLabel = computed(() =>
  tabsState.tabs.map((t) => ({
    id: t.id,
    label: decodePath(t.connectionId, t.path).segments.at(-1)?.name ?? 'untitled',
  })),
);

function onTabClick(tab: AnyTab, event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey) {
    duplicate(tab.id);
    return;
  }
  activate(tab.id);
}

function onMiddleClick(tab: AnyTab, event: MouseEvent): void {
  if (event.button === 1) close(tab.id);
}

function onContextMenu(tab: AnyTab, event: MouseEvent): void {
  event.preventDefault();
  openContextMenu(event, [
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'close',
      run: () => close(tab.id),
    },
    {
      type: 'item',
      id: 'close-others',
      label: 'Close others',
      icon: 'empty-window',
      run: () => closeOthers(tab.id),
    },
    {
      type: 'item',
      id: 'close-right',
      label: 'Close to the right',
      icon: 'empty-window',
      run: () => closeToRight(tab.id),
    },
    {
      type: 'item',
      id: 'close-all',
      label: 'Close all',
      icon: 'close-all',
      run: () => {
        for (const t of [...tabsState.tabs]) close(t.id);
      },
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'duplicate',
      label: 'Duplicate tab',
      icon: 'files',
      run: () => duplicate(tab.id),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => {
        void navigator.clipboard.writeText(tabLabel.value.find((l) => l.id === tab.id)?.label ?? '');
      },
    },
  ]);
}

let dragId: string | null = null;

function onDragStart(tab: AnyTab): void {
  dragId = tab.id;
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
}

function onDrop(tab: AnyTab): void {
  if (dragId === null || dragId === tab.id) return;
  const from = tabsState.tabs.findIndex((t) => t.id === dragId);
  const to = tabsState.tabs.findIndex((t) => t.id === tab.id);
  if (from < 0 || to < 0) return;
  move(dragId, to);
  dragId = null;
}

function scrollActiveIntoView(el: HTMLElement | null, active: boolean): void {
  if (el && active) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
</script>

<template>
  <div class="tab-strip">
    <div class="tab-scroll">
      <div
        v-for="tab in tabsState.tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === tabsState.activeId }"
        :data-testid="`tab-${tab.id}`"
        :data-active="tab.id === tabsState.activeId"
        draggable="true"
        @click="onTabClick(tab, $event)"
        @contextmenu.prevent="onContextMenu(tab, $event)"
        @mousedown.middle.prevent="onMiddleClick(tab, $event)"
        @dragstart="onDragStart(tab)"
        @dragover="onDragOver"
        @drop="onDrop(tab)"
      >
        <span class="rail" :style="{ background: `var(--kira-conn-${connectionColor(tab)})` }" />
        <Codicon :name="tabIcon(tab)" :size="13" />
        <span class="label">{{ tabLabel.find((l) => l.id === tab.id)?.label }}</span>
        <button
          type="button"
          class="close"
          :aria-label="`Close ${tabLabel.find((l) => l.id === tab.id)?.label}`"
          @click.stop="close(tab.id)"
        >
          <Codicon name="close" :size="12" />
        </button>
      </div>
    </div>
    <template v-for="tab in tabsState.tabs" :key="`ref-${tab.id}`">
      <div v-show="false" :ref="(el) => scrollActiveIntoView(el as HTMLElement | null, tab.id === tabsState.activeId)" />
    </template>
  </div>
</template>

<style scoped>
.tab-strip {
  height: 100%;
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

.tab-scroll {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  scrollbar-width: none;
}

.tab-scroll::-webkit-scrollbar {
  display: none;
}

.tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 12px;
  min-width: 0;
  max-width: 220px;
  border-right: 1px solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.tab:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.tab.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.rail {
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 3px;
  border-radius: 2px;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--kira-fg-disabled);
  cursor: pointer;
  opacity: 0;
}

.tab:hover .close,
.tab.active .close {
  opacity: 1;
}

.close:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}
</style>
