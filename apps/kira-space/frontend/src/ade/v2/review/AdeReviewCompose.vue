<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { onKeyStroke, useTimeoutFn } from '@vueuse/core';
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
  10_000,
  { immediate: false },
);

const STATUS_TEXT: Record<Exclude<Status, ''>, string> = {
  sent: 'Sent',
  answering: 'Answering…',
  noSubmit: 'Claude Code did not take the message; press Enter in its terminal.',
};

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
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onKeyStroke(
  'Enter',
  (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      void send();
    }
  },
  { target: () => box.value?.$el as HTMLElement | undefined },
);

watch(
  () => store.askNonce,
  () => (box.value?.$el as HTMLElement | undefined)?.focus(),
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
        aria-label="Drop the code reference"
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
      placeholder="Ask about this branch"
      aria-label="Question for the review agent"
      data-testid="ade-review-question"
    />
    <div class="flex items-center gap-2">
      <Tooltip :disabled="!blocked">
        <TooltipTrigger as-child>
          <span>
            <Button variant="dialog" size="kira" :disabled="!canSend" data-testid="ade-review-send" @click="send">Send</Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Claude Code is waiting for an answer in its terminal.</TooltipContent>
      </Tooltip>
      <span v-if="status" class="text-kira-sm text-muted-foreground" data-testid="ade-review-status">{{ STATUS_TEXT[status] }}</span>
      <span v-else-if="error" class="text-kira-sm text-error" data-testid="ade-review-error">{{ error }}</span>
    </div>
  </div>
</template>
