<script setup lang="ts">
import EmptyState from '../theme/primitives/EmptyState.vue';
import LeftPanel from '../workbench/panels/LeftPanel.vue';

// P1 C6: Http's own left-panel content, mounted through the same LeftPanel shell Studio's
// ProjectPanel.vue uses (D3/D6) — proof the seam works, not a stub of a feature. `empty` is
// always true: P1 adds zero HTTP tab kinds and no collections format, so there is genuinely
// nothing here yet (AGENTS.md: "scope left out of a phase is left out entirely").
</script>

<template>
  <LeftPanel empty>
    <template #title>
      <span>Collections</span>
    </template>
    <template #empty>
      <EmptyState icon="globe" label="Collections arrive in a later phase" />
    </template>
  </LeftPanel>
</template>
