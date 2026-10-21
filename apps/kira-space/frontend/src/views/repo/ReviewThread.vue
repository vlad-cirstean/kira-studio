<script setup lang="ts">
// One review thread's body over Monaco, mounted into an IViewZone by
// reviewDecorations.ts via createApp/unmount, never routed through the workbench's own tab
// system (this is editor-surface furniture, not a view). Two modes: 'view' renders an existing
// ReviewComment (body, anchor label, Delete); 'compose' is the empty add-comment form
// (reviewComments.ts:5-7's own "the gutter + is the discoverable affordance", ported as a glyph +
// this zone rather than VS Code's own comment-widget chrome). All three transport calls
// (review.comment.add/remove, plus the repaint that follows) stay in reviewDecorations.ts — this
// component only renders and emits.
import type { ReviewComment, ReviewCommentKind, ReviewCommentState } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
import { Textarea } from '@theme/components/ui/textarea';
import VarText from '@theme/components/VarText.vue';
import { t } from '@theme/i18n';
import { useShortcut } from '@workbench/shortcuts/useShortcut';
import { computed, ref, useTemplateRef } from 'vue';
import { anchorParts } from './reviewAnchor';

const props = defineProps<{
  mode: 'view' | 'compose';
  comment?: ReviewComment;
  /** The review session's branch — reviewComments.ts:63-74's own anchorLabel needs it for the
   *  'removed'/'stale' message text; 'exact'/'projected' render no label (current lines, no
   *  caveat). */
  branch: string;
}>();

const emit = defineEmits<{
  close: [];
  delete: [];
  submit: [body: string, kind: ReviewCommentKind];
  setState: [state: ReviewCommentState];
  cancel: [];
}>();

const anchorLabel = computed(() => anchorParts(props.comment, props.branch));

const draft = ref('');
const kind = ref<ReviewCommentKind>('change');
const KIND_ITEMS = computed(() => [
  {
    value: 'change',
    label: t('git.review.comments.kind.change.label'),
    testid: 'review-thread-kind-change',
  },
  {
    value: 'question',
    label: t('space.ade.needs.kind.question.label'),
    testid: 'review-thread-kind-question',
  },
]);
const nextState = computed<ReviewCommentState>(() =>
  props.comment?.state === 'addressed' ? 'open' : 'addressed',
);
const input = useTemplateRef<{ $el: HTMLElement }>('input');
useShortcut(
  () => input.value?.$el,
  ['form.submit'],
  () => submit(),
);

function submit(): void {
  const body = draft.value.trim();
  if (body === '') return;
  emit('submit', body, kind.value);
}
</script>

<template>
  <!-- §3.1: Monaco's view-lines layer otherwise wins text selection inside this zone too. -->
  <div
    class="box-border w-full h-full bg-elevated border-t border-b border-border-strong text-fg text-kira-md flex flex-col gap-1.5 overflow-auto select-text py-2 px-3"
    data-testid="review-thread"
  >
    <template v-if="mode === 'view' && comment">
      <div v-if="anchorLabel" class="text-warn italic"><VarText :parts="anchorLabel" /></div>
      <div class="flex items-center gap-1.5 text-kira-sm text-muted-foreground">
        <span data-testid="review-thread-kind-chip">{{
          comment.kind === 'question'
            ? t('space.ade.needs.kind.question.label')
            : t('git.review.comments.kind.change.label')
        }}</span>
        <span data-testid="review-thread-state-chip">{{
          comment.state === 'addressed'
            ? t('git.review.comments.state.addressed.label')
            : t('common.action.open.label')
        }}</span>
      </div>
      <div class="whitespace-pre-wrap break-words">{{ comment.body }}</div>
      <div
        v-if="comment.reply"
        class="whitespace-pre-wrap break-words border-l-2 border-border-strong pl-2 text-muted-foreground"
        data-testid="review-thread-reply"
      >
        {{ comment.reply }}
      </div>
      <div class="flex justify-end gap-1.5">
        <Button
          variant="toolbar"
          size="kira"
          data-testid="review-thread-state"
          @click="emit('setState', nextState)"
        >
          {{
            comment.state === 'addressed'
              ? t('git.review.comments.reopen.label')
              : t('git.review.comments.markAddressed.label')
          }}
        </Button>
        <Button variant="toolbar" size="kira" @click="emit('close')">
          <CodiconIcon name="close" :size="13" />
          {{ t('common.action.close.label') }}
        </Button>
        <Button variant="danger" size="kira" @click="emit('delete')">
          <CodiconIcon name="trash" :size="13" />
          {{ t('common.action.delete.label') }}
        </Button>
      </div>
    </template>
    <template v-else>
      <SecondaryTabs
        v-model="kind"
        variant="segmented"
        :items="KIND_ITEMS"
        data-testid="review-thread-kind"
      />
      <Textarea
        ref="input"
        v-model="draft"
        class="resize-y"
        :placeholder="t('space.repo.view.comment.placeholder')"
        rows="3"
        data-testid="review-thread-input"
      />
      <div class="flex justify-end gap-1.5">
        <Button variant="toolbar" size="kira" @click="emit('cancel')">{{
          t('common.action.cancel.label')
        }}</Button>
        <Button variant="toolbar-primary" size="kira" @click="submit">
          <CodiconIcon name="comment" :size="13" />
          {{ t('common.comment.label') }}
        </Button>
      </div>
    </template>
  </div>
</template>
