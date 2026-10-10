<script setup lang="ts">
import { Alert } from '@theme/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { ref } from 'vue';
import { useAgentsModel } from '../state/useAgentsModel';
import PlanTaskCard from './PlanTaskCard.vue';

// The plan by day, in plan order. Tap a task for its workflow stages.
const { model, boardQuery } = useAgentsModel();
const open = ref<string | null>(null);
</script>

<template>
  <section class="flex flex-col" data-testid="plan-screen">
    <p v-if="boardQuery.isPending.value" class="m-0 p-4 text-muted-foreground">Loading</p>
    <Alert v-else-if="boardQuery.isError.value" variant="destructive" class="m-3 w-auto" data-testid="plan-error">
      Could not load the plan.
    </Alert>
    <Empty v-else-if="model && !model.plan.length" class="py-10" data-testid="plan-empty">
      <EmptyHeader>
        <EmptyTitle>No tasks planned</EmptyTitle>
        <EmptyDescription>Tasks added in Kira Space appear here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <template v-else-if="model">
      <div v-for="group in model.plan" :key="group.key" data-testid="plan-group">
        <h2 class="m-0 border-b border-border bg-chrome px-3 py-1.5 text-kira-sm font-medium uppercase tracking-wide text-subtle">
          {{ group.label }}
        </h2>
        <ul class="m-0 flex list-none flex-col p-0">
          <PlanTaskCard
            v-for="card in group.cards"
            :key="card.task.id"
            :card="card"
            :open="open === card.task.id"
            @toggle="open = open === card.task.id ? null : card.task.id"
          />
        </ul>
      </div>
    </template>
  </section>
</template>
