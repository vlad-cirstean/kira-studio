<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { computed } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import AdeActivityIcon from './AdeActivityIcon.vue';
import { needsInputByRepo } from './activity';
import { useAdeSessions } from './queries';
import { useAdeUiStore } from './state/adeUi';
import { useAgentSessionsStore } from './state/agentSessions';

// P129 Part 3 §0.15/§2.7: mockup lines 33-45's own 40px bar, restyled onto shadcn `Tabs` (keyboard
// and ARIA for free) — one tab per imported repo (`codeReposStore.records`, existing order), the
// pinned "All agents" tab is Part 7's own addition. The needs-input count is every running
// session's own repo (§0.15's own divergence from the mockup's queued-only count), never zero-hidden
// per tab.
const codeReposStore = useCodeReposStore();
const adeUiStore = useAdeUiStore();
const agentSessionsStore = useAgentSessionsStore();
const sessionsQuery = useAdeSessions();

const needsInput = computed(() =>
  needsInputByRepo(sessionsQuery.data.value?.sessions ?? [], agentSessionsStore.activity),
);

function select(id: string): void {
  adeUiStore.setActiveRepo(id);
}
</script>

<template>
  <Tabs
    :model-value="adeUiStore.activeRepoId"
    class="h-10 shrink-0 gap-0 border-b border-border bg-elevated pl-2"
    @update:model-value="(v) => select(String(v))"
  >
    <TabsList class="h-full gap-0.5 bg-transparent p-0">
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
