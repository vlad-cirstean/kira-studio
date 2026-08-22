<script setup lang="ts">
import Codicon from '../../theme/Codicon.vue';

defineProps<{ icon: string; label: string }>();
</script>

<template>
  <div class="text-muted flex h-full flex-col items-center justify-center gap-2">
    <Codicon :name="icon" :size="24" />
    <span>{{ label }}</span>
    <slot />
  </div>
</template>
