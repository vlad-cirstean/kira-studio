<script setup lang="ts">
import Codicon from '../../theme/Codicon.vue';

defineProps<{ icon: string; label: string }>();
</script>

<template>
  <div class="p-empty">
    <Codicon :name="icon" :size="24" class="big" />
    <span class="label">{{ label }}</span>
    <slot />
  </div>
</template>
