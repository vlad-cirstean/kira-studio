<script setup lang="ts">
// Tab stop only while the wrapped control is disabled; an enabled control is focusable itself.
withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: true });
</script>

<template>
  <!-- Blink dispatches no pointer/focus event on a disabled control, so a TooltipTrigger placed
       directly on one never fires; several tips exist only to explain the disabled state. shadcn-vue
       documents this focusable wrapper as the answer. -->
  <span :tabindex="disabled ? 0 : -1" class="inline-flex" :aria-describedby="undefined">
    <slot />
  </span>
</template>
