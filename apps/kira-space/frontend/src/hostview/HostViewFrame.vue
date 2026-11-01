<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Skeleton } from '@theme/components/ui/skeleton';
import { t } from '@theme/i18n';
import TitleBarBase from '@workbench/components/TitleBar.vue';

// The chrome both views share: title bar (badge, title, ref, refresh / copy / open), the loading
// skeleton and the failure alert with Retry. The body is the default slot.
defineProps<{
  title: string;
  refText: string;
  fetching: boolean;
  pending: boolean;
  failure: string;
  copyLabel: string;
  openLabel: string;
  openDisabled?: boolean;
}>();
const emit = defineEmits<{ refresh: []; copy: []; open: [] }>();
</script>

<template>
  <div class="flex h-full flex-col bg-bg">
    <TitleBarBase>
      <div class="flex min-w-0 flex-1 items-center gap-2" data-testid="host-view-header">
        <slot name="badge" />
        <span class="min-w-0 truncate text-kira-md font-medium" data-testid="host-view-title">{{
          title
        }}</span>
        <span
          class="shrink-0 font-data text-kira-sm text-muted-foreground"
          data-testid="host-view-ref"
        >
          {{ refText }}
        </span>
      </div>
      <div class="wails-no-drag flex shrink-0 items-center gap-1">
        <TooltipIconButton
          icon="refresh"
          :label="t('common.action.refresh.label')"
          :icon-size="16"
          variant="title"
          size="title"
          :disabled="fetching"
          data-testid="host-view-refresh"
          @click="emit('refresh')"
        />
        <TooltipIconButton
          icon="link"
          :label="copyLabel"
          :icon-size="16"
          variant="title"
          size="title"
          :disabled="openDisabled"
          data-testid="host-view-copy"
          @click="emit('copy')"
        />
        <TooltipIconButton
          icon="link-external"
          :label="openLabel"
          :icon-size="16"
          variant="title"
          size="title"
          :disabled="openDisabled"
          data-testid="host-view-open-host"
          @click="emit('open')"
        />
      </div>
    </TitleBarBase>

    <div v-if="pending" class="flex flex-col gap-3 p-4" data-testid="host-view-loading">
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-full" />
    </div>
    <div v-else-if="failure" class="flex flex-col gap-2 p-4" data-testid="host-view-failure">
      <Alert variant="error">
        <AlertDescription data-testid="host-view-failure-reason">{{ failure }}</AlertDescription>
      </Alert>
      <Button size="inline" variant="link" data-testid="host-view-retry" @click="emit('refresh')">
        {{ t('common.action.retry.label') }}
      </Button>
    </div>
    <slot v-else />
  </div>
</template>
