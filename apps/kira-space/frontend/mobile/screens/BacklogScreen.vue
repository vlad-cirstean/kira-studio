<script setup lang="ts">
import { adeAgoOptions } from '@ade/ago';
import { parseGithub } from '@ade/board/panelFacts';
import { useBacklog } from '@ade/readQueries';
import type { BacklogItem } from '@ade/wire';
import { Alert } from '@theme/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { useTimeAgo } from '@vueuse/core';
import { ref } from 'vue';

// Backlog in priority order. Read-only, so a row only expands to show its notes.
const backlog = useBacklog();
const open = ref<string | null>(null);

function facts(item: BacklogItem): string {
  const gh = parseGithub(item.githubUrl);
  return [item.jira?.key ?? '', gh ? `${gh.kind === 'PR' ? 'PR' : 'issue'} ${gh.ref}` : '']
    .filter(Boolean)
    .join(' · ');
}
const ago = (at: number) => useTimeAgo(at, adeAgoOptions);
</script>

<template>
  <section class="flex flex-col" data-testid="backlog-screen">
    <p v-if="backlog.isPending.value" class="m-0 p-4 text-muted-foreground">Loading</p>
    <Alert v-else-if="backlog.isError.value" variant="destructive" class="m-3 w-auto" data-testid="backlog-error">
      Could not load the backlog.
    </Alert>
    <Empty v-else-if="!backlog.data.value?.items.length" class="py-10" data-testid="backlog-empty">
      <EmptyHeader>
        <EmptyTitle>The backlog is empty</EmptyTitle>
        <EmptyDescription>Items added in Kira Space appear here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <ol v-else class="m-0 flex list-none flex-col p-0">
      <li v-for="(item, index) in backlog.data.value.items" :key="item.id" class="border-b border-border" data-testid="backlog-item">
        <button
          type="button"
          class="flex w-full items-start gap-3 bg-transparent px-3 py-2.5 text-left text-fg"
          :aria-expanded="open === item.id"
          @click="open = open === item.id ? null : item.id"
        >
          <span class="w-5 shrink-0 text-kira-sm text-subtle">{{ index + 1 }}</span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-kira-md">{{ item.text }}</span>
            <span class="text-kira-sm text-subtle">
              <template v-if="facts(item)">{{ facts(item) }} · </template>{{ ago(item.addedAt).value }}
            </span>
          </span>
        </button>
        <p
          v-if="open === item.id"
          class="m-0 whitespace-pre-wrap px-3 pb-3 pl-11 text-kira-md text-muted-foreground"
          data-testid="backlog-notes"
        >
          {{ item.notes || 'No notes.' }}
        </p>
      </li>
    </ol>
  </section>
</template>
