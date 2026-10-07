<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger, tabChipVariants } from '@theme/components/ui/tabs';
import { computed } from 'vue';
import AdeAddPopover from '../AdeAddPopover.vue';
import AdeBacklogPage from '../backlog/AdeBacklogPage.vue';
import AdeClaudeDialog from '../dialog/AdeClaudeDialog.vue';
import AdeNeedsPage from '../needs/AdeNeedsPage.vue';
import AdePanel from '../panel/AdePanel.vue';
import AdePlanView from '../plan/AdePlanView.vue';
import { usePlanModel } from '../plan/usePlanModel';
import { useBacklog } from '../queries';
import AdeRunDialog from '../run/AdeRunDialog.vue';
import AdeTakeOverDialog from '../sessions/AdeTakeOverDialog.vue';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import { tagStyle } from '../tones';
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
</script>

<template>
  <Tabs :model-value="ui.view" class="flex min-h-0 flex-1 flex-col gap-0.5 bg-chrome" data-testid="ade-shell" @update:model-value="onView">
    <nav class="flex h-tabbar shrink-0 items-center gap-2 border-b border-border bg-chrome px-1.5">
      <TabsList>
        <TabsTrigger
          value="backlog"
          :class="tabChipVariants({ active: ui.view === 'backlog', size: 'wide' })"
          data-testid="ade-tab-backlog"
        >
          Backlog
          <span
            class="rounded-kira-pill px-1.5 text-kira-sm font-semibold"
            :style="tagStyle('grey')"
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
            :style="tagStyle('amber')"
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
    <div class="flex min-h-0 flex-1 gap-0.5 px-0.5 pb-0.5">
      <AdeBacklogPage v-if="ui.view === 'backlog'" />
      <AdeNeedsPage v-else-if="ui.view === 'needs'" />
      <AdeWorkflowsPage v-else-if="ui.view === 'workflows'" />
      <template v-else>
        <AdePlanView />
        <AdePanel v-if="ui.selectedTaskId" />
      </template>
    </div>
    <AdeRunDialog />
    <AdeClaudeDialog />
    <AdeTakeOverDialog />
  </Tabs>
</template>
