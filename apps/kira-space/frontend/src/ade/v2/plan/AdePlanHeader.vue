<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import PanelHeader from '@workbench/components/PanelHeader.vue';
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
  <div data-testid="ade-plan-header">
    <PanelHeader>
      Plan
      <template #actions>
        <Button
          variant="dialog"
          size="kira-lg"
          :disabled="allBusy"
          data-testid="ade-refresh-all"
          @click="emit('refreshAll')"
        >
          <CodiconIcon name="refresh" :size="12" />
          {{ allBusy ? 'Refreshing…' : 'Refresh all' }}
        </Button>
      </template>
    </PanelHeader>
    <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
      <AdeRepoChip
        v-for="r in repos"
        :key="r.codeRepoId"
        v-bind="r"
        @toggle="emit('toggle', r.codeRepoId)"
        @refresh="emit('refreshOne', r.codeRepoId)"
      />
      <span v-if="ripple" class="flex items-center gap-1.5 text-kira-sm" data-testid="ade-ripple">
        <span class="text-muted-foreground">On merge</span>
        <span
          :style="ripple.tone === 'amber' ? { color: TONE.amber[1] } : undefined"
          :class="ripple.tone === 'amber' ? '' : 'text-subtle'"
          >{{ ripple.text }}</span
        >
      </span>
    </div>
  </div>
</template>
