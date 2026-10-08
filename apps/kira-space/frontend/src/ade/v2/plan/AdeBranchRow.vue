<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { computed } from 'vue';
import { useRepos } from '../../../repo/state/reposQueries';
import AdeTip from '../AdeTip.vue';
import { fixItems } from '../board/fixMenu';
import { repoColor } from '../palette';
import { useOpenReviewWindow } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { TONE_TAG_CLASS } from '../tones';
import AdeAttention from './AdeAttention.vue';
import { type BranchRowModel, usePlanModel } from './usePlanModel';

const props = defineProps<{ row: BranchRowModel; merged: boolean }>();
const emit = defineEmits<{ forcePush: [] }>();
const ui = useAdeBoardUiStore();
const dialogs = useAdeDialogsStore();
const contextMenu = useContextMenuStore();
const { model } = usePlanModel();
const repos = useRepos();
const openReview = useOpenReviewWindow();
const hasChips = computed(() => props.row.chips.merged.length + props.row.chips.deployed.length > 0);
const selected = computed(() => ui.selectedBranchId === props.row.id);

function pick(): void {
  ui.selectBranch(props.row.branch.taskId, props.row.id);
}

function onMenu(ev: MouseEvent): void {
  const m = model.value;
  const items = m
    ? fixItems({
        branchId: props.row.id,
        graph: m.view.graph,
        targets:
          repos.data.value?.repos.find((r) => r.codeRepoId === props.row.branch.codeRepoId)
            ?.integrationBranches ?? [],
        after: m.view.after,
        unpushed: m.board.plan.unpushed,
      })
    : null;
  const created = props.row.branch.name !== '';
  ev.preventDefault();
  ev.stopPropagation();
  const id = props.row.id;
  contextMenu.openContextMenu(ev, [
    { type: 'label', label: `${props.row.repo} · ${props.row.name}` },
    {
      type: 'item' as const,
      id: 'ade-review-code',
      label: created ? 'Review code' : 'Review code (create the branch first)',
      disabled: !created,
      run: () =>
        openReview.mutate(
          { branchId: id },
          {
            onError: (err) => {
              ui.select(props.row.branch.taskId);
              ui.actionError[props.row.branch.taskId] = err instanceof Error ? err.message : String(err);
            },
          },
        ),
    },
    ...(!items
      ? []
      : items.length === 0
      ? [{ type: 'item' as const, id: 'ade-fix-none', label: 'Nothing to fix', disabled: true, run: () => {} }]
      : items.map((it) => ({
          type: 'item' as const,
          id: it.id,
          label: it.label,
          run: () => {
            if (it.kind === 'merge') dialogs.merge(id, it.target);
            else if (it.kind === 'rebaseMain') dialogs.rebaseOnto(it.rootId, 'main', it.label);
            else if (it.kind === 'rebaseOnto') dialogs.rebaseOnto(id, it.onto, it.label);
            else emit('forcePush');
          },
        }))),
  ]);
}

