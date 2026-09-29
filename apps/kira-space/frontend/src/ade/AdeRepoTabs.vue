<script setup lang="ts">
import TabStrip from '@workbench/components/TabStrip.vue';
import { computed } from 'vue';
import AdeActivityIcon from './AdeActivityIcon.vue';
import { activitySummary, needsInputByRepo } from './activity';
import { useAdeSessions } from './queries';
import { useAgentSessionsStore } from './state/agentSessions';
import { ALL_AGENTS_TAB, useAdeTabStripHost } from './useAdeTabStripHost';

// P137: repo tabs + pinned "All agents" render through the shared `TabStrip`. The needs-input
// count (every running session, per repo; `activitySummary` for All agents) fills `#tab-leading`.
const host = useAdeTabStripHost();
const agentSessionsStore = useAgentSessionsStore();
const sessionsQuery = useAdeSessions();

const sessions = computed(() => sessionsQuery.data.value?.sessions ?? []);

const needsInput = computed(() => needsInputByRepo(sessions.value, agentSessionsStore.activity));

const allAgentsCount = computed(
  () => activitySummary(sessions.value, agentSessionsStore.activity).input,
);

function countFor(id: string): number {
  return id === ALL_AGENTS_TAB ? allAgentsCount.value : (needsInput.value.get(id) ?? 0);
}
</script>

<template>
  <div
    class="h-tabbar min-h-0 shrink-0 overflow-hidden border-b border-border bg-chrome"
    data-testid="ade-repo-tabs"
  >
    <TabStrip :host="host">
      <template #tab-leading="{ tab }">
        <span v-if="countFor(tab.id) > 0" class="flex items-center gap-1 font-data text-kira-sm">
          <AdeActivityIcon kind="input" />{{ countFor(tab.id) }}
        </span>
      </template>
    </TabStrip>
  </div>
</template>
