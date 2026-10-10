<script setup lang="ts">
import { TONE_SOLID_CLASS, TONE_TAG_CLASS } from '@ade/tones';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useAuthStore } from '../state/auth';
import type { PlanCard } from '../state/useAgentsModel';
import { useTaskActions } from '../state/useTaskActions';

// One planned task: status, current stage and progress, expanding to every stage and its steps.
const props = defineProps<{ card: PlanCard; open: boolean }>();
defineEmits<{ toggle: [] }>();

const STATUS_TONE = {
  'To do': 'grey',
  'In progress': 'amber',
  'In review': 'blue',
  Done: 'green',
  Blocked: 'red',
} as const;
const tone = computed(() => STATUS_TONE[props.card.status]);

const { permissions } = storeToRefs(useAuthStore());
const actions = useTaskActions(() => props.card);
const canMove = computed(() => permissions.value.write && props.card.blocks.length > 0);
const stopFirst = computed(() => props.card.moves.live);
</script>

<template>
  <li class="border-b border-border" data-testid="plan-task" :data-status="card.status">
    <button
      type="button"
      class="flex w-full items-start gap-2.5 bg-transparent px-3 py-2.5 text-left text-fg"
      :aria-expanded="open"
      @click="$emit('toggle')"
    >
      <span class="mt-1.5 size-2.5 shrink-0 rounded-full" :style="{ background: card.color }" />
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="text-kira-md">{{ card.title }}</span>
        <span class="flex flex-wrap items-center gap-1.5 text-kira-sm">
          <span class="rounded-kira-sm px-2 py-0.5" :class="TONE_TAG_CLASS[tone]" data-testid="plan-status">{{ card.status }}</span>
          <span v-if="card.progress.label" class="text-muted-foreground" data-testid="plan-stage">{{ card.progress.label }}</span>
          <Badge v-for="repo in card.repos" :key="repo" variant="chip" class="bg-field text-muted-foreground">{{ repo }}</Badge>
        </span>
        <span
          v-if="card.progress.showBar"
          class="h-1 overflow-hidden rounded-full bg-field"
          role="progressbar"
          :aria-valuenow="card.progress.percent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="block h-full bg-primary" :style="{ width: `${card.progress.percent}%` }" />
        </span>
        <span v-if="card.attention" class="text-kira-sm text-warn" data-testid="plan-attention">{{ card.attention }}</span>
      </span>
    </button>

    <ol v-if="open" class="m-0 flex list-none flex-col gap-2 px-3 pb-3 pl-8" data-testid="plan-stages">
      <li v-if="!card.blocks.length" class="text-kira-sm text-subtle">No workflow.</li>
      <li v-for="block in card.blocks" :key="block.stage.id" class="flex flex-col gap-0.5" :data-state="block.state">
        <span class="flex items-center gap-2 text-kira-md" :class="block.state === 'now' ? 'font-medium text-fg' : 'text-muted-foreground'">
          <span aria-hidden="true">{{ block.state === 'done' ? '✓' : block.state === 'now' ? '▸' : '○' }}</span>
          {{ block.stage.name }}
          <span v-if="block.count" class="text-kira-sm text-subtle">{{ block.count }}</span>
          <span v-if="block.state === 'skipped'" class="text-kira-sm text-subtle">skipped</span>
        </span>
        <ul v-if="block.steps.length" class="m-0 flex list-none flex-col gap-0.5 p-0 pl-5">
          <li v-for="view in block.steps" :key="view.step.id" class="flex items-center gap-2 text-kira-sm">
            <span class="size-1.5 shrink-0 rounded-full" :class="TONE_SOLID_CLASS[view.tone]" />
            <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ view.step.name }}</span>
            <span class="text-subtle">{{ view.statusText }}</span>
          </li>
        </ul>
      </li>
    </ol>

    <div v-if="open && canMove" class="flex flex-wrap gap-2 px-3 pb-3 pl-8" data-testid="plan-actions">
      <Button size="kira"
        variant="dialog"
        class="h-11 px-4"
        :disabled="stopFirst || !card.moves.prev"
        data-testid="plan-stage-back"
        @click="actions.ask('back')"
      >
        Back
      </Button>
      <Button size="kira"
        variant="dialog"
        class="h-11 px-4"
        :disabled="stopFirst || !card.moves.next"
        data-testid="plan-stage-next"
        @click="actions.ask('next')"
      >
        Next
      </Button>
      <Button size="kira"
        v-if="actions.startKind.value"
        variant="dialog-primary"
        class="h-11 px-4"
        data-testid="plan-start"
        @click="actions.ask('start')"
      >
        Start
      </Button>
      <p v-if="stopFirst" class="m-0 w-full text-kira-sm text-subtle">Stop its running agents first to move it.</p>
    </div>

    <div v-if="open && permissions.agentInput && card.tuiSessions.length" class="flex flex-col gap-1 px-3 pb-3 pl-8">
      <RouterLink
        v-for="session in card.tuiSessions"
        :key="session.id"
        :to="{ name: 'terminal', params: { sessionId: session.id } }"
        class="flex h-11 items-center rounded-kira border border-border-strong bg-field px-3 text-kira-md text-fg no-underline"
        data-testid="plan-terminal"
      >
        Terminal
      </RouterLink>
    </div>
    <ConfirmDialog
      :open="actions.intent.value !== null"
      :title="actions.dialog.value.title"
      :text="actions.dialog.value.text"
      :confirm-label="actions.dialog.value.confirmLabel"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @cancel="actions.cancel"
      @confirm="actions.confirm"
    />
  </li>
</template>
