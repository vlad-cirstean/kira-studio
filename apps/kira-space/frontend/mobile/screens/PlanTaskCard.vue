<script setup lang="ts">
import AdeChip from '@ade/AdeChip.vue';
import { statusLabel } from '@ade/board/actions';
import StatusDot from '@theme/components/StatusDot.vue';
import { Button } from '@theme/components/ui/button';
import { FieldDescription } from '@theme/components/ui/field';
import { Progress } from '@theme/components/ui/progress';
import { formatPercent } from '@theme/format';
import { t } from '@theme/i18n';
import ConfirmDialogView from '@workbench/components/ConfirmDialogView.vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
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
      class="flex w-full items-start gap-3 bg-transparent px-3 py-3 text-left text-fg"
      :aria-expanded="open"
      @click="$emit('toggle')"
    >
      <StatusDot class="mt-1.5" :color="card.color" />
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="text-kira-md">{{ card.title }}</span>
        <span class="flex flex-wrap items-center gap-1.5 text-kira-sm">
          <AdeChip :label="statusLabel(card.status)" :tone="tone" />
          <span v-if="card.progress.label" class="text-muted-foreground" data-testid="plan-stage">{{
            card.progress.label
          }}</span>
          <AdeChip v-for="repo in card.repos" :key="repo" :label="repo" tone="grey" />
        </span>
        <span v-if="card.progress.showBar" class="flex items-center gap-2">
          <Progress :model-value="card.progress.percent" />
          <span class="text-kira-sm text-fg">{{ formatPercent(card.progress.percent) }}</span>
        </span>
        <span v-if="card.attention" class="text-kira-sm text-warn" data-testid="plan-attention">{{
          card.attention
        }}</span>
      </span>
    </button>

    <ol
      v-if="open"
      class="m-0 flex list-none flex-col gap-2 px-3 pb-3 pl-8"
      data-testid="plan-stages"
    >
      <li v-if="!card.blocks.length" class="text-kira-sm text-subtle">{{
        t('mobile.plan.noWorkflow.empty')
      }}</li>
      <li
        v-for="block in card.blocks"
        :key="block.stage.id"
        class="flex flex-col gap-0.5"
        :data-state="block.state"
      >
        <span
          class="flex items-center gap-2 text-kira-md"
          :class="block.state === 'now' ? 'font-medium text-fg' : 'text-muted-foreground'"
        >
          <span aria-hidden="true">{{
            block.state === 'done' ? '✓' : block.state === 'now' ? '▸' : '○'
          }}</span>
          {{ block.stage.name }}
          <span v-if="block.count" class="text-kira-sm text-subtle">{{ block.count }}</span>
          <span v-if="block.state === 'skipped'" class="text-kira-sm text-subtle">{{
            t('common.skipped.status')
          }}</span>
        </span>
        <ul v-if="block.steps.length" class="m-0 flex list-none flex-col gap-0.5 p-0 pl-5">
          <li
            v-for="view in block.steps"
            :key="view.step.id"
            class="flex items-center gap-2 text-kira-sm"
          >
            <StatusDot :color="`var(--color-tone-${view.tone}-solid)`" />
            <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ view.step.name }}</span>
            <span class="text-subtle">{{ view.statusText }}</span>
          </li>
        </ul>
      </li>
    </ol>

    <div
      v-if="open && canMove"
      class="flex flex-wrap gap-2 px-3 pb-3 pl-8"
      data-testid="plan-actions"
    >
      <Button
        size="touch"
        variant="dialog"
        :disabled="stopFirst || !card.moves.prev"
        data-testid="plan-stage-back"
        @click="actions.ask('back')"
      >
        {{ t('common.action.back.label') }}
      </Button>
      <Button
        size="touch"
        variant="dialog"
        :disabled="stopFirst || !card.moves.next"
        data-testid="plan-stage-next"
        @click="actions.ask('next')"
      >
        {{ t('common.action.next.label') }}
      </Button>
      <Button
        size="touch"
        v-if="actions.startKind.value"
        variant="dialog-primary"
        data-testid="plan-start"
        @click="actions.ask('start')"
      >
        {{ t('common.action.start.label') }}
      </Button>
      <FieldDescription v-if="stopFirst" class="w-full">{{
        t('mobile.plan.stopFirst.hint')
      }}</FieldDescription>
    </div>

    <div
      v-if="open && permissions.agentInput && card.tuiSessions.length"
      class="flex flex-col gap-1 px-3 pb-3 pl-8"
    >
      <Button
        size="touch"
        v-for="session in card.tuiSessions"
        :key="session.id"
        as-child
        variant="dialog"
        class="no-underline"
      >
        <RouterLink
          :to="{ name: 'terminal', params: { sessionId: session.id } }"
          data-testid="plan-terminal"
          >{{
            t('common.module.terminal.label')
          }}</RouterLink
        >
      </Button>
    </div>
    <ConfirmDialogView
      touch
      tone="primary"
      :open="actions.intent.value !== null"
      :title="actions.dialog.value.title"
      :message="actions.dialog.value.text"
      :confirm-label="actions.dialog.value.confirmLabel"
      :busy="actions.busy.value"
      :error="actions.error.value"
      :testids="{ root: 'confirm-dialog', cancel: 'confirm-cancel', confirm: 'confirm-yes', error: 'confirm-error' }"
      @cancel="actions.cancel"
      @confirm="actions.confirm"
    />
  </li>
</template>
