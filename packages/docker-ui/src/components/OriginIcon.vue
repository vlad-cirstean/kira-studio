<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { siKubernetes } from 'simple-icons';
import { computed } from 'vue';
import type { ContainerOrigin } from '../wire';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{ origin: ContainerOrigin; name?: string; size?: number }>(),
  {
    name: '',
    size: 13,
  },
);

const label = computed(() => {
  const n = props.name;
  switch (props.origin) {
    case 'compose':
      return t('docker.origin.compose.tooltip', { tool: 'Compose' });
    case 'devcontainer':
      return n
        ? t('docker.origin.devcontainerNamed.tooltip', { name: n })
        : t('docker.origin.devcontainer.tooltip');
    case 'testcontainers':
      return 'Testcontainers';
    case 'kind':
      return t('docker.origin.kind.tooltip', { name: n });
    case 'kubernetes':
      return t('docker.origin.kubernetes.tooltip', { tool: 'Kubernetes', name: n });
    case 'swarm':
      return t('docker.origin.swarm.tooltip', { tool: 'Swarm', name: n });
    case 'buildx':
      return t('docker.origin.buildx.tooltip', { tool: 'Buildx', name: n });
    default:
      return '';
  }
});
</script>

<template>
  <Tooltip v-if="origin !== ''">
    <TooltipTrigger as-child>
      <span
        class="inline-flex shrink-0 items-center text-muted-foreground"
        data-testid="docker-origin-icon"
        :data-origin="origin"
        :aria-label="label"
        v-bind="$attrs"
      >
        <CodiconIcon
          v-if="origin === 'compose'"
          name="layers"
          :size="size"
          style="color: #00b4ff"
        />
        <svg
          v-else-if="origin === 'kubernetes' || origin === 'kind'"
          :width="size"
          :height="size"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path :fill="`#${siKubernetes.hex}`" :d="siKubernetes.path" />
        </svg>
        <CodiconIcon v-else-if="origin === 'swarm'" name="type-hierarchy" :size="size" />
        <CodiconIcon v-else-if="origin === 'buildx'" name="tools" :size="size" />
        <CodiconIcon v-else-if="origin === 'devcontainer'" name="remote-explorer" :size="size" />
        <CodiconIcon v-else name="beaker" :size="size" />
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ label }}</TooltipContent>
  </Tooltip>
</template>
