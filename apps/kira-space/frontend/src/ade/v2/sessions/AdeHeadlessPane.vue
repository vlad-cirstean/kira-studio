<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { computed, ref } from 'vue';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import AdeTip from '../AdeTip.vue';
import { adeAgoOptions } from '../ago';
import AdeRunLog from '../panel/AdeRunLog.vue';
import { useStopRun } from '../queries';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import { ACTION_CLASS } from '../tones';
import AdeSessionId from './AdeSessionId.vue';
import type { SessionView } from './sessionView';

// A running background run: status bar (step, run state, age) with Take over and Stop, then its
// read-only log.
const props = defineProps<{ view: SessionView; archived?: boolean }>();

const takeOver = useAdeTakeOverStore();
const stop = useStopRun();
const error = ref('');
const ago = useTimeAgo(() => props.view.session.lastActiveAt, adeAgoOptions);

const runState = computed(() => props.view.run?.state ?? '');
const needsYou = computed(() => runState.value === 'stuck' || props.view.session.activity === 'input');
const running = computed(() => runState.value === 'running');
const status = computed(
  () =>
    `headless run · step ${props.view.step} · ${runState.value || props.view.kind}${needsYou.value ? ' · needs you' : ''} · ${ago.value}`,
);

async function onStop(): Promise<void> {
  error.value = '';
  try {
    await stop.mutateAsync({ runId: props.view.session.runId });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="ade-headless-pane">
    <div
      class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-kira-md"
      :class="needsYou ? 'bg-tone-amber-solid/8 text-tone-amber' : 'text-muted-foreground'"
      data-testid="ade-headless-status"
    >
      <AdeActivityIcon :kind="view.kind" :size="14" />
      <Button
        v-if="!archived"
        size="xs"
        class="shrink-0 rounded-kira-sm px-2.5 font-semibold"
        :class="ACTION_CLASS.claude"
        :disabled="takeOver.pending.has(view.session.id)"
        title="Continue this run yourself in an interactive Claude Code session"
        data-testid="ade-session-takeover"
        @click="takeOver.request(view.session.id)"
      >
        Take over
      </Button>
      <AdeTip v-if="running && !archived" text="stop this run; it becomes stuck">
        <Button
          variant="dialog"
          size="xs"
          class="shrink-0 rounded-kira-sm px-2.5"
          :disabled="stop.isPending.value"
          data-testid="ade-session-stop"
          @click="onStop"
        >
          Stop
        </Button>
      </AdeTip>
      <span class="min-w-0 truncate" data-testid="ade-headless-label">{{ status }}</span>
      <AdeSessionId class="ml-auto" :id="view.session.claudeSessionId" />
    </div>
    <p v-if="error" class="m-0 px-3 py-1 text-kira-sm text-error" data-testid="ade-session-error">{{ error }}</p>
    <div class="min-h-0 flex-1 overflow-auto p-2">
      <AdeRunLog v-if="view.session.runId" kind="run" :id="view.session.runId" max-height="100%" />
    </div>
    <div class="shrink-0 border-t border-border px-3 py-2 text-kira-sm text-subtle">
      Read-only log of a background run. Use Take over to continue it yourself in Claude Code.
    </div>
  </div>
</template>
