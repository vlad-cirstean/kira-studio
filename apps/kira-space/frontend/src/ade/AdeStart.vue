<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';

// P128 §2.7: MainView.vue's own fallback while the `ade` module is active — GitStart.vue/
// TerminalStart.vue's own EmptyState shape, minus AlertAction: there is no action yet, this
// module being a placeholder reserving MODE_ORDER's slot ahead of a later chapter's real agent
// surface.
</script>

<template>
  <div class="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4" data-testid="ade-start">
    <div class="w-105 max-w-full">
      <Alert class="w-full flex-col items-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="robot" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">Agents arrive in a later update</AlertTitle>
      </Alert>
    </div>
  </div>
</template>
