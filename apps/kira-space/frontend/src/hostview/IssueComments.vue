<script setup lang="ts">
import SectionHeading from '@theme/components/SectionHeading.vue';
import { FieldDescription } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import { formatRelative } from '@workbench/behaviour/format';
import MarkdownBody from './MarkdownBody.vue';
import type { IssueComment } from './wire';

// Read-only comments, oldest first, with a note when the list is partial.
defineProps<{
  comments: IssueComment[];
  truncated: boolean;
  omitted: boolean;
  label: string;
}>();
</script>

<template>
  <section class="mt-6 flex flex-col gap-3" data-testid="issue-comments">
    <SectionHeading :label="t('space.hostView.conversation.heading.title')" />
    <FieldDescription v-if="comments.length === 0 && !omitted" data-testid="issue-comments-empty">{{
      t('space.hostView.conversation.empty.empty')
    }}</FieldDescription>
    <FieldDescription v-if="omitted" data-testid="issue-comments-omitted">{{
      t('space.hostView.issue.comments.omitted.hint', { label })
    }}</FieldDescription>
    <FieldDescription v-else-if="truncated" data-testid="issue-comments-truncated">{{
      t('space.hostView.issue.comments.truncated.hint', { label })
    }}</FieldDescription>
    <article
      v-for="comment in comments"
      :key="comment.id"
      class="rounded-kira-md border border-border px-3 py-2"
      :class="comment.pending && 'text-muted-foreground'"
      :data-pending="comment.pending || undefined"
      data-testid="issue-comment"
    >
      <div class="m-0 mb-1 text-kira-sm text-muted-foreground">
        <span class="font-medium text-fg">{{ comment.author.name }}</span>
        · {{ formatRelative(comment.createdAt) }}
        <span
          v-if="comment.updatedAt && comment.updatedAt > comment.createdAt"
          data-testid="issue-comment-edited"
          >· {{ t('space.hostView.issue.comments.edited.status') }}</span
        >
      </div>
      <MarkdownBody :source="comment.body" />
    </article>
  </section>
</template>
