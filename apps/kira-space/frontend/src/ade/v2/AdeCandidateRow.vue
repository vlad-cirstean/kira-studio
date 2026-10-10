<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import { useRepoLinksStore } from '../../repo/state/repoLinks';
import { repoText } from '../../state/coderepos';
import { adeAgoOptions } from './ago';
import type { CandidateBranch } from './wire';

const props = defineProps<{ branch: CandidateBranch; repo: string }>();
const emit = defineEmits<{ pick: [] }>();

const ago = useTimeAgo(() => props.branch.lastCommitAt, adeAgoOptions);
const repoLinks = useRepoLinksStore();
const repoLabel = computed(() => repoText(repoLinks.repoColorOf(props.branch.codeRepoId)));
</script>

<template>
  <Button size="kira"
    variant="ghost"
    class="box-border h-9 w-full justify-start gap-2 px-2 text-left text-fg"
    data-testid="ade-candidate"
    @click="emit('pick')"
  >
    <span class="w-13 shrink-0 text-kira-sm text-muted-foreground">{{ ago }}</span>
    <span class="shrink-0 text-kira-sm" :class="branch.mine ? 'text-fg' : 'text-muted-foreground'">{{
      branch.mine ? 'you' : branch.author
    }}</span>
    <span class="shrink-0 text-kira-sm font-medium" :class="repoLabel.class" :style="repoLabel.style">{{ repo }}</span>
    <span class="min-w-0 flex-1 truncate font-data text-kira-md">{{ branch.name }}</span>
  </Button>
</template>
