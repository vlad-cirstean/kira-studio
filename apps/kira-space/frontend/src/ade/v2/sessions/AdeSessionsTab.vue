<script setup lang="ts">
import { computed } from 'vue';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdeHeadlessPane from './AdeHeadlessPane.vue';
import AdeSessionStrip from './AdeSessionStrip.vue';
import AdeStoppedList from './AdeStoppedList.vue';
import AdeTuiPane from './AdeTuiPane.vue';
import { byRecent, byRunningOrder } from './sessionView';
import { useSessionViews } from './useSessionViews';

// Sessions of a task (every one) or of one branch: the running ones in a strip with the selected
// one's pane, the finished ones below.
const props = defineProps<{ taskId: string; branchId?: string; archived?: boolean }>();

const ui = useAdeBoardUiStore();
const { sessions, view } = useSessionViews();

const scoped = computed(() =>
  sessions.value.filter(
    (s) => s.taskId === props.taskId && (props.branchId === undefined || s.branchId === props.branchId),
  ),
);
const running = computed(() =>
  scoped.value
    .filter((s) => s.state === 'running')
    .sort(byRunningOrder)
    .map(view),
);
const stopped = computed(() =>
  scoped.value
    .filter((s) => s.state !== 'running')
    .sort(byRecent)
    .map(view),
);
const current = computed(() => running.value.find((v) => v.session.id === ui.sessionId) ?? running.value[0]);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-bg" data-testid="ade-sessions-tab">
    <AdeSessionStrip
      v-if="running.length"
      :views="running"
      :selected-id="current?.session.id ?? null"
      @pick="(id) => (ui.sessionId = id)"
    />
    <template v-if="current">
      <AdeHeadlessPane v-if="current.headless" :key="current.session.id" :view="current" :archived="archived" />
      <AdeTuiPane v-else :key="current.session.id" :view="current" />
    </template>
    <div v-else class="flex-1 p-3.5 text-kira-md text-muted-foreground" data-testid="ade-sessions-empty">Nothing running.</div>
    <AdeStoppedList :views="stopped" :archived="archived" />
  </div>
</template>
