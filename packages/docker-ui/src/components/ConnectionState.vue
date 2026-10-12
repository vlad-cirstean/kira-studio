<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import Spinner from '@theme/components/Spinner.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { useDockerStatus, useRetryStatus } from '../queries';

const status = useDockerStatus();
const { retrying, retry } = useRetryStatus();
</script>

<template>
  <EmptyState
    class="h-full"
    data-testid="docker-panel-unavailable"
    :title="status.data.value ? t('docker.panel.unavailable.title') : t('common.connecting.loading')"
    :description="status.data.value ? t('docker.panel.unavailable.description') : undefined"
  >
    <template #media>
      <CodiconIcon v-if="status.data.value" name="debug-disconnect" :size="24" class="text-error" />
      <Spinner v-else :size="24" label="" />
    </template>
    <Button
      v-if="status.data.value"
      size="kira"
      variant="toolbar"
      :disabled="retrying"
      @click="retry"
      >{{
        t('common.action.retry.label')
      }}</Button
    >
  </EmptyState>
</template>
