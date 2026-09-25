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
// outside the scrolling tab row's own `overflow-x: auto` — it never scrolls away with everything
// else.
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
    class="h-full flex items-center min-w-0"
    :class="{ 'px-1': tabs.length === 0 }"
    :data-testid="tabs.length > 0 ? 'tab-strip-wrapper' : 'tab-strip-empty'"
  >
    <!-- P72 §7: the pinned tab's own fixed leading slot — a sibling of the scrolling tab row,
         outside its `overflow-x: auto`, so it never scrolls away. Icon-only: the repo name moves to the
         tooltip/`aria-label` (`titleFor`), the chrome is one glyph. Never draggable (§6.1) and
         never has a close button, so neither is wired here at all rather than guarded per-tab. -->
    <div
      v-if="pinnedTabs.length > 0"
      class="h-full flex items-center gap-0.5 shrink-0 pt-0.5 pl-1"
      data-testid="tab-strip-pinned"
    >
      <Tooltip v-for="{ tab, icon } in pinnedTabs" :key="tab.id">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="h-control-lg inline-flex items-center gap-1 px-1 rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-sm tab-chip"
            :class="[
              tab.active ? 'bg-elevated border-border-strong text-fg' : 'border-transparent text-muted-foreground',
              { 'is-active': tab.active },
            ]"
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
            <CodiconIcon v-if="'codicon' in icon" :name="icon.codicon" :size="13" class="shrink-0" />
            <span
              v-else
              class="shrink-0 tab-file-icon w-3.5 h-3.5 text-muted-foreground mask-contain mask-no-repeat mask-center"
              :style="icon.fileStyle"
              aria-hidden="true"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ titleFor(tab) }}</TooltipContent>
      </Tooltip>
      <span class="self-stretch shrink-0 w-px my-1 mr-0.5 bg-border" aria-hidden="true"></span>
    </div>
    <div
      ref="stripRef"
      class="h-full flex items-center gap-0.5 overflow-x-auto overflow-y-hidden min-w-0 scrollbar-none pt-0.5 px-1"
      data-testid="tab-strip-row"
      @wheel="onWheel"
    >
      <!-- P105 §11: a focusable close control nested inside the tab's own <button> is invalid
           HTML and unreachable by keyboard — the close button is this tab's sibling now, not its
           child. `draggable`/drag* stay on this wrapper (the whole chip is the drag handle);
           click/dblclick/auxclick/contextmenu move onto the tab's own inner button. -->
      <div
        v-for="{ tab, icon } in scrollingTabs"
        :key="tab.id"
        class="h-control-lg inline-flex items-center gap-1 px-1.5 rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-sm tab-chip"
        :class="[
          tab.active ? 'bg-elevated border-border-strong text-fg' : 'border-transparent text-muted-foreground',
          {
            'is-active': tab.active,
            'opacity-50': dragId === tab.id,
            'is-attention': isAttention(tab),
          },
        ]"
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
        <span class="w-0.5 h-3.5 rounded-xs shrink-0 bg-(--kira-rail)" />
        <button
          type="button"
          class="flex flex-1 min-w-0 items-center gap-1 border-0 bg-transparent p-0 cursor-pointer"
          @click="onClick(tab)"
          @dblclick="host.tabs.promoteTab(tab.id)"
          @auxclick.middle="onMiddleClick(tab)"
          @contextmenu.prevent="onContextMenu($event, tab)"
        >
          <CodiconIcon v-if="'codicon' in icon" :name="icon.codicon" :size="13" class="shrink-0" />
          <span
            v-else
            class="shrink-0 tab-file-icon w-3.5 h-3.5 text-muted-foreground mask-contain mask-no-repeat mask-center"
            :style="icon.fileStyle"
            aria-hidden="true"
          />
          <Tooltip v-if="indicatorFor(tab)">
            <TooltipTrigger as-child>
              <CodiconIcon :name="indicatorFor(tab)!.icon" :size="12" class="shrink-0 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>{{ indicatorFor(tab)!.tooltip }}</TooltipContent>
          </Tooltip>
          <span class="tab-title truncate min-w-0" :class="{ italic: host.tabs.isPreview(tab.id) }">{{
            titleFor(tab)
          }}</span>
          <Tooltip v-if="badgeFor(tab)">
            <TooltipTrigger as-child>
              <CodiconIcon
                :name="badgeFor(tab)!.icon"
                :size="12"
                class="shrink-0 text-muted-foreground"
                data-testid="tab-badge"
              />
            </TooltipTrigger>
            <TooltipContent>{{ badgeFor(tab)!.tooltip }}</TooltipContent>
          </Tooltip>
        </button>
        <button
          type="button"
          class="tab-close shrink-0 flex items-center justify-center w-4 h-4 cursor-pointer border-0 bg-transparent p-0 rounded-kira-sm"
          aria-label="Close tab"
          data-testid="tab-close"
          @click="onClose($event, tab)"
        >
          <CodiconIcon name="close" :size="13" />
        </button>
      </div>
    </div>
    <!-- P83 §9.1/P91 §8: a third fixed child, after the scrolling tab row, mirroring the pinned
         tab's own leading-edge fix at the other end. Per-app "new tab" affordance — the whole
         `data-testid="tab-strip-actions"` wrapper is slot content (not a wrapper this component
         owns), so each app keeps its own `v-if="showNewTab"` gating the element's very presence in
         the DOM. P110 B13: the wrapper and button are now plain Tailwind utility classes inlined in
         each app's own WorkbenchShell.vue, not a tab strip actions/tab new class published
         from workbench.css — the data-testid is what's shared now. -->
    <slot name="new-tab" />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P110 B36: only what a static utility class genuinely can't express stays here. Everything else
   (layout/spacing/colour, including .tab-file-icon's own mask-size/mask-repeat/mask-position —
   Tailwind's own mask-contain/mask-no-repeat/mask-center, confirmed via compile check to emit both
   the -webkit- prefixed and unprefixed forms) moved onto the template as inline utility classes —
   see this file's own git history for the byte-for-byte mapping. What's left, and why:
   - `.tab-chip:hover:not(.is-active)` / `.tab-close:hover` / the hover half of the close button's
     opacity toggle: real `:hover` on one element driving another (or itself) — no static class can
     stand in for a live pointer state.
   - `.tab-chip.is-attention::after`: a generated pseudo-element (dot badge) — nothing in the DOM to
     hang a utility class on.
   `.tab-chip`/`.is-active`/`.is-attention`/`.tab-close`/`.tab-file-icon`/`.tab-title` stay as bare
   marker classes to anchor the selectors below; `.is-active`/`.tab-file-icon`/`.tab-title`/
   `.tab-close` are also real test dependencies (slick-grid.spec.ts, budgets.spec.ts,
   repo-workspace.spec.ts, font-roles.spec.ts, multiwindow-real.spec.ts, definition.spec.ts). */
/* P110 B37: raw background: var(--kira-hover)/var(--kira-state-on) and opacity: 0/1 declarations
   below all convert to @apply in place (same selectors, same cascade position) -- content: ''
   becomes content-[''], section 1.2's own allowlist entry for this exact attention-dot pseudo-
   element. */
.tab-chip:hover:not(.is-active) {
  @apply bg-hover;
}

/* P86 §14.2: a Claude Code session waiting on you, in a tab that is not the active one. */
.tab-chip.is-attention {
  @apply relative;
}
.tab-chip.is-attention::after {
  @apply absolute top-1 right-1 w-1.5 h-1.5 rounded-full content-[''] bg-state-on;
}

.tab-close {
  @apply opacity-0;
}
.tab-chip:hover .tab-close,
.tab-chip.is-active .tab-close {
  @apply opacity-100;
}
.tab-close:hover {
  @apply bg-hover;
}
</style>
