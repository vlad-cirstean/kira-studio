<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Codicon from '../theme/Codicon.vue';
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
    <div v-if="contextMenuState.open" ref="menuRef" class="context-menu" data-testid="context-menu" :style="style">
      <template v-for="(item, idx) in contextMenuState.items" :key="item.type === 'separator' ? `sep-${idx}` : item.id">
        <div v-if="item.type === 'separator'" class="separator" />

        <div
          v-else-if="item.type === 'item'"
          class="row"
          :class="{ disabled: item.disabled, danger: item.danger }"
          :data-testid="`menu-item-${item.id}`"
          @mouseenter="onRowEnter(item)"
          @click="onItemClick(item)"
        >
          <span class="check"><Codicon v-if="item.checked" name="check" :size="12" /></span>
          <span v-if="item.swatch" class="swatch" :style="{ background: `var(--kira-conn-${item.swatch})` }" />
          <Codicon v-else-if="item.icon" :name="item.icon" :size="12" class="item-icon" />
          <span class="label">{{ item.label }}</span>
        </div>

        <div v-else class="row submenu-trigger" :data-testid="`menu-item-${item.id}`" @mouseenter="onRowEnter(item)">
          <span class="check" />
          <Codicon v-if="item.icon" :name="item.icon" :size="12" class="item-icon" />
          <span class="label">{{ item.label }}</span>
          <Codicon name="chevron-right" :size="12" class="caret" />

          <div v-if="openSubmenuId === item.id" class="submenu" data-testid="context-submenu">
            <template v-for="(sub, subIdx) in item.items" :key="sub.type === 'separator' ? `sep-${subIdx}` : sub.id">
              <div v-if="sub.type === 'separator'" class="separator" />
              <div
                v-else
                class="row"
                :class="{ disabled: sub.type === 'item' && sub.disabled }"
                :data-testid="`menu-item-${sub.id}`"
                @click="sub.type === 'item' && onItemClick(sub)"
              >
                <span class="check">
                  <Codicon v-if="sub.type === 'item' && sub.checked" name="check" :size="12" />
                </span>
                <span
                  v-if="sub.type === 'item' && sub.swatch"
                  class="swatch"
                  :style="{ background: `var(--kira-conn-${sub.swatch})` }"
                />
                <Codicon v-else-if="sub.icon" :name="sub.icon" :size="12" class="item-icon" />
                <span class="label">{{ sub.label }}</span>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  min-width: 180px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  padding: 4px;
  z-index: 200;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--kira-radius-sm);
  cursor: pointer;
  position: relative;
  white-space: nowrap;
}

.row:hover {
  background: var(--kira-hover);
}

.row.disabled {
  color: var(--kira-fg-disabled);
  cursor: not-allowed;
}

.row.disabled:hover {
  background: transparent;
}

.row.danger {
  color: var(--kira-error);
}

.check {
  width: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-icon {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.label {
  flex: 1;
}

.caret {
  margin-left: 8px;
  color: var(--kira-fg-muted);
}

.separator {
  height: 1px;
  background: var(--kira-border);
  margin: 4px 2px;
}

.submenu-trigger {
  position: relative;
}

.submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 160px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  padding: 4px;
}
</style>
