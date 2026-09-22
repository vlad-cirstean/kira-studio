<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { connColorVar } from '@theme/connColor';
import { useEventListener, useTimeoutFn } from '@vueuse/core';
import { type ComponentPublicInstance, computed, nextTick, ref, watch } from 'vue';
import { formatShortcut } from '../shortcuts/keys';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';
import { computeFloatPosition, pointReference } from '../theme/floatingPosition';
import { CONTEXT_MENU_KEY_HANDLERS, type ContextMenuKeyContext } from './contextMenuKeys';

// P99 Part 2 §6.3 hard case: stays hand-rolled, DropdownMenuRoot/ContextMenuRoot both declined.
// (1) This is one shared singleton menu opened imperatively from useContextMenuStore() by many
// unrelated call sites (tree rows, grid rows, tabs, ...), each handing it a fully custom
// MenuItem[] tree (swatch/checked/danger/shortcut/hint) — reka-ui's DropdownMenuItem has no prop
// for any of that, so every row still needs custom slot content; reka-ui buys nothing on render.
// (2) reka-ui's trigger/content model assumes one owning trigger per menu; this menu's anchor is
// an arbitrary (x, y) captured once into the store. A zero-size virtual anchor could stand in for
// that, but reka-ui's own Sub/SubContent state model still expects a declarative trigger/content
// pair per submenu, while this submenu is one dynamically-toggled row inside a v-for — re-deriving
// reka-ui's internal open state to match the already-tuned activeIndex/activeSubIndex roving focus,
// hover-delay-open and Escape/blur-close (contextMenuKeys.ts, P43/P94) is a rewrite of tested
// keyboard semantics, not a swap, and risks exactly the behavior regression §9.4 forbids.
// (3) Positioning already goes through this app's own floatingPosition.ts, shared with
// PopoverPanel/ErrorPopover; forking just this menu onto reka-ui's internal Floating UI wiring
// would split one shared positioning implementation across components not otherwise in scope here.
// What DID move: the document/window listeners to useEventListener, the submenu-open timer to
// useTimeoutFn (below) — VueUse's actual equivalents for this file's own event/timer machinery.
const contextMenuStore = useContextMenuStore();

const SUBMENU_OPEN_DELAY_MS = 150;

const menuRef = ref<HTMLElement | null>(null);
const submenuRef = ref<HTMLElement | null>(null);
const openSubmenuId = ref<string | null>(null);
const style = ref({ left: '0px', top: '0px' });
const submenuStyle = ref({ left: '0px', top: '0px' });

// VueUse's useTimeoutFn auto-clears on unmount (tryOnScopeDispose) — no manual onUnmounted
// cleanup needed. pendingItem/submenuDelayMs are set right before start() so the callback (which
// reads .value, not a closure argument) always sees the row onRowEnter was just called for.
const pendingItem = ref<MenuItem | null>(null);
const submenuDelayMs = ref(0);
const { start: startSubmenuTimer, stop: clearSubmenuTimer } = useTimeoutFn(
  () => {
    openSubmenuId.value = pendingItem.value?.type === 'submenu' ? pendingItem.value.id : null;
  },
  submenuDelayMs,
  { immediate: false },
);

// A plain `ref="submenuRef"` on this element would silently do the wrong thing: it sits inside
// this template's own `v-for="item in contextMenuStore.items"`, and Vue collects any `ref` bound
// inside a `v-for` scope into an array — regardless of the inner `v-if` ever mounting at most one
// of them — so `submenuRef.value` would be `[HTMLDivElement]`, not the element, and every DOM
// read below it (`.parentElement` included) would silently return `undefined`. A function ref
// sidesteps the array-collection rule entirely: Vue calls it directly with the element (or `null`
// on unmount) instead of pushing into a list.
function setSubmenuRef(el: Element | ComponentPublicInstance | null): void {
  submenuRef.value = el as HTMLElement | null;
}

