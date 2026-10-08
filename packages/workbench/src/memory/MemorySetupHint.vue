<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useMemoryModule } from './module';

// P221: the module hosts no setup actions; it points to the host's settings.
defineProps<{ message: string }>();
const { openSettings } = useMemoryModule();
</script>

<template>
  <div class="flex items-center gap-1 text-kira-sm text-muted-foreground">
    <span class="min-w-0">{{ message }}</span>
    <Button variant="link" size="xs" class="h-auto p-0" data-testid="memory-open-settings" @click="openSettings()">
      Open Settings
    </Button>
  </div>
</template>
