<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex shrink-0 text-info" data-testid="script-ai-badge">
        <CodiconIcon name="sparkle" :size="13" />
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ t('automations.smart.badge.tooltip') }}</TooltipContent>
  </Tooltip>
</template>
