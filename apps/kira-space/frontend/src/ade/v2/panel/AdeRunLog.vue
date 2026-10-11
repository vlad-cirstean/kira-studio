<script setup lang="ts">
import InlineState from '@theme/components/InlineState.vue';
import { Card } from '@theme/components/ui/card';
import { useFollowTail } from '@workbench/behaviour/followTail';
import QueryState from '@workbench/components/QueryState.vue';
import { computed, useTemplateRef } from 'vue';
import { useLog } from '../readQueries';
import type { LogChunk, LogKind } from '../wire';

// Inline log of one run or worktree setup (R28): the first page, then pushed chunks, following the
// tail unless the reader scrolled up.
const props = defineProps<{ kind: LogKind; id: string; maxHeight?: string }>();

const log = useLog(
  () => props.kind,
  () => props.id,
);
const card = useTemplateRef<InstanceType<typeof Card>>('card');
const el = computed<HTMLElement | null>(() => (card.value?.$el as HTMLElement | undefined) ?? null);
useFollowTail(el, () => log.data.value?.chunks.length);

function failed(c: LogChunk): boolean {
  return c.stream === 'stderr' || /exit code [1-9]/i.test(c.text);
}

</script>

<template>
  <Card
    ref="card"
    class="gap-0 overflow-auto font-data text-kira-sm leading-relaxed"
    :class="maxHeight ? undefined : 'max-h-60'"
    :style="maxHeight ? { maxHeight } : undefined"
    data-testid="ade-run-log"
    :data-log-id="id"
  >
    <QueryState :query="log" variant="inline" :is-empty="() => false">
      <template #error="{ message }">
        <InlineState kind="error" data-testid="ade-run-log-error">{{ message }}</InlineState>
      </template>
      <template #default="{ data }">
        <div v-if="data.truncated" class="text-subtle">… earlier output dropped</div>
        <div v-if="data.chunks.length === 0" class="text-subtle">No output yet.</div>
        <div
          v-for="c in data.chunks"
          :key="c.seq"
          class="whitespace-pre-wrap break-words"
          :class="failed(c) ? 'text-error' : 'text-fg'"
          data-testid="ade-run-log-line"
          :data-stream="c.stream"
          >{{ c.text.replace(/\n$/, '') }}</div
        >
      </template>
    </QueryState>
  </Card>
</template>
