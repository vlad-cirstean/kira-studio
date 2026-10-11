<script setup lang="ts">
import { cardVariants } from '@theme/components/ui/card';
import { FieldError } from '@theme/components/ui/field';
import { cn } from '@theme/lib/utils';
import { useFollowTail } from '@workbench/behaviour/followTail';
import QueryState from '@workbench/components/QueryState.vue';
import { ref } from 'vue';
import { useRunLog } from './runsQueries';

// A smart run's log: the first page, then pushed chunks, following the end unless the reader
// scrolled up.
const props = defineProps<{ runId: string }>();

const log = useRunLog(() => props.runId);
const el = ref<HTMLElement | null>(null);
useFollowTail(el, () => log.data.value?.chunks.length);
</script>

<template>
  <div
    ref="el"
:class="cn(cardVariants(), 'min-h-0 flex-1 gap-0 overflow-auto font-data text-kira-sm leading-relaxed')"
    data-testid="run-log"
  >
    <QueryState :query="log" variant="inline" :is-empty="() => false">
      <template #error="{ message }">
        <FieldError data-testid="run-log-error">{{ message }}</FieldError>
      </template>
      <template #default="{ data }">
        <div v-if="data.truncated" class="text-subtle">… earlier output dropped</div>
        <div v-if="data.chunks.length === 0" class="text-subtle">No output yet.</div>
        <div
          v-for="c in data.chunks"
          :key="c.seq"
          class="whitespace-pre-wrap break-words"
          :class="c.stream === 'stderr' ? 'text-error' : c.stream === 'event' ? 'text-muted-foreground' : 'text-fg'"
          data-testid="run-log-line"
          :data-stream="c.stream"
          >{{ c.text.replace(/\n$/, '') }}</div
        >
      </template>
    </QueryState>
  </div>
</template>
