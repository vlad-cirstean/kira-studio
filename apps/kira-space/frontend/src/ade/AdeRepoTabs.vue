<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tabs, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { computed } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import AdeActivityIcon from './AdeActivityIcon.vue';
import { activitySummary, needsInputByRepo } from './activity';
import { useAdeSessions } from './queries';
import { useAdeUiStore } from './state/adeUi';
import { useAgentSessionsStore } from './state/agentSessions';

// P129 Part 3 §0.15/§2.7: mockup lines 33-45's own 40px bar, restyled onto shadcn `Tabs` (keyboard
// and ARIA for free) — one tab per imported repo (`codeReposStore.records`, existing order). The
// needs-input count is every running session's own repo (§0.15's own divergence from the mockup's
// queued-only count), never zero-hidden per tab.
// P129 Part 7 §0.1/§0.3/§0.4: the leading pinned "All agents" tab — `ALL_AGENTS_TAB` is a plain
// local sentinel for the `Tabs` model value only, never written into `adeUi` state (the store keeps
// its own `allAgents` flag, §0.3). The count is `activitySummary`'s own `input` (every running
// session across every repo), rendered exactly like a repo tab's own count. P137 later moves this
// trigger block into `TabStrip`'s pinned slot (§0.1) — this file stays loosely coupled to that move.
const ALL_AGENTS_TAB = '__all__';

const codeReposStore = useCodeReposStore();
const adeUiStore = useAdeUiStore();
const agentSessionsStore = useAgentSessionsStore();
const sessionsQuery = useAdeSessions();

const sessions = computed(() => sessionsQuery.data.value?.sessions ?? []);

const needsInput = computed(() => needsInputByRepo(sessions.value, agentSessionsStore.activity));

const allAgentsCount = computed(
  () => activitySummary(sessions.value, agentSessionsStore.activity).input,
);

const modelValue = computed(() =>
  adeUiStore.allAgents ? ALL_AGENTS_TAB : adeUiStore.activeRepoId,
);

function select(value: string): void {
  if (value === ALL_AGENTS_TAB) adeUiStore.showAllAgents();
  else adeUiStore.showRepo(value);
}
</script>

<template>
  <Tabs
    :model-value="modelValue"
    class="h-10 shrink-0 gap-0 border-b border-border bg-elevated pl-2"
    @update:model-value="(v) => select(String(v))"
  >
    <TabsList class="h-full gap-0.5 bg-transparent p-0">
      <TabsTrigger
        :value="ALL_AGENTS_TAB"
        data-testid="ade-all-agents-tab"
        class="h-full max-w-55 gap-1.5 rounded-none border-t-2 border-transparent border-r border-r-[#2a2d35] px-2 text-kira-sm text-muted-foreground data-[state=active]:border-t-[#e8a33d] data-[state=active]:bg-elevated data-[state=active]:text-fg"
      >
        <CodiconIcon name="terminal" :size="13" :style="{ color: '#d97757' }" />
        <span v-if="allAgentsCount > 0" class="flex items-center gap-1 font-data text-kira-sm">
          <AdeActivityIcon kind="input" />{{ allAgentsCount }}
        </span>
        <span class="max-w-45 overflow-hidden text-ellipsis whitespace-nowrap">All agents</span>
      </TabsTrigger>
      <TabsTrigger
        v-for="repo in codeReposStore.records"
        :key="repo.id"
        :value="repo.id"
        data-testid="ade-repo-tab"
        :data-repo-id="repo.id"
        class="h-full max-w-55 gap-1.5 rounded-none border-t-2 border-transparent px-2 text-kira-sm text-muted-foreground data-[state=active]:border-t-[#e8a33d] data-[state=active]:bg-elevated data-[state=active]:text-fg"
      >
        <span
          v-if="(needsInput.get(repo.id) ?? 0) > 0"
          class="flex items-center gap-1 font-data text-kira-sm"
        >
          <AdeActivityIcon kind="input" />{{ needsInput.get(repo.id) }}
        </span>
        <span class="max-w-45 overflow-hidden text-ellipsis whitespace-nowrap">{{ repo.name }}</span>
      </TabsTrigger>
    </TabsList>
  </Tabs>
</template>
