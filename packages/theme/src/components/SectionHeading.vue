<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';

// P262 §2.6/§2.7: panel/picker/list section heading. Successor of git-ui's RefSectionHeader;
// `justify-between` is unconditional, so a trailing action in the default slot needs no variant.
// `collapsible` renders a full-width toggle button with a leading chevron; `count` trails the label.
defineProps<{ label: string; collapsible?: boolean; expanded?: boolean; count?: number | string }>();
const emit = defineEmits<(e: 'toggle') => void>();
</script>

<template>
  <button
    v-if="collapsible"
    type="button"
    data-slot="section-heading"
    class="flex w-full items-center justify-between h-control-sm px-1.5 text-kira-sm text-subtle uppercase tracking-wider cursor-default"
    :aria-expanded="expanded ?? false"
    @click="emit('toggle')"
  >
    <span class="flex min-w-0 items-center gap-1">
      <CodiconIcon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="12" />
      <span>{{ label }}</span>
    </span>
    <span v-if="count !== undefined" class="text-kira-sm tabular-nums">{{ count }}</span>
    <slot />
  </button>
  <div
    v-else
    data-slot="section-heading"
    class="flex items-center justify-between h-control-sm px-1.5 text-kira-sm text-subtle uppercase tracking-wider"
  >
    <span>{{ label }}</span>
    <span v-if="count !== undefined" class="text-kira-sm tabular-nums">{{ count }}</span>
    <slot />
  </div>
</template>
