<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { computed, ref } from 'vue';
import { useDocker } from '../context';
import type { DockerStatus, UnavailableReason } from '../wire';
import EndpointChip from './EndpointChip.vue';

const props = defineProps<{ status: DockerStatus }>();

const { control } = useDocker();
const qc = useQueryClient();
const retrying = ref(false);

const COPY: Record<UnavailableReason, { title: string; hint: string }> = {
  'not-installed': {
    title: "Docker isn't installed",
    hint: 'Install Docker Desktop, Colima or Podman, then retry.',
  },
  'daemon-down': {
    title: "Docker isn't running",
    hint: 'Start Docker Desktop, or run `colima start`, then retry.',
  },
  'permission-denied': {
    title: 'Permission denied',
    hint: 'Your user cannot reach the Docker socket. Add it to the docker group or check the socket permissions.',
  },
  unreachable: {
    title: "Can't reach the Docker engine",
    hint: 'Check DOCKER_HOST, the selected context and your network.',
  },
  tls: {
    title: 'TLS handshake failed',
    hint: 'Check the context certificates or DOCKER_CERT_PATH.',
  },
  error: { title: 'Docker error', hint: 'The engine returned an unexpected error.' },
};

const copy = computed(() => COPY[props.status.reason ?? 'error']);

async function retry(): Promise<void> {
  retrying.value = true;
  try {
    qc.setQueryData<DockerStatus>(['docker', 'status'], await control.status(true));
  } finally {
    retrying.value = false;
  }
}
</script>

<template>
  <Empty class="h-full" data-testid="docker-unavailable">
    <EmptyHeader>
      <EmptyMedia variant="icon"><CodiconIcon name="vm" :size="20" /></EmptyMedia>
      <EmptyTitle data-testid="docker-unavailable-title">{{ copy.title }}</EmptyTitle>
      <EmptyDescription data-testid="docker-unavailable-hint">{{ copy.hint }}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <code class="font-data text-kira-sm text-muted-foreground" data-testid="docker-unavailable-endpoint">{{ status.endpoint.host }}</code>
      <p v-if="status.message" class="max-w-md text-kira-sm text-muted-foreground">{{ status.message }}</p>
      <div class="flex items-center gap-2">
        <Button size="kira" variant="secondary" :disabled="retrying" data-testid="docker-retry" @click="retry">Retry</Button>
        <EndpointChip />
      </div>
    </EmptyContent>
  </Empty>
</template>
