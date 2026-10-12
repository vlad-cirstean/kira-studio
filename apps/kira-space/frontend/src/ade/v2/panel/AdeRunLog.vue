<script setup lang="ts">
import LogLines, { type LogLine } from '@workbench/components/LogLines.vue';
import QueryState from '@workbench/components/QueryState.vue';
import { useLog } from '../readQueries';
import type { LogChunk, LogKind } from '../wire';

// Inline log of one run or worktree setup (R28): the first page, then pushed chunks, following the
// tail unless the reader scrolled up.
const props = defineProps<{ kind: LogKind; id: string; maxHeight?: string }>();

const log = useLog(
  () => props.kind,
  () => props.id,
);

function toLines(chunks: readonly LogChunk[]): LogLine[] {
  return chunks.map((c) => ({
    id: c.seq,
    text: c.text,
    stream: c.stream === 'stderr' || /exit code [1-9]/i.test(c.text) ? 'stderr' : c.stream,
  }));
}
</script>

<template>
  <QueryState :query="log" variant="inline" :is-empty="() => false">
    <template #error="{ message }">
      <LogLines
        :lines="[]"
        :error="message"
        testid="ade-run-log"
        :max-height="maxHeight"
        :data-log-id="id"
      />
    </template>
    <template #default="{ data }">
      <LogLines
        :lines="toLines(data.chunks)"
        :truncated="data.truncated"
        testid="ade-run-log"
        :max-height="maxHeight"
        :data-log-id="id"
      />
    </template>
  </QueryState>
</template>
