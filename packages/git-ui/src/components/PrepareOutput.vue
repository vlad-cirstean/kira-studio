<script setup lang="ts">
import type { WorktreePrepareLine } from '@kira/git-ipc';

defineProps<{ lines: readonly WorktreePrepareLine[] }>();
</script>

<template>
  <pre
    class="kv:max-h-60 kv:overflow-y-auto kv:p-1 kv:bg-panel kv:border kv:border-panel-border kv:font-data kv:text-sm kv:whitespace-pre-wrap kv:break-all kv:m-0"
    data-testid="worktree-prepare-output"
  ><span
      v-for="(line, i) in lines"
      :key="i"
      :class="line.stream === 'stderr' ? 'kv:text-diff-deleted' : ''"
    >{{ line.text }}
</span></pre>
</template>
