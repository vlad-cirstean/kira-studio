<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { computed } from 'vue';
import AdeAddPopover from '../AdeAddPopover.vue';
import AdeBacklogPage from '../backlog/AdeBacklogPage.vue';
import AdeClaudeDialog from '../dialog/AdeClaudeDialog.vue';
import AdeNeedsPage from '../needs/AdeNeedsPage.vue';
import AdePanel from '../panel/AdePanel.vue';
import AdePlanView from '../plan/AdePlanView.vue';
import { usePlanModel } from '../plan/usePlanModel';
import { useBacklog } from '../queries';
import AdeReposPage from '../repos/AdeReposPage.vue';
import AdeRunDialog from '../run/AdeRunDialog.vue';
import AdeTakeOverDialog from '../sessions/AdeTakeOverDialog.vue';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { TONE, tagStyle } from '../tones';
import AdeWorkflowsPage from '../workflows/AdeWorkflowsPage.vue';
import AdeCaptureBox from './AdeCaptureBox.vue';

// Top bar (tabs, capture box, Add) over the active tab; the Plan opens the panel beside it.
const ui = useAdeBoardUiStore();
const backlog = useBacklog();
const count = computed(() => backlog.data.value?.items.length ?? 0);
const { model } = usePlanModel();
const needsCount = computed(() => model.value?.needs.badge ?? 0);
</script>

<template>
  <Tabs v-model="ui.view" class="flex min-h-0 flex-1 flex-col gap-0" data-testid="ade-shell">
    <nav class="flex h-10 shrink-0 items-stretch border-b border-border bg-chrome pl-2">
      <TabsList class="gap-0">
        <TabsTrigger
          value="backlog"
          class="h-full cursor-pointer gap-1.5 border-b-2 border-transparent px-3.5 text-kira-lg text-muted-foreground data-[state=active]:font-semibold data-[state=active]:text-fg"
          :style="ui.view === 'backlog' ? { borderBottomColor: TONE.amber[2] } : undefined"
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
          class="h-full cursor-pointer gap-1.5 border-b-2 border-transparent px-3.5 text-kira-lg text-muted-foreground data-[state=active]:font-semibold data-[state=active]:text-fg"
          :style="ui.view === 'needs' ? { borderBottomColor: TONE.amber[2] } : undefined"
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
          class="h-full cursor-pointer gap-1.5 border-b-2 border-transparent px-3.5 text-kira-lg text-muted-foreground data-[state=active]:font-semibold data-[state=active]:text-fg"
          :style="ui.view === 'plan' ? { borderBottomColor: TONE.amber[2] } : undefined"
          data-testid="ade-tab-plan"
        >
          Plan
        </TabsTrigger>
      </TabsList>
      <span class="flex-1" />
      <div class="flex items-center gap-2 px-3">
        <AdeCaptureBox />
        <AdeAddPopover />
      </div>
      <TabsList class="gap-0">
        <TabsTrigger
          value="workflows"
          class="h-full cursor-pointer gap-1.5 border-b-2 border-transparent px-3.5 text-kira-lg text-muted-foreground data-[state=active]:font-semibold data-[state=active]:text-fg"
          :style="ui.view === 'workflows' ? { borderBottomColor: TONE.amber[2] } : undefined"
          data-testid="ade-tab-workflows"
        >
          Workflows
        </TabsTrigger>
        <TabsTrigger
          value="repos"
          class="h-full cursor-pointer gap-1.5 border-b-2 border-transparent px-3.5 text-kira-lg text-muted-foreground data-[state=active]:font-semibold data-[state=active]:text-fg"
          :style="ui.view === 'repos' ? { borderBottomColor: TONE.amber[2] } : undefined"
          data-testid="ade-tab-repos"
        >
          Repos
        </TabsTrigger>
      </TabsList>
    </nav>
    <AdeBacklogPage v-if="ui.view === 'backlog'" />
    <AdeNeedsPage v-else-if="ui.view === 'needs'" />
    <AdeWorkflowsPage v-else-if="ui.view === 'workflows'" />
    <AdeReposPage v-else-if="ui.view === 'repos'" />
    <div v-else class="flex min-h-0 flex-1">
      <AdePlanView />
      <AdePanel v-if="ui.selectedTaskId" />
    </div>
    <AdeRunDialog />
    <AdeClaudeDialog />
    <AdeTakeOverDialog />
  </Tabs>
</template>
