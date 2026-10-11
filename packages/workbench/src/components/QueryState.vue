<script setup lang="ts" generic="T">
import CodiconIcon from '@theme/CodiconIcon.vue';
import InlineState from '@theme/components/InlineState.vue';
import Spinner from '@theme/components/Spinner.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { t } from '@theme/i18n';
import type { Ref } from 'vue';
import { computed } from 'vue';
import { errorText } from '../bridge/codedError';

// The one loading / error / empty shell for bridge data. `pane` fills a panel or view body with an
// Empty block (spinner, error with Retry); `inline` is a one-line state inside a list or popover.
// A caller passes its TanStack query result and fills the `default` slot with the loaded data.
interface QueryLike {
  data: Ref<T | undefined>;
  isPending: Ref<boolean>;
  isError: Ref<boolean>;
  error: Ref<unknown>;
  refetch: () => unknown;
}

const props = withDefaults(
  defineProps<{
    query: QueryLike;
    variant?: 'pane' | 'inline';
    /** Default: an empty array. */
    isEmpty?: (data: T) => boolean;
    loadingLabel?: string;
  }>(),
  { variant: 'pane', loadingLabel: () => t('common.state.loading.loading'), isEmpty: undefined },
);

defineSlots<{
  default(props: { data: T }): unknown;
  empty(): unknown;
  loading(): unknown;
  error(props: { message: string; retry: () => void }): unknown;
}>();

const message = computed(() => errorText(props.query.error.value));
const state = computed<'loading' | 'error' | 'empty' | 'data'>(() => {
  const { isPending, isError, data } = props.query;
  if (isError.value) return 'error';
  if (isPending.value || data.value === undefined) return 'loading';
  const empty = props.isEmpty ? props.isEmpty(data.value) : Array.isArray(data.value) && data.value.length === 0;
  return empty ? 'empty' : 'data';
});

function retry(): void {
  void props.query.refetch();
}
</script>

<template>
  <template v-if="state === 'loading'">
    <slot name="loading">
      <Empty v-if="variant === 'pane'" class="h-full" data-testid="query-loading">
        <EmptyHeader>
          <EmptyMedia><Spinner :size="24" /></EmptyMedia>
          <EmptyTitle>{{ loadingLabel }}</EmptyTitle>
        </EmptyHeader>
      </Empty>
      <InlineState v-else kind="loading" data-testid="query-loading">{{ loadingLabel }}</InlineState>
    </slot>
  </template>
  <template v-else-if="state === 'error'">
    <slot name="error" :message="message" :retry="retry">
      <Empty v-if="variant === 'pane'" class="h-full" data-testid="query-error">
        <EmptyHeader>
          <EmptyMedia><CodiconIcon name="error" :size="24" class="text-error" /></EmptyMedia>
          <EmptyTitle>{{ t('common.state.loadFailed.title') }}</EmptyTitle>
          <EmptyDescription>{{ message }}</EmptyDescription>
        </EmptyHeader>
        <Button size="kira" variant="toolbar" data-testid="query-retry" @click="retry">{{ t('common.action.retry.label') }}</Button>
      </Empty>
      <InlineState v-else kind="error" data-testid="query-error">{{ message }}</InlineState>
    </slot>
  </template>
  <slot v-else-if="state === 'empty'" name="empty" />
  <slot v-else :data="query.data.value as T" />
</template>
