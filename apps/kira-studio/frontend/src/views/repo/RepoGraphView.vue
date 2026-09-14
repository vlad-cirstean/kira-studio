<script setup lang="ts">
// C5 §6.2: the pinned first tab (a placeholder at C5). C10 §8 replaces this file's content
// wholesale with the real @kira/git-ui graph mount, read-only (docs/v1.5/plans/
// C10-git-graph-native.md) — modelled on RepoDiffView.vue's own mount lifecycle: mount() on
// onMounted, unmount() on onUnmounted (a mere tab switch away, not a workspace close — the
// transport itself outlives that, cached per repo workspace by gitTransportFor, S17 disposes it).
import type { MountHandle } from '@kira/git-ui';
import type { RepoGraphTabRecord } from '@shared/domain/tabs';
import { repoIdOfWorkspace, type WorkspaceKey } from '@shared/domain/workspace';
import { onMounted, onUnmounted, ref } from 'vue';
import { loadGitUi } from '../../repo/git/gitUiModule';
import { gitTransportFor } from '../../repo/git/transport';
import { TabViewStateStore } from '../../repo/git/viewStateStore';
import EmptyState from '../../theme/primitives/EmptyState.vue';

const props = defineProps<{ tab: RepoGraphTabRecord }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let handle: MountHandle | null = null;

async function mountGraph(): Promise<void> {
  const repoId = props.tab.workspaceId
    ? repoIdOfWorkspace(props.tab.workspaceId as WorkspaceKey)
    : null;
  if (!repoId) {
    errorMessage.value = 'This tab has no repository.';
    return;
  }
  if (!container.value) return; // unmounted (tab closed/switched away) before this ran.

  const { mount, parsePersistedViewState } = await loadGitUi();
  if (!container.value) return; // unmounted while the chunk above was in flight.

  handle = mount(container.value, {
    transport: gitTransportFor(repoId),
    viewState: new TabViewStateStore(props.tab.id, parsePersistedViewState),
    host: 'kira',
    view: 'graph', // never 'review' — the C11 boundary (§9): this excludes the whole review layer.
    // §14 OQ4: no wire event maps onto this natively. Go's gitrpc emits no 'connection.changed'
    // analogue at all — that event is composed entirely by the VS Code extension host
    // (proxyHandlers.ts's own ConnectionManager.onStateChange push), not something a raw
    // rpcstream naturally has. A dropped renderer stream (a reload) tears this whole mount down
    // regardless, so there is no lesser-failure state worth inventing a synthetic event for.
    // Left unconditionally 'connected' rather than wired to nothing.
    hostConnectionState: { kind: 'connected' },
  });
}

onMounted(() => void mountGraph());

// A mere tab switch away, not a workspace close — git-ui's own AppRoot/App.vue instance is torn
// down (this is what ViewStateStore exists for, §8), but the transport itself is cached per repo
// workspace (gitTransportFor) and outlives it; only closing the workspace disposes it (S17).
onUnmounted(() => {
  handle?.unmount();
  handle = null;
});
</script>

<template>
  <div
    v-if="!errorMessage"
    ref="container"
    class="repo-graph-host"
    data-testid="repo-graph-host"
  />
  <EmptyState v-else icon="warning" :label="errorMessage" />
</template>

<style scoped>
.repo-graph-host {
  height: 100%;
  width: 100%;
}
</style>
