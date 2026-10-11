<script setup lang="ts">
import { Alert } from '@theme/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { t } from '@theme/i18n';
import QueryState from '@workbench/components/QueryState.vue';
import { ref } from 'vue';
import { useAgentsModel } from '../state/useAgentsModel';
import PlanTaskCard from './PlanTaskCard.vue';

// The plan by day, in plan order. Tap a task for its workflow stages.
const { model, boardQuery } = useAgentsModel();
const open = ref<string | null>(null);
</script>

<template>
  <section class="flex flex-col" data-testid="plan-screen">
    <QueryState :query="boardQuery" :is-empty="() => false">
    <template #loading><p class="m-0 p-4 text-muted-foreground">{{ t('common.state.loading.loading') }}</p></template>
    <template #error>
      <Alert variant="error" strip data-testid="plan-error">{{ t('mobile.plan.loadError.error') }}</Alert>
    </template>
    <Empty v-if="model && !model.plan.length" class="py-10" data-testid="plan-empty">
      <EmptyHeader>
        <EmptyTitle>{{ t('mobile.plan.list.empty') }}</EmptyTitle>
        <EmptyDescription>{{ t('mobile.plan.list.emptyHint') }}</EmptyDescription>
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
    </QueryState>
  </section>
</template>
