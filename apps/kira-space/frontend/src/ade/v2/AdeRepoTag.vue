<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import { computed } from 'vue';
import { useRepoLinksStore } from '../../repo/state/repoLinks';
import { repoTint } from '../../state/coderepos';

// A repo's nickname as a chip in the repo's own colour, so a repo reads the same on every surface.
const props = defineProps<{ codeRepoId: string; label: string }>();
const repoLinks = useRepoLinksStore();
const tint = computed(() => repoTint(repoLinks.repoColorOf(props.codeRepoId)));
</script>

<template>
  <Badge variant="chip" :class="tint.class" :style="tint.style" data-testid="ade-repo-tag">{{ label }}</Badge>
</template>
