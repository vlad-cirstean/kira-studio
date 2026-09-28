<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { computed } from 'vue';
import AdeAgentsPill from './AdeAgentsPill.vue';
import { rowHeightClass } from './rowHeight';
import type { QueueItem, QueueStackMember } from './useQueue';

// P129 Part 5 §0.21: one stack row (mockup `rowFor`, 1096-1129) — elbow, colour square, agents
// pill, owner pill, title/branch. Row click/title click/agent pill click all select. `data-ade-id`
// plus `data-ade-row-movable` (movable = non-review) are `useTimelineDrag`'s own row-level hooks
// (§0.12): a movable row's own drag starts the box's inner sortable; a review row bubbles to the
// box's own outer handle instead.
const props = defineProps<{
  member: QueueStackMember;
  item: QueueItem;
  /** The row's own parent item kind, `null` with no parent — decides the elbow colour (mockup
   *  `pd && pd.kind === 'review' ? '#7aa7ff' : '#5c606b'`). */
  parentKind: QueueItem['kind'] | null;
  /** This segment's own first row, on a continuation segment (mockup `g.cont && g.m[0].id === x.id`)
   *  — its elbow is dashed rather than solid. */
  dashedElbow: boolean;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  /** P129 Part 6 §0.21: bubbled from `AdeAgentsPill`'s own click, re-emitted with both arguments —
   *  `$event` only carries the first. */
  openSession: [itemId: string, sessionId: string];
}>();

const movable = computed(() => props.item.kind !== 'review' && props.item.kind !== 'dependency');
const merged = computed(() => props.item.status.label === 'merged');
const elbowColor = computed(() => (props.parentKind === 'review' ? '#7aa7ff' : '#5c606b'));

const titleClass = computed(() => {
  if (props.item.kind === 'review') return 'text-[#93b6ff]';
  if (props.item.kind === 'parked') return 'text-[#b4b6bd]';
  if (props.item.kind === 'dependency') return 'text-[#9fdde4]';
  return 'text-fg';
});

const rowStyle = computed(() => {
  if (props.selected) return { background: '#26272d', borderLeftColor: '#e8a33d' };
  if (merged.value) return { background: 'rgba(163,113,247,0.08)', borderLeftColor: 'transparent' };
  if (props.item.kind === 'review') {
    return {
      background:
        'repeating-linear-gradient(135deg, rgba(122,167,255,0.07) 0 8px, rgba(122,167,255,0.03) 8px 16px)',
      borderLeftColor: 'transparent',
    };
  }
  return { background: 'transparent', borderLeftColor: 'transparent' };
});

const dotClass = computed(() => {
  const kind = props.item.kind;
  if (kind === 'review') return 'rounded-[3px] border-2';
  if (kind === 'parked') return 'rounded-[3px] border-2 border-dashed';
  return 'rounded-[3px]';
});

function onPick(): void {
  emit('select', props.member.id);
}
</script>

<template>
  <div
    class="flex w-full items-center gap-2 border-l-3 px-2.5"
    :style="rowStyle"
    :class="[rowHeightClass(item), movable ? 'cursor-grab' : 'cursor-default']"
    data-testid="ade-stack-row"
    :data-ade-row-movable="movable ? '' : null"
    :data-ade-id="member.id"
    :data-ade-kind="item.kind"
    role="option"
    tabindex="0"
    :aria-selected="selected"
    @click="onPick"
    @keydown.enter.prevent="onPick"
    @keydown.space.prevent="onPick"
  >
    <span
      class="relative shrink-0 self-stretch"
      :style="{ width: `${member.dep * 18}px` }"
    >
      <span
        v-if="member.dep"
        class="absolute -top-1 right-0.5 h-[18px] w-[9px] rounded-bl"
        :style="{
          borderLeft: `2px ${dashedElbow ? 'dashed' : 'solid'} ${elbowColor}`,
          borderBottom: `2px solid ${elbowColor}`,
        }"
      />
    </span>
    <CodiconIcon
      v-if="item.kind === 'dependency'"
      name="globe"
      :size="11"
      :style="{ color: item.color }"
      class="shrink-0"
    />
    <span
      v-else
      class="size-2.5 shrink-0"
      :class="dotClass"
      :style="
        item.kind === 'review'
          ? { borderColor: item.color }
          : item.kind === 'parked'
            ? { borderColor: item.color }
            : item.draft
              ? {
                  border: `2px solid ${item.color}`,
                  background: `repeating-linear-gradient(135deg, ${item.color} 0 2px, transparent 2px 4px)`,
                }
              : { background: item.color }
      "
    />
    <AdeAgentsPill
      :item-id="item.id"
      :agents="item.agents"
      @open-session="(itemId, sessionId) => emit('openSession', itemId, sessionId)"
    />
    <span
      v-if="item.kind === 'review'"
      title="Someone else's branch: read-only here"
      class="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-[rgba(122,167,255,0.16)] px-2 text-kira-sm font-semibold text-[#93b6ff]"
    >
      <CodiconIcon name="lock" :size="10" />
      {{ item.owner }}
    </span>
    <div class="flex min-w-0 flex-1 flex-col justify-center">
      <button
        type="button"
        class="flex min-w-0 flex-col border-none bg-transparent text-left"
        :aria-label="`Open ${item.title}`"
        @click.stop="onPick"
      >
        <span class="truncate text-kira-md font-semibold leading-4" :class="titleClass">{{
          item.title
        }}</span>
        <span
          v-if="item.branchText"
          class="truncate font-data text-kira-sm leading-[14px]"
          :class="[item.draft ? 'italic text-[#9a9ca5]' : 'text-[#7c7f88]']"
          >{{ item.branchText }}</span
        >
      </button>
      <span
        v-if="item.jira"
        class="flex min-w-0 items-center gap-1.5 text-kira-sm leading-[14px]"
        data-testid="ade-row-jira"
      >
        <a
          v-if="item.jira.url"
          :href="item.jira.url"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 font-data text-[#7aa7ff] hover:underline"
          @click.stop
          >{{ item.jira.key }}</a
        >
        <span v-else class="shrink-0 font-data text-[#7aa7ff]">{{ item.jira.key }}</span>
        <span v-if="item.title !== item.jira.key" class="truncate text-[#9a9ca5]">{{
          item.title
        }}</span>
      </span>
    </div>
  </div>
</template>
