<script setup lang="ts">
import EmptyState from '../theme/primitives/EmptyState.vue';

// P1 C6: Http's own "nothing open" content — mirrors workbench/panels/StudioStart.vue's role
// (MainView's fallback when the current mode has no active tab), built from the same EmptyState
// primitive as CollectionsPanel.vue. Genuinely empty on purpose (D3/§0.2): no request builder, no
// history, nothing protocol-specific lands until a later phase.
</script>

<template>
  <div class="start" data-testid="http-start">
    <EmptyState icon="globe" label="Http mode arrives in a later phase" />
  </div>
</template>

<style scoped>
.start {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--kira-s-6);
}
</style>
