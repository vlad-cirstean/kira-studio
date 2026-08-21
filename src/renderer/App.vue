<script setup lang="ts">
import { onMounted } from 'vue';
import { engineState, initEngineState } from './workbench/state/engine';

onMounted(() => {
  void initEngineState();
});
</script>

<template>
  <!-- Temporary placeholder for Step 3 verification; replaced by WorkbenchShell in Step 6. -->
  <div
    style="
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ccc;
      background: #1f1f1f;
      font-family: 'SF Mono', Menlo, monospace;
    "
    data-testid="status-bar"
  >
    engine {{ engineState.status }}<span v-if="engineState.lastPingMs !== null">
      · {{ engineState.lastPingMs }} ms</span
    >
  </div>
</template>
