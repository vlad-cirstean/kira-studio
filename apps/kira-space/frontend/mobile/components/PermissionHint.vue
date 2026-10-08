<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';

// Names the desktop pane that turns a phone permission on; the phone cannot grant it itself.
defineProps<{ what: string }>();
</script>

<template>
  <Alert variant="note" class="m-3 w-auto" data-testid="permission-hint">
    <AlertDescription>
      {{ what }} To allow it, open Settings > Mobile access in Kira Space on the computer.
    </AlertDescription>
  </Alert>
</template>
