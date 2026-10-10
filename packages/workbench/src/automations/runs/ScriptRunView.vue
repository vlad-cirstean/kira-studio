<script setup lang="ts">
import { useMutation } from '@tanstack/vue-query';
import { Button } from '@theme/components/ui/button';
import { useClaimPrompt } from '@workbench/prompts/promptsQueries';
import { queryClient } from '@workbench/state/queryClient';
import { computed, onMounted, ref } from 'vue';
import { useAutomationsModule } from '../module';
import { useRerun } from '../runScript';
import SmartBadge from '../smart/SmartBadge.vue';
import RunElapsed from './RunElapsed.vue';
import RunLog from './RunLog.vue';
import RunOutcomeBlock from './RunOutcomeBlock.vue';
import RunStatusBadge from './RunStatusBadge.vue';
import { useScriptRun, useSeenRuns, useStopScriptRun } from './runsQueries';

// The tab of one smart script run: status, result, the prompt sent, and the live log.
const props = defineProps<{ tab: { id: string; state: { runId: string; label?: string } } }>();
const ctx = useAutomationsModule();
const { run, query } = useScriptRun(() => props.tab.state.runId);
const stop = useStopScriptRun();
const decline = useMutation(
  { mutationKey: ['scriptRuns', 'decline'], mutationFn: (id: string) => ctx.runs.confirmDecline(id) },
  queryClient,
);
const rerunRun = useRerun();
const error = ref<string | null>(null);
const { markSeen } = useSeenRuns();
onMounted(() => markSeen(props.tab.state.runId));

const claim = useClaimPrompt();
const isSmart = computed(() => run.value?.kind === 'smart');
const live = computed(() => run.value?.state === 'running' || run.value?.state === 'waiting');
const ended = computed(() => run.value !== null && !live.value);
const canContinue = computed(
  () =>
    run.value !== null &&
    run.value.sessionId !== '' &&
    (run.value.state === 'blocked' || run.value.state === 'failed'),
);

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

function continueInTerminal(): void {
  const r = run.value;
  if (!r) return;
  ctx.openTerminalTab({
    cwd: r.cwd,
    launch: {
      command: `claude --resume ${shellQuote(r.sessionId)}`,
      label: 'Claude Code',
      color: 'none',
      kind: 'claude-code',
    },
  });
}

async function rerun(): Promise<void> {
  if (run.value) error.value = await rerunRun(run.value);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2 p-3" data-testid="script-run-view">
    <div v-if="!run" class="text-kira-sm text-muted-foreground" data-testid="script-run-missing">
      {{ query.isPending.value ? 'Loading…' : 'This run is no longer in the list.' }}
    </div>
    <template v-else>
      <div class="flex items-center gap-2" data-testid="script-run-header">
        <SmartBadge v-if="isSmart" />
        <span class="min-w-0 truncate font-semibold">{{ run.scriptName }}</span>
        <RunStatusBadge :state="run.state" />
        <RunElapsed :run="run" class="text-kira-sm text-muted-foreground" />
        <span v-if="isSmart" class="font-data text-kira-sm text-muted-foreground">{{ run.model }}</span>
        <Button
          v-if="run.state === 'waiting'"
          variant="dialog-primary"
          size="kira-lg"
          class="ml-auto"
          data-testid="run-review"
          @click="claim.mutate(`schedule:${run.id}`)"
        >
          Review and run
        </Button>
        <Button
          v-if="run.state === 'waiting'"
          variant="dialog"
          size="kira-lg"
          data-testid="run-decline"
          @click="decline.mutate(run.id)"
        >
          Decline
        </Button>
        <Button
          v-if="run.state === 'running'"
          variant="dialog"
          size="kira-lg"
          class="ml-auto"
          data-testid="run-stop"
          @click="stop.mutate(run.id)"
        >
          Stop
        </Button>
      </div>
      <div v-if="ended" class="flex flex-col gap-1.5" data-testid="script-run-result">
        <RunOutcomeBlock :run="run" @rerun="rerun" />
        <Button
          v-if="canContinue"
          variant="dialog"
          size="kira-lg"
          class="self-start"
          data-testid="run-continue"
          @click="continueInTerminal"
        >
          Continue in terminal
        </Button>
        <span v-if="error" class="text-kira-sm text-error">{{ error }}</span>
      </div>
      <div v-if="!isSmart" class="font-data text-kira-sm whitespace-pre-wrap break-words" data-testid="script-run-command">
        {{ run.command }}
      </div>
      <details v-if="isSmart" class="text-kira-sm" data-testid="script-run-prompt">
        <summary class="cursor-default text-muted-foreground">Prompt sent</summary>
        <pre class="mt-1 whitespace-pre-wrap break-words font-data">{{ run.prompt }}</pre>
      </details>
      <RunLog v-if="run.state !== 'waiting' && run.state !== 'skipped'" :run-id="run.id" />
    </template>
  </div>
</template>
