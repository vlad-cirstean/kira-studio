<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { computed, ref } from 'vue';
import { useTerminalsStore } from '../../../state/terminals';
import { useAgentSessionsStore } from '../../state/agentSessions';
import { withTuiActivity } from '../activity';
import { blockingSetups } from '../board/setupGate';
import { useLaunchOpener } from '../dialog/useLaunchOpener';
import AdeSetupProgress from '../panel/AdeSetupProgress.vue';
import { useBoard, useFocusSession, useLaunchReviewAgent, useReviewAgent } from '../queries';
import AdeTuiPane from '../sessions/AdeTuiPane.vue';
import { type SessionLookup, sessionView } from '../sessions/sessionView';
import { isPreparing, useSetupWait } from '../state/useSetupWait';
import type { ReviewWindowTarget } from '../wire';
import AdeReviewCompose from './AdeReviewCompose.vue';

// The review agent of this window's task: its terminal when this window runs it, a pointer to the
// window that does, or a Start button. One process per task, never two.
const props = defineProps<{ target: ReviewWindowTarget; repoLabel: string }>();

const terminals = useTerminalsStore();
const launchOpener = useLaunchOpener();
const agentStore = useAgentSessionsStore();
const agent = useReviewAgent(() => props.target.taskId);
const launchM = useLaunchReviewAgent();
const focusM = useFocusSession();

const board = useBoard();
// The review window's worktree may still be preparing: Start waits for it instead of failing.
const setups = computed(() => blockingSetups(board.data.value, props.target.taskId, [props.target.branchId]));
const setupWait = useSetupWait(() => start());
const waitingSetup = setupWait.waiting;

const note = ref('');
const error = ref('');
const missing = ref(false);

const session = computed(() => {
  const s = agent.data.value?.session;
  return s ? (withTuiActivity([s], agentStore.activity)[0] ?? null) : null;
});
const running = computed(() => session.value?.state === 'running');
const here = computed(
  () => running.value && terminals.terminalSession(session.value?.terminalId ?? '') !== undefined,
);

const NO_LOOKUP: SessionLookup = {
  task: () => undefined,
  branch: () => undefined,
  repoLabel: () => '',
  workflow: () => undefined,
};
const view = computed(() => (session.value ? sessionView(session.value, NO_LOOKUP) : null));

async function start(): Promise<void> {
  error.value = '';
  note.value = '';
  try {
    const result = await launchM.mutateAsync({ taskId: props.target.taskId });
    setupWait.stop();
    note.value = result.note;
    await launchOpener.open(result.launch);
  } catch (err) {
    if (isPreparing(err)) {
      setupWait.start();
    } else {
      setupWait.stop();
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    await agent.refetch();
  }
}

async function focus(): Promise<void> {
  if (!session.value) return;
  missing.value = false;
  const shown = await focusM
    .mutateAsync({ sessionId: session.value.id, taskId: props.target.taskId })
    .catch(() => false);
  if (!shown) missing.value = true;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="ade-review-agent">
    <Alert v-if="note" variant="note" class="m-2" data-testid="ade-review-note">
      <AlertDescription>{{ note }}</AlertDescription>
    </Alert>
    <template v-if="session && running && view">
      <AdeTuiPane v-if="here" :view="view" class="min-h-0 flex-1" />
      <div v-else class="flex flex-col items-start gap-2 p-3 text-kira-md" data-testid="ade-review-elsewhere">
        <p class="m-0">Review agent is open in another window</p>
        <Button variant="dialog" size="kira" data-testid="ade-review-focus" @click="focus">Focus</Button>
        <p v-if="missing" class="m-0 text-muted-foreground">That window is gone.</p>
      </div>
      <AdeReviewCompose :target="target" :repo-label="repoLabel" :session="session" />
    </template>
    <div v-else class="flex flex-col items-start gap-2 p-3 text-kira-md" data-testid="ade-review-start-box">
      <p class="m-0 text-muted-foreground">Ask questions about this branch in a Claude Code session.</p>
      <AdeSetupProgress
        v-for="b in setups"
        :key="b.id"
        class="w-full"
        :branch="b"
        :repo="repoLabel"
        data-testid="ade-review-setup"
      />
      <Button
        variant="dialog"
        size="kira"
        :disabled="launchM.isPending.value || waitingSetup"
        data-testid="ade-review-start"
        @click="start"
      >
        {{ waitingSetup ? 'Starts when ready…' : session ? 'Resume review agent' : 'Start review agent' }}
      </Button>
    </div>
    <p v-if="error" class="m-0 px-3 pb-2 text-kira-sm text-error" data-testid="ade-review-start-error">{{ error }}</p>
  </div>
</template>
