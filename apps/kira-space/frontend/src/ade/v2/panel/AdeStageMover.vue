<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { computed, ref } from 'vue';
import type { CardModel } from '../plan/usePlanModel';
import { useSetTaskStage } from '../queries';

// Moves the task to any stage of its workflow, or to Done, in either direction.
const props = defineProps<{ card: CardModel }>();
const setStage = useSetTaskStage();
const error = ref('');

const DONE = 'done';
const options = computed(() => [
  ...props.card.blocks.map((b) => ({ id: b.stage.id, name: b.stage.name })),
  { id: DONE, name: 'Done' },
]);
const at = computed(() => {
  const i = options.value.findIndex((o) => o.id === props.card.task.stageId);
  return i < 0 ? 0 : i;
});
const live = computed(() => props.card.task.runs.some((r) => r.state === 'running'));
const reason = computed(() => (live.value ? 'Stop its running agents first' : ''));

async function move(stageId: string): Promise<void> {
  error.value = '';
  try {
    await setStage.mutateAsync({ taskId: props.card.task.id, stageId });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div v-if="card.blocks.length" class="flex flex-col gap-1" data-testid="ade-stage-mover">
    <div class="flex items-center gap-1">
      <span class="text-kira-sm text-muted-foreground">Stage</span>
      <TooltipIconButton
        icon="arrow-left"
        :label="reason || 'Back one stage'"
        aria-label="Back one stage"
        :disabled="live || at === 0"
        disabled-trigger
        data-testid="ade-stage-back"
        @click="move(options[at - 1]?.id ?? '')"
      />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="dialog" size="xs" :disabled="live" data-testid="ade-stage-pick">
            {{ options[at]?.name }}
            <CodiconIcon name="chevron-down" :size="12" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="ade-stage-menu">
          <DropdownMenuItem
            v-for="o in options"
            :key="o.id"
            :data-testid="`ade-stage-option-${o.id}`"
            @select="move(o.id)"
          >
            {{ o.name }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipIconButton
        icon="arrow-right"
        :label="reason || 'Next stage'"
        aria-label="Next stage"
        :disabled="live || at === options.length - 1"
        disabled-trigger
        data-testid="ade-stage-next"
        @click="move(options[at + 1]?.id ?? '')"
      />
    </div>
    <p v-if="error" class="m-0 text-kira-sm text-error" data-testid="ade-stage-error">{{ error }}</p>
  </div>
</template>
