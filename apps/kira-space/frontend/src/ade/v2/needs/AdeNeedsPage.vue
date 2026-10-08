<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { computed, ref } from 'vue';
import { usePlanModel } from '../plan/usePlanModel';
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
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-kira border border-border bg-bg" data-testid="ade-needs-page">
    <PanelHeader>
      Needs you
      <template v-if="needs && !needs.empty" #actions>
        <span class="normal-case tracking-normal" data-testid="ade-needs-summary"
          >{{ needs.items.length }} items · oldest first, most urgent on top</span
        >
      </template>
    </PanelHeader>
    <div class="flex min-h-0 flex-1 flex-col overflow-auto">
      <template v-if="needs">
        <AdeNeedsRow
          v-for="n in needs.items"
          :key="n.id"
          :item="n"
          :task-title="taskOf(n.taskId).title"
          :task-color="taskOf(n.taskId).color"
        />
        <div v-if="needs.empty" class="border-b border-border px-3 py-6 text-kira-lg text-tone-green" data-testid="ade-needs-empty">
          Nothing needs you right now.
        </div>
        <div class="flex items-center gap-2.5 border-b border-border px-3 py-2 text-kira-md text-muted-foreground">
          <span class="flex-1" data-testid="ade-needs-footer">{{ needs.footer }}</span>
          <Button variant="dialog" size="kira-lg" data-testid="ade-needs-all" @click="showAll = !showAll">
            {{ showAll ? 'Hide all sessions' : 'All sessions' }}
          </Button>
        </div>
      </template>
      <AdeAllSessions v-if="showAll" />
    </div>
  </div>
</template>
