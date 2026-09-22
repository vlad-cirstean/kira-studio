<script setup lang="ts">
// C5 §6.2: the pinned first tab (a placeholder at C5). C10 §8 replaces this file's content
// wholesale with the real @kira/git-ui graph mount, read-only (docs/v1.5/plans/
// C10-git-graph-native.md) — modelled on RepoDiffView.vue's own mount lifecycle: mount() on
// onMounted, unmount() on onUnmounted (a mere tab switch away, not a workspace close — the
// transport itself outlives that, cached per repo workspace by gitTransportFor, S17 disposes it;
// each mount holds its own lease over that shared transport, P67b §2.1 — so this mount's own
// unmount/dispose never tears down the graph tab's peers).
//
// P72 §3: `MainView.vue` now wraps this view in a `KeepAlive` (Studio only) — a tab switch away
// deactivates it rather than destroying it, so `mountGraph()`'s own layout stays computed instead
// of rebuilding from row 0 on every return (the "reload on tab focus" symptom). `defineOptions`'s
// `name` is what makes `KeepAlive`'s `include` match this component at all; without it a
// `<script setup>` component has no name and the include list matches nothing — a silent no-op.
// `onUnmounted`'s `handle?.unmount()` below still only runs on genuine destruction (a closed tab,
// or a `:max` eviction); reactivation needs no imperative resize call — verified during
// implementation (not assumed) with a standalone Chromium + WebKit repro reproducing this exact
// KeepAlive shape: `CommitGrid.vue`'s own `ResizeObserver` reliably fired both the deactivate
// (0×0) and reactivate (real size) transitions on both engines, so `scheduleResize()`'s existing
// `resizeCanvas()` + `rebuildColumns()` path already runs on return (now guarded against the 0×0
// leg doing wasted work, P79 review fix). `MountHandle`'s own doc comment (`main.ts`) names the
// fallback this would have needed had the observer not covered it.
//
// P79 review fix (Performance, LOW): deactivation DOES now add one hook — `onDeactivated`/
// `onActivated` call `handle.setVisible`, so `CommitGrid.vue`'s own generation-triggered rebuild
// (the layout worker's output, a `repo.changed` refresh) defers to a single catch-up on return
// instead of paying full rebuild cost against an invisible grid for as long as this tab stays
// backgrounded. This only pauses that one, specifically-measured live cost — every other retained
// bit of state this `KeepAlive` exists to keep (layout, scroll position, loaded rows, the git
// transport lease) is untouched, exactly as before.
import type { MountHandle } from '@kira/git-ui';
// P104 §3.4: EmptyState's ui/alert rewrite is a genuinely separate, non-mechanical piece of work --
// not attempted in this pass, same deferral as OperationsPanel.vue's own.
import EmptyState from '@theme/primitives/EmptyState.vue';
import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { loadGitUi } from '../../repo/git/gitUiModule';
import { takePendingBlameReveal } from '../../repo/git/hostHandlers';
import { gitTransportFor } from '../../repo/git/transport';
import { TabViewStateStore } from '../../repo/git/viewStateStore';
import { useSettingsStore } from '../../state/settings';
import type { RepoGraphTabRecord } from '../../state/tabDomain';
import { repoIdOfWorkspace, type WorkspaceKey } from '../../state/workspace';

defineOptions({ name: 'RepoGraphView' });

const props = defineProps<{ tab: RepoGraphTabRecord }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let handle: MountHandle | null = null;

async function mountGraph(): Promise<void> {
  const settingsStore = useSettingsStore();
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

  // P62 §4.5: a blame-annotation click-through that fired while this tab was cold — consumed
  // exactly once, the same `pendingUiAction` seam G10 D19's palette commands already use.
  const pendingReveal = takePendingBlameReveal(repoId);

  handle = mount(container.value, {
    transport: gitTransportFor(repoId),
    viewState: new TabViewStateStore(props.tab.id, parsePersistedViewState),
    host: 'kira',
    view: 'graph', // never 'review' — the C11 boundary (§9): this excludes the whole review layer.
    // P72 §9.1: Kira Studio's own app-wide appearance.dateFormat — read once here, at mount time,
    // not reactively (main.ts's own MountOptions.dateFormat doc comment).
    dateFormat: settingsStore.appearance.dateFormat,
    pendingUiAction: pendingReveal ? { action: 'revealCommit', target: pendingReveal } : null,
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
// This mount's own transport is a lease (P67b §2.1) — its dispose(), triggered by App.vue's own
// teardown chain on unmount, releases only this mount's subscriptions, never the shared socket.
onUnmounted(() => {
  handle?.unmount();
  handle = null;
});

// P79 review fix (Performance, LOW): `setVisible` is optional on `MountHandle` (main.ts) — a
// no-op call here is only reachable if `mountGraph()` hasn't resolved yet (this tab was opened
// and immediately backgrounded before its own chunk import settled), in which case there is
// nothing live yet to pause anyway.
onDeactivated(() => handle?.setVisible?.(false));
onActivated(() => handle?.setVisible?.(true));
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
@reference "@theme/base.css";

.repo-graph-host {
  @apply h-full w-full;
}
</style>
