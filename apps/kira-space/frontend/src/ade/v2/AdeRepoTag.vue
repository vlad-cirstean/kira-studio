<script setup lang="ts">
import { computed } from 'vue';
import { useRepoLinksStore } from '../../repo/state/repoLinks';
import { repoTint } from '../../state/coderepos';

// A repo's nickname as a chip in the repo's own colour, so a repo reads the same on every surface.
const props = defineProps<{ codeRepoId: string; label: string }>();
const repoLinks = useRepoLinksStore();
const tint = computed(() => repoTint(repoLinks.repoColorOf(props.codeRepoId)));
</script>

<template>
  <span
    class="shrink-0 rounded-kira-xs px-1.25 py-px text-kira-sm font-semibold"
    :class="tint.class"
    :style="tint.style"
    data-testid="ade-repo-tag"
    >{{ label }}</span
  >
</template>
