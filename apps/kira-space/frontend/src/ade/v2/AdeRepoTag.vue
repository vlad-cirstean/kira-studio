<script setup lang="ts">
import { computed } from 'vue';
import { repoColor } from './palette';

// A repo's nickname as a chip in the repo's own colour, so a repo reads the same on every surface.
const props = defineProps<{ codeRepoId: string; label: string }>();
const style = computed(() => {
  const c = repoColor(props.codeRepoId);
  return { background: `${c}1f`, color: c };
});
</script>

<template>
  <span
    class="shrink-0 rounded-kira-xs px-1.25 py-px text-kira-sm font-semibold"
    :style="style"
    data-testid="ade-repo-tag"
    >{{ label }}</span
  >
</template>
