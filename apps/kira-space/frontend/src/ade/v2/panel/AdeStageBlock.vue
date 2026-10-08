<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, ref } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeRepoTag from '../AdeRepoTag.vue';
import AdeTip from '../AdeTip.vue';
import type { Tone } from '../board/actions';
import { integrationChips } from '../board/labels';
import type { StepRun } from '../board/progress';
import { WAITING_SETUP_NOTES } from '../board/setupGate';
import { nextStageId, type StageBlock } from '../board/stageBlocks';
import type { CardModel } from '../plan/usePlanModel';
import { useApprove, useOpenReviewWindow, useRetryRun, useSetTaskStage } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import { ACTION_CLASS, TONE_SOLID_CLASS, TONE_TAG_CLASS, TONE_TEXT_CLASS } from '../tones';
import AdeRunLog from './AdeRunLog.vue';
import AdeSetupProgress from './AdeSetupProgress.vue';

// One stage of the Workflow block: header (state chip, action slot, name, count, mode), then its
// steps with their per-repo run lines, or the branches of the Release stage.
const props = defineProps<{ block: StageBlock; card: CardModel }>();
const ui = useAdeBoardUiStore();
const takeOver = useAdeTakeOverStore();
const approve = useApprove();
const retry = useRetryRun();
const setStage = useSetTaskStage();
const contextMenu = useContextMenuStore();
const openReview = useOpenReviewWindow();

const error = ref('');
const openLog = ref<string | null>(null);

const STATE_TONE: Record<StageBlock['state'], Tone> = { done: 'green', now: 'amber', next: 'grey', skipped: 'grey' };
const current = computed(() => props.block.state === 'now');
const skipped = computed(() => props.block.state === 'skipped');

function moveTo(stageId: string): void {
  const taskId = props.card.task.id;
  delete ui.actionError[taskId];
  setStage.mutate(
    { taskId, stageId },
    { onError: (err) => (ui.actionError[taskId] = err instanceof Error ? err.message : String(err)) },
  );
}
function onMenu(ev: MouseEvent): void {
  ev.preventDefault();
  const live = props.card.task.runs.some((r) => r.state === 'running');
  const hint = live ? 'Stop its running agents first' : undefined;
  const items: MenuItem[] = [
    { type: 'label', label: props.block.stage.name },
    {
      type: 'item',
      id: 'ade-stage-move-here',
      label: 'Move task here',
      disabled: current.value || skipped.value || live,
      hint: current.value || skipped.value ? undefined : hint,
      run: () => moveTo(props.block.stage.id),
    },
  ];
  if (current.value) {
    items.push({
      type: 'item',
      id: 'ade-stage-skip-this',
      label: 'Skip this stage',
      disabled: live,
      hint,
      run: () => moveTo(nextStageId(props.card.blocks, props.block.stage.id)),
    });
  }
  contextMenu.openContextMenu(ev, items);
}
const boxClass = computed(() => {
  if (current.value) return 'border-tone-amber-solid/40 bg-tone-amber-solid/5';
  return 'border-border bg-elevated';
});
/** The row of a run line held back by its branch's prepare script. */
const heldRow = (rl: { run: { branchId: string }; note: string }) =>
  WAITING_SETUP_NOTES.includes(rl.note) ? props.card.rows.find((r) => r.id === rl.run.branchId) : undefined;
const stateLabel = (s: StageBlock['state']): string => (s === 'now' ? 'now' : s);

const GLYPH_BOX: Record<string, string> = {
  done: 'bg-tone-green-solid text-bg',
  stuck: 'bg-tone-amber-solid text-bg',
  failed: 'bg-tone-red-solid text-bg',
  running: 'border border-tone-amber-solid text-tone-amber-solid',
  pending: 'border border-border-strong text-subtle',
};
const STEP_GLYPH: Record<string, string> = { done: '✓', running: '●', stuck: '!', failed: '✕', pending: '' };
const glyphClass = (state: string): string => GLYPH_BOX[state] ?? GLYPH_BOX.pending ?? '';
const TEXT_TONE: Record<string, string> = {
  stuck: 'text-tone-red',
  failed: 'text-tone-red',
  running: 'text-tone-amber',
  done: 'text-tone-green',
};
const statusClass = (state: string): string => TEXT_TONE[state] ?? 'text-subtle';

