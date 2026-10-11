<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useCopy } from '@workbench/behaviour/clipboard';

// The Claude session id of a session, full and copyable, for `claude --resume <id>`.
const props = defineProps<{ id: string }>();
const { copy, copied } = useCopy();
</script>

<template>
  <span class="flex min-w-0 items-center gap-1" data-testid="ade-session-id">
    <template v-if="id">
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="min-w-0 truncate font-data text-kira-sm" data-testid="ade-session-id-text">{{ id }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ id }}</TooltipContent>
      </Tooltip>
      <TooltipIconButton
        :icon="copied ? 'check' : 'copy'"
        :label="copied ? 'Copied' : 'Copy session id'"
        data-testid="ade-session-id-copy"
        @click="copy(props.id)"
      />
    </template>
    <span v-else class="text-kira-sm text-subtle">waiting for session id</span>
  </span>
</template>
