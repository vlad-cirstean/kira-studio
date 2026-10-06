<script setup lang="ts" generic="M extends string">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { tabChipVariants } from '@theme/components/ui/tabs';
import type { ModeRegistry } from '../modes';

// P128 §2.3: hoisted from Kira Studio's own TitleBar.vue (lines 50-81) — markup, classes, test IDs
// and comments carried byte-for-byte so Studio's visual baseline holds. Kira Space's own
// TitleBar.vue renders this for the first time (§2.6).
defineProps<{
  order: readonly M[];
  modes: ModeRegistry<M>;
  active: M;
}>();

const emit = defineEmits<{ select: [mode: M] }>();
</script>

<template>
  <!-- No app title (removed — HideTitle already drops AppKit's own, and a second wordmark read as
       redundant next to the mode switcher). Centered on the bar's true full width via absolute
       positioning, deliberately NOT `justify-content: center` inside the flex row -- that would
       center within the *padded* box, not the window, and reads visibly off-centre. -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-0.5">
    <!-- P15 D9: px-3 (12px) -- the tab chip's own metrics (--kira-h-md/--kira-t-sm, 26px/11px)
         inside a 38px bar leaves 6px of clearance, the same --kira-s-3 the bar already uses as its
         own right padding. wails-no-drag: isDraggableEvent (drag.ts) reads the event target's
         computed style, so every interactive child of the shared, wails-drag-carrying TitleBar root
         must explicitly override it, or clicking a mode tab would also start a window drag. -->
    <button
      v-for="mode in order"
      :key="mode"
      type="button"
      class="wails-no-drag"
      :class="tabChipVariants({ active: active === mode, size: 'wide' })"
      :aria-pressed="active === mode"
      data-testid="mode-tab"
      :data-mode="mode"
      @click="emit('select', mode)"
    >
      <!-- P22 D6: rendered at the icon's own 16px design size (--kira-icon-box) — the glyph fills
           its box instead of leaving per-glyph advance slack at 13px (F9(a)). Mode-tab-local. -->
      <span
        class="size-4 flex items-center justify-center shrink-0 leading-3.5"
        data-testid="mode-tab-icon"
        ><CodiconIcon :name="modes[mode].icon" :size="16"
      /></span>
      <span class="mode-label leading-3.5">{{ modes[mode].label }}</span>
    </button>
  </div>
</template>
