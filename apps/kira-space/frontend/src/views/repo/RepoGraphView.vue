<script setup lang="ts">
// C5 §6.2: the pinned first tab (a placeholder at C5). C10 §8 replaces this file's content
// wholesale with the real @kira/git-ui graph mount, read-only (docs/v1.5/plans/
// C10-git-graph-native.md) — modelled on RepoDiffView.vue's own mount lifecycle: mount() on
// onMounted, unmount() on onUnmounted (a mere tab switch away, not a workspace close — the
// transport itself outlives that, cached per repo workspace by gitTransportFor, S17 disposes it;
// each mount holds its own lease over that shared transport, P67b §2.1 — so this mount's own
// unmount/dispose never tears down the graph tab's peers).
//
// A tab switch away unmounts this view; the transport outlives it and view state restores
// through TabViewStateStore.
import type { MountHandle } from '@kira/git-ui';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Empty, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { onMounted, onUnmounted, ref } from 'vue';
import { loadGitUi } from '../../repo/git/gitUiModule';
import { takePendingBlameReveal } from '../../repo/git/hostHandlers';
import { repoHeadOf } from '../../repo/git/repoHead';
import { gitTransportFor } from '../../repo/git/transport';
import { TabViewStateStore } from '../../repo/git/viewStateStore';
import { useCodeReposStore } from '../../state/coderepos';
import { useLayoutStore } from '../../state/layout';
import { useSettingsStore } from '../../state/settings';
import type { RepoGraphTabRecord } from '../../state/tabDomain';
import { NO_REPOSITORY_MESSAGE, repoIdOfTab } from '../../state/workspace';

const props = defineProps<{ tab: RepoGraphTabRecord }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let handle: MountHandle | null = null;

async function mountGraph(): Promise<void> {
  const settingsStore = useSettingsStore();
  const layoutStore = useLayoutStore();
  const repoHead = repoHeadOf(useCodeReposStore().codeRepoRecord(repoIdOfTab(props.tab)));
  const repoId = repoIdOfTab(props.tab);
  if (!repoId) {
    errorMessage.value = NO_REPOSITORY_MESSAGE;
    return;
  }
  if (!container.value) return; // unmounted (tab closed/switched away) before this ran.

  const { mount, parsePersistedViewState } = await loadGitUi();
  if (!container.value) return; // unmounted while the chunk above was in flight.

  // P62 §4.5: a blame-annotation click-through that fired while this tab was cold — consumed
  // exactly once, the same `pendingUiAction` seam G10 D19's palette commands already use.
  const pendingReveal = takePendingBlameReveal(repoId);

  handle = mount(container.value, {
    transport: gitTransportFor(repoId),
    viewState: new TabViewStateStore(props.tab.id, parsePersistedViewState),
    view: 'graph', // never 'review' — the C11 boundary (§9): this excludes the whole review layer.
    // P72 §9.1: Kira Studio's own app-wide appearance.dateFormat — read once here, at mount time,
    // not reactively (main.ts's own MountOptions.dateFormat doc comment).
    dateFormat: settingsStore.appearance.dateFormat,
    repoHead,
    pendingUiAction: pendingReveal ? { action: 'revealCommit', target: pendingReveal } : null,
    // P173: the failure banner's "Show in Operations" button.
    onShowOperations: () => {
      if (!layoutStore.panel.operations.visible) layoutStore.toggleOperationsPanel();
    },
  });
}

onMounted(() => void mountGraph());

// A mere tab switch away, not a workspace close — git-ui's own AppRoot/App.vue instance is torn
// down (this is what ViewStateStore exists for, §8), but the transport itself is cached per repo
// workspace (gitTransportFor) and outlives it; only closing the workspace disposes it (S17).
// This mount's own transport is a lease (P67b §2.1) — its dispose(), triggered by App.vue's own
// teardown chain on unmount, releases only this mount's subscriptions, never the shared socket.
onUnmounted(() => {
  handle?.unmount();
  handle = null;
});
</script>

<template>
  <div
    v-if="!errorMessage"
    ref="container"
    class="h-full w-full"
    data-testid="repo-graph-host"
  />
  <Empty v-else class="h-full">
      <EmptyMedia><CodiconIcon name="warning" :size="24" /></EmptyMedia>
      <EmptyTitle>{{ errorMessage }}</EmptyTitle>
    </Empty>
</template>
