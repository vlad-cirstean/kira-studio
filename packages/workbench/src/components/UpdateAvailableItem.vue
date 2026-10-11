<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';

// P119: hoisted from Kira Studio's own StatusBar.vue (same data-testid, same markup) —
// AppMetricsItem.vue's own plain-props shape, shared with Kira Space's own status bar. The click
// used to open GitHub's release page directly (OpenReleasePage); it now just tells the store to
// open the in-app dialog (§4.6's deliberate behavior change).
const props = defineProps<{ latestVersion: string; currentVersion: string }>();

const emit = defineEmits<(e: 'open') => void>();

const tooltip = computed(
  () => `Version ${props.latestVersion} is available. You have ${props.currentVersion}.`,
);
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        variant="toolbar"
        size="kira"
        class="h-control-sm gap-1 px-1.5 text-kira-sm font-normal text-info"
        data-testid="update-available"
        @click="emit('open')"
      >
        <CodiconIcon name="cloud-download" :size="13" />
        Update {{ latestVersion }}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ tooltip }}</TooltipContent>
  </Tooltip>
</template>
