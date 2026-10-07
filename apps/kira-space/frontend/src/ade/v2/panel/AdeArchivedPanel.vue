<script setup lang="ts">
import { computed } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import { usePlanModel } from '../plan/usePlanModel';
import AdeSessionsTab from '../sessions/AdeSessionsTab.vue';
import type { HistoryEntry } from '../wire';
import AdePanelFrame from './AdePanelFrame.vue';

// An archived task, read-only: its title and repos over the Sessions tab, so the logs of its runs stay
// reachable. Take over is not offered: the task and its worktrees are gone.
const props = defineProps<{ entry: HistoryEntry }>();

const { sessions, repoLabel } = usePlanModel();
const tab = defineModel<string>('tab', { default: 'sessions' });

const count = computed(() => sessions.value.filter((s) => s.taskId === props.entry.taskId).length);
const repos = computed(() => props.entry.codeRepoIds.map(repoLabel).join(' · '));
</script>

<template>
  <AdePanelFrame v-model="tab" title="Archived task" :tabs="[{ value: 'sessions', label: `Sessions ${count}` }]">
    <template #header>
      <div class="flex items-start gap-2">
        <span class="mt-1 box-border size-3 shrink-0 rounded-kira-xs bg-disabled" />
        <AdeChip label="archived" tone="grey" />
        <AdeTip :text="entry.title">
          <h3
            class="m-0 line-clamp-2 min-w-0 flex-1 break-words text-kira-lg font-bold leading-4.5"
            data-testid="ade-panel-title"
          >
            {{ entry.title }}
          </h3>
        </AdeTip>
      </div>
      <div class="truncate text-kira-sm text-muted-foreground" data-testid="ade-panel-facts">{{ repos }}</div>
    </template>
    <AdeSessionsTab :task-id="entry.taskId" archived />
  </AdePanelFrame>
</template>
