<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { useDockerStatus, useRetryStatus } from '../queries';

const status = useDockerStatus();
const { retrying, retry } = useRetryStatus();
</script>

<template>
  <EmptyState
    fill
    :loading="!status.data.value"
    data-testid="docker-panel-unavailable"
    :title="
      status.data.value ? t('docker.panel.unavailable.title') : t('common.connecting.loading')
    "
    :description="status.data.value ? t('docker.panel.unavailable.description') : undefined"
  >
    <template #media>
      <CodiconIcon name="debug-disconnect" :size="24" class="text-error" />
    </template>
    <Button
      v-if="status.data.value"
      size="kira"
      variant="toolbar"
      :pending="retrying"
      @click="retry"
      >{{
        t('common.action.retry.label')
      }}</Button
    >
  </EmptyState>
</template>
