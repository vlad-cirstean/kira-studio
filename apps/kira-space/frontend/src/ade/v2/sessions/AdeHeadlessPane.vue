<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import { useRelativeTime } from '@workbench/behaviour/format';
import { errorText } from '@workbench/bridge/codedError';
import { computed, ref } from 'vue';
import AdeTip from '../AdeTip.vue';
import { activityLabel } from '../activity';
import AdeRunLog from '../panel/AdeRunLog.vue';
import { useStopRun } from '../queries';
import { runStateLabel } from '../runState';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import { ACTION_CLASS } from '../tones';
import AdeSessionBar from './AdeSessionBar.vue';
import type { SessionView } from './sessionView';

// A running background run: status bar (step, run state, age) with Take over and Stop, then its
// read-only log.
const props = defineProps<{ view: SessionView; archived?: boolean }>();

const takeOver = useAdeTakeOverStore();
const stop = useStopRun();
const error = ref('');
const ago = useRelativeTime(() => props.view.session.lastActiveAt);

const runState = computed(() => props.view.run?.state ?? '');
const needsYou = computed(
  () => runState.value === 'stuck' || props.view.session.activity === 'input',
);
const running = computed(() => runState.value === 'running');
const status = computed(() =>
  t(
    needsYou.value ? 'space.ade.headless.statusNeedsYou.label' : 'space.ade.headless.status.label',
    {
      step: props.view.step,
      state: runState.value ? runStateLabel(runState.value) : activityLabel(props.view.kind),
      ago: ago.value,
    },
  ),
);

async function onStop(): Promise<void> {
  error.value = '';
  try {
    await stop.mutateAsync({ runId: props.view.session.runId });
  } catch (err) {
    error.value = errorText(err);
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="ade-headless-pane">
    <AdeSessionBar :view="view" :needs-you="needsYou" data-testid="ade-headless-status">
      <Button
        v-if="!archived"
        variant="dialog"
        size="kira"
        class="shrink-0 rounded-kira-sm px-2"
        :class="ACTION_CLASS.claude"
        :pending="takeOver.pending.has(view.session.id)"
        :title="t('space.ade.headless.takeOver.tooltip')"
        data-testid="ade-session-takeover"
        @click="takeOver.request(view.session.id)"
      >
        {{ t('common.action.takeOver.label') }}
      </Button>
      <AdeTip v-if="running && !archived" :text="t('space.ade.headless.stop.tooltip')">
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
      <span class="min-w-0 truncate" data-testid="ade-headless-label">{{ status }}</span>
    </AdeSessionBar>
    <FieldError v-if="error" class="px-3 py-1" data-testid="ade-session-error">{{
      error
    }}</FieldError>
    <div class="min-h-0 flex-1 overflow-auto p-2">
      <AdeRunLog v-if="view.session.runId" kind="run" :id="view.session.runId" max-height="100%" />
    </div>
    <div class="shrink-0 border-t border-border px-3 py-2 text-kira-sm text-subtle">
      {{ t('space.ade.headless.footer.hint') }}
    </div>
  </div>
</template>
