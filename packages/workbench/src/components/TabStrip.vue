<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { useEventListener } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import { type TabLike, useWorkbenchHost } from '../host';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';
import { copyText } from '../util/clipboard';
import { wheelToHorizontal } from '../util/wheelScroll';

// P103 Part 2 (§5.4): Kira Studio's own workbench/panels/TabStrip.vue and Kira Space's, unified.
// The strip, drag-reorder, wheel-scroll, keyboard-scroll-into-view and the six generic
// context-menu items are exactly the two apps' shared skeleton (confirmed side by side); every
// per-app extra — Kira Studio's incognito eye glyph + agent-attention dot, Kira Space's seti file
// icons — arrives through the host's own `iconFor`/`tabIndicator`/`tabBadge`/`tabAttention` hooks
// (host.ts) instead of an app-local import. The trailing "+" new-tab affordance is real per-app
// divergence (Kira Studio: the Terminal module's own plain-session menu; Kira Space: one repo-root
// terminal, no menu) — not a lookup a host hook can express cleanly, so it stays a `#new-tab` slot,
// each app supplying its own button exactly as before.
const host = useWorkbenchHost();
const contextMenuStore = useContextMenuStore();

function isPinned(tab: TabLike): boolean {
  return host.kinds[tab.kind]?.pinned === true;
}

function titleFor(tab: TabLike): string {
  return host.kinds[tab.kind]?.title(tab) ?? '';
}

function badgeFor(tab: TabLike): { icon: string; tooltip: string } | null {
  return host.tabBadge?.(tab) ?? null;
}

function indicatorFor(tab: TabLike): { icon: string; tooltip: string } | null {
  return host.tabIndicator?.(tab) ?? null;
}

function isAttention(tab: TabLike): boolean {
  return host.tabAttention?.(tab) ?? false;
}

function onClick(tab: TabLike): void {
  host.tabs.activateTab(tab.id);
}

// §6.1: a pinned tab has no middle-click close.
function onMiddleClick(tab: TabLike): void {
  if (isPinned(tab)) return;
  host.tabs.closeTab(tab.id);
}

function onClose(e: MouseEvent, tab: TabLike): void {
  e.stopPropagation();
  host.tabs.closeTab(tab.id);
}

// §8.10's Tab row: Close · Close others · Close to the right · Close all · — · Duplicate tab ·
// Copy name · plus whatever the tab's own kind appends (D22), plus `extraTabMenu` (host.ts).
// §6.1: a pinned tab's own menu is reduced to just "Copy name".
function onContextMenu(e: MouseEvent, tab: TabLike): void {
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
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'close',
      // P21 D13: `tab.close` always closes the *active* tab, not the clicked one — printed anyway
      // (VS Code does the same on this exact row) since it's the keyboard route to this command.
      shortcut: 'tab.close',
      run: () => host.tabs.closeTab(tab.id),
    },
    {
      type: 'item',
      id: 'close-others',
      label: 'Close others',
      run: () => host.tabs.closeOthers(tab.id),
    },
    {
      type: 'item',
      id: 'close-to-the-right',
      label: 'Close to the right',
      run: () => host.tabs.closeToTheRight(tab.id),
    },
    {
      type: 'item',
      id: 'close-all',
      label: 'Close all',
      run: () => host.tabs.closeAll(host.activeWorkspace.value),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'duplicate-tab',
      label: 'Duplicate tab',
      icon: 'copy',
      run: () => void host.tabs.duplicateTab(tab.id),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(titleFor(tab)),
    },
    ...(host.kinds[tab.kind]?.menuExtras(tab) ?? []),
    ...(host.extraTabMenu?.(tab) ?? []),
  ];
  contextMenuStore.openContextMenu(e, items);
}

const tabs = computed(() => host.tabs.tabsForWorkspace(host.activeWorkspace.value));

// P72 §7: split out of `tabs` so the template can render the pinned tab in a fixed leading slot,
// outside `.tab-strip`'s own `overflow-x: auto` — it never scrolls away with everything else.
const pinnedTabs = computed(() =>
  tabs.value.filter((tab) => isPinned(tab)).map((tab) => ({ tab, icon: host.iconFor(tab) })),
);
const scrollingTabs = computed(() =>
  tabs.value.filter((tab) => !isPinned(tab)).map((tab) => ({ tab, icon: host.iconFor(tab) })),
);

// Selecting a tab from anywhere other than this strip itself previously left the strip's own
// scroll position untouched — the newly active tab could be selected yet scrolled out of view.
const activeTabId = computed(() => host.tabs.activeIdByWorkspace[host.activeWorkspace.value]);
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

