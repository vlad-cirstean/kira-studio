<script setup lang="ts">
/**
 * P131 Part 2 §3.6: rewritten on the P104 §5.2 point-anchored pattern (packages/workbench/src/
 * components/ContextMenu.vue) -- a point-anchored `DropdownMenu` instead of kira-ui's
 * `KuiContextMenu`. Public API unchanged (every prop, every emit), so this file's 8 consumers
 * (review's `ReviewCommitRow.vue` included) need zero edits.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { onMounted, ref } from 'vue';
import MenuSections from './MenuSections.vue';
import type { MenuSection } from './rowMenuModel.ts';

defineProps<{
  sections: readonly MenuSection[];
  x: number;
  y: number;
  label: string;
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'close'): void;
  /** The invoking element was replaced while the menu was open (a grid re-render), so focus
   *  cannot return to it; the consumer restores focus to its owner. */
  (e: 'restoreFocus'): void;
}>();

// Consumers mount this component with `v-if`, so it always starts open.
const open = ref(true);

function onOpenChange(value: boolean): void {
  open.value = value;
  if (!value) emit('close');
}

// KuiContextMenu's own focus-capture-and-return: the element focused before this menu opened
// (the row/button that invoked it) gets focus back once the menu closes, instead of reka's own
// close-auto-focus target (the 0x0 trigger span, never a real focus destination).
let invoker: HTMLElement | null = null;

onMounted(() => {
  invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
});

function onCloseAutoFocus(e: Event): void {
  e.preventDefault();
  if (invoker?.isConnected) invoker.focus();
  else emit('restoreFocus');
}
</script>

<template>
  <DropdownMenu :open="open" @update:open="onOpenChange">
    <DropdownMenuTrigger as-child>
      <span
        class="fixed size-0"
        :style="{ left: `${x}px`, top: `${y}px` }"
        aria-hidden="true"
      />
    </DropdownMenuTrigger>
    <!-- P131 Part 2: `prioritize-position` reorders reka's Popper middleware to flip before shift
         (its default order runs shift first). With a 0x0 point anchor, unprioritized shift alone
         can clamp the overflow to zero by pinning the panel's edge right at the anchor -- leaving
         flip nothing to react to, so a click with very little room below never flips above and
         instead renders a near-unusable, scrolled-to-fit sliver. Root-caused via
         floating-geometry.spec.ts's own "no room below" case. -->
    <DropdownMenuContent
      align="start"
      :side-offset="0"
      prioritize-position
      class="min-w-45 max-w-80"
      :aria-label="title ?? label"
      @close-auto-focus="onCloseAutoFocus"
    >
      <MenuSections :sections="sections" :title="title" @select="(id) => emit('select', id)" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
