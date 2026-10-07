<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { adeAgoOptions } from './ago';
import { repoColor } from './palette';
import type { CandidateBranch } from './wire';

const props = defineProps<{ branch: CandidateBranch; repo: string }>();
const emit = defineEmits<{ pick: [] }>();

const ago = useTimeAgo(() => props.branch.lastCommitAt, adeAgoOptions);
</script>

<template>
  <Button
    variant="ghost"
    class="box-border h-9 w-full justify-start gap-2 px-2 text-left text-fg"
    data-testid="ade-candidate"
    @click="emit('pick')"
  >
    <span class="w-13 shrink-0 text-kira-sm text-muted-foreground">{{ ago }}</span>
    <span class="shrink-0 text-kira-sm" :class="branch.mine ? 'text-fg' : 'text-muted-foreground'">{{
      branch.mine ? 'you' : branch.author
    }}</span>
    <span class="shrink-0 text-kira-sm font-semibold" :style="{ color: repoColor(branch.codeRepoId) }">{{ repo }}</span>
    <span class="min-w-0 flex-1 truncate font-data text-kira-md">{{ branch.name }}</span>
  </Button>
</template>
