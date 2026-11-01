<script setup lang="ts">
import SectionHeading from '@theme/components/SectionHeading.vue';
import { Badge } from '@theme/components/ui/badge';
import { FieldDescription } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import { formatRelative } from '@workbench/behaviour/format';
import MarkdownBody from './MarkdownBody.vue';
import type { ReviewerState, Thread } from './wire';

defineProps<{ threads: Thread[]; truncated: boolean }>();

function reviewLabel(state: ReviewerState | undefined): string {
  switch (state) {
    case 'approved':
      return t('space.hostView.review.approved.status');
    case 'changesRequested':
      return t('space.hostView.review.changesRequested.status');
    case 'rejected':
      return t('space.hostView.review.rejected.status');
    default:
      return t('space.hostView.review.commented.status');
  }
}
</script>

<template>
  <section class="mt-6 flex flex-col gap-3" data-testid="host-view-conversation">
    <SectionHeading :label="t('space.hostView.conversation.heading.title')" />
    <FieldDescription v-if="threads.length === 0" data-testid="host-view-no-threads">{{
      t('space.hostView.conversation.empty.empty')
    }}</FieldDescription>
    <article
      v-for="thread in threads"
      :key="thread.id"
      class="rounded-kira-md border border-border"
      :data-kind="thread.kind"
      data-testid="host-view-thread"
    >
      <header
        v-if="thread.kind !== 'comment'"
        class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-kira-sm"
      >
        <Badge
          v-if="thread.kind === 'review'"
          variant="chip"
          data-testid="host-view-thread-review"
          >{{
            reviewLabel(thread.reviewState)
          }}</Badge
        >
        <span v-if="thread.path" class="font-data" data-testid="host-view-thread-path">{{
          thread.line ? `${thread.path}:${thread.line}` : thread.path
        }}</span>
        <Badge v-if="thread.resolved" variant="ok">{{
          t('space.hostView.conversation.resolved.status')
        }}</Badge>
        <Badge v-if="thread.outdated" variant="warn">{{
          t('space.hostView.conversation.outdated.status')
        }}</Badge>
      </header>
      <FieldDescription
        v-if="thread.commentsTruncated"
        class="border-b border-border px-3 py-1.5"
        data-testid="host-view-comments-truncated"
        >{{
          t('space.hostView.conversation.commentsTruncated.hint')
        }}</FieldDescription
      >
      <div
        v-for="comment in thread.comments"
        :key="comment.id"
        class="border-b border-border px-3 py-2 last:border-b-0"
        data-testid="host-view-comment"
      >
        <div class="m-0 mb-1 text-kira-sm text-muted-foreground">
          <span class="font-medium text-fg">{{ comment.author.name || comment.author.login }}</span>
          · {{ formatRelative(comment.createdAt) }}
        </div>
        <MarkdownBody :source="comment.body" />
      </div>
    </article>
    <FieldDescription v-if="truncated" data-testid="host-view-threads-truncated">{{
      t('space.hostView.conversation.truncated.hint')
    }}</FieldDescription>
  </section>
</template>
