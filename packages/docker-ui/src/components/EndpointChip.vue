<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import { useDocker } from '../context';
import { useDockerStatus } from '../queries';
import type { DockerStatus } from '../wire';

const AUTOMATIC = '__automatic__';

const { control } = useDocker();
const qc = useQueryClient();
const status = useDockerStatus();
const contexts = useQuery({ queryKey: ['docker', 'contexts'], queryFn: () => control.contexts() });

const endpoint = computed(() => status.data.value?.endpoint);
const ok = computed(() => status.data.value?.state === 'ok');
const selected = computed(() =>
  endpoint.value?.source === 'selected' ? endpoint.value.context : AUTOMATIC,
);

async function onSelect(value: unknown): Promise<void> {
  const name = value === AUTOMATIC ? '' : String(value);
  const next = await control.useContext(name);
  qc.setQueryData<DockerStatus>(['docker', 'status'], next);
  await qc.invalidateQueries({ queryKey: ['docker', 'contexts'] });
}
</script>

<template>
  <DropdownMenu :modal="false">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="flex min-w-0 items-center gap-1 rounded-kira-sm px-1 h-control-sm normal-case tracking-normal text-kira-sm text-fg hover:bg-hover"
        data-testid="docker-endpoint-chip"
        :aria-label="`Docker endpoint ${endpoint?.context ?? ''}`"
      >
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="ok ? 'bg-ok' : 'bg-error'"
          data-testid="docker-status-dot"
          :data-state="ok ? 'ok' : 'unavailable'"
        />
        <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ endpoint?.context ?? 'docker' }}</span>
        <CodiconIcon name="chevron-down" :size="12" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-56" data-testid="docker-context-menu">
      <DropdownMenuRadioGroup :model-value="selected" @update:model-value="onSelect">
        <DropdownMenuRadioItem :value="AUTOMATIC" class="min-h-control" data-testid="docker-context-automatic">
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">Automatic</span>
          <template #indicator-icon><CodiconIcon name="check" :size="13" /></template>
        </DropdownMenuRadioItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioItem
          v-for="c in contexts.data.value ?? []"
          :key="c.name"
          :value="c.name"
          class="min-h-control"
          data-testid="docker-context-option"
          :data-value="c.name"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ c.name }}</span>
            <span class="overflow-hidden text-ellipsis whitespace-nowrap text-kira-sm text-muted-foreground">{{ c.host }}</span>
          </span>
          <template #indicator-icon><CodiconIcon name="check" :size="13" /></template>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
  <Tooltip v-if="endpoint && !endpoint.secure">
    <TooltipTrigger as-child>
      <span class="flex items-center text-warn" data-testid="docker-insecure">
        <span class="sr-only">Unencrypted connection</span>
        <CodiconIcon name="warning" :size="12" />
      </span>
    </TooltipTrigger>
    <TooltipContent>Unencrypted connection</TooltipContent>
  </Tooltip>
</template>
