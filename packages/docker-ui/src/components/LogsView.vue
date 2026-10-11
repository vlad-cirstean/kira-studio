<script setup lang="ts">
import SearchField from '@theme/components/SearchField.vue';
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Toggle } from '@theme/components/ui/toggle';
import { t } from '@theme/i18n';
import { useDebounceFn } from '@vueuse/core';
import { useFollowTail } from '@workbench/behaviour/followTail';
import { matchesQuery } from '@workbench/behaviour/match';
import { TIMING } from '@workbench/behaviour/timing';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/behaviour/virtualRows';
import { errorText } from '@workbench/bridge/codedError';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useDocker } from '../context';
import { parseAnsi, splitMatches } from '../lib/ansi';
import type { DockerLogLine } from '../wire';

const props = defineProps<{ containerId: string }>();

const MAX_LINES = 20_000;
const WRAP_RENDER_LINES = 2_000;
const ROW_HEIGHT = 18;
const TAILS = [100, 1000, 5000, -1] as const;

const tailLabel = (n: number): string => (n === -1 ? t('common.state.all.option') : t('docker.logs.tail.option', { count: n }));

interface Line extends DockerLogLine {
  n: number;
}

const { control } = useDocker();

const lines = shallowRef<Line[]>([]);
const follow = ref(true);
const timestamps = ref(false);
const wrap = ref(false);
const tail = ref<number>(1000);
const filter = ref('');
const ended = ref(false);
const failure = ref('');
const streamError = ref('');

let streamId = '';
let opening: Promise<unknown> = Promise.resolve();
let seq = 0;
let off: (() => void) | null = null;

const needle = computed(() => filter.value.trim().toLowerCase());
const visible = computed(() => {
  const q = needle.value;
  return q === '' ? lines.value : lines.value.filter((l) => matchesQuery(l.text, q));
});
const wrapped = computed(() => visible.value.slice(-WRAP_RENDER_LINES));

const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll: onVirtualScroll } = useVirtualRows({
  count: () => visible.value.length,
  rowHeight: () => ROW_HEIGHT,
  scrollElement: scrollEl,
  overscan: 20,
});

const { atBottom, jumpToLatest, stick } = useFollowTail(scrollEl, lines, { follow });

