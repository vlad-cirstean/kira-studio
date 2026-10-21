<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { ResizeHandle } from '@theme/components/ui/resizable';
import { useLiveSize } from '@theme/components/ui/resizable/useLiveSize';
import { t } from '@theme/i18n';
import { tryOnScopeDispose } from '@vueuse/core';
import { usePersistedState } from '@workbench/behaviour/persisted';
import MainView from '@workbench/components/MainView.vue';
import TabStrip from '@workbench/components/TabStrip.vue';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import { queryClient } from '@workbench/state/queryClient';
import { computed, useTemplateRef } from 'vue';
import { onReviewRepaint } from '../../../repo/git/transport';
import { useReviewStep, viewedSyncPlanPrefix } from '../queries';
import { useAdeReviewWindowStore } from '../state/adeReviewWindow';
import AdeReviewAgentPanel from './AdeReviewAgentPanel.vue';
import AdeReviewFiles from './AdeReviewFiles.vue';
import AdeReviewHeader from './AdeReviewHeader.vue';
import AdeWorkflowReviewPanel from './AdeWorkflowReviewPanel.vue';
import { useReviewContext } from './useReviewContext';

// Three panes for one branch: files to review (left), this window's diff tabs (centre), and the
// questions panel (right).
const store = useAdeReviewWindowStore();
const target = computed(() => store.target);
const { repoLabel } = useReviewContext(() => store.target as NonNullable<typeof store.target>);

const files = useTemplateRef('files');

// A mark from the file list or from a diff editor can change what a sync would do.
function refreshSyncPlan(): void {
  void queryClient.invalidateQueries({ queryKey: viewedSyncPlanPrefix });
}
tryOnScopeDispose(
  onReviewRepaint((e) => {
    if (e.kind === 'mark' && e.repoId === target.value?.gitRepoId) refreshSyncPlan();
  }),
);

// The Workflow review tab shows while the branch has a review step run; it opens first while that
// run waits, and the user's own pick wins afterwards.
const reviewStep = useReviewStep(() => store.target?.branchId ?? '');
const hasWorkflowReview = computed(() => reviewStep.data.value?.run != null);
const rightTab = computed<'workflow' | 'ask'>({
  get: () => {
    if (!hasWorkflowReview.value) return 'ask';
    if (store.rightTab) return store.rightTab;
    return reviewStep.data.value?.run?.state === 'review' ? 'workflow' : 'ask';
  },
  set: (v) => {
    store.rightTab = v;
  },
});
const RIGHT_TABS = computed(() => [
  {
    value: 'workflow',
    label: t('space.ade.reviewStep.tab.workflow.label'),
    testid: 'ade-review-tab-workflow',
  },
  { value: 'ask', label: t('space.ade.reviewStep.tab.ask.label'), testid: 'ade-review-tab-ask' },
]);

const LEFT_MIN = 180;
const LEFT_MAX = 480;
const storedLeft = usePersistedState('kira.ade.review.leftWidth', 260);
// A width stored under the older 220-560 bounds is clamped, not reset.
const left = useLiveSize(
  () => Math.max(LEFT_MIN, Math.min(LEFT_MAX, storedLeft.value)),
  (w) => {
    storedLeft.value = w;
  },
);

const RIGHT_MIN = 280;
const RIGHT_MAX = 720;
const storedRight = usePersistedState('kira.ade.review.rightWidth', 380);
const right = useLiveSize(
  () => Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, storedRight.value)),
  (w) => {
    storedRight.value = w;
  },
);
</script>

<template>
  <div v-if="target" class="flex h-full flex-col" data-testid="ade-review-window">
    <TitleBarBase>
      <span class="truncate text-kira-md text-muted-foreground">{{
        t('space.ade.review.window.title.title', { branch: target.branch })
      }}</span>
    </TitleBarBase>
    <AdeReviewHeader :target="target" />
    <div class="flex min-h-0 flex-1 gap-0.5 bg-chrome px-1.5 pb-0.5">
      <section
        class="min-h-0 flex-none overflow-hidden rounded-kira border border-border bg-bg"
        :style="{ width: `${left.size.value}px` }"
        :aria-label="t('space.ade.review.window.files.aria')"
        data-testid="ade-review-left"
      >
        <AdeReviewFiles ref="files" :target="target" @marked="refreshSyncPlan" />
      </section>
      <ResizeHandle
        :label="t('space.ade.panel.resize.label')"
        data-testid="ade-panel-resize-handle"
        :min="LEFT_MIN"
        :max="LEFT_MAX"
        v-bind="left.bind"
      />
      <section
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-kira border border-border bg-bg"
        :aria-label="t('space.ade.review.window.diffs.aria')"
        data-testid="ade-review-centre"
      >
        <div
          class="h-tabbar min-h-0 shrink-0 overflow-hidden border-b border-border bg-chrome"
          data-testid="ade-review-tabs"
        >
          <TabStrip />
        </div>
        <div class="min-h-0 flex-1">
          <MainView>
            <template #empty>
              <p class="m-0 p-4 text-muted-foreground" data-testid="ade-review-empty">{{
                t('space.ade.review.window.emptyHint.emptyHint')
              }}</p>
            </template>
          </MainView>
        </div>
      </section>
      <ResizeHandle
        :label="t('space.ade.panel.resize.label')"
        data-testid="ade-panel-resize-handle"
        direction="reverse"
        :min="RIGHT_MIN"
        :max="RIGHT_MAX"
        v-bind="right.bind"
      />
      <section
        class="flex min-h-0 flex-none flex-col overflow-hidden rounded-kira border border-border bg-bg"
        :style="{ width: `${right.size.value}px` }"
        :aria-label="t('space.ade.review.agent.label')"
        data-testid="ade-review-right"
      >
        <SecondaryTabs
          v-if="hasWorkflowReview"
          v-model="rightTab"
          :items="RIGHT_TABS"
          class="shrink-0 border-b border-border"
          data-testid="ade-review-right-tabs"
        />
        <div class="min-h-0 flex-1">
          <AdeWorkflowReviewPanel
            v-if="rightTab === 'workflow'"
            :target="target"
            @open-file="files?.selectFile($event)"
          />
          <AdeReviewAgentPanel v-else :target="target" :repo-label="repoLabel" />
        </div>
      </section>
    </div>
  </div>
</template>
