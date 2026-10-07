<script setup lang="ts">
import { useScroll } from '@vueuse/core';
import { nextTick, ref, watch } from 'vue';
import { useLog } from '../queries';
import type { LogChunk, LogKind } from '../wire';

// Inline log of one run or worktree setup (R28): the first page, then pushed chunks, following the
// tail unless the reader scrolled up.
const props = defineProps<{ kind: LogKind; id: string; maxHeight?: string }>();

const log = useLog(
  () => props.kind,
  () => props.id,
);
const el = ref<HTMLElement | null>(null);
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
  <div
    ref="el"
    class="overflow-auto rounded-kira border border-border bg-bg px-2.5 py-2 font-data text-kira-sm leading-relaxed"
    :style="{ maxHeight: maxHeight ?? '240px' }"
    data-testid="ade-run-log"
    :data-log-id="id"
  >
    <div v-if="log.isPending.value" class="text-subtle">Loading…</div>
    <div v-else-if="log.isError.value" class="text-error" data-testid="ade-run-log-error">
      {{ log.error.value instanceof Error ? log.error.value.message : String(log.error.value) }}
    </div>
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
  </div>
</template>
