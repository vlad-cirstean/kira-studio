<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { connColorVar } from '../theme/connColor';
import { closeContextMenu, contextMenuState, type MenuItem } from './state/contextMenu';

const SUBMENU_OPEN_DELAY_MS = 150;

const menuRef = ref<HTMLElement | null>(null);
const openSubmenuId = ref<string | null>(null);
const style = ref({ left: '0px', top: '0px' });
let submenuTimer: ReturnType<typeof setTimeout> | null = null;

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
    void position();
  },
);

function onDocMouseDown(e: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) closeContextMenu();
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeContextMenu();
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
  if (submenuTimer) clearTimeout(submenuTimer);
  submenuTimer = setTimeout(
    () => {
      openSubmenuId.value = item.type === 'submenu' ? item.id : null;
    },
    item.type === 'submenu' ? SUBMENU_OPEN_DELAY_MS : 0,
  );
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
          :class="{ 'is-disabled': item.disabled, danger: item.danger }"
          :data-testid="`menu-item-${item.id}`"
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
            <Codicon v-else-if="item.icon" :name="item.icon" :size="12" class="item-icon" />
          </span>
          <span class="label">{{ item.label }}</span>
          <span v-if="item.checked" class="icon-box"><Codicon name="check" :size="12" /></span>
        </div>

        <div v-else class="p-row row submenu-trigger" :data-testid="`menu-item-${item.id}`" @mouseenter="onRowEnter(item)">
          <span class="icon-box">
            <Codicon v-if="item.icon" :name="item.icon" :size="12" class="item-icon" />
          </span>
          <span class="label">{{ item.label }}</span>
          <span class="icon-box"><Codicon name="chevron-right" :size="12" class="caret" /></span>

          <div v-if="openSubmenuId === item.id" class="submenu p-float" data-testid="context-submenu">
            <template v-for="(sub, subIdx) in item.items" :key="sub.type === 'separator' ? `sep-${subIdx}` : sub.id">
              <div v-if="sub.type === 'separator'" class="p-sep" />
              <div
                v-else
                class="p-row row"
                :class="{ 'is-disabled': sub.type === 'item' && sub.disabled }"
                :data-testid="`menu-item-${sub.id}`"
                @click="sub.type === 'item' && onItemClick(sub)"
              >
                <span class="icon-box">
                  <span
                    v-if="sub.type === 'item' && sub.swatch"
                    class="swatch"
                    :class="{ none: sub.swatch === 'none' }"
                    :style="{ background: connColorVar(sub.swatch) }"
                  />
                  <Codicon v-else-if="sub.icon" :name="sub.icon" :size="12" class="item-icon" />
                </span>
                <span class="label">{{ sub.label }}</span>
                <span v-if="sub.type === 'item' && sub.checked" class="icon-box">
                  <Codicon name="check" :size="12" />
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
