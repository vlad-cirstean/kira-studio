<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { computed, nextTick, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { openContextMenu } from '../../state/contextMenu';
import { modeState, tabsForMode } from '../../state/mode';
import { TAB_KINDS } from '../../state/tabKinds';
import {
  activateTab,
  closeAll,
  closeOthers,
  closeTab,
  closeToTheRight,
  duplicateTab,
  moveTab,
  tabsState,
} from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';
import { wheelToHorizontal } from '../../wheelScroll';

// P1 D4/C4: title/icon/rail all read the tab-kind registry now — TabStrip.vue no longer knows
// what a 'data' tab's icon is, or that a tab's colour comes from its connection.
function colorFor(tab: TabRecord): string | undefined {
  return TAB_KINDS[tab.kind].railColor(tab);
}

function iconFor(tab: TabRecord): string {
  return TAB_KINDS[tab.kind].icon(tab);
}

function titleFor(tab: TabRecord): string {
  return TAB_KINDS[tab.kind].title(tab);
}

// P15 D8: undefined for a kind with no badge() member at all (most kinds); null for a kind that
// has one but has nothing to flag on this particular tab.
function badgeFor(tab: TabRecord): { icon: string; tooltip: string } | null | undefined {
  return TAB_KINDS[tab.kind].badge?.(tab);
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
// Copy name · plus whatever the tab's own kind appends (D22) — Studio's kinds all append
// "Reveal in project panel" (F11); an Api tab kind supplies its own menuExtras, or none.
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
      run: () => void duplicateTab(tab.id),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(titleFor(tab)),
    },
    ...TAB_KINDS[tab.kind].menuExtras(tab),
  ]);
}

// P1 D5: this mode's own tabs only — an Api tab is never rendered in Studio's strip, or vice
// versa (§6.2's "the empty tab-strip state" is this filter returning nothing for a mode with no
// tab kinds registered yet).
const tabs = computed(() => tabsForMode(modeState.active));

// Selecting a tab from anywhere other than this strip itself (a tree double-click, Cmd/Ctrl+click
// nav, session restore) previously left the strip's own scroll position untouched — the newly
// active tab could be selected yet scrolled out of view, with nothing on screen indicating a
// selection had even happened until the user scrolled the strip by hand to go find it.
const activeTabId = computed(() => tabsState.activeIdByMode[modeState.active]);
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

// P31 D7/F9, hoisted to wheelScroll.ts P42 D7 (views/console/'s own result strip needs the same
// eight lines and may not import workbench/): this strip's own horizontal scrollbar is
// deliberately thin/subtle — without this, the strip is reachable only by trackpad.
function onWheel(e: WheelEvent): void {
  if (wheelToHorizontal(stripRef.value, e)) e.preventDefault();
}

// Drag-reorder (same shape as ColumnsMenu.vue's column drag): moveTab splices tabsState.tabs
// live as the dragged tab crosses another one's midpoint, so the strip itself needs no local
// copy. Tracks the dragged tab's id (P1 F15), not its index — this strip renders a filtered,
// per-mode view of tabsState.tabs, so an index into it no longer addresses the same element in
// the underlying array moveTab splices.
const dragId = ref<string | null>(null);

function onDragStart(id: string): void {
  dragId.value = id;
}
function onDragOver(id: string): void {
  const from = dragId.value;
  if (from === null || from === id) return;
  moveTab(from, id);
  dragId.value = id;
}
function onDragEnd(): void {
  dragId.value = null;
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
      :class="{ 'is-active': tab.active, 'is-dragging': dragId === tab.id }"
      data-testid="tab"
      :data-tab-id="tab.id"
      :data-tab-kind="tab.kind"
      :data-active="tab.active"
      :data-color="colorFor(tab)"
      :style="{ '--kira-rail': connColorVar(colorFor(tab)) }"
      draggable="true"
      @click="onClick(tab)"
      @auxclick.middle="onMiddleClick(tab)"
      @contextmenu.prevent="onContextMenu($event, tab)"
      @dragstart="onDragStart(tab.id)"
      @dragover.prevent="onDragOver(tab.id)"
      @dragend="onDragEnd"
    >
      <span class="p-tab-rail" />
      <CodiconIcon :name="iconFor(tab)" :size="13" class="tab-icon" />
      <span class="tab-title">{{ titleFor(tab) }}</span>
      <CodiconIcon
        v-if="badgeFor(tab)"
        :name="badgeFor(tab)!.icon"
        :size="12"
        class="tab-badge"
        v-tooltip="badgeFor(tab)!.tooltip"
        data-testid="tab-badge"
      />
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

.p-tab.is-dragging {
  opacity: 0.5;
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

.tab-badge {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
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