// P43 iter3 D43/D44/F32: roving keyboard focus. `activeIndex` is -1 until the first arrow key, so
// a menu opened by mouse looks exactly as it does today until the keyboard is used.
// `navigable`/`navigableSub` skip separators and disabled rows rather than landing on them and
// refusing — the same thing the rows already do to the mouse (onItemClick's own disabled guard,
// below). `activeSubIndex` is a second index rather than folding the open submenu's rows into
// `navigable` itself: ArrowDown/Up always act on exactly one level (whichever the user is
// currently in), and Left/Right are what move between the two levels — merging them would make
// ArrowDown occasionally jump out of an open submenu into an unrelated top-level row.
const activeIndex = ref(-1);
const activeSubIndex = ref(-1);

/** Every row a keyboard can land on at the top level, in render order: enabled `item`s and every
 *  `submenu` trigger. */
const navigable = computed(() =>
  contextMenuStore.items.filter(
    (item) => item.type === 'submenu' || (item.type === 'item' && !item.disabled),
  ),
);

/** The open submenu's own navigable rows — empty when none is open. */
const navigableSub = computed(() => {
  const trigger = navigable.value.find(
    (item) => item.type === 'submenu' && item.id === openSubmenuId.value,
  );
  if (trigger?.type !== 'submenu') return [];
  return trigger.items.filter((sub) => sub.type === 'item' && !sub.disabled);
});

const activeTopItem = computed(() =>
  activeSubIndex.value < 0 ? (navigable.value[activeIndex.value] ?? null) : null,
);
const activeSubItem = computed(() =>
  activeSubIndex.value >= 0 ? (navigableSub.value[activeSubIndex.value] ?? null) : null,
);

// P23: anchored to the mouse click point, not an element (theme/floatingPosition.ts's own
// pointReference) — flip is off because a point has no "other side" to flip to, only the
// viewport edges shift() already keeps it clear of. This menu only opens briefly (a click,
// choose, close), so — unlike the submenu below and PopoverPanel/ErrorPopover — it does not
// track the window resizing while it's open, matching this component's own pre-existing
// behaviour (there was never a resize listener here).
async function position(): Promise<void> {
  await nextTick();
  const el = menuRef.value;
  if (!el) return;
  const { left, top } = await computeFloatPosition(
    pointReference(contextMenuStore.x, contextMenuStore.y),
    el,
    { offset: 0, flip: false },
  );
  style.value = { left: `${left}px`, top: `${top}px` };
}

// P23: the submenu used to be pure CSS (`left: 100%; top: -4px`, this file's own style block) —
// no flip and no clamp at all, so a submenu near the right or bottom edge of the window rendered
// partly or wholly offscreen (e.g. the row context menu's Color submenu, or the grid row menu's
// Copy row(s) submenu). `right-start` is the CSS's own placement restated in floating-ui terms;
// `crossAxis: -4` is the CSS's `top: -4px`; flip (default on) is what actually fixes the bug —
// falling back to `left-start` when the right edge has no room and the left side has more.
async function positionSubmenu(): Promise<void> {
  await nextTick();
  const el = submenuRef.value;
  const trigger = el?.parentElement;
  if (!el || !trigger) return;
  const { left, top } = await computeFloatPosition(trigger, el, {
    placement: 'right-start',
    offset: { mainAxis: 0, crossAxis: -4 },
  });
  submenuStyle.value = { left: `${left}px`, top: `${top}px` };
}

watch(
  () => contextMenuStore.open,
  (open) => {
    if (!open) return;
    openSubmenuId.value = null;
    activeIndex.value = -1;
    activeSubIndex.value = -1;
    void position();
  },
);

watch(openSubmenuId, (id) => {
  if (id) void positionSubmenu();
});

function onDocMouseDown(e: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) contextMenuStore.closeContextMenu();
}

// P94 pass 3 §4.3: the handler table itself (contextMenuKeys.ts) owns every branch's body;
// onKeydown stays the Escape guard, the open guard and the lookup. `keyCtx` carries the SFC's own
// refs/computed refs directly (never a snapshot), since a handler must re-read `.value` at the
// exact point the inline code did (contextMenuKeys.ts's own header comment).
const keyCtx: ContextMenuKeyContext = {
  activeIndex,
  activeSubIndex,
  openSubmenuId,
  navigable,
  navigableSub,
  activeTopItem,
  activeSubItem,
  clearSubmenuTimer,
  onItemClick,
};

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    contextMenuStore.closeContextMenu();
    return;
  }
  if (!contextMenuStore.open) return;
  const handler = CONTEXT_MENU_KEY_HANDLERS[e.key];
  if (!handler) return;
  e.preventDefault();
  handler(keyCtx);
}

