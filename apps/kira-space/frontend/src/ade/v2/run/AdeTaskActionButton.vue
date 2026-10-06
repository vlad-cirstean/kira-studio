<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import AdeTip from '../AdeTip.vue';
import type { CardModel } from '../plan/usePlanModel';
import { actionStyle } from '../tones';
import { useTaskAction } from './useTaskAction';

// The task's stage action: `▶ Run`, `▶ <Stage>`, `Take over`, `Approve`, `Retry`, `Done ›`, `Finish ✓`,
// `Archive`; nothing otherwise.
const props = defineProps<{ card: CardModel }>();
const { action, perform, busy } = useTaskAction(() => props.card);
</script>

<template>
  <AdeTip v-if="action" :text="action.tip">
    <Button
      size="xs"
      class="h-[22px] shrink-0 rounded-kira-sm px-[9px] text-kira-sm font-semibold"
      :style="actionStyle(action.tone)"
      :disabled="busy"
      :data-testid="`ade-task-action-${action.kind}`"
      @click.stop="perform"
    >
      {{ action.label }}
    </Button>
  </AdeTip>
</template>
