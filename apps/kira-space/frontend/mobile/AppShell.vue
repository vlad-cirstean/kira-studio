<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { useOnline } from '@vueuse/core';
import { onMounted } from 'vue';
import { useServerEvents } from './api/events';
import { useAgentSessionsStore } from './state/agentSessions';
import TabBar from './TabBar.vue';

const queryClient = useQueryClient();
const agentSessions = useAgentSessionsStore();
const online = useOnline();

function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: ['adetask'] });
}

// Pushes sent while the stream was down are lost: refetch everything and re-read the agent state.
const { connection } = useServerEvents(() => {
  void queryClient.invalidateQueries({ queryKey: ['adetask'] });
  void agentSessions.initAgentSessions();
});
onMounted(() => void agentSessions.initAgentSessions());

const DOT: Record<typeof connection.value, string> = {
  live: 'bg-ok',
  reconnecting: 'bg-warn',
  offline: 'bg-error',
};
</script>

<template>
  <div class="flex h-full flex-col pt-[env(safe-area-inset-top)]" data-testid="app-shell">
    <header class="flex items-center gap-2 border-b border-border bg-chrome px-3 py-2">
      <h1 class="m-0 flex-1 text-kira-lg font-semibold">Agents</h1>
      <Button variant="ghost" size="icon" aria-label="Refresh" data-testid="refresh" @click="refresh">
        <CodiconIcon name="refresh" :size="14" />
      </Button>
      <span
        class="size-2 rounded-full"
        :class="DOT[connection]"
        :title="connection"
        role="status"
        :aria-label="`Connection ${connection}`"
        data-testid="connection-dot"
      />
    </header>
    <p v-if="!online" class="m-0 bg-warn/16 px-3 py-1 text-warn" data-testid="offline-banner">
      You are offline. Showing what was last loaded.
    </p>
    <main class="min-h-0 flex-1 overflow-auto">
      <RouterView />
    </main>
    <TabBar />
  </div>
</template>
