<script setup lang="ts">
import type { MountHandle } from '@kira/git-ui';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { onMounted, onUnmounted, ref } from 'vue';
import { loadGitUi } from '../../../repo/git/gitUiModule';
import { gitTransportFor } from '../../../repo/git/transport';
import { ensureRepoOpen } from '../../../state/repoOpenHold';
import type { ReviewWindowTarget } from '../wire';

// The review window's left pane: git-ui's review view on this window's branch and base, listing
// only the files that changed since their last review.
const props = defineProps<{ target: ReviewWindowTarget }>();
const emit = defineEmits<{ marked: [path: string] }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let handle: MountHandle | null = null;

onMounted(async () => {
  if (!container.value) return;
  try {
    // The review view only asks about a repo this connection already holds.
    const transport = gitTransportFor(props.target.codeRepoId);
    await ensureRepoOpen(transport, props.target.gitRepoId);
    const { mount, NullViewStateStore } = await loadGitUi();
    if (!container.value) return;
    handle = mount(container.value, {
      transport,
      viewState: new NullViewStateStore(),
        view: 'review',
      target: {
        repoId: props.target.gitRepoId,
        branch: props.target.branch,
        base: props.target.base,
        pane: 'files',
      },
      reviewFilter: 'needsReview',
      onReviewMarked: (path) => emit('marked', path),
    });
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  }
});

onUnmounted(() => {
  handle?.unmount();
  handle = null;
});
</script>

<template>
  <div v-if="!errorMessage" ref="container" class="h-full w-full" data-testid="ade-review-files" />
  <Alert v-else variant="note">
    <AlertDescription>{{ errorMessage }}</AlertDescription>
  </Alert>
</template>
