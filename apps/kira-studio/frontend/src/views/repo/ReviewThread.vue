<script setup lang="ts">
// C11 §7.4 (S10) — one review thread's body over Monaco, mounted into an IViewZone by
// reviewDecorations.ts (S9) via createApp/unmount, never routed through the workbench's own tab
// system (this is editor-surface furniture, not a view). Two modes: 'view' renders an existing
// ReviewComment (body, anchor label, Delete); 'compose' is the empty add-comment form
// (reviewComments.ts:5-7's own "the gutter + is the discoverable affordance", ported as a glyph +
// this zone rather than VS Code's own comment-widget chrome). All three transport calls
// (review.comment.add/remove, plus the repaint that follows) stay in reviewDecorations.ts — this
// component only renders and emits.
import type { ReviewComment } from '@kira/git-ipc';
import { computed, ref } from 'vue';
import AppButton from '../../theme/primitives/AppButton.vue';

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
  submit: [body: string];
  cancel: [];
}>();

// reviewComments.ts:63-74, ported verbatim (the anchoring itself is server-side, §7.2 — this is
// only the display string).
const anchorLabel = computed<string | undefined>(() => {
  const comment = props.comment;
  if (!comment) return undefined;
  const sha8 = comment.anchorSha.slice(0, 8);
  switch (comment.anchor) {
    case 'removed':
      return `lines no longer exist on ${props.branch} — shown as of ${sha8}`;
    case 'stale':
      return `lines as of ${sha8} — ${props.branch}'s history was rewritten since`;
    case 'exact':
    case 'projected':
      return undefined;
  }
  return undefined;
});

const draft = ref('');

function submit(): void {
  const body = draft.value.trim();
  if (body === '') return;
  emit('submit', body);
}
</script>

<template>
  <div class="review-thread" data-testid="review-thread">
    <template v-if="mode === 'view' && comment">
      <div v-if="anchorLabel" class="review-thread-anchor">{{ anchorLabel }}</div>
      <div class="review-thread-body">{{ comment.body }}</div>
      <div class="review-thread-actions">
        <AppButton icon="close" @click="emit('close')">Close</AppButton>
        <AppButton icon="trash" variant="danger" @click="emit('delete')">Delete</AppButton>
      </div>
    </template>
    <template v-else>
      <textarea
        v-model="draft"
        class="review-thread-input"
        placeholder="Leave a review comment…"
        rows="3"
        data-testid="review-thread-input"
        @keydown.meta.enter="submit"
        @keydown.ctrl.enter="submit"
      />
      <div class="review-thread-actions">
        <AppButton @click="emit('cancel')">Cancel</AppButton>
        <AppButton icon="comment" variant="primary" @click="submit">Comment</AppButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.review-thread {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 8px 12px;
  background: var(--kira-bg-elevated);
  border-top: var(--kira-border-width) solid var(--kira-border-strong);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
  color: var(--kira-fg);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
  /* §3.1: Monaco's view-lines layer otherwise wins text selection inside this zone too. */
  user-select: text;
}

.review-thread-anchor {
  color: var(--kira-warn);
  font-style: italic;
}

.review-thread-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.review-thread-input {
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius-sm);
  padding: 6px 8px;
  font: inherit;
}

.review-thread-input:focus {
  outline: none;
  border-color: var(--kira-focus);
}

.review-thread-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
