<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import VarText from '@theme/components/VarText.vue';
import type { TextPart } from '@theme/varText';

defineProps<{ text?: string; parts?: readonly TextPart[] }>();
</script>

<template>
  <Tooltip v-if="text || parts?.length">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipContent class="whitespace-pre-line break-words"
      ><VarText v-if="parts?.length" :parts="parts" /><template v-else>{{ text }}</template></TooltipContent
    >
  </Tooltip>
  <slot v-else />
</template>
