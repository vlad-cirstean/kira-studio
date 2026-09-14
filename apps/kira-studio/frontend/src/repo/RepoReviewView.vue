<script setup lang="ts">
// C11 §8.4 (S13) — the review sidebar's real mount, modelled on views/repo/RepoGraphView.vue's own
// mount lifecycle (view: 'graph' there, 'review' here) with two differences that follow directly
// from §5.3's call: this is not a tab (RepoPanel.vue, S14, keeps it mounted with v-show while the
// segment is hidden rather than unmounting it on every switch away, so an in-flight review survives
// a trip to Files and back) and `viewState` is `NullViewStateStore` — `ReviewView.vue` never reads
// it (§5.3's own corroborating fact), so there is no per-mount state to persist through a
// TabViewStateStore the way the graph needs one.
import type { MountHandle } from '@kira/git-ui';
import { onMounted, onUnmounted, ref } from 'vue';
import { loadGitUi } from './git/gitUiModule';
import { takePendingReviewTarget } from './git/hostHandlers';
import { gitTransportFor } from './git/transport';

const props = defineProps<{ repoId: string }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let handle: MountHandle | null = null;

async function mountReview(): Promise<void> {
  if (!props.repoId) {
    errorMessage.value = 'This panel has no repository.';
    return;
  }
  if (!container.value) return; // unmounted (workspace closed) before this ran.

  // §8.4/S13: review.open's own cold-mount hand-off (hostHandlers.ts) — consumed once, so a later
  // remount (there isn't one, this component mounts exactly once per workspace, S14) never
  // re-applies a stale target.
  const target = takePendingReviewTarget(props.repoId);

  const { mount, NullViewStateStore } = await loadGitUi();
  if (!container.value) return; // unmounted while the chunk above was in flight.

  handle = mount(container.value, {
    transport: gitTransportFor(props.repoId),
    viewState: new NullViewStateStore(),
    host: 'kira',
    view: 'review',
    target,
    // §14 OQ4's own reasoning (RepoGraphView.vue) applies here identically — no native
    // 'connection.changed' analogue exists to wire this to.
    hostConnectionState: { kind: 'connected' },
  });
}

onMounted(() => void mountReview());

// Only fires on workspace close (RepoPanel.vue keeps this component alive with v-show for a mere
// segment switch, §8.4) — the transport itself is cached per repo workspace and outlives this
// regardless (gitTransportFor, disposed by state/workspace.ts's own close path, C10 S17).
onUnmounted(() => {
  handle?.unmount();
  handle = null;
});
</script>

<template>
  <div
    v-if="!errorMessage"
    ref="container"
    class="repo-review-host"
    data-testid="repo-review-host"
  />
  <p v-else class="p-strip note error-note">{{ errorMessage }}</p>
</template>

<style scoped>
.repo-review-host {
  height: 100%;
  width: 100%;
}
</style>
