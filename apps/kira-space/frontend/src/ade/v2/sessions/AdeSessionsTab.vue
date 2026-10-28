<script setup lang="ts">
import InlineState from '@theme/components/InlineState.vue';
import { t } from '@theme/i18n';
import { computed, ref, watch } from 'vue';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdeHeadlessPane from './AdeHeadlessPane.vue';
import AdeSessionStrip from './AdeSessionStrip.vue';
import AdeStoppedList from './AdeStoppedList.vue';
import AdeStoppedMenu from './AdeStoppedMenu.vue';
import AdeTuiPane from './AdeTuiPane.vue';
import { byRecent, byRunningOrder } from './sessionView';
import { useSessionViews } from './useSessionViews';

// Sessions of a task (every one) or of one branch: the running ones in a strip with the selected
// one's pane, the finished ones in a dropdown beside it. Archived tasks list them inline.
const props = defineProps<{ taskId: string; branchId?: string; archived?: boolean }>();

const ui = useAdeBoardUiStore();
const { sessions, view } = useSessionViews();

const scoped = computed(() =>
  sessions.value.filter(
    (s) =>
      s.taskId === props.taskId && (props.branchId === undefined || s.branchId === props.branchId),
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
const current = computed(
  () => running.value.find((v) => v.session.id === ui.sessionId) ?? running.value[0],
);
const stoppedOpen = ref(false);
const revealed = ref<string | null>(null);

// Re-runs when the lists load, since the event can land before the sessions query resolves.
watch(
  [() => ui.revealSessionId, stopped, running],
  ([id]) => {
    if (!id) return;
    if (stopped.value.some((v) => v.session.id === id)) {
      if (!props.archived) {
        revealed.value = id;
        stoppedOpen.value = true;
      }
      ui.revealSessionId = null;
    } else if (running.value.some((v) => v.session.id === id)) {
      ui.revealSessionId = null;
    }
  },
  { immediate: true, flush: 'post' },
);
watch(stoppedOpen, (open) => {
  if (!open) revealed.value = null;
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-bg" data-testid="ade-sessions-tab">
    <div
      v-if="!archived && (running.length || stopped.length)"
      class="flex shrink-0 items-center gap-1 border-b border-border bg-chrome pr-1.5"
      data-testid="ade-session-bar-row"
    >
      <AdeSessionStrip
        v-if="running.length"
        :views="running"
        :selected-id="current?.session.id ?? null"
        @select="(id) => (ui.sessionId = id)"
      />
      <AdeStoppedMenu v-model:open="stoppedOpen" :views="stopped" :selected-id="revealed" />
    </div>
    <template v-if="current">
      <AdeHeadlessPane
        v-if="current.headless"
        :key="current.session.id"
        :view="current"
        :archived="archived"
      />
      <AdeTuiPane v-else :key="current.session.id" :view="current" />
    </template>
    <AdeStoppedList v-else-if="archived && stopped.length" :views="stopped" archived />
    <InlineState v-else kind="empty" class="flex-1 p-3" data-testid="ade-sessions-empty">{{
      t('space.ade.sessionList.empty.empty')
    }}</InlineState>
  </div>
</template>
