<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
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
    { label: t('space.workbench.claudeUsage.session.label'), long: t('space.workbench.claudeUsage.fiveHourLong.label'), window: d.fiveHour },
    { label: t('space.workbench.claudeUsage.weeklyLong.label'), long: t('space.workbench.claudeUsage.weeklyLong.label'), window: d.sevenDay },
  ].filter((w): w is { label: string; long: string; window: ClaudeUsageWindow } => w.window !== null);
});

const text = computed(() => {
  if (isError.value && windows.value.length === 0) return t('space.workbench.claudeUsage.unavailable.status');
  if (windows.value.length === 0) return t('space.workbench.claudeUsage.unknown.status');
  return windows.value
    .map((w) => t('common.progressPercent.label', { label: w.label, percent: Math.round(w.window.usedPercent) }))
    .join(' · ');
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
    return t('space.workbench.claudeUsage.line.status', { window: w.long, percent: Math.round(w.window.usedPercent), when, left });
  }),
);

const sourceLine = computed(() => {
  const d = data.value;
  if (d?.state !== 'ok') return '';
  const when = formatRelative(d.updatedAt, now.value.getTime());
  return t(d.source === 'run' ? 'space.workbench.claudeUsage.sourceRun.status' : 'space.workbench.claudeUsage.sourceSession.status', { when });
});

const detail = computed(() => {
  if (isError.value && windows.value.length === 0) return t('space.workbench.claudeUsage.readFailed.error');
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
