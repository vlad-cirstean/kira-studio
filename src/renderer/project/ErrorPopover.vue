<script setup lang="ts">
// Misc-fixes: a reusable "click for full text" replacement for truncated inline error text +
// native title tooltip (unreadable for multi-line/long messages, and unreachable on touch).
// Mirrors ContextMenu.vue's Teleport/fixed-position/outside-click-closes pattern.
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { copyText } from '../clipboard';
import CodiconIcon from '../theme/CodiconIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';

const props = defineProps<{ message: string }>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const style = ref({ left: '0px', top: '0px' });

async function position(): Promise<void> {
  await nextTick();
  const trigger = triggerRef.value;
  const popover = popoverRef.value;
  if (!trigger || !popover) return;
  const t = trigger.getBoundingClientRect();
  const p = popover.getBoundingClientRect();
  let left = t.left;
  let top = t.bottom + 4;
  if (left + p.width > window.innerWidth) left = Math.max(4, window.innerWidth - p.width - 4);
  if (top + p.height > window.innerHeight) top = Math.max(4, t.top - p.height - 4);
  style.value = { left: `${left}px`, top: `${top}px` };
}

function toggle(e: MouseEvent): void {
  e.stopPropagation();
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

watch(open, (isOpen) => {
  if (isOpen) void position();
});

function onDocMouseDown(e: MouseEvent): void {
  if (!open.value) return;
  const target = e.target as Node;
  if (popoverRef.value?.contains(target) || triggerRef.value?.contains(target)) return;
  close();
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) close();
}

document.addEventListener('mousedown', onDocMouseDown, true);
document.addEventListener('keydown', onKeydown);
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <span class="error-popover-host">
    <button
      ref="triggerRef"
      type="button"
      class="error-trigger"
      data-testid="error-popover-trigger"
      :aria-label="`Error: ${props.message}`"
      @click="toggle"
    >
      <CodiconIcon name="error" :size="12" />
      <span class="error-trigger-text">{{ props.message }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popoverRef"
        class="error-popover p-float"
        data-testid="error-popover"
        :style="style"
      >
        <div class="error-popover-body">{{ props.message }}</div>
        <div class="p-toolbar last error-popover-actions">
          <AppButton class="p-push" @click="copyText(props.message)">Copy</AppButton>
          <AppButton @click="close">Close</AppButton>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.error-popover-host {
  min-width: 0;
  margin-left: auto;
  flex-shrink: 1;
}

.error-trigger {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  min-width: 0;
  max-width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  color: var(--kira-error);
  font-size: var(--kira-t-sm);
  cursor: pointer;
}

.error-trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-popover {
  position: fixed;
  z-index: 200;
  width: 340px;
  max-width: calc(100vw - 8px);
  max-height: 240px;
  display: flex;
  flex-direction: column;
  font-size: var(--kira-t-md);
}

.error-popover-body {
  padding: var(--kira-s-4);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--kira-error);
  font-family: var(--kira-font-family);
}

/* Footer is the same 28px band used everywhere a toolbar sits at the edge of a
   floating surface, with the border moved to the top since this one closes
   the popover instead of opening it. */
.error-popover-actions {
  border-top: var(--kira-border-width) solid var(--kira-border);
  flex-shrink: 0;
}
</style>
