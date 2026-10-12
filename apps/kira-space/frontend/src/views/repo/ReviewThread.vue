<script setup lang="ts">
import { shortSha } from '@kira/git-core';
// C11 §7.4 (S10) — one review thread's body over Monaco, mounted into an IViewZone by
// reviewDecorations.ts (S9) via createApp/unmount, never routed through the workbench's own tab
// system (this is editor-surface furniture, not a view). Two modes: 'view' renders an existing
// ReviewComment (body, anchor label, Delete); 'compose' is the empty add-comment form
// (reviewComments.ts:5-7's own "the gutter + is the discoverable affordance", ported as a glyph +
// this zone rather than VS Code's own comment-widget chrome). All three transport calls
// (review.comment.add/remove, plus the repaint that follows) stay in reviewDecorations.ts — this
// component only renders and emits.
import type { ReviewComment } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Textarea } from '@theme/components/ui/textarea';
import { t } from '@theme/i18n';
import { useShortcut } from '@workbench/shortcuts/useShortcut';
import { computed, ref, useTemplateRef } from 'vue';

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
  const sha = shortSha(comment.anchorSha);
  switch (comment.anchor) {
    case 'removed':
      return t('space.repo.view.anchorRemoved.status', { branch: props.branch, sha });
    case 'stale':
      return t('space.repo.view.anchorStale.status', { branch: props.branch, sha });
    case 'exact':
    case 'projected':
      return undefined;
  }
  return undefined;
});

const draft = ref('');
const input = useTemplateRef<{ $el: HTMLElement }>('input');
useShortcut(() => input.value?.$el, ['form.submit'], () => submit());

function submit(): void {
  const body = draft.value.trim();
  if (body === '') return;
  emit('submit', body);
}
</script>

<template>
  <!-- §3.1: Monaco's view-lines layer otherwise wins text selection inside this zone too. -->
  <div class="box-border w-full h-full bg-elevated border-t border-b border-border-strong text-fg text-kira-md flex flex-col gap-1.5 overflow-auto select-text py-2 px-3" data-testid="review-thread">
    <template v-if="mode === 'view' && comment">
      <div v-if="anchorLabel" class="text-warn italic">{{ anchorLabel }}</div>
      <div class="whitespace-pre-wrap break-words">{{ comment.body }}</div>
      <div class="flex justify-end gap-1.5">
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
      <Textarea
        ref="input"
        v-model="draft"
        class="resize-y"
        :placeholder="t('space.repo.view.comment.placeholder')"
        rows="3"
        data-testid="review-thread-input"
      />
      <div class="flex justify-end gap-1.5">
        <Button variant="toolbar" size="kira" @click="emit('cancel')">{{ t('common.action.cancel.label') }}</Button>
        <Button variant="toolbar-primary" size="kira" @click="submit">
          <CodiconIcon name="comment" :size="13" />
          {{ t('common.comment.label') }}
        </Button>
      </div>
    </template>
  </div>
</template>
