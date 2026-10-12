<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { TooltipDisabledTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import { computed, ref } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import AdeAutomationsBlock from '../automation/AdeAutomationsBlock.vue';
import { archiveTip, STATUS_TONE, statusLabel } from '../board/actions';
import { dayLabel, LATER } from '../board/calendar';
import { taskFacts, taskPatch } from '../board/panelFacts';
import { taskReviewTip } from '../board/reviewCode';
import AdeNotesEditor from '../notes/AdeNotesEditor.vue';
import type { CardModel, PlanModel } from '../plan/usePlanModel';
import { useTaskMenu } from '../plan/useTaskMenu';
import { useUpdateTask } from '../queries';
import { useReviewCode } from '../review/useReviewCode';
import AdeTaskActionButton from '../run/AdeTaskActionButton.vue';
import AdeSessionsTab from '../sessions/AdeSessionsTab.vue';
import { useSessionViews } from '../sessions/useSessionViews';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import AdePanelFrame from './AdePanelFrame.vue';
import AdeTaskTab from './AdeTaskTab.vue';

// Task mode: header facts, the Task, Notes and Sessions tabs.
const props = defineProps<{ card: CardModel; model: PlanModel }>();

const ui = useAdeBoardUiStore();
const dialogs = useAdeDialogsStore();
const { sessions } = useSessionViews();
const sessionCount = computed(
  () =>
    sessions.value.filter((x) => x.taskId === props.card.task.id && x.state === 'running').length,
);
const update = useUpdateTask();
const taskMenu = useTaskMenu(() => props.card);
function openMore(ev: MouseEvent): void {
  if (ev.currentTarget instanceof Element) taskMenu.openAt(ev.currentTarget);
}
const reviewCode = useReviewCode();
const choices = computed(() => reviewCode.choicesOf(props.card));
const reviewTip = computed(() => taskReviewTip(choices.value));
const reviewDisabled = computed(
  () => reviewCode.pending.value || choices.value.every((c) => c.disabled),
);
const notesError = ref('');

/** A finished task shows Archive as its stage action; any other task gets the quiet one. */
const quietArchive = computed(
  () => props.card.task.kind !== 'review' && props.card.action?.kind !== 'archive',
);

const tone = computed(() => (props.card.parked ? 'grey' : STATUS_TONE[props.card.status]));
const label = computed(() =>
  props.card.parked ? t('space.ade.board.notMerging.label') : statusLabel(props.card.status),
);

const facts = computed(() => {
  const e = props.card.entry;
  const cal = props.model.cal;
  const span =
    e.day === LATER
      ? t('common.later.label')
      : dayLabel(cal, e.day) + (e.days.length > 1 ? `–${dayLabel(cal, e.end)}` : '');
  const repos: string[] = [];
  for (const row of props.card.rows) if (!repos.includes(row.repo)) repos.push(row.repo);
  const p = props.card.progress;
  return taskFacts({
    span,
    branches: props.card.rows.length,
    repos,
    doneSteps: p.doneSteps,
    steps: p.steps.length,
  });
});

async function saveNotes(taskId: string, value: string): Promise<void> {
  notesError.value = '';
  try {
    await update.mutateAsync({ taskId, patch: taskPatch({ notes: value }) });
  } catch (err) {
    notesError.value = errorText(err);
  }
}
</script>

<template>
  <AdePanelFrame
    v-model="ui.taskTab"
    :title="t('common.task.label')"
    :tabs="[
      { value: 'task', label: t('common.task.label') },
      { value: 'notes', label: t('space.common.notes.label') },
      { value: 'sessions', label: t('space.ade.panel.sessionsTab.label', { count: sessionCount }) },
    ]"
  >
    <template #actions>
      <AdeTaskActionButton :card="card" />
      <AdeTip v-if="quietArchive" :text="archiveTip()">
        <Button
          variant="dialog"
          size="kira-lg"
          :pending="dialogs.pending.has(`archive:${card.task.id}`)"
          data-testid="ade-panel-archive"
          @click="dialogs.archive(card.task.id)"
        >
          {{ t('space.common.archive.label') }}
        </Button>
      </AdeTip>
      <AdeTip v-if="choices.length" :parts="reviewTip">
        <TooltipDisabledTrigger :disabled="reviewDisabled">
          <Button
            variant="dialog"
            size="kira-lg"
            :disabled="reviewDisabled"
            data-testid="ade-panel-review"
            @click="(ev: MouseEvent) => reviewCode.openTask(card, ev.currentTarget as HTMLElement)"
          >
            {{ t('space.ade.board.taskMenu.reviewCode.label') }}
          </Button>
        </TooltipDisabledTrigger>
      </AdeTip>
      <TooltipIconButton
        icon="ellipsis"
        :label="t('common.moreActions.tooltip')"
        class="shrink-0"
        data-testid="ade-panel-more"
        @click="openMore"
      />
    </template>
    <template #header>
      <div class="flex items-start gap-2">
        <span
          class="mt-1 box-border size-3 shrink-0 rounded-kira-xs"
          :class="card.parked ? 'border-2 border-dashed' : ''"
          :style="card.parked ? { borderColor: card.color } : { background: card.color }"
          data-testid="ade-panel-dot"
        />
        <AdeChip :label="label" :tone="tone" />
        <AdeTip :text="card.title">
          <h3
            class="m-0 line-clamp-2 min-w-0 flex-1 break-words text-kira-lg font-medium text-fg"
            data-testid="ade-panel-title"
          >
            {{ card.title }}
          </h3>
        </AdeTip>
      </div>
      <div class="truncate text-kira-sm text-muted-foreground" data-testid="ade-panel-facts">{{
        facts
      }}</div>
      <Alert
        v-if="ui.actionError[card.task.id]"
        variant="error"
        data-testid="ade-panel-action-error"
        ><AlertDescription>{{ ui.actionError[card.task.id] }}</AlertDescription></Alert
      >
      <AdeAutomationsBlock :task-id="card.task.id" />
      <Alert v-if="card.review" variant="info" data-testid="ade-panel-review-note"
        ><AlertDescription>{{
          t('space.ade.taskPanel.reviewNote.body', { owner: card.task.owner || t('space.ade.taskPanel.someone.label') })
        }}</AlertDescription></Alert
      >
    </template>
    <AdeTaskTab v-if="ui.taskTab === 'task'" :card="card" />
    <AdeSessionsTab v-else-if="ui.taskTab === 'sessions'" :task-id="card.task.id" />
    <div v-else class="flex min-h-0 flex-1 flex-col p-3" data-testid="ade-notes-tab">
      <AdeNotesEditor :notes="card.task.notes" :item-id="card.task.id" @save="saveNotes" />
      <Alert v-if="notesError" variant="error" data-testid="ade-notes-error"
        ><AlertDescription>{{ notesError }}</AlertDescription></Alert
      >
    </div>
  </AdePanelFrame>
</template>
