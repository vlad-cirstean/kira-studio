<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { computed, ref } from 'vue';
import AdeStackRow from './AdeStackRow.vue';
import { TONE } from './tones';
import type { QueueItem, QueueSegment, QueueTag } from './useQueue';
import type { DropResult } from './useTimelineDrag';
import { useTimelineDrag } from './useTimelineDrag';

// P129 Part 5 §0.21/§0.17: one stack block — the 210px action column (mockup 216-226) beside the
// box itself (mockup 227-260). §0.17's own click wiring: this component only emits the action
// object `useQueue.ts` already built (kind, targetIds/id, label) — the caller (`AdeRepoView`, via
// the bubble chain) is the one that knows what a rebase/queueAfter/forcePush/start/archive action
// does. §0.12: the box itself is the inner sortable's own root — its row list.
const props = defineProps<{
  segment: QueueSegment;
  itemsById: ReadonlyMap<string, QueueItem>;
  parentOf: Readonly<Record<string, string>>;
  selectedId: string | null;
}>();

type SegmentActionType = NonNullable<QueueSegment['action']>;
type CellActionType = NonNullable<QueueSegment['cells'][number]['action']>;

const emit = defineEmits<{
  select: [id: string];
  /** P129 Part 6 §0.21: bubbled from `AdeStackRow`, re-emitted with both arguments. */
  openSession: [itemId: string, sessionId: string];
  segmentAction: [action: SegmentActionType];
  cellAction: [action: CellActionType];
  drop: [result: NonNullable<DropResult>];
}>();

const boxEl = ref<HTMLElement | null>(null);
useTimelineDrag(boxEl, 'row', (result) => emit('drop', result));

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
  if (props.segment.dependency) {
    return {
      border: '1px dotted #4fb8c4',
      borderLeft: '3px solid #4fb8c4',
      background: 'rgba(79,184,196,0.07)',
    };
  }
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
  <div
    class="flex items-start gap-2"
    data-testid="ade-stack-block"
    :data-ade-block="segment.dependency ? null : ''"
    :data-ade-drag-ids="segment.dragIds.join(',')"
  >
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
          v-if="cell.blocked"
          :title="cell.blocked.tip"
          :style="tagStyle(cell.blocked.tone)"
          :data-testid="`ade-blocked-chip-${segment.members[i]?.id}`"
          class="flex shrink-0 items-center gap-0.5 rounded-kira-sm px-1.5 py-0.5 text-kira-sm font-semibold"
          ><CodiconIcon name="globe" :size="10" /> {{ cell.blocked.count }}</span
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
          @click="emit('segmentAction', segment.action)"
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
          @click="emit('cellAction', cell.action)"
          >{{ cell.action.label }}</button
        >
      </div>
    </div>
    <div
      ref="boxEl"
      class="flex min-w-0 max-w-140 flex-1 flex-col gap-0 rounded-kira py-0.5"
      :style="boxStyle"
      :title="segment.tag.tip"
      data-testid="ade-stack-box"
      :data-ade-box="segment.dependency ? null : ''"
      :data-ade-dependency="segment.dependency ? '' : null"
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
        @open-session="(itemId, sessionId) => emit('openSession', itemId, sessionId)"
      />
    </div>
  </div>
</template>
