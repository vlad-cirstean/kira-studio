<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { control } from './bridge/control';
import { initEngineState } from './workbench/state/engine';
import { toggleOperationsPanel, toggleProjectPanel } from './workbench/state/layout';
import { settingsOpen } from './workbench/state/settings';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

let unsubscribe: Array<() => void> = [];

onMounted(() => {
  void initEngineState();
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsOpen.value = true;
    }),
    control.onToggleProjectPanel(toggleProjectPanel),
    control.onToggleOperationsPanel(toggleOperationsPanel),
  ];
});

onUnmounted(() => {
  for (const off of unsubscribe) off();
});
</script>

<template>
  <WorkbenchShell />
</template>
