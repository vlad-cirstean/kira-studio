<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import AdeTip from '../AdeTip.vue';
import { useStopRun } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import { ACTION_CLASS } from '../tones';
import type { SessionView } from './sessionView';

// Take over and Stop of a background run, at the right end of the session tab row.
const props = defineProps<{ view: SessionView }>();

const ui = useAdeBoardUiStore();
const takeOver = useAdeTakeOverStore();
const stop = useStopRun();

async function onStop(): Promise<void> {
  const { taskId, runId } = props.view.session;
  delete ui.actionError[taskId];
  try {
    await stop.mutateAsync({ runId });
  } catch (err) {
    ui.actionError[taskId] = errorText(err);
  }
}
</script>

<template>
  <template v-if="view.headless">
    <AdeTip :text="t('space.ade.headless.takeOver.tooltip')">
      <Button
        variant="dialog"
        size="kira"
        class="shrink-0 rounded-kira-sm px-2"
        :class="ACTION_CLASS.agent"
        :pending="takeOver.pending.has(view.session.id)"
        data-testid="ade-session-takeover"
        @click="takeOver.request(view.session.id)"
      >
        {{ t('common.action.takeOver.label') }}
      </Button>
    </AdeTip>
    <AdeTip v-if="view.run?.state === 'running'" :text="t('space.ade.headless.stop.tooltip')">
      <Button
        variant="dialog"
        size="kira"
        class="shrink-0 rounded-kira-sm px-2"
        :pending="stop.isPending.value"
        data-testid="ade-session-stop"
        @click="onStop"
      >
        {{ t('common.action.stop.label') }}
      </Button>
    </AdeTip>
  </template>
</template>
