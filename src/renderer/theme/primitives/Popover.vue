<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

// Shared chrome for every trigger-anchored popover/menu (ColumnsMenu, FilterHistoryMenu,
// ConsoleSavedMenu, PreviewCommandPanel): a full-viewport transparent backdrop that closes the
// popover on click-outside, plus Escape-to-close. The surface itself is only positioned and
// sized here (anchor + width) — each consumer wraps its own list/content in an inner element
// that owns its own max-height/overflow/flex-direction, since those vary per menu.
//
// Not for workbench/ContextMenu.vue: that menu is anchored to the mouse click point with its
// own positioning math, not to a fixed toolbar corner — a different model, left untouched.
const props = withDefaults(
  defineProps<{
    anchor?: 'left' | 'right';
    width?: number;
    testId?: string;
    backdropTestId?: string;
  }>(),
  { anchor: 'right', width: 240 },
);

const emit = defineEmits<{ close: [] }>();

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="menu-backdrop" :data-testid="backdropTestId" @click="emit('close')">
    <div
      class="popover p-float"
      :class="anchor"
      :data-testid="testId"
      :style="{ width: `${props.width}px` }"
      @click.stop
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.popover {
  position: absolute;
  top: 32px;
}

.popover.left {
  left: 8px;
}

.popover.right {
  right: 8px;
}
</style>
