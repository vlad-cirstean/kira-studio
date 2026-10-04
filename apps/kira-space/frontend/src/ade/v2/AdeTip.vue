<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';

defineProps<{ text: string }>();
</script>

<template>
  <Tooltip v-if="text">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipContent class="whitespace-pre-line break-words">{{ text }}</TooltipContent>
  </Tooltip>
  <slot v-else />
</template>
