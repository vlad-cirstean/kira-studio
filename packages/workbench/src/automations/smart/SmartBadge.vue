<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex shrink-0 text-info" data-testid="script-ai-badge">
        <CodiconIcon name="sparkle" :size="13" />
      </span>
    </TooltipTrigger>
    <TooltipContent>Smart script: runs Claude headless</TooltipContent>
  </Tooltip>
</template>
