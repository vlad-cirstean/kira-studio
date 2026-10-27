<script setup lang="ts">
import type { ChangeRequestReviewEvent } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { hostWords, type MessageKey, t } from '@theme/i18n';
import { useTimeoutFn } from '@vueuse/core';
import { TIMING } from '@workbench/behaviour/timing';
import { computed, ref } from 'vue';
import type { ReviewWindowTarget } from '../wire';
import AdeReviewSubmitDialog from './AdeReviewSubmitDialog.vue';
import { reviewGate, useChangeRequestReview } from './useChangeRequestReview';

const props = defineProps<{ target: ReviewWindowTarget }>();

const { state, openChangeRequest } = useChangeRequestReview(() => props.target);
const data = computed(() => state.data.value);
const ok = computed(() => (data.value?.kind === 'ok' ? data.value : null));
const unavailable = computed(() => (data.value?.kind === 'unavailable' ? data.value : null));
const short = computed(() => hostWords(ok.value?.host).changeRequestShort);

const EVENTS: readonly { event: ChangeRequestReviewEvent; label: MessageKey }[] = [
  { event: 'comment', label: 'common.comment.label' },
  { event: 'approve', label: 'common.action.approve.label' },
  { event: 'requestChanges', label: 'space.ade.review.actions.requestChanges.label' },
];
const items = computed(() => {
  const s = ok.value;
  return s ? EVENTS.map((e) => ({ ...e, gate: reviewGate(s, e.event) })) : [];
});

const mode = ref<ChangeRequestReviewEvent | 'conversation' | null>(null);
const posted = ref<'review' | 'comment' | null>(null);
const clearPosted = useTimeoutFn(() => (posted.value = null), TIMING.postedStatus, {
  immediate: false,
});
function done(kind: 'review' | 'comment'): void {
  posted.value = kind;
  clearPosted.start();
}
</script>

<template>
  <div
    v-if="ok || unavailable"
    class="wails-no-drag ml-auto flex shrink-0 items-center gap-1"
    data-testid="ade-review-actions"
  >
    <Tooltip v-if="unavailable">
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger>
          <Button
            variant="title"
            size="title-labelled"
            disabled
            data-testid="ade-review-actions-trigger"
          >
            {{ t('space.ade.board.branchTag.review.label') }}
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>{{ unavailable.status.reason }}</TooltipContent>
    </Tooltip>
    <template v-else-if="ok">
      <span
        v-if="posted"
        role="status"
        class="flex items-center gap-1 text-kira-sm text-muted-foreground"
        data-testid="ade-review-posted"
      >
        {{
          posted === 'review'
            ? t('space.ade.review.actions.postedReview.status')
            : t('space.ade.review.actions.postedComment.status')
        }}
        <Button
          variant="link"
          size="inline"
          class="text-kira-sm"
          @click="openChangeRequest(ok.number)"
        >
          {{ t('space.ade.review.actions.open.label', { short }) }}
        </Button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="title" size="title-labelled" data-testid="ade-review-actions-trigger">
            {{ t('space.ade.board.branchTag.review.label') }}
            <CodiconIcon name="chevron-down" :size="12" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <template v-for="i in items" :key="i.event">
            <DropdownMenuItem
              :disabled="!i.gate.enabled"
              :data-testid="`ade-review-action-${i.event}`"
              @select="mode = i.event"
            >
              {{ t(i.label) }}
            </DropdownMenuItem>
            <div
              v-if="!i.gate.enabled"
              class="max-w-64 px-1.5 pb-1 text-kira-sm text-muted-foreground"
              :data-testid="`ade-review-action-${i.event}-reason`"
            >
              {{ i.gate.reason }}
            </div>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="title"
        size="title-labelled"
        data-testid="ade-review-cr-comment"
        @click="mode = 'conversation'"
      >
        <CodiconIcon name="comment" :size="12" />
        {{ t('space.ade.review.actions.conversation.label', { short }) }}
      </Button>
    </template>
    <AdeReviewSubmitDialog
      v-if="mode && ok"
      :mode="mode"
      :target="target"
      :review="ok"
      @done="done"
      @close="mode = null"
    />
  </div>
</template>
