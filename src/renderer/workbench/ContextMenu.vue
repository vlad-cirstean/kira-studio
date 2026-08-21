<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { closeContextMenu, contextMenuState, type MenuItem } from './state/contextMenu';

// Renderer-drawn context menu (D12): teleported to body, positioned at the click and flipped when
// it would overflow the window, closes on Escape / outside click / scroll / window blur, one level
// of submenu on hover, checkmarks for checked items.

const menuRef = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });
const openSubmenu = ref<string | null>(null);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function clamp(): void {
  void nextTick(() => {
    const el = menuRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = contextMenuState.x;
    let y = contextMenuState.y;
    if (x + rect.width > window.innerWidth) x = Math.max(0, window.innerWidth - rect.width - 4);
    if (y + rect.height > window.innerHeight) y = Math.max(0, window.innerHeight - rect.height - 4);
    pos.value = { x, y };
  });
}

function run(item: Extract<MenuItem, { type: 'item' }>): void {
  closeContextMenu();
  void item.run();
}

function onSubmenuEnter(id: string): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  openSubmenu.value = id;
}

function onSubmenuLeave(): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    openSubmenu.value = null;
  }, 150);
}

function onGlobalMouseDown(e: MouseEvent): void {
  if (!menuRef.value?.contains(e.target as Node)) closeContextMenu();
}

function onGlobalScroll(): void {
  closeContextMenu();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeContextMenu();
}

function onBlur(): void {
  closeContextMenu();
}

watch(
  () => contextMenuState.open,
  (open) => {
    if (open) {
      pos.value = { x: contextMenuState.x, y: contextMenuState.y };
      openSubmenu.value = null;
      clamp();
    }
  },
);

onMounted(() => {
  document.addEventListener('mousedown', onGlobalMouseDown);
  window.addEventListener('scroll', onGlobalScroll, true);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('blur', onBlur);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onGlobalMouseDown);
  window.removeEventListener('scroll', onGlobalScroll, true);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('blur', onBlur);
});
</script>

<template>
  <div
    ref="menuRef"
    class="context-menu"
    data-testid="context-menu"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    role="menu"
  >
    <template v-for="(item, i) in contextMenuState.items" :key="item.type === 'separator' ? `sep-${i}` : item.id">
      <div v-if="item.type === 'separator'" class="separator" role="separator" />
      <div
        v-else
        class="menu-item"
        :class="{ danger: item.type === 'item' && item.danger, disabled: item.type === 'item' && item.disabled }"
        :data-testid="`menu-item-${item.id}`"
        role="menuitem"
        @mouseenter="item.type === 'submenu' && onSubmenuEnter(item.id)"
        @mouseleave="item.type === 'submenu' && onSubmenuLeave()"
        @click="item.type === 'item' && !item.disabled && run(item)"
      >
        <span class="gutter">
          <Codicon
            v-if="item.type === 'item' && item.checked"
            name="check"
            :size="12"
          />
        </span>
        <Codicon v-if="item.type !== 'item' || item.icon" :name="(item as { icon?: string }).icon ?? ''" :size="14" class="item-icon" />
        <span class="label">{{ item.label }}</span>
        <Codicon v-if="item.type === 'submenu'" name="chevron-right" :size="12" class="chevron" />

        <div
          v-if="item.type === 'submenu' && openSubmenu === item.id"
          class="submenu"
          data-testid="context-submenu"
        >
          <div
            v-for="child in item.items"
            :key="child.id"
            class="menu-item"
            :class="{ danger: child.type === 'item' && child.danger, disabled: child.type === 'item' && child.disabled }"
            :data-testid="`menu-item-${child.id}`"
            role="menuitem"
            @click.stop="child.type === 'item' && !child.disabled && run(child)"
          >
            <span class="gutter">
              <Codicon v-if="child.type === 'item' && child.checked" name="check" :size="12" />
            </span>
            <Codicon v-if="child.type !== 'item' || child.icon" :name="(child as { icon?: string }).icon ?? ''" :size="14" class="item-icon" />
            <span class="label">{{ child.label }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 200;
  min-width: 180px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  padding: 3px;
  display: flex;
  flex-direction: column;
}

.menu-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--kira-radius);
  font-size: 12px;
  color: var(--kira-fg);
  cursor: pointer;
  white-space: nowrap;
}

.menu-item:hover {
  background: var(--kira-select);
}

.menu-item.danger {
  color: var(--kira-error);
}

.menu-item.disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

.gutter {
  width: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.item-icon {
  color: var(--kira-fg-muted);
  flex-shrink: 0;
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  color: var(--kira-fg-muted);
  flex-shrink: 0;
}

.separator {
  height: 1px;
  background: var(--kira-border);
  margin: 3px 6px;
}

.submenu {
  position: absolute;
  left: calc(100% + 2px);
  top: -3px;
  min-width: 180px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  padding: 3px;
  display: flex;
  flex-direction: column;
}
</style>
