<script setup lang="ts">
import { TooltipProvider } from '@theme/components/ui/tooltip';
import type { Component } from 'vue';

// P131 Part 2 §3.5: git-ui is a separate Vue app (mount()'s own createApp), so neither host app's
// own <App.vue> TooltipProvider reaches it. This wraps whichever root mount() creates (AppRoot for
// view: "graph", ReviewView for view: "review") in the one TooltipProvider every Tooltip/
// TooltipTrigger/TooltipContent trio (and the AttributeTooltip bridge) in this package needs.
defineProps<{ root: Component; rootProps: Record<string, unknown> }>();
</script>

<template>
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300" disable-hoverable-content>
    <component :is="root" v-bind="rootProps" />
  </TooltipProvider>
</template>
