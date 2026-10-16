<script setup lang="ts">
import { useRelativeTime } from '@workbench/behaviour/format';

// Reactive "in 5d" / "3h ago" for one instant; a composable cannot be called per v-for row.
const props = defineProps<{ at: number }>();
const text = useRelativeTime(() => props.at);
</script>

<template>{{ text }}</template>
