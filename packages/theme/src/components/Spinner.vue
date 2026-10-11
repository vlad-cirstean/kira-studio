<script setup lang="ts">
import { computed } from 'vue';

// P263 §2.6: the one loading motion. `icon` swaps the glyph for an action's own icon spinning
// (`sync`, `refresh`). `label=""` marks it decorative (a parent already carries `role="status"`).
const props = withDefaults(
  defineProps<{ size?: 12 | 13 | 24; icon?: 'loading' | 'sync' | 'refresh'; label?: string }>(),
  { size: 13, icon: 'loading', label: 'Loading' },
);

const style = computed(() => ({ fontSize: `${props.size}px` }));
</script>

<template>
  <i
    :class="`codicon codicon-${icon} shrink-0 animate-spin`"
    :style="style"
    :role="label ? 'status' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  />
</template>
