<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  name: string;
  size?: number;
}>();

const style = computed(() => (props.size ? { fontSize: `${props.size}px` } : undefined));
</script>

<template>
  <i :class="`codicon codicon-${name}`" :style="style" aria-hidden="true" />
</template>
