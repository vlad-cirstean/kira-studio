<script setup lang="ts">
import { computed } from 'vue';
import AdeStackRow from './AdeStackRow.vue';
import type { QueueItem, QueueSegment, QueueTag } from './useQueue';

// P129 Part 5 §0.21/§0.17: one stack block — the 210px action column (mockup 216-226) beside the
// box itself (mockup 227-260). Read-only apart from selection this commit: cell/segment action
// buttons render (label, tip, disabled) but their click wiring lands with §0.17 in commit 9 (day-off
// and overdue/overflow buttons in commit 8); the box's own inner sortable is commit 10's.
const props = defineProps<{
  segment: QueueSegment;
  itemsById: ReadonlyMap<string, QueueItem>;
  parentOf: Readonly<Record<string, string>>;
  selectedId: string | null;
}>();

const emit = defineEmits<{ select: [id: string] }>();

// Mockup `tone()` (line 650-659) — literal tints, one 6-tone palette, never theme tokens (§0 standing
// decision: tone tints stay literal). `[background, foreground, solid]`.
const TONE: Record<QueueTag['tone'], [string, string, string]> = {
  amber: ['rgba(232,163,61,0.14)', '#f0b85c', '#e8a33d'],
  red: ['rgba(239,107,91,0.14)', '#f28b7d', '#ef6b5b'],
  green: ['rgba(108,197,138,0.14)', '#7fd49b', '#6cc58a'],
  blue: ['rgba(122,167,255,0.14)', '#93b6ff', '#7aa7ff'],
  purple: ['rgba(163,113,247,0.16)', '#c3a3fb', '#a371f7'],
  grey: ['#23252b', '#b4b6bd', '#6b6f7a'],
};

const items = computed(() => props.segment.members.map((m) => props.itemsById.get(m.id) as QueueItem));

function parentKindOf(memberId: string): QueueItem['kind'] | null {
  const parent = props.parentOf[memberId];
  if (parent === undefined) return null;
  return props.itemsById.get(parent)?.kind ?? null;
}

const isRipple = computed(() => props.segment.tag.label === '↻ rebases');
const isMerged = computed(() => props.segment.tag.label === '✓ merged');

const boxStyle = computed(() => {
  const solid = TONE[props.segment.tag.tone][2];
  if (props.segment.parked) {
    return {
      border: '1px dashed #3a3e48',
      background: 'repeating-linear-gradient(135deg, #17181c 0 7px, #1c1d22 7px 14px)',
      borderLeft: `3px solid ${solid}`,
    };
  }
  const border = isRipple.value
    ? '2px solid #e8a33d'
    : isMerged.value
      ? '1px solid rgba(163,113,247,0.55)'
      : props.segment.cont
        ? '1px dashed #3a3e48'
        : '1px solid #2a2d35';
  return { border, borderLeft: `3px solid ${solid}`, background: '#1a1c21' };
});

function tagStyle(tone: QueueTag['tone']): { background: string; color: string } {
  const [bg, fg] = TONE[tone];
  return { background: bg, color: fg };
}

function actionButtonStyle(tone: QueueTag['tone'], disabled: boolean): Record<string, string> {
  const solid = TONE[tone][2];
  return {
    background: solid,
    color: tone === 'purple' ? '#ffffff' : '#15161a',
    opacity: disabled ? '0.5' : '1',
  };
}
</script>

<template>
  <div class="flex items-start gap-2" data-testid="ade-stack-block">
    <div class="flex w-[210px] shrink-0 flex-col pt-[3px]">
      <div
        v-for="(cell, i) in segment.cells"
        :key="segment.members[i]?.id ?? i"
        class="flex h-10 min-w-0 items-center justify-end gap-1.5"
      >
        <span
          v-if="i === 0"
          :title="cell.tip"
          class="max-w-[120px] shrink truncate rounded-kira-sm px-1.5 py-0.5 text-kira-sm font-semibold"
          :style="tagStyle(segment.tag.tone)"
          >{{ segment.tag.label }}</span
        >
        <span
          v-else-if="cell.tag"
          :title="cell.tip"
          class="max-w-[120px] shrink truncate rounded-kira-sm px-1.5 py-0.5 text-kira-sm font-semibold"
          :style="tagStyle(cell.tag.tone)"
          >{{ cell.tag.label }}</span
        >
        <span
          v-if="cell.info"
          :title="cell.tip"
          class="min-w-0 truncate text-kira-sm text-muted-foreground"
          >{{ cell.info }}</span
        >
        <button
          v-if="i === 0 && segment.action"
          type="button"
          :disabled="segment.action.disabled"
          :title="segment.action.tip"
          class="h-[22px] shrink-0 whitespace-nowrap rounded-kira-sm px-2.5 text-kira-sm font-semibold"
          :style="actionButtonStyle(segment.tag.tone, segment.action.disabled)"
          :data-testid="`ade-segment-action-${segment.action.kind}`"
          >{{ segment.action.label }}</button
        >
        <button
          v-if="cell.action"
          type="button"
          :title="cell.action.tip"
          class="h-[22px] shrink-0 whitespace-nowrap rounded-kira-sm px-2.5 text-kira-sm font-semibold"
          :style="
            cell.action.kind === 'archive'
              ? { background: '#a371f7', color: '#ffffff' }
              : { background: '#d97757', color: '#1a0f0a' }
          "
          :data-testid="`ade-cell-action-${cell.action.kind}-${cell.action.id}`"
          >{{ cell.action.label }}</button
        >
      </div>
    </div>
    <div
      class="flex min-w-0 max-w-140 flex-1 flex-col gap-0 rounded-kira py-0.5"
      :style="boxStyle"
      :title="segment.tag.tip"
      data-testid="ade-stack-box"
      data-ade-box
      :data-ade-lead="segment.lead ?? ''"
      :data-ade-day="segment.day"
    >
      <AdeStackRow
        v-for="(member, i) in segment.members"
        :key="member.id"
        :member="member"
        :item="items[i] as QueueItem"
        :parent-kind="parentKindOf(member.id)"
        :dashed-elbow="segment.cont && i === 0"
        :selected="selectedId === member.id"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
