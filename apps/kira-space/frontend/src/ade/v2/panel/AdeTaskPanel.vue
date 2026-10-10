<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { TooltipDisabledTrigger } from '@theme/components/ui/tooltip';
import { formatShortcut } from '@workbench/shortcuts/keys';
import { computed, ref } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import AdeAutomationsBlock from '../automation/AdeAutomationsBlock.vue';
import { ARCHIVE_TIP, STATUS_TONE } from '../board/actions';
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
import { TONE_TAG_CLASS } from '../tones';
import AdePanelFrame from './AdePanelFrame.vue';
import AdeTaskTab from './AdeTaskTab.vue';

// Task mode: header facts, the Task, Notes and Sessions tabs.
const props = defineProps<{ card: CardModel; model: PlanModel }>();

const ui = useAdeBoardUiStore();
const dialogs = useAdeDialogsStore();
const { sessions } = useSessionViews();
const sessionCount = computed(
  () => sessions.value.filter((x) => x.taskId === props.card.task.id && x.state === 'running').length,
);
const update = useUpdateTask();
const taskMenu = useTaskMenu(() => props.card);
function openMore(ev: MouseEvent): void {
  if (ev.currentTarget instanceof Element) taskMenu.openAt(ev.currentTarget);
}
const reviewCode = useReviewCode();
const choices = computed(() => reviewCode.choicesOf(props.card));
const reviewTip = computed(() => [...taskReviewTip(choices.value), ` (${formatShortcut('ade.reviewCode')})`]);
const reviewDisabled = computed(() => reviewCode.pending.value || choices.value.every((c) => c.disabled));
const notesError = ref('');

/** A finished task shows Archive as its stage action; any other task gets the quiet one. */
const quietArchive = computed(
  () => props.card.task.kind !== 'review' && props.card.action?.kind !== 'archive',
);

const tone = computed(() => (props.card.parked ? 'grey' : STATUS_TONE[props.card.status]));
const label = computed(() => (props.card.parked ? 'not merging' : props.card.status));

const facts = computed(() => {
  const e = props.card.entry;
  const cal = props.model.cal;
  const span =
    e.day === LATER ? 'Later' : dayLabel(cal, e.day) + (e.days.length > 1 ? `–${dayLabel(cal, e.end)}` : '');
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
    notesError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <AdePanelFrame
    v-model="ui.taskTab"
    title="Task"
    :tabs="[
      { value: 'task', label: 'Task' },
      { value: 'notes', label: 'Notes' },
      { value: 'sessions', label: `Sessions ${sessionCount}` },
    ]"
  >
    <template #actions>
      <AdeTaskActionButton :card="card" />
      <AdeTip v-if="quietArchive" :text="ARCHIVE_TIP">
        <Button
          variant="dialog"
          size="kira-lg"
          :disabled="dialogs.pending.has(`archive:${card.task.id}`)"
          data-testid="ade-panel-archive"
          @click="dialogs.archive(card.task.id)"
        >
          Archive
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
            Review code
          </Button>
        </TooltipDisabledTrigger>
      </AdeTip>
      <TooltipIconButton
        icon="ellipsis"
        label="More actions"
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
            class="m-0 line-clamp-2 min-w-0 flex-1 break-words text-kira-lg font-medium leading-4.5"
            data-testid="ade-panel-title"
          >
            {{ card.title }}
          </h3>
        </AdeTip>
      </div>
      <div class="truncate text-kira-sm text-muted-foreground" data-testid="ade-panel-facts">{{ facts }}</div>
      <p v-if="ui.actionError[card.task.id]" class="m-0 text-kira-sm text-error" data-testid="ade-panel-action-error">
        {{ ui.actionError[card.task.id] }}
      </p>
      <AdeAutomationsBlock :task-id="card.task.id" />
      <div
        v-if="card.review"
        class="flex items-center gap-2 rounded-kira px-2.5 py-1.5 text-kira-md"
        :class="TONE_TAG_CLASS.blue"
        data-testid="ade-panel-review-note"
      >
        {{ card.task.owner || 'Someone' }}’s work. Read-only here: you can keep your own notes.
      </div>
    </template>
    <AdeTaskTab v-if="ui.taskTab === 'task'" :card="card" />
    <AdeSessionsTab v-else-if="ui.taskTab === 'sessions'" :task-id="card.task.id" />
    <div v-else class="flex min-h-0 flex-1 flex-col p-3" data-testid="ade-notes-tab">
      <AdeNotesEditor :notes="card.task.notes" :item-id="card.task.id" @save="saveNotes" />
      <p v-if="notesError" class="pt-1 text-kira-sm text-error" data-testid="ade-notes-error">{{ notesError }}</p>
    </div>
  </AdePanelFrame>
</template>
