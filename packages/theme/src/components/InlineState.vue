<script setup lang="ts">
import Spinner from '@theme/components/Spinner.vue';

// P263 §2.6/§2.7: the loading / empty / error line in a list or popover.
defineProps<{ kind: 'loading' | 'empty' | 'error' }>();
</script>

<template>
  <div
    data-slot="inline-state"
    class="flex items-center gap-1.5 px-1.5 py-1 text-kira-sm"
    :class="kind === 'error' ? 'text-error' : 'text-subtle'"
    :role="kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined"
  >
    <Spinner v-if="kind === 'loading'" :size="13" label="" />
    <slot />
  </div>
</template>
