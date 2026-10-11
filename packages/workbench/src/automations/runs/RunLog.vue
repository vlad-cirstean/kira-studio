<script setup lang="ts">
import InlineState from '@theme/components/InlineState.vue';
import { cardVariants } from '@theme/components/ui/card';
import { FieldError } from '@theme/components/ui/field';
import { cn } from '@theme/lib/utils';
import { useScroll } from '@vueuse/core';
import { nextTick, ref, watch } from 'vue';
import { errorText } from '../../bridge/codedError';
import { useRunLog } from './runsQueries';

// A smart run's log: the first page, then pushed chunks, following the end unless the reader
// scrolled up.
const props = defineProps<{ runId: string }>();

const log = useRunLog(() => props.runId);
const el = ref<HTMLElement | null>(null);
const { arrivedState } = useScroll(el);

watch(
  () => log.data.value?.chunks.length,
  async () => {
    const follow = arrivedState.bottom;
    await nextTick();
    if (follow && el.value) el.value.scrollTop = el.value.scrollHeight;
  },
);
</script>

<template>
  <div
    ref="el"
:class="cn(cardVariants(), 'min-h-0 flex-1 gap-0 overflow-auto font-data text-kira-sm leading-relaxed')"
    data-testid="run-log"
  >
    <InlineState v-if="log.isPending.value" kind="loading">Loading…</InlineState>
    <FieldError v-else-if="log.isError.value" data-testid="run-log-error">
      {{ errorText(log.error.value) }}
    </FieldError>
    <template v-else-if="log.data.value">
      <div v-if="log.data.value.truncated" class="text-subtle">… earlier output dropped</div>
      <div v-if="log.data.value.chunks.length === 0" class="text-subtle">No output yet.</div>
      <div
        v-for="c in log.data.value.chunks"
        :key="c.seq"
        class="whitespace-pre-wrap break-words"
        :class="c.stream === 'stderr' ? 'text-error' : c.stream === 'event' ? 'text-muted-foreground' : 'text-fg'"
        data-testid="run-log-line"
        :data-stream="c.stream"
        >{{ c.text.replace(/\n$/, '') }}</div
      >
    </template>
  </div>
</template>
