<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { tabTitle } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, nextTick, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { revealPath } from '../../project/state/tree';
import { connectionRecord } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import {
  activateTab,
  closeAll,
  closeOthers,
  closeTab,
  closeToTheRight,
  duplicateTab,
  tabsState,
} from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';

function colorFor(tab: TabRecord): string | undefined {
  return connectionRecord(tab.connectionId)?.color;
}

function iconFor(tab: TabRecord): string {
  if (tab.kind === 'definition') return 'file-code';
  if (tab.kind === 'console') return 'terminal';
  if (tab.kind === 'document') return 'json';
  // P17: a 'keyvalue' tab is a redis key OR an s3 object — pathTail's own node kind (already
  // computed below for the table/view/matview fallback) tells them apart with no extra state.
  if (tab.kind === 'keyvalue') return pathTail(tab.path)?.kind === 'object' ? 'file' : 'symbol-key';
  if (tab.kind === 'stream') return 'broadcast';
  if (tab.kind === 'browse') return 'list-tree';
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
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'close',
      // P21 D13: `tab.close` always closes the *active* tab, not the clicked one — printed anyway
      // (VS Code does the same on this exact row) since it's the keyboard route to this command.
      shortcut: 'tab.close',
      run: () => closeTab(tab.id),
    },
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

// Selecting a tab from anywhere other than this strip itself (a tree double-click, Cmd/Ctrl+click
// nav, session restore) previously left the strip's own scroll position untouched — the newly
// active tab could be selected yet scrolled out of view, with nothing on screen indicating a
// selection had even happened until the user scrolled the strip by hand to go find it.
const activeTabId = computed(() => tabsState.tabs.find((t) => t.active)?.id ?? null);
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

// P31 D7/F9: a plain mouse produces only a vertical wheel axis (deltaY), and this strip's own
// horizontal scrollbar is deliberately thin/subtle — without this, the strip is reachable only by
// trackpad. A no-op once the strip doesn't overflow, so it never fights ordinary page scroll.
function onWheel(e: WheelEvent): void {
  const el = stripRef.value;
  if (!el || e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return;
  el.scrollLeft += e.deltaY;
  e.preventDefault();
}
</script>

<template>
  <div
    v-if="tabs.length > 0"
    ref="stripRef"
    class="tab-strip"
    data-testid="tab-strip-row"
    @wheel="onWheel"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="p-tab"
      :class="{ 'is-active': tab.active }"
      data-testid="tab"
      :data-tab-id="tab.id"
      :data-tab-kind="tab.kind"
      :data-active="tab.active"
      :data-color="colorFor(tab)"
      :style="{ '--kira-rail': connColorVar(colorFor(tab)) }"
      @click="onClick(tab)"
      @auxclick.middle="onMiddleClick(tab)"
      @contextmenu.prevent="onContextMenu($event, tab)"
    >
      <span class="p-tab-rail" />
      <CodiconIcon :name="iconFor(tab)" :size="13" class="tab-icon" />
      <span class="tab-title">{{ tabTitle(tab) }}</span>
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
  <!-- Empty.html: with no tab open the strip is not hidden — it keeps its height so the layout
       does not jump the moment the first tab appears, but shows no label or action of its own
       (MainView's own empty state already covers "what do I do now"). -->
  <div v-else class="tab-strip is-empty" data-testid="tab-strip-empty"></div>
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
  /* Scrolls with too many tabs open, but the track itself stays hidden — reachable by wheel
     (onWheel above), trackpad, or drag either way, with no visible scrollbar chrome. */
  scrollbar-width: none;
}

.tab-strip::-webkit-scrollbar {
  display: none;
}

/* P24 D32: .tab used to re-declare .p-tab's own rules (primitives.css) by hand, 1px and 10px off
   on type size and max-width respectively — the class is now .p-tab itself, and only what this
   strip genuinely adds (the icon/title/close layout, the close button's hover reveal) stays here. */
.p-tab:hover:not(.is-active) {
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

.p-tab:hover .tab-close,
.p-tab.is-active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--kira-hover);
}

.tab-strip.is-empty {
  padding: 0 var(--kira-s-2);
}
</style>
