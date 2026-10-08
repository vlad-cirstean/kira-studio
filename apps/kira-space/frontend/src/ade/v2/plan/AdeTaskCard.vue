<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import type { BranchAction } from '../board/actions';
import AdeTaskActionButton from '../run/AdeTaskActionButton.vue';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { TONE_SOLID_CLASS, TONE_TAG_CLASS } from '../tones';
import AdeActionCell from './AdeActionCell.vue';
import AdeAttention from './AdeAttention.vue';
import AdeBranchRow from './AdeBranchRow.vue';
import type { BranchRowModel, CardModel } from './usePlanModel';
import { useTaskMenu } from './useTaskMenu';

const props = defineProps<{ card: CardModel }>();
const emit = defineEmits<{ select: []; forcePush: [row: BranchRowModel] }>();

const ui = useAdeBoardUiStore();
const dialogs = useAdeDialogsStore();
const taskMenu = useTaskMenu(() => props.card);

function onMenuKey(ev: KeyboardEvent): void {
  if (ev.currentTarget instanceof Element) taskMenu.openAt(ev.currentTarget);
}

function act(row: BranchRowModel, a: BranchAction): void {
  if (a.kind === 'forcePush') emit('forcePush', row);
  else if (a.kind === 'seeError') {
    ui.selectBranch(row.branch.taskId, row.id);
    ui.focusSetup = true;
  } else if (a.kind === 'start') dialogs.start(row.id);
  else dialogs.rebase(row.id, a);
}

const p = computed(() => props.card.progress);
const segClass = (state: string): string => {
  if (state === 'done') return 'bg-tone-green-solid';
  if (state === 'todo') return 'bg-border-strong';
  if (state === 'skipped') return 'bg-border';
  return p.value.bad ? 'bg-tone-red-solid' : 'bg-tone-amber-solid';
};
const labelClass = computed(() => {
  if (p.value.finished) return TONE_TAG_CLASS.green;
  if (p.value.bad) return TONE_SOLID_CLASS.red;
  return TONE_TAG_CLASS.amber;
});

// The left border colour is task data (`card.color`) except on a review card, which wears blue.
const boxStyle = computed(() => (props.card.review ? undefined : { borderLeftColor: props.card.color }));
const boxClass = computed(() => {
  const c = props.card;
  return [
    c.parked
      ? 'border-dashed bg-[repeating-linear-gradient(135deg,var(--kira-bg-elevated)_0_7px,var(--kira-bg-chrome)_7px_14px)]'
      : '',
    c.review ? 'cursor-default border-l-tone-blue-solid' : 'cursor-grab',
    c.allMerged ? 'border-y-tone-purple-solid/60 border-r-tone-purple-solid/60' : '',
    c.ripple && !c.selected ? 'outline outline-1 outline-dashed outline-tone-amber-solid' : '',
  ];
});

const headStyle = computed(() => (props.card.selected ? undefined : { background: `${props.card.color}1c` }));
</script>

<template>
  <div
    class="flex items-start gap-2"
    :data-ade-task="card.review ? undefined : ''"
    data-testid="ade-task"
    :data-task-id="card.task.id"
    :data-selected="card.selected || undefined"
  >
    <div class="flex w-52.5 shrink-0 flex-col pt-px" data-testid="ade-task-cells">
      <AdeActionCell v-if="card.tag" :tag="card.tag" tall @contextmenu="taskMenu.open">
        <AdeTaskActionButton :card="card" />
      </AdeActionCell>
      <AdeActionCell
        v-for="row in card.rows"
        :key="row.id"
        :tag="row.tag"
        :actions="row.tag.actions"
        :rebasing="dialogs.pending.has(`rebase:${row.id}`)"
        @act="(a) => act(row, a)"
        @contextmenu="(ev: MouseEvent) => card.review && taskMenu.open(ev)"
      />
    </div>
    <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only; the keyboard opens the menu from the header. -->
    <div
      :data-task-id="card.task.id"
      class="box-border flex min-w-0 flex-1 flex-col overflow-hidden rounded-kira-pill border border-l-4 border-border-strong bg-elevated shadow-kira"
      :class="boxClass"
      :style="boxStyle"
      data-testid="ade-card"
      @contextmenu="taskMenu.open"
    >
      <!-- biome-ignore lint/a11y/useSemanticElements: the header holds block content a button cannot. -->
      <div
        v-if="!card.review"
        class="box-border flex h-17 w-full cursor-pointer flex-col justify-center gap-1 border-b border-l-3 border-b-border px-2.5 py-1.5"
        :class="card.selected ? 'border-l-focus bg-hover' : 'border-l-transparent'"
        :style="headStyle"
        role="button"
        tabindex="0"
        data-testid="ade-card-head"
        @click="emit('select')"
        @keydown.enter.self="emit('select')"
        @keydown.space.self.prevent="emit('select')"
        @keydown.shift.f10.prevent="onMenuKey"
        @keydown.context-menu.prevent="onMenuKey"
      >
        <div class="flex h-4.5 min-w-0 items-center gap-1.5">
          <span
            class="box-border size-3 shrink-0 rounded-kira-xs"
            :class="card.parked ? 'border-2 border-dashed' : ''"
            :style="card.parked ? { borderColor: card.color } : { background: card.color }"
            data-testid="ade-card-dot"
          />
          <template v-if="p.hasWorkflow && !card.parked">
            <AdeTip :text="p.workflowTip">
              <span class="inline-flex shrink-0 items-center gap-0.5" data-testid="ade-stage-segs">
                <span
                  v-for="seg in p.segments"
                  :key="seg.id"
                  class="h-1.5 rounded-kira-xs"
                  :class="[seg.wide ? 'w-3.5' : 'w-2.25', segClass(seg.state)]"
                />
              </span>
            </AdeTip>
            <span
              class="max-w-37.5 shrink-0 truncate rounded-kira-sm px-1.5 py-px text-kira-sm font-bold"
              :class="labelClass"
              data-testid="ade-stage-label"
              >{{ p.label }}</span
            >
            <AdeTip v-if="p.showBar" :text="p.barTip">
              <span class="inline-flex shrink-0 items-center gap-1">
                <span class="inline-block h-1.25 w-11.5 overflow-hidden rounded-kira-xs bg-border-strong">
                  <span
                    class="block h-full"
                    :class="p.bad ? 'bg-tone-red-solid' : 'bg-tone-amber-solid'"
                    :style="{ width: `${p.percent}%` }"
                  />
                </span>
                <span class="text-kira-sm text-fg">{{ p.percent }}%</span>
              </span>
            </AdeTip>
          </template>
          <AdeAttention v-if="card.attention" :tip="card.attention" :item="card.attentionItem" />
          <AdeTip :text="card.meta">
            <span
              class="min-w-0 truncate text-kira-sm leading-3.5 text-subtle"
              data-testid="ade-card-meta"
              >{{ card.meta }}</span
            >
          </AdeTip>
        </div>
        <AdeTip :text="card.title">
          <Button
            type="button"
            variant="link"
            class="line-clamp-2 block h-auto justify-start whitespace-normal break-words rounded-none border-0 p-0 text-left text-kira-lg font-bold leading-4"
            :class="card.parked ? 'text-muted-foreground' : 'text-fg'"
            :aria-label="`Open ${card.title}`"
            data-testid="ade-card-title"
            @click.stop="emit('select')"
          >
            {{ card.title }}
          </Button>
        </AdeTip>
      </div>
      <AdeBranchRow v-for="row in card.rows" :key="row.id" :row="row" :merged="row.branch.mergedIntoMain" @force-push="emit('forcePush', row)" />
    </div>
  </div>
</template>
