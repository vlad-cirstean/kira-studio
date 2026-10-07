<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { copyText } from '@workbench/util/clipboard';

// monaco.ts only exposes loadMonaco(), no read-only model helper — a plain <pre> keeps this a view.
defineProps<{ raw: string }>();
</script>

<template>
  <div class="relative h-full" data-testid="docker-inspect">
    <TooltipIconButton icon="copy" label="Copy JSON" class="absolute right-2 top-1" data-testid="docker-inspect-copy" @click="copyText(raw)" />
    <pre class="h-full overflow-auto p-3 font-data text-kira-sm" data-testid="docker-inspect-json">{{ raw }}</pre>
  </div>
</template>