useEventListener(document, 'mousedown', onDocMouseDown, true);
useEventListener(document, 'keydown', onKeydown);
useEventListener(window, 'blur', () => contextMenuStore.closeContextMenu());

function onRowEnter(item: MenuItem): void {
  // D43: hovering a row syncs activeIndex so the mouse and the keyboard never disagree about
  // which row is live — indexOf is -1 for a disabled row (not in `navigable`), which correctly
  // leaves nothing active, matching what Enter would do there anyway (nothing).
  activeIndex.value = navigable.value.indexOf(item);
  activeSubIndex.value = -1;
  pendingItem.value = item;
  submenuDelayMs.value = item.type === 'submenu' ? SUBMENU_OPEN_DELAY_MS : 0;
  startSubmenuTimer();
}

function onSubRowEnter(sub: MenuItem): void {
  activeSubIndex.value =
    sub.type === 'item' && !sub.disabled ? navigableSub.value.indexOf(sub) : -1;
}

async function onItemClick(item: MenuItem): Promise<void> {
  if (item.type !== 'item' || item.disabled) return;
  contextMenuStore.closeContextMenu();
  await item.run();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="contextMenuStore.open"
      ref="menuRef"
      class="context-menu p-float"
      data-testid="context-menu"
      :style="style"
    >
      <template v-for="(item, idx) in contextMenuStore.items" :key="item.type === 'separator' ? `sep-${idx}` : item.id">
        <div v-if="item.type === 'separator'" class="p-sep" />

        <div
          v-else-if="item.type === 'item'"
          class="p-row row"
          :class="{ 'is-disabled': item.disabled, danger: item.danger, 'is-active': activeTopItem === item }"
          :data-testid="`menu-item-${item.id}`"
          v-tooltip="item.hint"
          @mouseenter="onRowEnter(item)"
          @click="onItemClick(item)"
        >
          <span class="icon-box">
            <span
              v-if="item.swatch"
              class="swatch"
              :class="{ none: item.swatch === 'none' }"
              :style="{ background: connColorVar(item.swatch) }"
            />
            <CodiconIcon v-else-if="item.icon" :name="item.icon" :size="13" class="item-icon" />
          </span>
          <span class="label">{{ item.label }}</span>
          <span
            v-if="item.shortcut"
            class="shortcut"
            :data-testid="`menu-item-${item.id}-shortcut`"
            >{{ formatShortcut(item.shortcut) }}</span
          >
          <span v-if="item.checked" class="icon-box"><CodiconIcon name="check" :size="13" /></span>
        </div>

        <div
          v-else
          class="p-row row submenu-trigger"
          :class="{ 'is-active': activeTopItem === item }"
          :data-testid="`menu-item-${item.id}`"
          @mouseenter="onRowEnter(item)"
        >
          <span class="icon-box">
            <CodiconIcon v-if="item.icon" :name="item.icon" :size="13" class="item-icon" />
          </span>
          <span class="label">{{ item.label }}</span>
          <span class="icon-box"><CodiconIcon name="chevron-right" :size="13" class="caret" /></span>

          <div
            v-if="openSubmenuId === item.id"
            :ref="setSubmenuRef"
            class="submenu p-float"
            data-testid="context-submenu"
            :style="submenuStyle"
          >
            <template v-for="(sub, subIdx) in item.items" :key="sub.type === 'separator' ? `sep-${subIdx}` : sub.id">
              <div v-if="sub.type === 'separator'" class="p-sep" />
              <div
                v-else
                class="p-row row"
                :class="{ 'is-disabled': sub.type === 'item' && sub.disabled, 'is-active': activeSubItem === sub }"
                :data-testid="`menu-item-${sub.id}`"
                @mouseenter="onSubRowEnter(sub)"
                @click="sub.type === 'item' && onItemClick(sub)"
              >
                <span class="icon-box">
                  <span
                    v-if="sub.type === 'item' && sub.swatch"
                    class="swatch"
                    :class="{ none: sub.swatch === 'none' }"
                    :style="{ background: connColorVar(sub.swatch) }"
                  />
                  <CodiconIcon v-else-if="sub.icon" :name="sub.icon" :size="13" class="item-icon" />
                </span>
                <span class="label">{{ sub.label }}</span>
                <span
                  v-if="sub.type === 'item' && sub.shortcut"
                  class="shortcut"
                  :data-testid="`menu-item-${sub.id}-shortcut`"
                  >{{ formatShortcut(sub.shortcut) }}</span
                >
                <span v-if="sub.type === 'item' && sub.checked" class="icon-box">
                  <CodiconIcon name="check" :size="13" />
                </span>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "@theme/base.css";

/* P16 design system: every floating surface is the same primitive (Menus.html) — .p-float
   supplies bg-elevated / border-strong / radius / shadow, overflow: hidden included. P23: the
   submenu below used to be an absolutely-positioned child (`left: 100%`) that had to escape this
   element's own box, which is what the `overflow: visible` override here used to be for; now
   that the submenu is its own `position: fixed` floating surface (theme/floatingPosition.ts),
   it no longer nests inside this box at all, so this menu keeps .p-float's default clipping like
   every other floating surface in the app. */
.context-menu {
  @apply fixed overflow-y-auto flex flex-col;
  /* P28 D17(a): computeFloatPosition's size() middleware writes these; a menu that fits is
     unaffected, one taller than the viewport scrolls instead of having its lower rows clipped away
     by .p-float's own overflow: hidden. */
  max-height: var(--kira-float-max-h, none);
  max-width: var(--kira-float-max-w, none);
  min-width: 180px;
  padding: var(--kira-s-2);
  gap: 1px;
  z-index: var(--kira-z-menu);
}

/* Rows share the tree/operations-list row primitive (P8) so a menu row and a
   tree row highlight identically. */
.row {
  @apply relative whitespace-nowrap;
}

.row.is-disabled {
  @apply cursor-default;
  color: var(--kira-fg-disabled);
}

/* P43 iter3 D43: the roving keyboard focus target — the same background primitives.css's own
   .p-row:hover/.is-hover already give a real mouse hover, so an active row and a hovered row read
   as the same state to the user, not a second visual vocabulary. */
.row.is-active {
  background: var(--kira-hover);
}

.row.is-disabled:hover {
  @apply bg-transparent;
}

.row.danger {
  color: var(--kira-error);
}

.item-icon {
  color: var(--kira-fg-muted);
}

.swatch {
  @apply w-2.5 h-2.5 rounded-full shrink-0;
}

.swatch.none {
  border: 1.5px solid var(--kira-fg-disabled);
}

.label {
  @apply flex-1 overflow-hidden text-ellipsis;
}

.shortcut {
  @apply shrink-0 whitespace-nowrap;
  margin-left: var(--kira-s-4);
  color: var(--kira-fg-muted);
}
.row.is-disabled .shortcut {
  color: var(--kira-fg-disabled);
}

.caret {
  color: var(--kira-fg-muted);
}

.submenu {
  /* left/top are set inline above, computed by positionSubmenu() — P23's flip+shift fix for the
     offscreen bug this was: a plain `left: 100%; top: -4px` here (with no flip and no clamp at
     all) rendered a submenu near the right or bottom edge of the window partly or wholly
     offscreen. */
  @apply fixed overflow-y-auto flex flex-col;
  z-index: var(--kira-z-menu);
  /* P28 D17(a): computeFloatPosition's size() middleware writes these; a menu that fits is
     unaffected, one taller than the viewport scrolls instead of having its lower rows clipped away
     by .p-float's own overflow: hidden. */
  max-height: var(--kira-float-max-h, none);
  max-width: var(--kira-float-max-w, none);
  min-width: 160px;
  padding: var(--kira-s-2);
  gap: 1px;
}
</style>
