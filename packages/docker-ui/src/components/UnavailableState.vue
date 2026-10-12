<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import Spinner from '@theme/components/Spinner.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import { useRetryStatus } from '../queries';
import type { DockerStatus, UnavailableReason } from '../wire';
import EndpointChip from './EndpointChip.vue';

const props = defineProps<{ status: DockerStatus }>();

const { retrying, retry } = useRetryStatus();

const COPY: Record<UnavailableReason, { title: () => string; hint: () => string }> = {
  'not-installed': {
    title: () => t('docker.unavailable.notInstalled.title'),
    hint: () => t('docker.unavailable.notInstalled.hint', { engines: 'Docker Desktop, Colima or Podman' }),
  },
  'daemon-down': {
    title: () => t('docker.unavailable.daemonDown.title'),
    hint: () => t('docker.unavailable.daemonDown.hint'),
  },
  'permission-denied': {
    title: () => t('docker.unavailable.permissionDenied.title'),
    hint: () => t('docker.unavailable.permissionDenied.hint'),
  },
  unreachable: {
    title: () => t('docker.unavailable.unreachable.title'),
    hint: () => t('docker.unavailable.unreachable.hint', { env: 'DOCKER_HOST' }),
  },
  tls: {
    title: () => t('docker.unavailable.tls.title'),
    hint: () => t('docker.unavailable.tls.hint', { env: 'DOCKER_CERT_PATH' }),
  },
  error: {
    title: () => t('docker.unavailable.error.title'),
    hint: () => t('docker.unavailable.error.hint'),
  },
};

const copy = computed(() => {
  const c = COPY[props.status.reason ?? 'error'];
  return { title: c.title(), hint: c.hint() };
});
</script>

<template>
  <EmptyState
    class="h-full"
    data-testid="docker-unavailable"
    :title="copy.title"
    :description="copy.hint"
  >
    <template #media><CodiconIcon name="debug-disconnect" :size="24" class="text-error" /></template>
      <code class="font-data text-kira-sm text-muted-foreground" data-testid="docker-unavailable-endpoint">{{ status.endpoint.host }}</code>
      <p v-if="status.message" class="max-w-md text-kira-sm text-muted-foreground">{{ status.message }}</p>
      <div class="flex items-center gap-2">
        <Button size="kira" variant="toolbar" :disabled="retrying" data-testid="docker-retry" @click="retry">
          <Spinner v-if="retrying" label="" /><CodiconIcon v-else name="refresh" :size="12" />{{ t('common.action.retry.label') }}
        </Button>
        <EndpointChip />
      </div>
      <p class="text-kira-sm text-muted-foreground">{{ t('docker.unavailable.recheck.hint') }}</p>
  </EmptyState>
</template>
