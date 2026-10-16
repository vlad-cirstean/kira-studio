<script setup lang="ts">
import Spinner from '@theme/components/Spinner.vue';
import { useSpinnerDelay } from '@theme/lib/useSpinnerDelay';

// P263 §2.6/§2.7: the loading / empty / error line in a list or popover. `loading` appears only
// after `SPINNER_DELAY` so a fast load never flashes.
const props = defineProps<{ kind: 'loading' | 'empty' | 'error' }>();

const delayed = useSpinnerDelay(() => props.kind === 'loading');
</script>

<template>
  <div
    v-if="kind !== 'loading' || delayed"
    data-slot="inline-state"
    class="flex items-center gap-1.5 px-1.5 py-1 text-kira-sm"
    :class="kind === 'error' ? 'text-error' : 'text-subtle'"
    :role="kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined"
  >
    <Spinner v-if="kind === 'loading'" :size="13" label="" />
    <slot />
  </div>
</template>
