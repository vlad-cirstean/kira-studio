<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@theme/components/ui/input-group';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Toggle } from '@theme/components/ui/toggle';
import { useDebounceFn } from '@vueuse/core';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/util/virtualRows';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useDocker } from '../context';
import { parseAnsi, splitMatches } from '../lib/ansi';
import type { DockerLogLine } from '../wire';

const props = defineProps<{ containerId: string }>();

const MAX_LINES = 20_000;
const WRAP_RENDER_LINES = 2_000;
const ROW_HEIGHT = 18;
const TAILS = [
  { label: '100 lines', value: 100 },
  { label: '1000 lines', value: 1000 },
  { label: '5000 lines', value: 5000 },
  { label: 'All', value: -1 },
] as const;

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
let seq = 0;
let off: (() => void) | null = null;

const needle = computed(() => filter.value.trim().toLowerCase());
const visible = computed(() => {
  const q = needle.value;
  return q === '' ? lines.value : lines.value.filter((l) => l.text.toLowerCase().includes(q));
});
const wrapped = computed(() => visible.value.slice(-WRAP_RENDER_LINES));

const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll: onVirtualScroll } = useVirtualRows({
  count: () => visible.value.length,
  rowHeight: () => ROW_HEIGHT,
  scrollElement: scrollEl,
  overscan: 20,
});

const atBottom = ref(true);

function stick(): void {
  const el = scrollEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function onScroll(): void {
  onVirtualScroll();
  const el = scrollEl.value;
  if (!el) return;
  const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  atBottom.value = bottom;
  if (!bottom && follow.value) follow.value = false;
}

function jumpToLatest(): void {
  follow.value = true;
  void nextTick(stick);
}

function append(batch: DockerLogLine[]): void {
  const next = lines.value.concat(batch.map((l) => ({ ...l, n: seq++ })));
  lines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
  if (follow.value) void nextTick(stick);
}

async function close(): Promise<void> {
  off?.();
  off = null;
  const id = streamId;
  streamId = '';
  if (id) await control.logsClose(id).catch(() => undefined);
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
    await control.logsOpen({
      streamId: id,
      containerId: props.containerId,
      tail: tail.value,
      timestamps: timestamps.value,
      follow: true,
    });
  } catch (err) {
    failure.value = err instanceof Error ? err.message : String(err);
  }
}

const reopen = useDebounceFn(() => void open(), 150);

watch([() => props.containerId, tail, timestamps], () => void reopen(), { immediate: true });
watch(follow, (v) => {
  if (v) void nextTick(stick);
});
onBeforeUnmount(() => {
  reopen.cancel?.();
  void close();
});

function clear(): void {
  lines.value = [];
}
</script>

<template>
  <div class="flex h-full flex-col" data-testid="docker-logs">
    <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-1.5 py-1">
      <Toggle v-model="follow" size="kira" data-testid="docker-logs-follow" aria-label="Follow">Follow</Toggle>
      <Toggle v-model="timestamps" size="kira" data-testid="docker-logs-timestamps" aria-label="Timestamps">Timestamps</Toggle>
      <Toggle v-model="wrap" size="kira" data-testid="docker-logs-wrap" aria-label="Wrap">Wrap</Toggle>
      <NativeSelect v-model="tail" aria-label="Tail" data-testid="docker-logs-tail">
        <option v-for="t in TAILS" :key="t.value" :value="t.value">{{ t.label }}</option>
      </NativeSelect>
      <InputGroup class="w-56">
        <InputGroupAddon><CodiconIcon name="filter" :size="13" /></InputGroupAddon>
        <InputGroupInput v-model="filter" placeholder="Filter" data-testid="docker-logs-filter" />
        <InputGroupAddon v-if="needle" align="inline-end">
          <span class="text-kira-sm text-muted-foreground" data-testid="docker-logs-count">{{ visible.length }}</span>
        </InputGroupAddon>
      </InputGroup>
      <Button variant="ghost" size="kira" class="ml-auto" data-testid="docker-logs-clear" @click="clear">Clear</Button>
    </div>
    <div class="relative min-h-0 flex-1">
      <div
        ref="scrollEl"
        class="h-full overflow-auto bg-bg py-1 font-data text-kira-sm"
        data-testid="docker-logs-body"
        @scroll="onScroll"
      >
        <div v-if="wrap" class="px-2">
          <div v-for="l in wrapped" :key="l.n" class="whitespace-pre-wrap break-all" :class="l.stream === 'stderr' ? 'text-error' : ''" data-testid="docker-log-line" :data-stream="l.stream">
            <span v-if="timestamps && l.ts" class="mr-2 text-muted-foreground">{{ l.ts }}</span>
            <template v-for="(seg, i) in parseAnsi(l.text)" :key="i">
              <span :style="{ color: seg.color, background: seg.background }" :class="[seg.bold ? 'font-bold' : '', seg.faint ? 'opacity-70' : '']">
                <template v-for="(part, j) in splitMatches(seg.text, needle)" :key="j">
                  <mark v-if="part.match" class="bg-warn/40 text-inherit">{{ part.text }}</mark>
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
                    <mark v-if="part.match" class="bg-warn/40 text-inherit">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
              </template>
            </template>
          </div>
        </div>
      </div>
      <Button
        v-if="!atBottom && !follow"
        size="kira"
        class="absolute bottom-2 right-4"
        data-testid="docker-logs-jump"
        @click="jumpToLatest"
      >
        Jump to latest
      </Button>
    </div>
    <div
      v-if="failure || ended"
      class="shrink-0 border-t border-border bg-chrome px-2 py-0.5 text-kira-sm"
      :class="failure || streamError ? 'text-error' : 'text-muted-foreground'"
      data-testid="docker-logs-ended"
    >
      {{ failure || streamError || 'Container stopped' }}
    </div>
  </div>
</template>
