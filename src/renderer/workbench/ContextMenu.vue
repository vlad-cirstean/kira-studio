<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { formatShortcut } from '../shortcuts/keys';
import { closeContextMenu, contextMenuState, type MenuItem } from '../state/contextMenu';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { connColorVar } from '../theme/connColor';

const SUBMENU_OPEN_DELAY_MS = 150;

const menuRef = ref<HTMLElement | null>(null);
const openSubmenuId = ref<string | null>(null);
const style = ref({ left: '0px', top: '0px' });
let submenuTimer: ReturnType<typeof setTimeout> | null = null;

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
  contextMenuState.items.filter(
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

/** Wraps in both directions; from -1 (nothing active yet), Down lands on the first row and Up on
 *  the last — the ordinary "nothing selected yet" convention, not the generic wrap formula's own
 *  off-by-one from -1. */
function stepIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}

async function position(): Promise<void> {
  await nextTick();
  const el = menuRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  let left = contextMenuState.x;
  let top = contextMenuState.y;
  if (left + rect.width > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width - 4);
  if (top + rect.height > window.innerHeight)
    top = Math.max(0, window.innerHeight - rect.height - 4);
  style.value = { left: `${left}px`, top: `${top}px` };
}

watch(
  () => contextMenuState.open,
  (open) => {
    if (!open) return;
    openSubmenuId.value = null;
    activeIndex.value = -1;
    activeSubIndex.value = -1;
    void position();
  },
);

function onDocMouseDown(e: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) closeContextMenu();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    closeContextMenu();
    return;
  }
  if (!contextMenuState.open) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    if (activeSubIndex.value >= 0) {
      activeSubIndex.value = stepIndex(activeSubIndex.value, delta, navigableSub.value.length);
    } else {
      activeIndex.value = stepIndex(activeIndex.value, delta, navigable.value.length);
      // Arrow-navigating past a hover-opened submenu trigger must not leave it open behind the
      // newly active row — the same thing hovering a non-submenu row already does (onRowEnter).
      if (submenuTimer) clearTimeout(submenuTimer);
      openSubmenuId.value = null;
    }
    return;
  }

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (activeSubIndex.value >= 0) return; // already as deep as this menu goes
    const current = activeTopItem.value;
    if (current?.type !== 'submenu') return;
    if (submenuTimer) clearTimeout(submenuTimer);
    openSubmenuId.value = current.id;
    activeSubIndex.value = navigableSub.value.length > 0 ? 0 : -1;
    return;
  }

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (activeSubIndex.value < 0) return; // already at the top level
    openSubmenuId.value = null;
    activeSubIndex.value = -1;
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (activeSubIndex.value >= 0) {
      const sub = activeSubItem.value;
      if (sub?.type === 'item') void onItemClick(sub);
      return;
    }
    const current = activeTopItem.value;
    if (!current) return;
    if (current.type === 'submenu') {
      if (submenuTimer) clearTimeout(submenuTimer);
      openSubmenuId.value = current.id;
      activeSubIndex.value = navigableSub.value.length > 0 ? 0 : -1;
      return;
    }
    void onItemClick(current);
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('blur', closeContextMenu);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('scroll', closeContextMenu, true);
  window.removeEventListener('blur', closeContextMenu);
  if (submenuTimer) clearTimeout(submenuTimer);
});

function onRowEnter(item: MenuItem): void {
  // D43: hovering a row syncs activeIndex so the mouse and the keyboard never disagree about
  // which row is live — indexOf is -1 for a disabled row (not in `navigable`), which correctly
  // leaves nothing active, matching what Enter would do there anyway (nothing).
  activeIndex.value = navigable.value.indexOf(item);
  activeSubIndex.value = -1;
  if (submenuTimer) clearTimeout(submenuTimer);
  submenuTimer = setTimeout(
    () => {
      openSubmenuId.value = item.type === 'submenu' ? item.id : null;
    },
    item.type === 'submenu' ? SUBMENU_OPEN_DELAY_MS : 0,
  );
}

function onSubRowEnter(sub: MenuItem): void {
  activeSubIndex.value =
    sub.type === 'item' && !sub.disabled ? navigableSub.value.indexOf(sub) : -1;
}

async function onItemClick(item: MenuItem): Promise<void> {
  if (item.type !== 'item' || item.disabled) return;
  closeContextMenu();
  await item.run();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="contextMenuState.open"
      ref="menuRef"
      class="context-menu p-float"
      data-testid="context-menu"
      :style="style"
    >
      <template v-for="(item, idx) in contextMenuState.items" :key="item.type === 'separator' ? `sep-${idx}` : item.id">
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

          <div v-if="openSubmenuId === item.id" class="submenu p-float" data-testid="context-submenu">
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
/* P16 design system: every floating surface is the same primitive (Menus.html) —
   .p-float supplies bg-elevated / border-strong / radius / shadow. Its own
   overflow: hidden is overridden here because a submenu pops out past this
   surface's edge (left: 100%) and must not be clipped by it. */
.context-menu {
  position: fixed;
  min-width: 180px;
  padding: var(--kira-s-2);
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: visible;
  z-index: 200;
}

/* Rows share the tree/operations-list row primitive (P8) so a menu row and a
   tree row highlight identically. */
.row {
  position: relative;
  white-space: nowrap;
}

.row.is-disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

/* P43 iter3 D43: the roving keyboard focus target — the same background primitives.css's own
   .p-row:hover/.is-hover already give a real mouse hover, so an active row and a hovered row read
   as the same state to the user, not a second visual vocabulary. */
.row.is-active {
  background: var(--kira-hover);
}

.row.is-disabled:hover {
  background: transparent;
}

.row.danger {
  color: var(--kira-error);
}

.item-icon {
  color: var(--kira-fg-muted);
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.swatch.none {
  border: 1.5px solid var(--kira-fg-disabled);
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shortcut {
  margin-left: var(--kira-s-4);
  color: var(--kira-fg-muted);
  flex-shrink: 0;
  white-space: nowrap;
}
.row.is-disabled .shortcut {
  color: var(--kira-fg-disabled);
}

.caret {
  color: var(--kira-fg-muted);
}

.submenu-trigger {
  position: relative;
}

.submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 160px;
  padding: var(--kira-s-2);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
</style>
