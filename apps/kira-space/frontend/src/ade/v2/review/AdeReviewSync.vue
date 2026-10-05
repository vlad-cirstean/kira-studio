<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, ref } from 'vue';
import { useGhSyncPlan, useGitHubSyncApply, useRefresh } from '../queries';
import type { GhSyncResult, ReviewWindowTarget } from '../wire';

// Marks this branch's fully reviewed files as viewed on its pull request, one way: nothing read from
// GitHub changes the app's review state. The plan reloads on window focus, mark, and popover open, never on
// a board push: each load lists the PR's files through GitHub.
const props = defineProps<{ target: ReviewWindowTarget }>();

const plan = useGhSyncPlan(() => props.target.branchId);
const apply = useGitHubSyncApply();
const refresh = useRefresh();

const open = ref(false);
const result = ref<GhSyncResult | null>(null);
const error = ref('');

const REASON: Record<string, string> = {
  notReviewed: 'not reviewed',
  partial: 'partly reviewed',
  changedSinceReview: 'changed since review',
  differsFromPrHead: 'differs from the PR head',
  notInPr: 'not in the PR',
};

const data = computed(() => plan.data.value);
const status = computed(() => data.value?.status);
const visible = computed(() => !!data.value && status.value !== 'disabled' && status.value !== 'noPr');
const marks = computed(() => data.value?.files.filter((f) => f.action === 'mark') ?? []);
const unmarks = computed(() => data.value?.files.filter((f) => f.action === 'unmark') ?? []);
const skipped = computed(() => data.value?.files.filter((f) => f.action === 'skip') ?? []);
const count = computed(() => marks.value.length + unmarks.value.length);
const prNumber = computed(() => data.value?.pr?.number ?? 0);

const blockedMessage = computed(() => {
  switch (status.value) {
    case 'prClosed':
      return data.value?.message ?? `PR #${prNumber.value} is closed`;
    case 'ghMissing':
      return 'Install the GitHub CLI (gh)';
    case 'unauthenticated':
    case 'unavailable':
      return data.value?.message ?? '';
    default:
      return '';
  }
});
const blocked = computed(() => blockedMessage.value !== '');
const headDiffers = computed(
  () => !!data.value && data.value.headSha !== '' && data.value.headSha !== data.value.localTip,
);

const confirmLabel = computed(() => {
  const m = marks.value.length;
  const u = unmarks.value.length;
  const markPart = `Mark ${m} ${m === 1 ? 'file' : 'files'} viewed on PR #${prNumber.value}`;
  return u > 0 ? `${markPart}, unmark ${u}` : markPart;
});

async function confirm(): Promise<void> {
  error.value = '';
  try {
    result.value = await apply.mutateAsync({ branchId: props.target.branchId });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function refreshRepo(): Promise<void> {
  error.value = '';
  try {
    await refresh.mutateAsync({ codeRepoIds: [props.target.codeRepoId] });
    await plan.refetch();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function onOpenChange(next: boolean): void {
  open.value = next;
  if (next) {
    result.value = null;
    void plan.refetch();
  }
}

function short(sha: string): string {
  return sha.slice(0, 7);
}
</script>

<template>
  <Popover v-if="visible" :open="open" @update:open="onOpenChange">
    <Tooltip :disabled="!blocked">
      <TooltipTrigger as-child>
        <span>
          <PopoverTrigger as-child>
            <Button variant="dialog" size="xs" :disabled="blocked" data-testid="ade-review-sync">
              Sync to GitHub · {{ count }}
            </Button>
          </PopoverTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ blockedMessage }}</TooltipContent>
    </Tooltip>
    <PopoverContent class="w-[380px] text-kira-md" align="end" data-testid="ade-review-sync-popover">
      <div class="flex flex-col gap-2">
        <p v-if="data?.account" class="m-0 text-kira-sm text-muted-foreground" data-testid="ade-review-sync-account">
          Syncing as {{ data.account }}
        </p>
        <p v-if="headDiffers && data" class="m-0 text-kira-sm text-muted-foreground" data-testid="ade-review-sync-head">
          PR head {{ short(data.headSha) }} ≠ local {{ short(data.localTip) }}
        </p>

        <template v-if="result">
          <p class="m-0" data-testid="ade-review-sync-result">
            Synced {{ result.marked.length + result.unmarked.length }}
            {{ result.marked.length + result.unmarked.length === 1 ? 'file' : 'files' }}
            <template v-if="result.failed.length"> · {{ result.failed.length }} failed</template>
          </p>
          <p v-if="result.status !== 'ok'" class="m-0 text-error">{{ result.message }}</p>
          <ul v-if="result.failed.length" class="m-0 list-none p-0 text-kira-sm text-error">
            <li v-for="f in result.failed" :key="f.path" class="truncate" :title="f.error">{{ f.path }} — {{ f.error }}</li>
          </ul>
        </template>

        <template v-else-if="status === 'headNotFetched'">
          <p class="m-0" data-testid="ade-review-sync-message">{{ data?.message }}</p>
          <Button variant="dialog" size="xs" :disabled="refresh.isPending.value" data-testid="ade-review-sync-refresh" @click="refreshRepo">
            Refresh repo
          </Button>
        </template>

        <template v-else>
          <p v-if="count === 0" class="m-0" data-testid="ade-review-sync-nothing">Nothing to sync</p>
          <ul v-else class="m-0 flex max-h-40 list-none flex-col gap-0.5 overflow-auto p-0" data-testid="ade-review-sync-rows">
            <li v-for="f in [...marks, ...unmarks]" :key="f.path" class="flex gap-2">
              <span class="shrink-0 text-muted-foreground">{{ f.action }}</span>
              <span class="truncate font-data" :title="f.path">{{ f.path }}</span>
            </li>
          </ul>
          <details v-if="skipped.length" data-testid="ade-review-sync-skipped">
            <summary class="cursor-pointer text-kira-sm text-muted-foreground">{{ skipped.length }} skipped</summary>
            <ul class="m-0 mt-1 flex max-h-32 list-none flex-col gap-0.5 overflow-auto p-0 text-kira-sm">
              <li v-for="f in skipped" :key="f.path" class="flex gap-2">
                <span class="truncate font-data" :title="f.path">{{ f.path }}</span>
                <span class="shrink-0 text-muted-foreground">{{ REASON[f.reason] ?? f.reason }}</span>
              </li>
            </ul>
          </details>
          <Button
            v-if="count > 0"
            variant="dialog"
            size="xs"
            :disabled="apply.isPending.value"
            data-testid="ade-review-sync-confirm"
            @click="confirm"
          >
            {{ confirmLabel }}
          </Button>
        </template>
        <p v-if="error" class="m-0 text-kira-sm text-error" data-testid="ade-review-sync-error">{{ error }}</p>
      </div>
    </PopoverContent>
  </Popover>
</template>
