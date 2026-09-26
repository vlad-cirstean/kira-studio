<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
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
      <button
        type="button"
        class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm cursor-pointer border-0 bg-none text-info hover:bg-hover hover:text-fg"
        data-testid="update-available"
        @click="emit('open')"
      >
        <CodiconIcon name="cloud-download" :size="13" />
        Update {{ latestVersion }}
      </button>
    </TooltipTrigger>
    <TooltipContent>{{ tooltip }}</TooltipContent>
  </Tooltip>
</template>
