<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

// A read-only key/value grid. The default slot holds `<dt>`/`<dd>` pairs.
const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <dl
    data-slot="key-value-list"
    :class="
      cn(
        'm-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-kira-md [&>dd]:m-0 [&>dd]:min-w-0 [&>dt]:text-muted-foreground',
        props.class,
      )
    "
  >
    <slot />
  </dl>
</template>
