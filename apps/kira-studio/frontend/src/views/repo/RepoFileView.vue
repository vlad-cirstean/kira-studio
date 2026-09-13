<script setup lang="ts">
// C5 §12/S12: the real Monaco-mounted file view lands here at S12, together with monaco.ts's lazy
// init — SPEC's own S10 note is explicit that no separate stand-in ever ships in between, so until
// S12 this renders nothing (the same "open a tab, see a blank pane" state S9's own tree rows leave
// a repo-file tab in before this file gains real content).
import type { TabRecord } from '@shared/domain/tabs';

defineProps<{ tab: TabRecord }>();
</script>

<template><div class="repo-file-view" /></template>

<style scoped>
.repo-file-view {
  height: 100%;
}
</style>
