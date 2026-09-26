<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';
import type { KeepAwakeStatus } from '../bridge/createCoreControl';

// P116 H7: the keep-awake toggle and "New window" button, hoisted verbatim from Kira Studio's own
// TitleBar.vue (same data-testids, same DOM order — Kira Space's own copy, workbench.spec.ts's own
// DOM-order assertion covers both apps' rightmost two title-bar buttons). The click/status logic
// (the actual keepAwakeStore/control.windowsOpenNew calls) stays app-side: this component only
// renders and emits, since each app's own store/control instance differs.
const props = defineProps<{ keepAwake: KeepAwakeStatus }>();
const emit = defineEmits<{ 'toggle-keep-awake': []; 'new-window': [] }>();

// §8.3: aria-pressed plus this state-naming tooltip carry what a missing coffee-off glyph would
// have — @vscode/codicons ships no such glyph, so the button can't also swap its icon the way the
// Connections/Operations toggles do.
const keepAwakeTooltip = computed(() => {
  if (props.keepAwake.error) return `Keep awake failed: ${props.keepAwake.error}`;
  return props.keepAwake.manual
    ? 'Keeping this Mac awake — click to stop'
    : 'Keep this Mac awake';
});
</script>

<template>
  <TooltipIconButton
    v-if="keepAwake.supported"
    icon="coffee"
    :label="keepAwakeTooltip"
    aria-label="Keep this Mac awake"
    :icon-size="15"
    variant="title"
    size="title"
    :aria-pressed="keepAwake.manual"
    data-testid="toggle-keep-awake"
    @click="emit('toggle-keep-awake')"
  />
  <Button variant="title" size="title-labelled" data-testid="new-window" @click="emit('new-window')">
    <CodiconIcon name="empty-window" :size="15" />
    <span>New window</span>
  </Button>
</template>
