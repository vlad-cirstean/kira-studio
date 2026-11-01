<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Skeleton } from '@theme/components/ui/skeleton';
import { t } from '@theme/i18n';
import { useCopy } from '@workbench/behaviour/clipboard';
import { formatRelative } from '@workbench/behaviour/format';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import { computed } from 'vue';
import { control } from '../bridge/control';
import HostViewConversation from './HostViewConversation.vue';
import HostViewSidebar from './HostViewSidebar.vue';
import MarkdownBody from './MarkdownBody.vue';
import { useChangeRequestDetail } from './queries';
import { useHostViewWindowStore } from './state';

// One change request: description and conversation (left), state and people (right). Refresh is the
// only refetch trigger; a host failure shows its reason with Retry.
const store = useHostViewWindowStore();
const target = computed(() => store.target as NonNullable<typeof store.target>);
const { copy } = useCopy();
const query = useChangeRequestDetail(() => target.value.url);
const result = computed(() => query.data.value);
const detail = computed(() => (result.value?.kind === 'ok' ? result.value.detail : undefined));
const failure = computed(() => {
  if (query.isError.value) return String(query.error.value ?? '');
  const r = result.value;
  if (!r || r.kind === 'ok') return '';
  return r.status.reason || t('space.hostView.gone.body');
});
const title = computed(
  () => detail.value?.title ?? `${target.value.host.changeRequestShort}${target.value.number}`,
);
const stateLabel = computed(() => {
  switch (detail.value?.state) {
    case 'draft':
      return t('common.draft.status');
    case 'merged':
      return t('common.merged.status');
    case 'closed':
      return t('common.closed.status');
    default:
      return t('common.action.open.label');
  }
});
const stateVariant = computed(() => {
  switch (detail.value?.state) {
    case 'merged':
      return 'info' as const;
    case 'closed':
      return 'error' as const;
    case 'draft':
      return 'chip' as const;
    default:
      return 'ok' as const;
  }
});

function refresh(): void {
  void query.refetch();
}
function openOnHost(): void {
  fireAndForget(control.gitHostOpenChangeRequestUrl(target.value.url), 'hostView.window');
}
function copyLink(): void {
  void copy(target.value.url);
}
</script>

<template>
  <div class="flex h-full flex-col bg-bg" data-testid="host-view-window">
    <TitleBarBase>
      <div class="flex min-w-0 flex-1 items-center gap-2" data-testid="host-view-header">
        <Badge v-if="detail" :variant="stateVariant" class="shrink-0" data-testid="host-view-state">
          {{ stateLabel }}
        </Badge>
        <span class="min-w-0 truncate text-kira-md font-medium" data-testid="host-view-title">{{
          title
        }}</span>
        <span
          class="shrink-0 font-data text-kira-sm text-muted-foreground"
          data-testid="host-view-ref"
        >
          {{ target.repo }} {{ target.host.changeRequestShort }}{{ target.number }}
        </span>
      </div>
      <div class="wails-no-drag flex shrink-0 items-center gap-1">
        <TooltipIconButton
          icon="refresh"
          :label="t('common.action.refresh.label')"
          :icon-size="16"
          variant="title"
          size="title"
          :disabled="query.isFetching.value"
          data-testid="host-view-refresh"
          @click="refresh"
        />
        <TooltipIconButton
          icon="link"
          :label="t('space.ade.link.copy.tooltip', { label: target.host.changeRequestShort })"
          :icon-size="16"
          variant="title"
          size="title"
          data-testid="host-view-copy"
          @click="copyLink"
        />
        <TooltipIconButton
          icon="link-external"
          :label="t('space.ade.board.taskMenu.openHost.label', { label: target.host.label })"
          :icon-size="16"
          variant="title"
          size="title"
          data-testid="host-view-open-host"
          @click="openOnHost"
        />
      </div>
    </TitleBarBase>

    <div
      v-if="query.isPending.value"
      class="flex flex-col gap-3 p-4"
      data-testid="host-view-loading"
    >
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-full" />
    </div>
    <div v-else-if="failure" class="flex flex-col gap-2 p-4" data-testid="host-view-failure">
      <Alert variant="error">
        <AlertDescription data-testid="host-view-failure-reason">{{ failure }}</AlertDescription>
      </Alert>
      <Button size="inline" variant="link" data-testid="host-view-retry" @click="refresh">
        {{ t('common.action.retry.label') }}
      </Button>
    </div>
    <div v-else-if="detail" class="flex min-h-0 flex-1" data-testid="host-view-body">
      <main class="min-w-0 flex-1 overflow-y-auto p-4">
        <div
          class="mb-3 flex flex-wrap items-center gap-x-2 text-kira-sm text-muted-foreground"
          data-testid="host-view-meta"
        >
          <CodiconIcon name="git-pull-request" :size="13" />
          <span>{{
            t('space.hostView.header.opened.label', {
              author: detail.author.name || detail.author.login,
              when: formatRelative(detail.createdAt),
            })
          }}</span>
          <span class="font-data" data-testid="host-view-branches">{{
            t('space.hostView.header.branches.label', { head: detail.headRef, base: detail.baseRef })
          }}</span>
        </div>
        <MarkdownBody :source="detail.body" />
        <HostViewConversation :threads="detail.threads" :truncated="!!detail.threadsTruncated" />
      </main>
      <HostViewSidebar :detail="detail" />
    </div>
  </div>
</template>
