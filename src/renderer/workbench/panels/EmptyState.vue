<script setup lang="ts">
import Codicon from '../../theme/Codicon.vue';

withDefaults(defineProps<{ icon: string; label: string; compact?: boolean }>(), {
  compact: false,
});
</script>

<template>
  <div
    v-if="compact"
    class="text-muted flex h-full items-center justify-center gap-2 px-2"
  >
    <Codicon :name="icon" :size="14" />
    <span>{{ label }}</span>
  </div>
  <div v-else class="text-muted flex h-full flex-col items-center justify-center gap-2">
    <Codicon :name="icon" :size="24" />
    <span>{{ label }}</span>
  </div>
</template>
