<script setup lang="ts">
import { shortAge } from '@ade/ago';
import { tagStyle } from '@ade/tones';
import { Alert } from '@theme/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { useAgentsModel } from '../state/useAgentsModel';

// Everything that waits on you, most urgent first. Read-only: acting happens on the computer.
const { model, boardQuery } = useAgentsModel();
</script>

<template>
  <section class="flex flex-col" data-testid="needs-screen">
    <p v-if="boardQuery.isPending.value" class="m-0 p-4 text-muted-foreground">Loading</p>
    <Alert v-else-if="boardQuery.isError.value" variant="destructive" class="m-3 w-auto" data-testid="needs-error">
      Could not load the board.
    </Alert>
    <template v-else-if="model">
      <Empty v-if="model.needs.empty" class="py-10" data-testid="needs-empty">
        <EmptyHeader>
          <EmptyTitle>Nothing needs you</EmptyTitle>
          <EmptyDescription>{{ model.needs.footer }}</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <template v-else>
        <ul class="m-0 flex list-none flex-col p-0">
          <li
            v-for="item in model.needs.items"
            :key="item.id"
            class="flex flex-col gap-1 border-b border-border px-3 py-2.5"
            data-testid="needs-item"
            :data-kind="item.kind"
          >
            <span class="flex items-center gap-2">
              <span
                class="rounded-kira-sm px-2 py-0.5 text-kira-sm font-bold"
                :style="tagStyle(item.tone)"
                >{{ item.kind }}</span
              >
              <span class="text-kira-sm text-subtle">{{ shortAge(item.ageMs) }}</span>
              <span class="ml-auto flex min-w-0 items-center gap-1.5 text-kira-sm text-subtle">
                <span
                  class="size-2 shrink-0 rounded-full"
                  :style="{ background: model.cards.get(item.taskId)?.color }"
                />
                <span class="truncate">{{ model.cards.get(item.taskId)?.title }}</span>
              </span>
            </span>
            <span class="text-kira-md text-fg">{{ item.what }}</span>
            <span v-if="item.detail" class="text-kira-sm text-muted-foreground">{{ item.detail }}</span>
            <span v-if="item.scope" class="text-kira-sm text-subtle">{{ item.scope }}</span>
          </li>
        </ul>
        <p class="m-0 px-3 py-2 text-kira-sm text-subtle" data-testid="needs-footer">{{ model.needs.footer }}</p>
      </template>
    </template>
  </section>
</template>
