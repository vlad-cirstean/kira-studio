<script setup lang="ts">
import Disclosure from '@theme/components/Disclosure.vue';
import TruncatedText from '@theme/components/TruncatedText.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { FieldDescription } from '@theme/components/ui/field';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@theme/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import VarText from '@theme/components/VarText.vue';
import { hostWords, type MessageKey, t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import Identifier from '@workbench/components/Identifier.vue';
import { computed, ref } from 'vue';
import { remoteErrorText } from '../board/panelFacts';
import { useHostLabels } from '../hostLabels';
import { useRefresh, useViewedSyncApply, useViewedSyncPlan } from '../queries';
import type { ReviewWindowTarget, ViewedSyncResult } from '../wire';
import { headDiffersParts } from './syncParts';

// Marks this branch's fully reviewed files as viewed on its pull request, one way: nothing read from
// the host changes the app's review state. The plan reloads on window focus, mark, and popover open, never on
// a board push: each load lists the change request's files through the host.
const props = defineProps<{ target: ReviewWindowTarget }>();

const plan = useViewedSyncPlan(() => props.target.branchId);
const apply = useViewedSyncApply();
const refresh = useRefresh();

const open = ref(false);
const result = ref<ViewedSyncResult | null>(null);
const error = ref('');

const REASON = {
  notReviewed: 'space.ade.review.sync.notReviewed.status',
  partial: 'space.ade.review.sync.partial.status',
  changedSinceReview: 'space.ade.review.sync.changedSinceReview.status',
  differsFromPrHead: 'space.ade.review.sync.differsFromHead.status',
  notInPr: 'space.ade.review.sync.notInChangeRequest.status',
} as const satisfies Record<string, MessageKey>;
const reasonText = (reason: string): string =>
  reason in REASON
    ? t(REASON[reason as keyof typeof REASON], {
        changeRequestShort: words.value.changeRequestShort,
      })
    : reason;
const ACTION = {
  mark: 'space.ade.review.sync.mark.label',
  unmark: 'space.ade.review.sync.unmark.label',
} as const satisfies Record<string, MessageKey>;
const actionText = (action: string): string =>
  action in ACTION ? t(ACTION[action as keyof typeof ACTION]) : action;

const data = computed(() => plan.data.value);
const hostLabels = useHostLabels();
const words = computed(() => hostWords(data.value?.host));
const hostLabel = computed(() => data.value?.host?.label ?? hostLabels.labels.value);
const status = computed(() => data.value?.status);
const loadFailed = computed(() => plan.isError.value && !data.value);
const visible = computed(
  () =>
    loadFailed.value ||
    (!!data.value &&
      status.value !== 'disabled' &&
      status.value !== 'noPr' &&
      status.value !== 'unsupported'),
);
const marks = computed(() => data.value?.files.filter((f) => f.action === 'mark') ?? []);
const unmarks = computed(() => data.value?.files.filter((f) => f.action === 'unmark') ?? []);
const skipped = computed(() => data.value?.files.filter((f) => f.action === 'skip') ?? []);
const count = computed(() => marks.value.length + unmarks.value.length);
const prNumber = computed(() => data.value?.changeRequest?.number ?? 0);

const blockedMessage = computed(() => {
  if (loadFailed.value) {
    const e = plan.error.value;
    return t('space.ade.review.sync.loadFailed.error', { error: errorText(e) });
  }
  switch (status.value) {
    case 'prClosed':
      return (
        data.value?.message ??
        t('space.ade.review.sync.closed.tooltip', {
          changeRequestShort: words.value.changeRequestShort,
          number: String(prNumber.value),
        })
      );
    case 'cliMissing':
      return t('space.ade.review.sync.cliMissing.tooltip', { cli: data.value?.host?.cli ?? '' });
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
  const number = String(prNumber.value);
  const { changeRequestShort } = words.value;
  return u > 0
    ? t('space.ade.review.sync.confirmUnmark.label', {
        count: m,
        changeRequestShort,
        number,
        unmarked: u,
      })
    : t('space.ade.review.sync.confirm.label', { count: m, changeRequestShort, number });
});

async function confirm(): Promise<void> {
  error.value = '';
  try {
    result.value = await apply.mutateAsync({ branchId: props.target.branchId });
  } catch (err) {
    error.value = errorText(err);
  }
}

async function refreshRepo(): Promise<void> {
  error.value = '';
  try {
    const res = await refresh.mutateAsync({ codeRepoIds: [props.target.codeRepoId] });
    const failed = res.repos.find((r) => r.error)?.error;
    if (failed) error.value = remoteErrorText(failed);
    await plan.refetch();
  } catch (err) {
    error.value = errorText(err);
  }
}

function onOpenChange(next: boolean): void {
  open.value = next;
  if (next) {
    result.value = null;
    void plan.refetch();
  }
}
</script>

<template>
  <Popover v-if="visible" :open="open" @update:open="onOpenChange">
    <PopoverAnchor as-child>
      <Tooltip :disabled="!blocked">
        <TooltipTrigger as-child>
          <span>
            <PopoverTrigger as-child>
              <Button
                variant="dialog"
                size="kira"
                :disabled="blocked"
                data-testid="ade-review-sync"
              >
                {{
                  loadFailed ? t('space.ade.review.sync.button.label', { label: hostLabel }) : t('space.ade.review.sync.buttonCount.label', { label: hostLabel, count })
                }}
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ blockedMessage }}</TooltipContent>
      </Tooltip>
    </PopoverAnchor>
    <PopoverContent class="w-96 text-kira-md" align="end" data-testid="ade-review-sync-popover">
      <div class="flex flex-col gap-2">
        <FieldDescription v-if="data?.account" data-testid="ade-review-sync-account">
          {{ t('space.ade.review.sync.account.label', { account: data.account }) }}
        </FieldDescription>
        <FieldDescription v-if="headDiffers && data" data-testid="ade-review-sync-head">
          <VarText
            :parts="headDiffersParts(data.headSha, data.localTip, words.changeRequestShort)"
          />
        </FieldDescription>

        <template v-if="result">
          <p class="m-0" data-testid="ade-review-sync-result">
            {{
              result.failed.length
                ? t('space.ade.review.sync.syncedFailed.status', { count: result.marked.length + result.unmarked.length, failed: result.failed.length })
                : t('space.ade.review.sync.synced.status', { count: result.marked.length + result.unmarked.length })
            }}
          </p>
          <Alert v-if="result.status !== 'ok'" variant="error"
            ><AlertDescription>{{ result.message }}</AlertDescription></Alert
          >
          <ul v-if="result.failed.length" class="m-0 list-none p-0 text-kira-sm text-error">
            <li v-for="f in result.failed" :key="f.path" class="flex gap-2">
              <Identifier :value="f.path" split="path" />
              <TruncatedText :text="f.error" />
            </li>
          </ul>
        </template>

        <template v-else-if="status === 'headNotFetched'">
          <p class="m-0" data-testid="ade-review-sync-message">{{ data?.message }}</p>
          <Button
            variant="dialog"
            size="kira"
            :pending="refresh.isPending.value"
            data-testid="ade-review-sync-refresh"
            @click="refreshRepo"
          >
            {{ t('space.ade.review.sync.refreshRepo.label') }}
          </Button>
        </template>

        <template v-else>
          <p v-if="count === 0" class="m-0" data-testid="ade-review-sync-nothing">{{
            t('space.ade.review.sync.nothing.empty')
          }}</p>
          <ul
            v-else
            class="m-0 flex max-h-40 list-none flex-col gap-0.5 overflow-auto p-0"
            data-testid="ade-review-sync-rows"
          >
            <li v-for="f in [...marks, ...unmarks]" :key="f.path" class="flex gap-2">
              <span class="shrink-0 text-muted-foreground">{{ actionText(f.action) }}</span>
              <Identifier :value="f.path" split="path" />
            </li>
          </ul>
          <Disclosure
            v-if="skipped.length"
            :label="t('memory.import.totals.skipped.label', { count: skipped.length })"
            trigger-class="text-kira-sm text-muted-foreground"
            data-testid="ade-review-sync-skipped"
          >
            <ul
              class="m-0 mt-1 flex max-h-32 list-none flex-col gap-0.5 overflow-auto p-0 text-kira-sm"
            >
              <li v-for="f in skipped" :key="f.path" class="flex gap-2">
                <Identifier :value="f.path" split="path" />
                <span class="shrink-0 text-muted-foreground">{{ reasonText(f.reason) }}</span>
              </li>
            </ul>
          </Disclosure>
          <Button
            v-if="count > 0"
            variant="dialog"
            size="kira"
            :pending="apply.isPending.value"
            data-testid="ade-review-sync-confirm"
            @click="confirm"
          >
            {{ confirmLabel }}
          </Button>
        </template>
        <Alert v-if="error" variant="error" data-testid="ade-review-sync-error"
          ><AlertDescription>{{ error }}</AlertDescription></Alert
        >
      </div>
    </PopoverContent>
  </Popover>
</template>
