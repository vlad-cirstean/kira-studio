<script setup lang="ts">
// "Show N more (M remaining)" for any list capped by `useCappedList`; `@click` reaches the caller's
// own `showMore` through the single-root attrs fallthrough.
import { Button } from '@theme/components/ui/button';

defineProps<{ hiddenCount: number; step: number }>();
</script>

<template>
  <Button
    v-if="hiddenCount > 0"
    variant="link"
    size="kira"
    class="w-full justify-start px-2 py-0.5 h-auto text-muted-foreground"
  >
    Show {{ Math.min(step, hiddenCount) }} more ({{ hiddenCount }} remaining)
  </Button>
</template>
