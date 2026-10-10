<script setup lang="ts">
import { BoxesIcon, HammerIcon, NetworkIcon } from '@lucide/vue';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { siKubernetes } from 'simple-icons';
import { computed } from 'vue';
import type { ContainerOrigin } from '../wire';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{ origin: ContainerOrigin; name?: string; size?: number }>(), {
  name: '',
  size: 13,
});

const label = computed(() => {
  const n = props.name;
  switch (props.origin) {
    case 'compose':
      return 'Compose project';
    case 'devcontainer':
      return n ? `Dev container (${n})` : 'Dev container';
    case 'testcontainers':
      return 'Testcontainers';
    case 'kind':
      return `kind cluster ${n}`;
    case 'kubernetes':
      return `Kubernetes pod ${n}`;
    case 'swarm':
      return `Swarm service ${n}`;
    case 'buildx':
      return `Buildx builder ${n}`;
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
        <BoxesIcon v-if="origin === 'compose'" :size="size" style="color: #00b4ff" />
        <svg v-else-if="origin === 'kubernetes' || origin === 'kind'" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true">
          <path :fill="`#${siKubernetes.hex}`" :d="siKubernetes.path" />
        </svg>
        <NetworkIcon v-else-if="origin === 'swarm'" :size="size" />
        <HammerIcon v-else-if="origin === 'buildx'" :size="size" />
        <CodiconIcon v-else-if="origin === 'devcontainer'" name="remote-explorer" :size="size" />
        <CodiconIcon v-else name="beaker" :size="size" />
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ label }}</TooltipContent>
  </Tooltip>
</template>