async function run(fn: () => Promise<unknown>): Promise<void> {
  error.value = '';
  try {
    await fn();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
const onApprove = (stepId: string): Promise<void> =>
  run(() => approve.mutateAsync({ taskId: props.card.task.id, stageId: props.block.stage.id, stepId }));
const onRetry = (runId: string): Promise<void> => run(() => retry.mutateAsync({ runId }));

const canTakeOver = (r: StepRun): boolean =>
  props.block.stage.kind === 'agent' &&
  r.sessionId !== '' &&
  (r.state === 'stuck' || r.state === 'failed' || r.state === 'running');

const released = computed(() =>
  props.block.release
    ? props.card.rows.filter((r) => r.branch.kind === 'mine' && !r.draft)
    : [],
);
const reviewRows = computed(() =>
  props.block.stage.id === 'review' ? props.card.rows.filter((r) => r.branch.kind === 'mine') : [],
);
const onReview = (branchId: string): void =>
  openReview.mutate(
    { branchId },
    { onError: (err) => (error.value = err instanceof Error ? err.message : String(err)) },
  );
const chipClass = (t: 'muted' | 'stale' | 'unknown'): string => (t === 'stale' ? 'text-tone-amber' : 'text-muted-foreground');
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded-kira border px-2.5 py-2"
    :class="[skipped ? 'opacity-60' : '', boxClass]"
    data-testid="ade-stage-block"
    :data-stage-id="block.stage.id"
    :data-state="block.state"
  >
    <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only; the header holds nested interactive controls. -->
    <div class="flex min-h-6 items-center gap-2" data-testid="ade-stage-block-head" @contextmenu="onMenu">
      <AdeChip :label="stateLabel(block.state)" :tone="STATE_TONE[block.state]" class="min-w-10 text-center" />
      <slot name="action" />
      <span class="text-kira-lg font-bold" data-testid="ade-stage-block-name">{{ block.stage.name }}</span>
      <span class="font-data text-kira-md font-bold text-tone-amber" data-testid="ade-stage-block-count">{{ block.count }}</span>
      <span class="min-w-0 truncate text-kira-sm text-subtle" data-testid="ade-stage-block-mode">{{ block.mode }}</span>
    </div>

    <div
      v-for="sv in block.steps"
      :key="sv.step.id"
      class="flex flex-col gap-0.5 rounded-kira-sm bg-bg px-1.5 py-1"
      data-testid="ade-step"
      :data-step-id="sv.step.id"
    >
      <div class="flex min-h-control items-center gap-2">
        <span
          class="box-border flex size-4 shrink-0 items-center justify-center rounded-kira-sm text-kira-sm font-extrabold"
          :class="glyphClass(sv.step.state)"
          >{{ STEP_GLYPH[sv.step.state] }}</span
        >
        <span class="shrink-0 whitespace-nowrap text-kira-sm" :class="statusClass(sv.step.state)" data-testid="ade-step-status">{{
          sv.statusText
        }}</span>
        <Button
          v-if="sv.step.approval"
          size="kira"
          class="shrink-0 font-semibold"
          :class="TONE_SOLID_CLASS.amber"
          data-testid="ade-step-approve"
          @click="onApprove(sv.step.id)"
        >
          Approve
        </Button>
        <span class="shrink-0 text-kira-sm text-subtle">{{ sv.step.n }}.</span>
        <span
          class="min-w-0 flex-1 truncate text-kira-md font-semibold"
          :class="sv.step.state === 'done' ? 'text-subtle' : 'text-fg'"
          data-testid="ade-step-name"
          >{{ sv.step.name }}</span
        >
        <span v-if="sv.failText" class="shrink-0 whitespace-nowrap text-kira-sm text-tone-blue">{{ sv.failText }}</span>
        <span v-if="sv.gated" class="shrink-0 whitespace-nowrap text-kira-sm text-tone-amber">needs approval</span>
        <AdeTip :text="sv.scope">
          <span
            class="min-w-0 shrink truncate text-kira-sm text-subtle"
            :class="block.stage.kind === 'script' ? 'font-data' : ''"
            data-testid="ade-step-scope"
            >{{ sv.scope }}</span
          >
        </AdeTip>
      </div>
      <template v-for="rl in sv.runs" :key="rl.run.branchId">
        <div class="flex min-h-control items-center gap-1.75 pl-6" data-testid="ade-run-line" :data-branch-id="rl.run.branchId">
          <span class="w-3.5 shrink-0 text-center text-kira-sm font-extrabold" :class="TONE_TEXT_CLASS[rl.tone]" data-testid="ade-run-glyph">{{ rl.glyph }}</span>
          <AdeRepoTag
            :code-repo-id="card.rows.find((r) => r.id === rl.run.branchId)?.branch.codeRepoId ?? ''"
            :label="card.rows.find((r) => r.id === rl.run.branchId)?.repo ?? ''"
          />
          <span class="w-16 shrink-0 whitespace-nowrap text-kira-sm" :class="TONE_TEXT_CLASS[rl.tone]" data-testid="ade-run-status">{{ rl.status }}</span>
          <Button
            v-if="rl.hasLog"
            variant="dialog"
            size="kira"
            class="shrink-0"
            data-testid="ade-run-log-toggle"
            @click="openLog = openLog === rl.run.runId ? null : rl.run.runId"
          >
            {{ block.stage.kind === 'script' ? (openLog === rl.run.runId ? 'Hide output' : 'Output') : openLog === rl.run.runId ? 'Hide log' : 'Log' }}
          </Button>
          <Button
            v-if="canTakeOver(rl.run)"
            size="kira"
            class="shrink-0 font-semibold"
            :class="ACTION_CLASS.claude"
            :disabled="takeOver.pending.has(rl.run.sessionId)"
            data-testid="ade-run-takeover"
            @click="takeOver.request(rl.run.sessionId)"
          >
            Take over
          </Button>
          <Button
            v-if="rl.canRetry"
            size="kira"
            class="shrink-0 font-semibold"
            :class="TONE_SOLID_CLASS.red"
            data-testid="ade-run-retry"
            @click="onRetry(rl.run.runId)"
          >
            Retry
          </Button>
          <AdeTip v-if="rl.note" :text="rl.note">
            <span class="min-w-0 truncate text-kira-sm text-muted-foreground" data-testid="ade-run-note">{{ rl.note }}</span>
          </AdeTip>
        </div>
        <AdeSetupProgress
          v-if="heldRow(rl)?.branch.setup"
          class="my-0.5 ml-6"
          compact
          :branch="heldRow(rl)!.branch"
          :repo="heldRow(rl)!.repo"
        />
        <div v-if="openLog === rl.run.runId && rl.run.runId" class="my-0.5 ml-6">
          <AdeRunLog kind="run" :id="rl.run.runId" max-height="140px" />
        </div>
      </template>
    </div>

    <Button
      v-for="row in released"
      :key="row.id"
      variant="ghost"
      size="kira-lg"
      class="w-full justify-start gap-2 rounded-kira-sm bg-bg px-1.5 text-left text-fg"
      data-testid="ade-release-row"
      :data-branch-id="row.id"
      @click="ui.selectBranch(card.task.id, row.id)"
    >
      <span class="shrink-0 rounded-kira-sm px-1.5 py-px text-kira-sm font-semibold" :class="TONE_TAG_CLASS[row.branch.mergedIntoMain ? 'purple' : 'grey']">{{
        row.branch.mergedIntoMain ? 'main ✓' : 'main —'
      }}</span>
      <AdeTip v-for="c in integrationChips(row.branch)" :key="c.label" :text="c.tip">
        <span class="shrink-0 text-kira-sm font-semibold" :class="chipClass(c.tone)">{{ c.label }}</span>
      </AdeTip>
      <AdeRepoTag :code-repo-id="row.branch.codeRepoId" :label="row.repo" />
      <span class="min-w-0 truncate font-data text-kira-md">{{ row.name }}</span>
    </Button>
    <div
      v-for="row in reviewRows"
      :key="`review-${row.id}`"
      class="flex h-7 items-center gap-2 rounded-kira-sm bg-bg px-1.5"
      data-testid="ade-review-row"
      :data-branch-id="row.id"
    >
      <AdeRepoTag :code-repo-id="row.branch.codeRepoId" :label="row.repo" />
      <span class="min-w-0 flex-1 truncate font-data text-kira-md">{{ row.name }}</span>
      <AdeTip :text="row.branch.name === '' ? 'Create the branch first' : 'Open the review window'">
        <Button
          variant="dialog"
          size="kira"
          class="shrink-0"
          :disabled="row.branch.name === ''"
          data-testid="ade-review-code"
          @click="onReview(row.id)"
        >
          Review code
        </Button>
      </AdeTip>
    </div>
    <p v-if="error" class="m-0 text-kira-sm text-error" data-testid="ade-stage-block-error">{{ error }}</p>
  </div>
</template>
