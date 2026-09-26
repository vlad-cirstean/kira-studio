<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
// Misc-fixes: a reusable "click for full text" replacement for truncated inline error text +
// native title tooltip (unreadable for multi-line/long messages, and unreachable on touch).
// Mirrors ContextMenu.vue's Teleport/fixed-position/outside-click-closes pattern.
import { useEventListener } from '@vueuse/core';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
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
  <span class="min-w-0 ml-auto shrink">
    <button
      ref="triggerRef"
      type="button"
      class="flex items-center min-w-0 max-w-full bg-transparent border-none p-0 cursor-pointer gap-1 text-error text-kira-md"
      data-testid="error-popover-trigger"
      :aria-label="`Error: ${props.message}`"
      @click="toggle"
    >
      <CodiconIcon name="error" :size="13" />
      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ props.message }}</span>
    </button>

    <Teleport to="body">
      <!-- P28 D17(c): the menu rung. This was a bare 200 -- above the dialog scrim (then 100) and
           below the tooltip (then 300). Both relationships are preserved by the ladder: 300 sits
           above --kira-z-dialog and below --kira-z-tooltip. -->
      <div
        v-if="open"
        ref="popoverRef"
        class="bg-elevated border border-border-strong rounded-kira shadow-kira-dialog overflow-hidden fixed w-80 max-h-60 flex flex-col z-(--kira-z-menu) max-w-[calc(100vw-8px)] text-kira-md"
        data-testid="error-popover"
        :style="style"
      >
        <div class="overflow-auto whitespace-pre-wrap break-words p-2 text-error font-data">{{ props.message }}</div>
        <!-- Footer is the same 28px band used everywhere a toolbar sits at the edge of a
             floating surface, with the border moved to the top since this one closes
             the popover instead of opening it. -->
        <ViewToolbar border="top">
          <Button variant="toolbar" size="kira" class="ml-auto" @click="copyText(props.message)">Copy</Button>
          <Button variant="toolbar" size="kira" @click="close">Close</Button>
        </ViewToolbar>
      </div>
    </Teleport>
  </span>
</template>
