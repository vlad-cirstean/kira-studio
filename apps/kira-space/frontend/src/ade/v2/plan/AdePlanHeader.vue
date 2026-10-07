<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import type { Ripple } from '../board/timeline';
import { TONE } from '../tones';
import AdeRepoChip from './AdeRepoChip.vue';

// Sticky top of the Plan: Refresh all, one chip per repo, and the "On merge" line of the selection.
export interface RepoChipModel {
  codeRepoId: string;
  label: string;
  lastFetchAt: number | null;
  shown: boolean;
  busy: boolean;
  error: string;
  summary: string;
}

defineProps<{ repos: RepoChipModel[]; allBusy: boolean; ripple: Ripple | null }>();
const emit = defineEmits<{ refreshAll: []; refreshOne: [codeRepoId: string]; toggle: [codeRepoId: string] }>();
</script>

<template>
  <div class="mb-2 ml-15 flex flex-col gap-1.5 pl-2" data-testid="ade-plan-header">
    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="xs"
        class="gap-1.5 rounded-kira bg-fg px-2.5 font-semibold text-bg hover:bg-fg/90"
        :disabled="allBusy"
        data-testid="ade-refresh-all"
        @click="emit('refreshAll')"
      >
        <CodiconIcon name="refresh" :size="12" />
        {{ allBusy ? 'Refreshing…' : 'Refresh all' }}
      </Button>
      <AdeRepoChip
        v-for="r in repos"
        :key="r.codeRepoId"
        v-bind="r"
        @toggle="emit('toggle', r.codeRepoId)"
        @refresh="emit('refreshOne', r.codeRepoId)"
      />
    </div>
    <div v-if="ripple" class="flex items-center gap-1.5 text-kira-sm" data-testid="ade-ripple">
      <span class="text-muted-foreground">On merge</span>
      <span
        class="font-data"
        :style="ripple.tone === 'amber' ? { color: TONE.amber[1] } : undefined"
        :class="ripple.tone === 'amber' ? '' : 'text-subtle'"
        >{{ ripple.text }}</span
      >
    </div>
  </div>
</template>
