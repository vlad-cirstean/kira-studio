<script setup lang="ts">
import { TooltipProvider } from '@theme/components/ui/tooltip';
import ContextMenu from '@workbench/components/ContextMenu.vue';
import CheetahProto from './CheetahProto.vue';
</script>

<template>
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300" disable-hoverable-content>
    <div class="flex h-screen w-screen flex-col bg-bg text-fg">
      <CheetahProto />
    </div>
    <ContextMenu />
  </TooltipProvider>
</template>
