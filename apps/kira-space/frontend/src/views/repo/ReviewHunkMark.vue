<script setup lang="ts">
// The per-hunk mark button, mounted by reviewDecorations.ts into a one-line view zone's margin
// node (its own createApp, so the tooltip needs its own provider).
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { TooltipProvider } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { useEventListener } from '@vueuse/core';
import { useTemplateRef } from 'vue';

defineProps<{ reviewed: boolean }>();
const emit = defineEmits<{ toggle: [] }>();

const box = useTemplateRef<HTMLElement>('box');
// Monaco's margin handler otherwise takes the press and the release land on different elements.
for (const type of ['pointerdown', 'mousedown'] as const) {
  useEventListener(box, type, (e) => e.stopPropagation());
}
</script>

<template>
  <TooltipProvider>
    <div ref="box" class="flex h-full w-9 items-center justify-center">
      <TooltipIconButton
        :icon="reviewed ? 'pass-filled' : 'circle-large-outline'"
        :label="reviewed ? t('common.markUnreviewed.tooltip') : t('common.markReviewed.tooltip')"
        :tone="reviewed ? 'ok' : undefined"
        :class="reviewed ? '' : 'text-primary'"
        data-testid="review-hunk-mark"
        :data-state="reviewed ? 'reviewed' : 'actionable'"
        @click="emit('toggle')"
      />
    </div>
  </TooltipProvider>
</template>
