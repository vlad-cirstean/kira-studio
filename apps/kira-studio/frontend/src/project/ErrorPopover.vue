<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
// Misc-fixes: a reusable "click for full text" replacement for truncated inline error text +
// native title tooltip (unreadable for multi-line/long messages, and unreachable on touch).
// Mirrors ContextMenu.vue's Teleport/fixed-position/outside-click-closes pattern.
import { useEventListener } from '@vueuse/core';
import { copyText } from '@workbench/util/clipboard';
import { autoUpdate, computeFloatPosition } from '@workbench/util/floatingPosition';
import { nextTick, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{ message: string }>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const style = ref({ left: '0px', top: '0px' });
let stopAutoUpdate: (() => void) | null = null;

async function position(): Promise<void> {
  const trigger = triggerRef.value;
  const popover = popoverRef.value;
  if (!trigger || !popover) return;
  const { left, top } = await computeFloatPosition(trigger, popover);
  style.value = { left: `${left}px`, top: `${top}px` };
}

function toggle(e: MouseEvent): void {
  e.stopPropagation();
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

// P23: unlike the app's tooltips (close on scroll), this popover has no backdrop and stays open
// across a page interaction — its trigger is often a row's own error text (TreeRow.vue among others),
// which can sit inside a scrolling panel. autoUpdate keeps it pinned to that trigger instead of
// drifting away from it the moment the panel scrolls.
watch(open, async (isOpen) => {
  stopAutoUpdate?.();
  stopAutoUpdate = null;
  if (!isOpen) return;
  await nextTick();
  const trigger = triggerRef.value;
  const popover = popoverRef.value;
  if (!trigger || !popover) return;
  void position();
  stopAutoUpdate = autoUpdate(trigger, popover, position);
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

// useEventListener attaches immediately (like the addEventListener calls this replaces, run at
// setup time rather than deferred to onMounted) and auto-detaches on this component's unmount —
// same lifetime as the manual pair it replaces.
useEventListener(document, 'mousedown', onDocMouseDown, true);
useEventListener(document, 'keydown', onKeydown);
onUnmounted(() => {
  stopAutoUpdate?.();
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
      <CodiconIcon name="error" :size="13" />
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
          <Button variant="toolbar" size="kira" class="p-push" @click="copyText(props.message)">Copy</Button>
          <Button variant="toolbar" size="kira" @click="close">Close</Button>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
@reference "@theme/base.css";

.error-popover-host {
  @apply min-w-0 ml-auto shrink;
}

.error-trigger {
  @apply flex items-center min-w-0 max-w-full bg-transparent border-none p-0 cursor-pointer;
  gap: var(--kira-s-2);
  color: var(--kira-error);
  font-size: var(--kira-t-sm);
}

.error-trigger-text {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}

.error-popover {
  /* P28 D17(c): the menu rung. This was a bare 200 — above the dialog scrim (then 100) and below
     the tooltip (then 300). Both relationships are preserved by the ladder: 300 sits above
     --kira-z-dialog and below --kira-z-tooltip. */
  @apply fixed w-[340px] max-h-[240px] flex flex-col;
  z-index: var(--kira-z-menu);
  max-width: calc(100vw - 8px);
  font-size: var(--kira-t-md);
}

.error-popover-body {
  @apply overflow-auto whitespace-pre-wrap break-words;
  padding: var(--kira-s-4);
  color: var(--kira-error);
  font-family: var(--kira-font-data);
}

/* Footer is the same 28px band used everywhere a toolbar sits at the edge of a
   floating surface, with the border moved to the top since this one closes
   the popover instead of opening it. */
.error-popover-actions {
  @apply shrink-0;
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
