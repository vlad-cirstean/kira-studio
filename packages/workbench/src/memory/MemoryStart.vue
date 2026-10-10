<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import ImportView from './import/ImportView.vue';
import { useImportUiStore } from './import/importStore';
import { useMemoryHistory } from './queries';
import { useMemoryUiStore } from './store';

// P201: the main area of the Memory module — the selected memory and its version trail.
const ui = useMemoryUiStore();
const imports = useImportUiStore();
const { selectedId } = storeToRefs(ui);
const history = useMemoryHistory(selectedId);

const selected = computed(() => history.data.value?.memories.find((m) => m.id === selectedId.value));
const trail = computed(() => [...(history.data.value?.memories ?? [])].reverse());

function eventsFor(id: string) {
  return (history.data.value?.events ?? []).filter((e) => e.memoryId === id);
}

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <ImportView v-if="imports.view === 'imports'" />
  <div v-else class="h-full overflow-y-auto" data-testid="memory-start">
    <Alert v-if="history.isError.value" variant="destructive" class="m-3 w-auto">
      <AlertDescription>{{ history.error.value?.message }}</AlertDescription>
    </Alert>
    <Empty v-else-if="!selectedId" class="h-full" data-testid="memory-detail-empty">
      <EmptyHeader>
        <EmptyTitle>Search or add a memory</EmptyTitle>
        <EmptyDescription>Select a result to see its reason and history.</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <div v-else-if="selected" class="flex flex-col gap-3 p-4" data-testid="memory-detail">
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1">
          <Badge :variant="selected.author === 'user' ? 'info' : 'default'">{{ selected.author }}</Badge>
          <Badge v-if="selected.historical" variant="warn">historical</Badge>
          <span class="text-kira-sm text-muted-foreground">v{{ selected.version }} · {{ when(selected.createdAt) }}</span>
        </div>
        <p class="m-0 text-kira-md whitespace-pre-wrap" data-testid="memory-detail-fact">{{ selected.fact }}</p>
        <p class="m-0 text-kira-md text-muted-foreground whitespace-pre-wrap">
          <span class="font-medium">Reason: </span>{{ selected.reason }}
        </p>
        <div v-if="selected.keywords.length" class="flex flex-wrap gap-1">
          <Badge v-for="k in selected.keywords" :key="k">{{ k }}</Badge>
        </div>
      </div>
      <div v-if="trail.length > 1" class="flex flex-col gap-1.5" data-testid="memory-trail">
        <span class="text-kira-sm font-medium uppercase tracking-wider text-muted-foreground">Versions</span>
        <div
          v-for="version in trail"
          :key="version.id"
          class="flex flex-col gap-0.5 rounded-kira-sm border border-border p-1.5"
          :class="{ 'opacity-70': version.historical }"
          :data-testid="`memory-version-${version.version}`"
        >
          <div class="flex items-center gap-1">
            <span class="text-kira-sm text-muted-foreground">v{{ version.version }} · {{ when(version.createdAt) }}</span>
            <Badge v-if="version.historical" variant="warn">historical</Badge>
          </div>
          <span class="text-kira-md whitespace-pre-wrap">{{ version.fact }}</span>
          <span v-for="event in eventsFor(version.id)" :key="event.seq" class="text-kira-sm text-muted-foreground">
            {{ event.action === 'noop' ? 'Reconfirmed' : event.action === 'add' ? 'Added' : 'Updated' }}
            by {{ event.author }} via {{ event.source }}<template v-if="event.source === 'import'"> ({{ event.sourceLabel ?? event.sourceRef }})</template><template v-if="event.rationale"> — {{ event.rationale }}</template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
