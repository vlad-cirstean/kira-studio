<script setup lang="ts">
import EmptyState from '@theme/components/EmptyState.vue';
import { ResizeHandle } from '@theme/components/ui/resizable';
import { useLiveSize } from '@theme/components/ui/resizable/useLiveSize';
import { t } from '@theme/i18n';
import { usePersistedState } from '@workbench/behaviour/persisted';
import QueryState from '@workbench/components/QueryState.vue';
import TabStrip from '@workbench/components/TabStrip.vue';
import { computed, watch } from 'vue';
import ProofHeader from './ProofHeader.vue';
import ProofHistory from './ProofHistory.vue';
import ProofStepView from './ProofStepView.vue';
import { useProofSession, useProofSessions, useProofSync } from './queries';
import { useProofWindowStore } from './state';
import { createProofTabHost, type ProofTab, proofTabId } from './tabHost';

// Three panes like the Kira Space review window: sessions (left) and the step tabs (centre).
const store = useProofWindowStore();
useProofSync();
const sessions = useProofSessions();
const session = useProofSession(() => store.sessionId);
const detail = computed(() => session.data.value ?? null);

// A deleted or evicted session leaves the selection; fall back to the newest.
watch(
  () => [sessions.data.value, store.sessionId] as const,
  ([list, id]) => {
    if (!list) return;
    if (id && list.some((s) => s.id === id)) return;
    store.selectSession(list[0]?.id ?? null);
  },
  { immediate: true },
);

const side = computed(() => store.side ?? (detail.value?.pending ? 'pending' : 'current'));
const revision = computed(() =>
  detail.value ? (side.value === 'pending' && detail.value.pending) || detail.value.current : null,
);
const tabs = computed<ProofTab[]>(() => {
  const rev = revision.value;
  if (!rev) return [];
  const activeId = store.activeId ?? (rev.steps[0] && proofTabId(rev.rev, rev.steps[0].ordinal));
  return rev.steps.map((meta) => {
    const id = proofTabId(rev.rev, meta.ordinal);
    return { id, kind: 'step', state: { rev: rev.rev, meta }, active: id === activeId };
  });
});
const activeTab = computed(() => tabs.value.find((tab) => tab.active) ?? null);
const host = createProofTabHost(tabs, store);

const LEFT_MIN = 180;
const LEFT_MAX = 480;
const storedLeft = usePersistedState('kira.proof.leftWidth', 260);
const left = useLiveSize(
  () => Math.max(LEFT_MIN, Math.min(LEFT_MAX, storedLeft.value)),
  (w) => {
    storedLeft.value = w;
  },
);
</script>

<template>
  <div class="flex h-full flex-col" data-testid="proof-window">
    <ProofHeader v-if="detail" :detail="detail" :steps="revision?.steps.length ?? 0" />
    <div v-else class="h-titlebar shrink-0 bg-chrome" />
    <div class="flex min-h-0 flex-1 gap-0.5 bg-chrome px-1.5 pb-0.5">
      <section
        class="min-h-0 flex-none overflow-hidden rounded-kira border border-border bg-bg"
        :style="{ width: `${left.size.value}px` }"
        :aria-label="t('studio.proof.history.aria')"
        data-testid="proof-left"
      >
        <ProofHistory />
      </section>
      <ResizeHandle
        :label="t('studio.proof.resize.label')"
        data-testid="proof-resize-handle"
        :min="LEFT_MIN"
        :max="LEFT_MAX"
        v-bind="left.bind"
      />
      <section
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-kira border border-border bg-bg"
        :aria-label="t('studio.proof.session.aria')"
        data-testid="proof-centre"
      >
        <QueryState v-if="store.sessionId" :query="session">
          <template #default="{ data }">
            <div
              class="h-tabbar min-h-0 shrink-0 overflow-hidden border-b border-border bg-chrome"
              :aria-label="t('studio.proof.tabs.aria')"
              data-testid="proof-tabs"
            >
              <TabStrip :host="host" />
            </div>
            <div class="min-h-0 flex-1" data-testid="proof-body">
              <ProofStepView
                v-if="activeTab"
                :key="activeTab.id"
                :session-id="data.id"
                :rev="activeTab.state.rev"
                :ordinal="activeTab.state.meta.ordinal"
              />
            </div>
          </template>
        </QueryState>
        <EmptyState
          v-else
          fill
          icon="checklist"
          :title="t('studio.proof.session.empty.emptyHint')"
          data-testid="proof-empty"
        />
      </section>
    </div>
  </div>
</template>
