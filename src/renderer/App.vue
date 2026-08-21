<script setup lang="ts">
import { onMounted } from 'vue';
import { initEngineState } from './workbench/state/engine';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

onMounted(() => {
  void initEngineState();
});
</script>

<template>
  <WorkbenchShell />
</template>
