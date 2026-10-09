<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useIntervalFn, useNow } from '@vueuse/core';
import { computed } from 'vue';
import type { ClaudeUsageWindow } from '../bridge/index';
import { useClaudeUsage } from '../state/claudeUsage';

// P239: ADE status-bar readout of the Claude Code 5-hour and weekly limits.
const WARN_AT = 80;
const ERROR_AT = 95;

const { data, isError } = useClaudeUsage();
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 30_000) });

const windows = computed(() => {
  const d = data.value;
  if (!d || d.state !== 'ok') return [];
  return [
    { label: '5h', long: '5-hour', window: d.fiveHour },
    { label: 'wk', long: 'Weekly', window: d.sevenDay },
  ].filter((w): w is { label: string; long: string; window: ClaudeUsageWindow } => w.window !== null);
});

const text = computed(() => {
  if (isError.value && windows.value.length === 0) return 'Usage unavailable';
  if (windows.value.length === 0) return 'Usage: –';
  return windows.value.map((w) => `${w.label} ${Math.round(w.window.usedPercent)}%`).join(' · ');
});

const tone = computed(() => {
  const top = Math.max(0, ...windows.value.map((w) => w.window.usedPercent));
  if (top >= ERROR_AT) return 'text-error';
  if (top >= WARN_AT) return 'text-warn-text';
  return 'text-fg';
});

function span(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const lines = computed(() =>
  windows.value.map((w) => {
    const at = new Date(w.window.resetsAt);
    const when = at.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `${w.long}: ${Math.round(w.window.usedPercent)}% used · resets ${when} (in ${span(w.window.resetsAt - now.value.getTime())})`;
  }),
);

const sourceLine = computed(() => {
  const d = data.value;
  if (!d || d.state !== 'ok') return '';
  const from = d.source === 'run' ? 'a background ADE run' : 'a Claude Code session';
  return `From ${from}, ${span(now.value.getTime() - d.updatedAt)} ago`;
});

const detail = computed(() => {
  if (isError.value && windows.value.length === 0) return 'Could not read the usage limits';
  return data.value?.state === 'ok' ? '' : (data.value?.detail ?? '');
});
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span
        class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-kira-sm cursor-default border-0 bg-none hover:bg-hover"
        :class="tone"
        data-testid="claude-usage-status"
      >
        <CodiconIcon name="pulse" :size="13" />
        <span class="font-data" data-testid="claude-usage-text">{{ text }}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent>
      <div class="flex flex-col gap-0.5" data-testid="claude-usage-tooltip">
        <span v-for="line in lines" :key="line">{{ line }}</span>
        <span v-if="sourceLine" class="text-subtle">{{ sourceLine }}</span>
        <span v-if="detail">{{ detail }}</span>
      </div>
    </TooltipContent>
  </Tooltip>
</template>
