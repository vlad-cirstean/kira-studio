<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useIntervalFn, useNow } from '@vueuse/core';
import { formatDateTime, formatDuration, formatRelative } from '@workbench/behaviour/format';
import { TIMING } from '@workbench/behaviour/timing';
import { computed } from 'vue';
import type { ClaudeUsageWindow } from '../bridge/index';
import { useClaudeUsage } from '../state/claudeUsage';

// P239: ADE status-bar readout of the Claude Code 5-hour and weekly limits.
const WARN_AT = 80;
const ERROR_AT = 95;

const { data, isError } = useClaudeUsage();
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, TIMING.clockTickSlow) });

const windows = computed(() => {
  const d = data.value;
  if (d?.state !== 'ok') return [];
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

const lines = computed(() =>
  windows.value.map((w) => {
    const when = formatDateTime(w.window.resetsAt);
    const left = formatDuration(Math.max(0, Math.round((w.window.resetsAt - now.value.getTime()) / 60_000)) * 60_000);
    return `${w.long}: ${Math.round(w.window.usedPercent)}% used · resets ${when} (in ${left})`;
  }),
);

const sourceLine = computed(() => {
  const d = data.value;
  if (d?.state !== 'ok') return '';
  const from = d.source === 'run' ? 'a background ADE run' : 'a Claude Code session';
  return `From ${from}, ${formatRelative(d.updatedAt, now.value.getTime())}`;
});

const detail = computed(() => {
  if (isError.value && windows.value.length === 0) return 'Could not read the usage limits';
  return data.value?.state === 'ok' ? '' : (data.value?.detail ?? '');
});
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        variant="toolbar"
        size="kira"
        class="h-control-sm gap-1 px-1.5 text-kira-sm font-normal"
        :class="tone"
        data-testid="claude-usage-status"
      >
        <CodiconIcon name="dashboard" :size="13" />
        <span class="font-data" data-testid="claude-usage-text">{{ text }}</span>
      </Button>
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
