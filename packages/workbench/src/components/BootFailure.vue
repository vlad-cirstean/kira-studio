<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';

// P113 F6: main.ts's own boot-failure fallback, both apps — mounted in place of App.vue when
// bootstrap()'s own hydrates reject, so a bad DB read or a busy DB shows this instead of a
// permanently blank window with the rejection only visible in the webview console. Deliberately
// standalone (no workbench/theme host, no Pinia store reads beyond the two shadcn-vue primitives
// already safe to use un-hydrated) — the stores that failed to hydrate cannot be trusted to render
// anything else. `appName` is the one thing kira-space's and kira-studio's own copies (P100 Part 2
// F2, P108 Part 12 F13) differed in.
defineProps<{ appName: string; message: string }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="h-full flex items-center justify-center overflow-auto p-4" data-testid="boot-failure">
    <div class="w-105 max-w-full">
      <Alert class="w-full flex-col items-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="warning" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">{{ appName }} failed to start</AlertTitle>
        <p class="text-kira-sm text-subtle whitespace-pre-wrap">{{ message }}</p>
        <AlertAction class="static mt-1 flex flex-col items-center gap-1.5">
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="boot-failure-retry"
            @click="emit('retry')"
          >
            <CodiconIcon name="refresh" :size="13" />
            Retry
          </Button>
        </AlertAction>
      </Alert>
    </div>
  </div>
</template>