const repoStyle = computed(() => {
  const c = repoColor(props.row.branch.codeRepoId);
  return { background: `${c}1f`, color: c };
});
const SEG: Record<string, string> = {
  done: 'bg-tone-green-solid',
  running: 'bg-tone-amber-solid',
  bad: 'bg-tone-red-solid',
};
const segClass = (state: string): string => SEG[state] ?? 'bg-border-strong';
const progClass = computed(() => {
  const tone = props.row.prog?.tone;
  if (tone === 'red') return 'text-tone-red';
  if (tone === 'green') return 'text-tone-green';
  return tone === 'grey' ? 'text-muted-foreground' : 'text-tone-amber';
});
const elbowClass = computed(() => (props.row.base?.tone === 'blue' ? 'border-tone-blue-solid' : 'border-border-strong'));
const rowBgClass = computed(() => {
  if (props.merged) return 'bg-tone-purple-solid/8';
  return props.row.isReview
    ? 'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--kira-info)_8%,transparent)_0_8px,color-mix(in_srgb,var(--kira-info)_3%,transparent)_8px_16px)]'
    : '';
});
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: the row holds block content a button cannot. -->
  <div
    class="box-border flex h-10 w-full cursor-pointer items-center gap-1.5 border-l-3 px-2.5"
    :class="[
      rowBgClass,
      selected ? 'border-l-focus' : 'border-l-transparent',
    ]"
    role="button"
    tabindex="0"
    :data-selected="selected || undefined"
    :data-ripple="row.ripple || undefined"
    data-testid="ade-branch-row"
    :data-branch-id="row.id"
    @click="pick"
    @contextmenu="onMenu"
    @keydown.enter.self="pick"
    @keydown.space.self.prevent="pick"
  >
    <span class="relative shrink-0 self-stretch" :style="{ width: `${row.depth * 16}px` }">
      <span
        v-if="row.depth"
        class="absolute -top-1 right-0.5 box-border h-4.5 w-2 rounded-bl-kira-sm border-b-2 border-l-2"
        :class="elbowClass"
      />
    </span>
    <span
      class="shrink-0 rounded-kira-xs px-1 py-px text-kira-sm font-semibold"
      :style="repoStyle"
      data-testid="ade-branch-repo"
      >{{ row.repo }}</span
    >
    <AdeTip v-if="row.base" :text="row.base.tip">
      <span
        class="max-w-27.5 shrink-0 truncate rounded-kira-xs px-1 py-px font-data text-kira-sm font-semibold"
        :class="row.base.tone === 'blue' ? TONE_TAG_CLASS.blue : 'bg-field text-fg'"
        data-testid="ade-base-marker"
        >{{ row.base.label }}</span
      >
    </AdeTip>
    <AdeAttention v-if="row.attention" :tip="row.attention" :item="row.attentionItem" />
    <AdeTip v-if="row.isReview" text="Someone else's branch: read-only here">
      <span
        class="inline-flex h-5 shrink-0 items-center gap-1 rounded-kira-pill px-2 text-kira-sm font-semibold"
        :class="TONE_TAG_CLASS.blue"
        data-testid="ade-owner-pill"
        >{{ row.branch.owner }}</span
      >
    </AdeTip>
    <AdeTip v-if="row.branch.origin === 'agent'" text="Added or named by the agent">
      <span class="inline-flex shrink-0 text-subtle" data-testid="ade-branch-agent">
        <CodiconIcon name="sparkle" :size="13" />
      </span>
    </AdeTip>
    <div class="flex h-full min-w-0 flex-1 flex-col justify-center text-left">
      <AdeTip :text="row.name">
        <span
          class="truncate font-data text-kira-md font-semibold leading-4"
          :class="row.isReview ? 'text-tone-blue' : row.draft ? 'italic text-muted-foreground' : 'text-fg'"
          data-testid="ade-branch-name"
          >{{ row.name }}</span
        >
      </AdeTip>
      <span v-if="row.context || row.prog || hasChips" class="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap leading-3.5">
        <AdeTip v-if="row.prog" :text="row.prog.tip">
          <span class="inline-flex shrink-0 items-center gap-1" data-testid="ade-branch-prog">
            <span class="inline-flex gap-0.5">
              <span
                v-for="(seg, i) in row.prog.segs"
                :key="i"
                class="h-1.25 w-1.75 rounded-kira-xs"
                :class="segClass(seg)"
              />
            </span>
            <span class="text-kira-sm font-semibold" :class="progClass">{{ row.prog.label }}</span>
          </span>
        </AdeTip>
        <span
          v-if="row.context"
          class="truncate text-kira-sm text-subtle"
          :class="row.draft ? 'italic' : ''"
          data-testid="ade-branch-context"
          >{{ row.context }}</span
        >
        <AdeTip v-for="c in row.chips.merged" :key="c.label" :text="c.tip">
          <span
            class="shrink-0 text-kira-sm font-medium"
            :class="c.tone === 'stale' ? 'text-tone-amber' : 'text-subtle'"
            data-testid="ade-branch-merged"
            >{{ c.label }}</span
          >
        </AdeTip>
        <span v-if="row.chips.divider" class="h-2.5 w-px shrink-0 bg-border-strong" />
        <AdeTip v-for="c in row.chips.deployed" :key="c.label" :text="c.tip">
          <span
            class="shrink-0 text-kira-sm font-medium"
            :class="c.tone === 'stale' ? 'text-tone-amber' : 'text-subtle'"
            data-testid="ade-branch-deployed"
            >{{ c.label }}</span
          >
        </AdeTip>
      </span>
    </div>
  </div>
</template>
