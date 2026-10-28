<script setup lang="ts">
import type { MountHandle, ReviewApi } from '@kira/git-ui';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { useWindowFocus } from '@vueuse/core';
import { errorText } from '@workbench/bridge/codedError';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { loadGitUi } from '../../../repo/git/gitUiModule';
import { gitTransportFor } from '../../../repo/git/transport';
import { ensureRepoOpen } from '../../../state/repoOpenHold';
import { useReviewNavigationStore } from '../../../state/reviewNavigation';
import type { ReviewWindowTarget } from '../wire';

// The review window's left pane: git-ui's review view locked to this window's branch and base.
const props = defineProps<{ target: ReviewWindowTarget }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let handle: MountHandle | null = null;
let api: ReviewApi | null = null;
let unregisterNavigator: (() => void) | null = null;
const navigation = useReviewNavigationStore();

// Opens a file's diff in the centre tabs, as a click in the file list does.
defineExpose({ selectFile: (path: string) => api?.selectFile(path) });

// A missed watcher event (sleep, dropped FS event) heals when the window regains focus.
const focused = useWindowFocus();
watch(focused, (now, was) => {
  if (now && !was) api?.refresh();
});

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
      lockTarget: true,
      onReviewApi: (a) => {
        api = a;
        unregisterNavigator?.();
        unregisterNavigator = navigation.register(props.target.codeRepoId, a);
      },
    });
  } catch (err) {
    errorMessage.value = errorText(err);
  }
});

onUnmounted(() => {
  unregisterNavigator?.();
  unregisterNavigator = null;
  handle?.unmount();
  handle = null;
});
</script>

<template>
  <div v-if="!errorMessage" ref="container" class="h-full w-full" data-testid="ade-review-files" />
  <Alert v-else variant="info">
    <AlertDescription>{{ errorMessage }}</AlertDescription>
  </Alert>
</template>
