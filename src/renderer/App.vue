<script setup lang="ts">
import { onMounted } from 'vue';
import Codicon from './theme/Codicon.vue';
import { engineState, initEngineState } from './workbench/state/engine';

onMounted(() => {
  void initEngineState();
});
</script>

<template>
  <!-- Temporary placeholder for Step 3/5 verification; replaced by WorkbenchShell in Step 6. -->
  <div
    class="bg-chrome text-fg flex h-full items-center justify-center gap-1.5"
    data-testid="status-bar"
  >
    <Codicon
      :name="engineState.status === 'ok' ? 'pass-filled' : 'error'"
      :style="{ color: engineState.status === 'ok' ? 'var(--kira-ok)' : 'var(--kira-error)' }"
    />
    engine {{ engineState.status }}<span v-if="engineState.lastPingMs !== null">
      · {{ engineState.lastPingMs }} ms</span
    >
  </div>
</template>