// P31 D7/F9: this strip's own horizontal scrollbar is deliberately thin/subtle — without this, the
// strip is reachable only by trackpad.
function onWheel(e: WheelEvent): void {
  if (wheelToHorizontal(stripRef.value, e)) e.preventDefault();
}

// Drag-reorder: moveTab splices the underlying tabs array live as the dragged tab crosses another
// one's midpoint, so the strip itself needs no local copy. Tracks the dragged tab's id, not its
// index — this strip renders a filtered, per-workspace view.
const dragId = ref<string | null>(null);

// §6.1: a pinned tab is `draggable="false"` in the template, so it never starts a drag itself —
// this guard also covers moveTab's own early-return for a pinned *drop target*.
function onDragStart(id: string): void {
  dragId.value = id;
}
function onDragOver(id: string): void {
  const from = dragId.value;
  if (from === null || from === id) return;
  host.tabs.moveTab(from, id);
  // F6: `dragId` tracks the *dragged* tab throughout the whole gesture, never the hovered one --
  // reassigning it to `id` here (the old code) meant the next dragover moved whatever tab had just
  // been hovered, not the tab the user is actually dragging, and `is-dragging` (below, matched
  // against `dragId`) landed on the wrong chip.
}
function onDragEnd(): void {
  dragId.value = null;
}

// P105 §5.1: dragstart/dragover/dragend delegated off each tab chip onto the strip — a pointer-only
// gesture with no keyboard equivalent to wire up, same as every other container-level listener this
// phase moved. `.closest` recovers which chip the event actually landed on.
function tabIdFromEvent(e: Event): string | null {
  return (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-testid="tab"]')?.dataset
    .tabId ?? null;
}
function onDragStartFromEvent(e: DragEvent): void {
  const id = tabIdFromEvent(e);
  if (id !== null) onDragStart(id);
}
function onDragOverFromEvent(e: DragEvent): void {
  e.preventDefault();
  const id = tabIdFromEvent(e);
  if (id !== null) onDragOver(id);
}
useEventListener(stripRef, 'dragstart', onDragStartFromEvent);
useEventListener(stripRef, 'dragover', onDragOverFromEvent);
useEventListener(stripRef, 'dragend', onDragEnd);
</script>

<template>
  <!-- P91 §8: always one wrapper — the Terminal module's own normal initial state is zero tabs,
       which needs the "+" (below) just as much as a populated strip does. -->
  <div
    class="tab-strip-wrapper"
    :class="{ 'is-empty': tabs.length === 0 }"
    :data-testid="tabs.length > 0 ? 'tab-strip-wrapper' : 'tab-strip-empty'"
  >
    <!-- P72 §7: the pinned tab's own fixed leading slot — a sibling of `.tab-strip`, outside its
         `overflow-x: auto`, so it never scrolls away. Icon-only: the repo name moves to the
         tooltip/`aria-label` (`titleFor`), the chrome is one glyph. Never draggable (§6.1) and
         never has a close button, so neither is wired here at all rather than guarded per-tab. -->
    <div v-if="pinnedTabs.length > 0" class="tab-strip-pinned" data-testid="tab-strip-pinned">
      <Tooltip v-for="{ tab, icon } in pinnedTabs" :key="tab.id">
        <TooltipTrigger as-child>
          <button
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
            @click="onClick(tab)"
            @contextmenu.prevent="onContextMenu($event, tab)"
          >
            <CodiconIcon v-if="'codicon' in icon" :name="icon.codicon" :size="13" class="tab-icon" />
            <span v-else class="tab-icon tab-file-icon" :style="icon.fileStyle" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ titleFor(tab) }}</TooltipContent>
      </Tooltip>
      <span class="tab-strip-separator" aria-hidden="true"></span>
    </div>
    <div ref="stripRef" class="tab-strip" data-testid="tab-strip-row" @wheel="onWheel">
      <!-- P105 §11: a focusable close control nested inside the tab's own <button> is invalid
           HTML and unreachable by keyboard — the close button is this tab's sibling now, not its
           child. `draggable`/drag* stay on this wrapper (the whole chip is the drag handle);
           click/dblclick/auxclick/contextmenu move onto `.tab-main`. -->
      <div
        v-for="{ tab, icon } in scrollingTabs"
        :key="tab.id"
        class="p-tab"
        :class="{
          'is-active': tab.active,
          'is-dragging': dragId === tab.id,
          'is-preview': host.tabs.isPreview(tab.id),
          'is-attention': isAttention(tab),
        }"
        data-testid="tab"
        :data-tab-id="tab.id"
        :data-tab-kind="tab.kind"
        :data-active="tab.active"
        :data-preview="host.tabs.isPreview(tab.id)"
        data-pinned="false"
        :data-color="host.railColorFor(tab)"
        :style="{ '--kira-rail': connColorVar(host.railColorFor(tab)) }"
        draggable="true"
      >
        <span class="p-tab-rail" />
        <button
          type="button"
          class="tab-main"
          @click="onClick(tab)"
          @dblclick="host.tabs.promoteTab(tab.id)"
          @auxclick.middle="onMiddleClick(tab)"
          @contextmenu.prevent="onContextMenu($event, tab)"
        >
          <CodiconIcon v-if="'codicon' in icon" :name="icon.codicon" :size="13" class="tab-icon" />
          <span v-else class="tab-icon tab-file-icon" :style="icon.fileStyle" aria-hidden="true" />
          <Tooltip v-if="indicatorFor(tab)">
            <TooltipTrigger as-child>
              <CodiconIcon :name="indicatorFor(tab)!.icon" :size="12" class="tab-incognito" />
            </TooltipTrigger>
            <TooltipContent>{{ indicatorFor(tab)!.tooltip }}</TooltipContent>
          </Tooltip>
          <span class="tab-title">{{ titleFor(tab) }}</span>
          <Tooltip v-if="badgeFor(tab)">
            <TooltipTrigger as-child>
              <CodiconIcon :name="badgeFor(tab)!.icon" :size="12" class="tab-badge" data-testid="tab-badge" />
            </TooltipTrigger>
            <TooltipContent>{{ badgeFor(tab)!.tooltip }}</TooltipContent>
          </Tooltip>
        </button>
        <button
          type="button"
          class="tab-close"
          aria-label="Close tab"
          data-testid="tab-close"
          @click="onClose($event, tab)"
        >
          <CodiconIcon name="close" :size="13" />
        </button>
      </div>
    </div>
    <!-- P83 §9.1/P91 §8: a third fixed child, after `.tab-strip`, mirroring `.tab-strip-pinned`'s
         own leading-edge fix at the other end. Per-app "new tab" affordance — the whole
         `.tab-strip-actions`/`data-testid="tab-strip-actions"` wrapper is slot content (not a
         wrapper this component owns), so each app keeps its own `v-if="showNewTab"` gating the
         element's very presence in the DOM, exactly as before (`.tab-strip-actions`/`.tab-new`
         publish from `workbench.css`, the same "class published, markup stays in the app" shape
         `.title-action` uses). -->
    <slot name="new-tab" />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P72 §7: the actual flex row — `.tab-strip-pinned` (fixed) and `.tab-strip` (scrolling) are its
   two children, so the pinned tab sits outside the latter's own `overflow-x` entirely instead of
   scrolling away with it. */
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

