<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger, tabChipVariants } from '@theme/components/ui/tabs';
import { useEventListener } from '@vueuse/core';
import { shortcutFor } from '@workbench/shortcuts/keys';
import { computed, useTemplateRef } from 'vue';
import AdeAddPopover from '../AdeAddPopover.vue';
import AdeBacklogPage from '../backlog/AdeBacklogPage.vue';
import AdeClaudeDialog from '../dialog/AdeClaudeDialog.vue';
import AdeNeedsPage from '../needs/AdeNeedsPage.vue';
import AdePanel from '../panel/AdePanel.vue';
import AdePlanView from '../plan/AdePlanView.vue';
import { usePlanModel } from '../plan/usePlanModel';
import { useBacklog } from '../queries';
import { useReviewCode } from '../review/useReviewCode';
import AdeRunDialog from '../run/AdeRunDialog.vue';
import AdeTakeOverDialog from '../sessions/AdeTakeOverDialog.vue';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import { TONE_TAG_CLASS } from '../tones';
import AdeWorkflowsPage from '../workflows/AdeWorkflowsPage.vue';
import AdeCaptureBox from './AdeCaptureBox.vue';

// Top bar (tabs, capture box, Add) over the active tab; the Plan opens the panel beside it.
const ui = useAdeBoardUiStore();
const wfUi = useAdeWorkflowsUiStore();

async function onView(view: unknown): Promise<void> {
  if (view === ui.view || (ui.view === 'workflows' && !(await wfUi.leave()))) return;
  ui.view = view as typeof ui.view;
}
const backlog = useBacklog();
const count = computed(() => backlog.data.value?.items.length ?? 0);
const { model } = usePlanModel();
const needsCount = computed(() => model.value?.needs.badge ?? 0);

// Review code on the focused branch or card, else the selected one.
const reviewCode = useReviewCode();
const planEl = useTemplateRef<HTMLElement>('planEl');
function reviewTarget(e: KeyboardEvent): { taskId?: string; branchId?: string; el?: HTMLElement } {
  const t = e.target instanceof Element ? e.target : null;
  const rowEl = t?.closest<HTMLElement>('[data-testid="ade-branch-row"][data-branch-id]');
  if (rowEl) return { branchId: rowEl.dataset.branchId, el: rowEl };
  const cardEl = t?.closest<HTMLElement>('[data-testid="ade-card"][data-task-id]');
  if (cardEl) {
    const head = cardEl.querySelector<HTMLElement>('[data-testid="ade-card-head"]');
    const inside = t instanceof HTMLElement && cardEl.contains(t) ? t : null;
    return { taskId: cardEl.dataset.taskId, el: inside ?? head ?? cardEl };
  }
  if (ui.selectedBranchId) return { branchId: ui.selectedBranchId };
  return { taskId: ui.selectedTaskId ?? undefined };
}
useEventListener(planEl, 'keydown', (e: KeyboardEvent) => {
  if (e.defaultPrevented || !shortcutFor(e, ['ade.reviewCode'])) return;
  e.preventDefault();
  const m = model.value;
  if (!m) return;
  const target = reviewTarget(e);
  if (target.branchId) {
    const branch = m.board.branches.find((b) => b.id === target.branchId);
    const card = branch ? m.cardFor(branch.taskId) : null;
    const row = card?.rows.find((r) => r.id === target.branchId);
    const choice = row ? reviewCode.choiceOf(row) : null;
    const anchor =
      target.el ?? document.querySelector<HTMLElement>(`[data-testid="ade-branch-row"][data-branch-id="${target.branchId}"]`);
    if (card && choice && !choice.disabled) reviewCode.open(card.task.id, target.branchId, anchor);
    return;
  }
  const card = target.taskId ? m.cardFor(target.taskId) : null;
  if (!card) return;
  const head =
    target.el ??
    document.querySelector<HTMLElement>(`[data-testid="ade-card"][data-task-id="${card.task.id}"] [data-testid="ade-card-head"]`);
  reviewCode.openTask(card, head);
});
</script>

<template>
  <Tabs :model-value="ui.view" class="flex min-h-0 flex-1 flex-col gap-0.5" data-testid="ade-shell" @update:model-value="onView">
    <nav class="flex h-tabbar shrink-0 items-center gap-2 rounded-kira border border-border bg-bg px-1.5">
      <TabsList>
        <TabsTrigger
          value="backlog"
          :class="tabChipVariants({ active: ui.view === 'backlog', size: 'wide' })"
          data-testid="ade-tab-backlog"
        >
          Backlog
          <span
            class="rounded-kira-pill px-1.5 text-kira-sm font-semibold"
            :class="TONE_TAG_CLASS.grey"
            data-testid="ade-backlog-count"
            >{{ count }}</span
          >
        </TabsTrigger>
        <TabsTrigger
          value="needs"
          :class="tabChipVariants({ active: ui.view === 'needs', size: 'wide' })"
          data-testid="ade-tab-needs"
        >
          Needs you
          <span
            v-if="needsCount > 0"
            class="rounded-kira-pill px-1.5 text-kira-sm font-semibold"
            :class="TONE_TAG_CLASS.amber"
            data-testid="ade-needs-count"
            >{{ needsCount }}</span
          >
        </TabsTrigger>
        <TabsTrigger
          value="plan"
          :class="tabChipVariants({ active: ui.view === 'plan', size: 'wide' })"
          data-testid="ade-tab-plan"
        >
          Plan
        </TabsTrigger>
      </TabsList>
      <span class="flex-1" />
      <div class="flex items-center gap-2">
        <AdeCaptureBox />
        <AdeAddPopover />
      </div>
      <TabsList>
        <TabsTrigger
          value="workflows"
          :class="tabChipVariants({ active: ui.view === 'workflows', size: 'wide' })"
          data-testid="ade-tab-workflows"
        >
          Workflows
        </TabsTrigger>
      </TabsList>
    </nav>
    <div class="flex min-h-0 flex-1 gap-0.5">
      <AdeBacklogPage v-if="ui.view === 'backlog'" />
      <AdeNeedsPage v-else-if="ui.view === 'needs'" />
      <AdeWorkflowsPage v-else-if="ui.view === 'workflows'" />
      <div v-else ref="planEl" class="contents">
        <AdePlanView />
        <AdePanel v-if="ui.selectedTaskId" />
      </div>
    </div>
    <AdeRunDialog />
    <AdeClaudeDialog />
    <AdeTakeOverDialog />
  </Tabs>
</template>