function append(batch: DockerLogLine[]): void {
  const next = lines.value.concat(batch.map((l) => ({ ...l, n: seq++ })));
  lines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

async function close(): Promise<void> {
  off?.();
  off = null;
  const id = streamId;
  streamId = '';
  if (!id) return;
  // LogsClose can reach Go before the in-flight LogsOpen registers the stream.
  await opening.catch(() => {
    // The open failure is reported by `open()`; there is no stream left to close.
  });
  await control.logsClose(id).catch(() => {
    // The stream is gone either way; Go drops it with the window.
  });
}

async function open(): Promise<void> {
  await close();
  lines.value = [];
  ended.value = false;
  failure.value = '';
  streamError.value = '';
  const id = `docker-logs:${crypto.randomUUID()}`;
  streamId = id;
  off = control.onLogs((e) => {
    if (e.streamId !== id) return;
    if (e.lines.length > 0) append(e.lines);
    if (e.ended) {
      ended.value = true;
      streamError.value = e.error ?? '';
    }
  });
  try {
    opening = control.logsOpen({
      streamId: id,
      containerId: props.containerId,
      tail: tail.value,
      timestamps: timestamps.value,
      follow: true,
    });
    await opening;
  } catch (err) {
    failure.value = errorText(err);
  }
}

const reopen = useDebounceFn(() => void open(), TIMING.search);

watch([() => props.containerId, tail, timestamps], () => void reopen(), { immediate: true });
watch(follow, (v) => {
  if (v) stick();
});
onBeforeUnmount(() => {
  reopen.cancel?.();
  void close();
});

const emptyText = computed(() => {
  if (needle.value) return t('docker.logs.noMatches.emptyHint');
  return ended.value ? t('docker.logs.none.emptyHint') : t('docker.logs.waiting.loading');
});

function clear(): void {
  lines.value = [];
}
</script>

<template>
  <div class="flex h-full flex-col" data-testid="docker-logs">
    <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-1.5 py-1">
      <Toggle v-model="follow" size="kira" data-testid="docker-logs-follow" :aria-label="t('docker.logs.follow.label')">{{ t('docker.logs.follow.label') }}</Toggle>
      <Toggle v-model="timestamps" size="kira" data-testid="docker-logs-timestamps" :aria-label="t('docker.logs.timestamps.label')">{{ t('docker.logs.timestamps.label') }}</Toggle>
      <Toggle v-model="wrap" size="kira" data-testid="docker-logs-wrap" :aria-label="t('docker.logs.wrap.label')">{{ t('docker.logs.wrap.label') }}</Toggle>
      <NativeSelect v-model="tail" :aria-label="t('docker.logs.tail.aria')" data-testid="docker-logs-tail">
        <option v-for="n in TAILS" :key="n" :value="n">{{ tailLabel(n) }}</option>
      </NativeSelect>
      <div class="w-56">
        <SearchField v-model="filter" :placeholder="t('common.action.filter.label')" data-testid="docker-logs-filter" />
      </div>
      <span v-if="needle" class="text-kira-sm text-muted-foreground" data-testid="docker-logs-count">{{ visible.length }}</span>
      <Button variant="ghost" size="kira" class="ml-auto" data-testid="docker-logs-clear" @click="clear">{{ t('common.action.clear.label') }}</Button>
    </div>
    <div class="relative min-h-0 flex-1">
      <div
        ref="scrollEl"
        class="h-full overflow-auto bg-bg py-1 font-data text-kira-sm"
        data-testid="docker-logs-body"
        @scroll="onVirtualScroll"
      >
        <div v-if="wrap" class="px-2">
          <div v-for="l in wrapped" :key="l.n" class="whitespace-pre-wrap break-all" :class="l.stream === 'stderr' ? 'text-error' : ''" data-testid="docker-log-line" :data-stream="l.stream">
            <span v-if="timestamps && l.ts" class="mr-2 text-muted-foreground">{{ l.ts }}</span>
            <template v-for="(seg, i) in parseAnsi(l.text)" :key="i">
              <span :style="{ color: seg.color, background: seg.background }" :class="[seg.bold ? 'font-bold' : '', seg.faint ? 'opacity-70' : '']">
                <template v-for="(part, j) in splitMatches(seg.text, needle)" :key="j">
                  <mark v-if="part.match" class="bg-search-match text-inherit">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </template>
          </div>
        </div>
        <div v-else class="relative" :style="{ height: `${totalSize}px` }">
          <div
            v-for="vi in virtualItems"
            :key="String(vi.key)"
            :class="[VIRTUAL_ROW_CLASS, 'whitespace-pre px-2', visible[vi.index]?.stream === 'stderr' ? 'text-error' : '']"
            :style="{ height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }"
            data-testid="docker-log-line"
            :data-stream="visible[vi.index]?.stream"
          >
            <template v-if="visible[vi.index]">
              <span v-if="timestamps && visible[vi.index]!.ts" class="mr-2 text-muted-foreground">{{ visible[vi.index]!.ts }}</span>
              <template v-for="(seg, i) in parseAnsi(visible[vi.index]!.text)" :key="i">
                <span :style="{ color: seg.color, background: seg.background }" :class="[seg.bold ? 'font-bold' : '', seg.faint ? 'opacity-70' : '']">
                  <template v-for="(part, j) in splitMatches(seg.text, needle)" :key="j">
                    <mark v-if="part.match" class="bg-search-match text-inherit">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
              </template>
            </template>
          </div>
        </div>
      </div>
      <p
        v-if="visible.length === 0"
        class="pointer-events-none absolute inset-0 grid place-items-center text-muted-foreground"
        data-testid="docker-logs-empty"
      >
        {{ emptyText }}
      </p>
      <Button
        v-if="!atBottom() && !follow"
        variant="toolbar"
        size="kira"
        class="absolute bottom-2 right-4"
        data-testid="docker-logs-jump"
        @click="jumpToLatest"
      >
        {{ t('docker.logs.jumpToLatest.label') }}
      </Button>
    </div>
    <FieldError
      v-if="failure || (ended && streamError)"
      class="shrink-0 border-t border-border bg-chrome px-2 py-0.5"
      data-testid="docker-logs-ended"
    >
      {{ failure || streamError }}
    </FieldError>
    <div
      v-else-if="ended"
      class="shrink-0 border-t border-border bg-chrome px-2 py-0.5 text-kira-sm text-muted-foreground"
      data-testid="docker-logs-ended"
    >
      {{ t('docker.logs.stopped.status') }}
    </div>
  </div>
</template>
