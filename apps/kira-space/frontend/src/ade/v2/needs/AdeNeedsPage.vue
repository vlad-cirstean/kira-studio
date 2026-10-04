<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed, ref } from 'vue';
import { usePlanModel } from '../plan/usePlanModel';
import { TONE } from '../tones';
import AdeAllSessions from './AdeAllSessions.vue';
import AdeNeedsRow from './AdeNeedsRow.vue';

// Needs you: one list across all tasks (SPEC2 section 11), over a footer with the run counts and the
// All sessions toggle.
const { model } = usePlanModel();
const needs = computed(() => model.value?.needs ?? null);
const showAll = ref(false);

function taskOf(taskId: string): { title: string; color: string } {
  const card = model.value?.cardFor(taskId);
  return { title: card?.title ?? taskId, color: card?.color ?? 'var(--kira-fg-subtle)' };
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto px-7 pb-7 pt-[18px]" data-testid="ade-needs-page">
    <div class="flex max-w-[1080px] flex-col gap-3.5">
      <div class="flex items-baseline gap-2.5">
        <h2 class="m-0 text-kira-xl font-bold">Needs you</h2>
        <span v-if="needs && !needs.empty" class="text-kira-md text-muted-foreground" data-testid="ade-needs-summary"
          >{{ needs.items.length }} items · oldest first, most urgent on top</span
        >
      </div>
      <template v-if="needs">
        <AdeNeedsRow
          v-for="n in needs.items"
          :key="n.id"
          :item="n"
          :task-title="taskOf(n.taskId).title"
          :task-color="taskOf(n.taskId).color"
        />
        <div v-if="needs.empty" class="px-3 py-6 text-kira-lg" :style="{ color: TONE.green[1] }" data-testid="ade-needs-empty">
          Nothing needs you right now.
        </div>
        <div class="flex items-center gap-2.5 border-t border-border px-3 py-2.5 text-kira-md text-muted-foreground">
          <span class="flex-1" data-testid="ade-needs-footer">{{ needs.footer }}</span>
          <Button variant="dialog" size="xs" class="h-6 px-2.5 text-kira-sm" data-testid="ade-needs-all" @click="showAll = !showAll">
            {{ showAll ? 'Hide all sessions' : 'All sessions' }}
          </Button>
        </div>
      </template>
      <AdeAllSessions v-if="showAll" />
    </div>
  </div>
</template>
