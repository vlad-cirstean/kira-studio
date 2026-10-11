<script setup lang="ts">
import InlineState from '@theme/components/InlineState.vue';
import { Card } from '@theme/components/ui/card';
import { useScroll } from '@vueuse/core';
import { errorText } from '@workbench/bridge/codedError';
import { computed, nextTick, useTemplateRef, watch } from 'vue';
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
const { arrivedState } = useScroll(el);

function failed(c: LogChunk): boolean {
  return c.stream === 'stderr' || /exit code [1-9]/i.test(c.text);
}

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
  <Card
    ref="card"
    class="gap-0 overflow-auto font-data text-kira-sm leading-relaxed"
    :class="maxHeight ? undefined : 'max-h-60'"
    :style="maxHeight ? { maxHeight } : undefined"
    data-testid="ade-run-log"
    :data-log-id="id"
  >
    <InlineState v-if="log.isPending.value" kind="loading">Loading…</InlineState>
    <InlineState v-else-if="log.isError.value" kind="error" data-testid="ade-run-log-error">
      {{ errorText(log.error.value) }}
    </InlineState>
    <template v-else-if="log.data.value">
      <div v-if="log.data.value.truncated" class="text-subtle">… earlier output dropped</div>
      <div v-if="log.data.value.chunks.length === 0" class="text-subtle">No output yet.</div>
      <div
        v-for="c in log.data.value.chunks"
        :key="c.seq"
        class="whitespace-pre-wrap break-words"
        :class="failed(c) ? 'text-error' : 'text-fg'"
        data-testid="ade-run-log-line"
        :data-stream="c.stream"
        >{{ c.text.replace(/\n$/, '') }}</div
      >
    </template>
  </Card>
</template>
