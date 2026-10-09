<script setup lang="ts">
/**
 * P173: the visible half of every failure the live region already announces. An inline banner,
 * not a toast: it stays until dismissed or superseded, pushes layout instead of covering grid
 * rows, and needs no toast host in either app. `role="region"` replaces `Alert`'s own
 * `role="alert"` so the shared `sr-only` live region stays the single announcer.
 */
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';
import type { FailureNotice } from '../state/failureNotice.ts';

const props = defineProps<{
  notice: FailureNotice;
  /** Present only where the host can open Kira Space's Operations dock. */
  showOperations?: (() => void) | undefined;
}>();
const emit = defineEmits<{ dismiss: []; retry: [] }>();

const detail = computed(() => props.notice.detail);
const hint = computed(() =>
  props.notice.logged && props.showOperations === undefined
    ? `${props.notice.hint} Details: Kira Space → Operations.`
    : props.notice.hint,
);
const canShowOperations = computed(() => props.notice.logged && props.showOperations !== undefined);
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: Alert's root is a themed div; role="region" only replaces its role="alert" -->
  <Alert
    variant="destructive"
    role="region"
    aria-label="Last failure"
    class="shrink-0 rounded-none border-x-0 border-t-0 pr-18"
    data-testid="failure-banner"
  >
    <AlertTitle class="font-semibold">{{ notice.title }}</AlertTitle>
    <AlertDescription v-if="detail" class="whitespace-pre-wrap">{{ detail }}</AlertDescription>
    <AlertDescription data-testid="failure-banner-hint">{{ hint }}</AlertDescription>
    <AlertAction class="flex items-center gap-1">
      <Button
        v-if="notice.retryGraph"
        variant="dialog"
        size="kira"
        data-testid="failure-banner-retry"
        @click="emit('retry')"
      >
        Retry
      </Button>
      <Button
        v-if="canShowOperations"
        variant="dialog"
        size="kira"
        data-testid="failure-banner-operations"
        @click="showOperations?.()"
      >
        Show in Operations
      </Button>
      <Button
        variant="toolbar"
        size="kira-icon"
        aria-label="Dismiss"
        data-testid="failure-banner-dismiss"
        @click="emit('dismiss')"
      >
        <CodiconIcon name="close" :size="13" />
      </Button>
    </AlertAction>
  </Alert>
</template>
