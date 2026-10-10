<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';

// End of an agent stage: the target of every result that completes the stage.
defineProps<{ data: { w: number; h: number } }>();
</script>

<template>
  <div
    class="flex items-center justify-center rounded-full border border-dashed border-border-strong bg-bg text-kira-sm text-subtle"
    :style="{ width: `${data.w}px`, height: `${data.h}px` }"
    data-testid="ade-wf-end-node"
  >
    end of stage
    <Handle id="in" type="target" :position="Position.Top" class="!size-2 !border-0 !bg-muted-foreground" />
  </div>
</template>