/* The visible "and after it the tab bar begins" boundary. */
.tab-strip-separator {
  @apply self-stretch shrink-0;
  width: var(--kira-border-width);
  margin: 4px 2px 4px 0;
  background: var(--kira-border);
}

.tab-strip {
  /* Scrolls with too many tabs open, but the track itself stays hidden — reachable by wheel
     (onWheel above), trackpad, or drag either way, with no visible scrollbar chrome. */
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

/* P105 §11: the tab's own click/select surface, a plain sibling <button> now rather than the
   whole chip — unstyled beyond filling the space .p-tab's own padding/gap leaves it. */
.tab-main {
  @apply flex flex-1 min-w-0 items-center gap-1 border-0 bg-transparent p-0 cursor-pointer;
}

.tab-icon {
  @apply shrink-0;
}

/* RepoTreeRow.vue's own .node-icon, ported for the identical `{ filePath }` marker — a repo-file
   tab's own seti icon, not a codicon glyph. */
.tab-file-icon {
  @apply w-3.5 h-3.5 text-muted-foreground;
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

/* C5 §5.1: the preview-tab affordance — VS Code's own convention for "opened, not yet promoted". */
.p-tab.is-preview .tab-title {
  @apply italic;
}

/* P86 §14.2: a Claude Code session waiting on you, in a tab that is not the active one. */
.p-tab.is-attention {
  @apply relative;
}
.p-tab.is-attention::after {
  @apply absolute top-1 right-1 w-1.5 h-1.5 rounded-full;
  content: '';
  background: var(--kira-state-on);
}

.tab-badge {
  @apply shrink-0;
  color: var(--kira-fg-muted);
}

/* P71 §5.1: mirrors .tab-badge's own colour — a small, unobtrusive mark, not a warning. */
.tab-incognito {
  @apply shrink-0;
  color: var(--kira-fg-muted);
}

.tab-close {
  @apply shrink-0 flex items-center justify-center w-4 h-4 cursor-pointer border-0 bg-transparent p-0 opacity-0 rounded-kira-sm;
}

.p-tab:hover .tab-close,
.p-tab.is-active .tab-close {
  @apply opacity-100;
}

.tab-close:hover {
  background: var(--kira-hover);
}
</style>
