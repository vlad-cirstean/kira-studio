<script setup lang="ts">
import PickerTrigger from '@theme/components/PickerTrigger.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import { errorText } from '@workbench/bridge/codedError';
import { computed, ref } from 'vue';
import { stepMoves } from '../board/stepMoves';
import type { CardModel } from '../plan/usePlanModel';
import { useSetTaskStep } from '../queries';

// Moves the task to any step of its workflow, or to Done, in either direction.
const props = defineProps<{ card: CardModel }>();
const setStep = useSetTaskStep();
const error = ref('');

const moves = computed(() =>
  stepMoves(
    props.card.blocks,
    props.card.progress.finished
      ? 'done'
      : (props.card.progress.step?.id ?? props.card.task.entryStepId),
    props.card.task.runs,
  ),
);
const options = computed(() => moves.value.options);
const at = computed(() => moves.value.at);
const prev = computed(() => moves.value.prev);
const next = computed(() => moves.value.next);
const live = computed(() => moves.value.live);
const reason = computed(() =>
  live.value ? t('space.ade.board.taskMenu.liveBlocked.tooltip') : '',
);

async function move(stepId: string): Promise<void> {
  error.value = '';
  try {
    await setStep.mutateAsync({ taskId: props.card.task.id, stepId });
  } catch (err) {
    error.value = errorText(err);
  }
}
</script>

<template>
  <div v-if="card.blocks.length" class="flex flex-col gap-1" data-testid="ade-step-mover">
    <div class="flex items-center gap-1">
      <span class="text-kira-sm text-muted-foreground">{{ t('space.common.step.label') }}</span>
      <TooltipIconButton
        :icon="ICON.back"
        :label="reason || t('space.ade.stepMover.back.tooltip')"
        :aria-label="t('space.ade.stepMover.back.tooltip')"
        :disabled="live || !prev"
        disabled-trigger
        data-testid="ade-step-back"
        @click="move(prev?.id ?? '')"
      />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <PickerTrigger
            size="kira"
            :label="options[at]?.name"
            :disabled="live"
            data-testid="ade-step-pick"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="ade-step-menu">
          <DropdownMenuItem
            v-for="o in options"
            :key="o.id"
            :data-testid="`ade-step-option-${o.id}`"
            :disabled="o.skipped"
            @select="move(o.id)"
          >
            {{ o.name
            }}<span v-if="o.skipped" class="text-subtle"> {{ t('common.skipped.status') }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipIconButton
        icon="arrow-right"
        :label="reason || t('space.ade.stepMover.next.tooltip')"
        :aria-label="t('space.ade.stepMover.next.tooltip')"
        :disabled="live || !next"
        disabled-trigger
        data-testid="ade-step-next"
        @click="move(next?.id ?? '')"
      />
    </div>
    <Alert v-if="error" variant="error" data-testid="ade-step-error"
      ><AlertDescription>{{ error }}</AlertDescription></Alert
    >
  </div>
</template>
