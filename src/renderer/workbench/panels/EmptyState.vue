<script setup lang="ts">
import Codicon from '../../theme/Codicon.vue';

defineProps<{ icon: string; label: string }>();
</script>

<template>
  <div class="flex h-full items-center justify-center gap-1.5 px-2 text-[11px] text-disabled">
    <Codicon :name="icon" :size="12" />
    <span>{{ label }}</span>
  </div>
</template>
