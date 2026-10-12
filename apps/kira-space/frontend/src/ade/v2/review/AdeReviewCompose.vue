<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { type MessageKey, t } from '@theme/i18n';
import { useFocus, useTimeoutFn } from '@vueuse/core';
import { TIMING } from '@workbench/behaviour/timing';
import { errorText } from '@workbench/bridge/codedError';
import { useShortcut } from '@workbench/shortcuts/useShortcut';
import { computed, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { activityKind } from '../activity';
import { deliver } from '../dialog/deliver';
import { adeTurns, type TurnWatch } from '../dialog/turnWatch';
import { useSend } from '../queries';
import { type ReviewSelection, useAdeReviewWindowStore } from '../state/adeReviewWindow';
import type { ReviewWindowTarget, Session } from '../wire';

// The question box. A message is the code reference plus the draft, pasted into the running review
// agent's terminal. Delivery reuses the dialogs' arm-then-send path, so a turn is only counted from
// this prompt's own submit.
const props = defineProps<{ target: ReviewWindowTarget; repoLabel: string; session: Session }>();

const store = useAdeReviewWindowStore();
const sendM = useSend();
const box = useTemplateRef<InstanceType<typeof Textarea>>('box');

type Status = '' | 'sent' | 'answering' | 'noSubmit';
const status = ref<Status>('');
const error = ref('');
const turn: { current: TurnWatch | null } = { current: null };

// Claude Code accepts a pasted message only when it is not waiting for an answer in its terminal.
const blocked = computed(() => activityKind(props.session) === 'input');
const canSend = computed(() => store.draft.trim() !== '' && !blocked.value && !sendM.isPending.value);

function lines(sel: ReviewSelection): string {
  return sel.start === sel.end ? `L${sel.start}` : `L${sel.start}-L${sel.end}`;
}

const prefix = computed(() => {
  const head = `${props.repoLabel} ${props.target.branch}`;
  const ref = store.reference;
  return ref ? `[${head} · ${ref.path}:${lines(ref)}]` : `[${head}]`;
});

const { start: armHint, stop: stopHint } = useTimeoutFn(
  () => {
    if (status.value === 'sent') status.value = 'noSubmit';
  },
  TIMING.agentPasteWait,
  { immediate: false },
);

const STATUS_TEXT = {
  sent: 'common.sent.status',
  answering: 'space.ade.review.compose.answering.loading',
  noSubmit: 'space.ade.review.compose.noSubmit.hint',
} as const satisfies Record<Exclude<Status, ''>, MessageKey>;

async function send(): Promise<void> {
  if (!canSend.value) return;
  error.value = '';
  turn.current?.cancel();
  turn.current = null;
  const message = `${prefix.value} ${store.draft.trim()}`;
  try {
    await deliver(
      { send: (a) => sendM.mutateAsync(a) },
      { kind: 'send', sessionId: props.session.id, terminalId: props.session.terminalId, message },
      (terminalId, requireSubmit) => {
        status.value = 'sent';
        turn.current = adeTurns.watch(terminalId, {
          requireSubmit,
          onSubmit: () => {
            stopHint();
            status.value = 'answering';
          },
        });
        armHint();
      },
    );
    store.sent();
    void (turn.current as TurnWatch | null)?.done.then(() => {
      stopHint();
      status.value = '';
    });
  } catch (err) {
    (turn.current as TurnWatch | null)?.cancel();
    turn.current = null;
    stopHint();
    status.value = '';
    error.value = errorText(err);
  }
}

const boxEl = computed(() => box.value?.$el as HTMLElement | undefined);
useShortcut(boxEl, ['form.submit'], () => void send());

const { focused: boxFocused } = useFocus(boxEl);
watch(
  () => store.askNonce,
  () => {
    boxFocused.value = true;
  },
);

onUnmounted(() => {
  turn.current?.cancel();
  stopHint();
});
</script>

<template>
  <div class="flex flex-none flex-col gap-1.5 border-t border-border p-2" data-testid="ade-review-compose">
    <div v-if="store.reference" class="flex items-center gap-1.5 text-kira-sm text-muted-foreground">
      <span class="truncate font-data" data-testid="ade-review-reference">{{ store.reference.path }}:{{ lines(store.reference) }}</span>
      <Button
        v-if="store.asked"
        variant="toolbar"
        size="kira"
        :aria-label="t('space.ade.review.compose.dropReference.aria')"
        data-testid="ade-review-reference-clear"
        @click="store.asked = null"
      >
        ×
      </Button>
    </div>
    <Textarea
      ref="box"
      v-model="store.draft"
      rows="3"
      :placeholder="t('space.ade.review.compose.question.placeholder')"
      :aria-label="t('space.ade.review.compose.question.aria')"
      data-testid="ade-review-question"
    />
    <div class="flex items-center gap-2">
      <Tooltip :disabled="!blocked">
        <TooltipTrigger as-child>
          <span>
            <Button variant="dialog" size="kira" :disabled="!canSend" data-testid="ade-review-send" @click="send">{{ t('common.action.send.label') }}</Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ t('space.ade.review.compose.blocked.tooltip') }}</TooltipContent>
      </Tooltip>
      <span v-if="status" class="text-kira-sm text-muted-foreground" data-testid="ade-review-status">{{ t(STATUS_TEXT[status]) }}</span>
      <FieldError v-else-if="error" data-testid="ade-review-error">{{ error }}</FieldError>
    </div>
  </div>
</template>
