<script setup lang="ts">
import ScriptProgress from '@theme/components/ScriptProgress.vue';
import { Button } from '@theme/components/ui/button';
import { computed, ref } from 'vue';
import { setupStatus } from '../board/setupStatus';
import { useRepos, useRetrySetup } from '../queries';
import { solidStyle } from '../tones';
import type { Branch } from '../wire';
import AdeRunLog from './AdeRunLog.vue';

// One branch's prepare-script status: where it is, how long, why it failed, its output and Retry.
// The same block sits in the Details tab, the launch dialogs and the stage block.
const props = defineProps<{ branch: Branch; repo: string; compact?: boolean }>();
const repos = useRepos();
const retry = useRetrySetup();
const error = ref('');

const status = computed(() => {
  const setup = props.branch.setup;
  if (!setup) return null;
  const timeout = repos.data.value?.repos.find((r) => r.codeRepoId === props.branch.codeRepoId)?.prepareTimeout ?? '';
  return setupStatus(setup, props.repo, props.branch.name, timeout);
});

async function onRetry(): Promise<void> {
  error.value = '';
  try {
    await retry.mutateAsync({ branchId: props.branch.id });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div v-if="status" class="flex flex-col gap-1" data-testid="ade-setup-progress" :data-branch-id="branch.id">
    <ScriptProgress v-bind="status">
      <template #actions>
        <Button
          v-if="status.state === 'failed'"
          size="xs"
          class="shrink-0 rounded-kira-xs px-2 font-semibold"
          :style="solidStyle('amber')"
          :disabled="retry.isPending.value"
          data-testid="ade-setup-retry"
          @click="onRetry"
        >
          Retry setup
        </Button>
      </template>
      <AdeRunLog
        v-if="!compact && (status.state === 'running' || status.state === 'failed')"
        kind="setup"
        :id="branch.id"
        max-height="160px"
      />
    </ScriptProgress>
    <p v-if="error" class="m-0 text-kira-sm text-error" data-testid="ade-setup-error">{{ error }}</p>
  </div>
</template>
