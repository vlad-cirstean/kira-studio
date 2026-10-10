<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';

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
      <Empty>
        <EmptyHeader>
          <EmptyMedia><CodiconIcon name="warning" :size="24" /></EmptyMedia>
          <EmptyTitle>{{ appName }} failed to start</EmptyTitle>
          <EmptyDescription class="whitespace-pre-wrap">{{ message }}</EmptyDescription>
        </EmptyHeader>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          data-testid="boot-failure-retry"
          @click="emit('retry')"
        >
          <CodiconIcon name="refresh" :size="13" />
          Retry
        </Button>
      </Empty>
    </div>
  </div>
</template>
