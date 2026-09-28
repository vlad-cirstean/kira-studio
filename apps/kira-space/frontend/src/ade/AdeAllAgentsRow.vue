<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { formatTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import AdeActivityGlyph from './AdeActivityGlyph.vue';
import { adeAgoOptions } from './ago';
import type { AllAgentsRow } from './allAgents';
import { CLAUDE_BUTTON_STYLE } from './tones';

// P129 Part 7 §2.4: one All-agents row (mockup 67-78) — grid columns 4px (colour bar) / 20px
// (glyph) / 130px (label) / 76px (last active) / 64px (button) / 90px (`claude <id>`) / 1fr (title
// over `branch worktree`), exactly the mockup's own column order. Props only; the parent
// (`AdeAllAgentsView`) owns same-window vs. cross-window Open (§0.8/§0.9) and the Start dialog
// (§0.10) — this component only emits which row and which action.
const props = defineProps<{ row: AllAgentsRow }>();

const emit = defineEmits<{ open: [row: AllAgentsRow]; start: [row: AllAgentsRow] }>();

/** Mockup `stateStyle` (line 881): literal tone text colour, `input`/`working`/`waiting` only —
 *  every other kind (idle, stopped, archived) reads the same muted grey. */
const labelColor = computed(() => {
  if (props.row.kind === 'input') return '#f0b85c';
  if (props.row.kind === 'working') return '#7fd49b';
  if (props.row.kind === 'waiting') return '#93b6ff';
  return '#9a9ca5';
});

/** Mockup `rowStyle` (line 882): the needs-input tint — only a running session ever reads `input`
 *  (`activityKind`), so `kind === 'input'` alone reproduces the mockup's own `x.act === 'input' &&
 *  isRun` guard. */
const rowBackground = computed(() =>
  props.row.kind === 'input' ? 'rgba(232,163,61,0.07)' : 'transparent',
);

const lastActive = computed(() => formatTimeAgo(new Date(props.row.lastActiveAt), adeAgoOptions));

function onAction(): void {
  if (props.row.action === 'open') emit('open', props.row);
  else emit('start', props.row);
}
</script>

<template>
  <div
    class="grid grid-cols-[4px_20px_130px_76px_64px_90px_minmax(0,1fr)] items-center gap-x-3.5 rounded-kira px-3 py-1.5"
    :style="{ background: rowBackground }"
    data-testid="ade-all-agents-row"
    :data-session-id="row.sessionId"
  >
    <span class="w-1 self-stretch rounded-kira-xs" :style="{ background: row.color }" />
    <AdeActivityGlyph :kind="row.kind" :size="14" :title="row.label" />
    <span class="truncate text-kira-sm" :style="{ color: labelColor }">{{ row.label }}</span>
    <span class="truncate text-kira-sm text-[#9a9ca5]">{{ lastActive }}</span>
    <Button
      v-if="row.action === 'open'"
      variant="dialog"
      class="h-[26px] shrink-0 rounded-kira-sm px-2.5 text-kira-sm"
      data-testid="ade-all-agents-action"
      @click="onAction"
    >
      Open
    </Button>
    <Button
      v-else
      variant="ghost"
      class="h-[26px] shrink-0 rounded-kira-sm px-2.5 text-kira-sm font-semibold"
      :style="CLAUDE_BUTTON_STYLE"
      data-testid="ade-all-agents-action"
      @click="onAction"
    >
      Start
    </Button>
    <span class="truncate font-data text-kira-sm text-[#9a9ca5]">{{ row.claudeLabel }}</span>
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-kira-sm font-semibold" data-testid="ade-all-agents-title">{{
        row.title
      }}</span>
      <span class="truncate font-data text-kira-sm text-[#7c7f88]"
        >{{ row.branchText }} {{ row.worktree }}</span
      >
    </div>
  </div>
</template>
