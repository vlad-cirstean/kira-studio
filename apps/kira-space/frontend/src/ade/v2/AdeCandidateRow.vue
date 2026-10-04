<script setup lang="ts">
import { useTimeAgo } from '@vueuse/core';
import { adeAgoOptions } from './ago';
import { repoColor } from './palette';
import type { CandidateBranch } from './wire';

const props = defineProps<{ branch: CandidateBranch; repo: string }>();
const emit = defineEmits<{ pick: [] }>();

const ago = useTimeAgo(() => props.branch.lastCommitAt, adeAgoOptions);
</script>

<template>
  <button
    type="button"
    class="box-border flex h-9 w-full cursor-pointer items-center gap-2 rounded-kira border-0 bg-transparent px-2 text-left text-fg hover:bg-hover"
    data-testid="ade-candidate"
    @click="emit('pick')"
  >
    <span class="w-[52px] shrink-0 text-kira-sm text-muted-foreground">{{ ago }}</span>
    <span class="shrink-0 text-kira-sm" :class="branch.mine ? 'text-fg' : 'text-muted-foreground'">{{
      branch.mine ? 'you' : branch.author
    }}</span>
    <span class="shrink-0 font-data text-kira-sm font-semibold" :style="{ color: repoColor(branch.codeRepoId) }">{{ repo }}</span>
    <span class="min-w-0 flex-1 truncate font-data text-kira-md">{{ branch.name }}</span>
  </button>
</template>
