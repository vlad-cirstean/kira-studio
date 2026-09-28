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
  invoker?.focus();
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
    <DropdownMenuContent
      align="start"
      :side-offset="0"
      class="min-w-45 max-w-80"
      :aria-label="title ?? label"
      @close-auto-focus="onCloseAutoFocus"
    >
      <MenuSections :sections="sections" :title="title" @select="(id) => emit('select', id)" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
