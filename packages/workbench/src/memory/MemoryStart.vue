<script setup lang="ts">
import SectionHeading from '@theme/components/SectionHeading.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Card } from '@theme/components/ui/card';
import { t } from '@theme/i18n';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { formatDateTime as when } from '../behaviour/format';
import ModuleStart from '../components/ModuleStart.vue';
import QueryState from '../components/QueryState.vue';
import ImportView from './import/ImportView.vue';
import { useImportUiStore } from './import/importStore';
import { eventText, originText } from './labels';
import { useMemoryHistory } from './queries';
import { useMemoryUiStore } from './store';

// P201: the main area of the Memory module — the selected memory and its version trail.
const ui = useMemoryUiStore();
const imports = useImportUiStore();
const { selectedId } = storeToRefs(ui);
const history = useMemoryHistory(selectedId);

const selected = computed(() =>
  history.data.value?.memories.find((m) => m.id === selectedId.value),
);
const trail = computed(() => [...(history.data.value?.memories ?? [])].reverse());

function eventsFor(id: string) {
  return (history.data.value?.events ?? []).filter((e) => e.memoryId === id);
}
</script>

<template>
  <ImportView v-if="imports.view === 'imports'" />
  <div v-else class="h-full overflow-y-auto" data-testid="memory-start">
    <ModuleStart
      v-if="!selectedId"
      class="h-full"
      data-testid="memory-detail-empty"
      icon="book"
      :title="t('memory.start.empty')"
      :description="t('memory.start.emptyHint')"
    />
    <QueryState v-else :query="history" :is-empty="() => false">
      <template #error="{ message }">
        <Alert variant="error" strip>
          <AlertDescription>{{ message }}</AlertDescription>
        </Alert>
      </template>
      <div v-if="selected" class="flex flex-col gap-3 p-4" data-testid="memory-detail">
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-1">
            <Badge :variant="selected.origin === 'user' ? 'info' : 'default'">{{
              originText(selected.origin, selected.sourceTag)
            }}</Badge>
            <Badge v-if="selected.historical" variant="warn">{{
              t('memory.common.historical.status')
            }}</Badge>
            <span class="text-kira-sm text-muted-foreground"
              >{{ t('memory.common.version.label', { version: selected.version }) }}
              · {{ when(selected.createdAt) }}</span
            >
          </div>
          <p class="m-0 text-kira-md whitespace-pre-wrap" data-testid="memory-detail-fact">{{
            selected.fact
          }}</p>
          <p class="m-0 text-kira-md text-muted-foreground whitespace-pre-wrap">
            <span class="font-medium">{{ t('memory.start.reason.label') }}</span>
            {{ selected.reason }}
          </p>
          <div v-if="selected.keywords.length" class="flex flex-wrap gap-1">
            <Badge v-for="k in selected.keywords" :key="k">{{ k }}</Badge>
          </div>
        </div>
        <div v-if="trail.length > 1" class="flex flex-col gap-1.5" data-testid="memory-trail">
          <SectionHeading :label="t('memory.start.versions.label')" />
          <Card
            v-for="version in trail"
            :key="version.id"
            class="gap-0.5"
            :class="{ 'opacity-50': version.historical }"
            :data-testid="`memory-version-${version.version}`"
          >
            <div class="flex items-center gap-1">
              <span class="text-kira-sm text-muted-foreground"
                >{{ t('memory.common.version.label', { version: version.version }) }}
                · {{ when(version.createdAt) }}</span
              >
              <Badge v-if="version.historical" variant="warn">{{
                t('memory.common.historical.status')
              }}</Badge>
            </div>
            <span class="text-kira-md whitespace-pre-wrap">{{ version.fact }}</span>
            <span
              v-for="event in eventsFor(version.id)"
              :key="event.seq"
              class="text-kira-sm text-muted-foreground"
            >
              {{ eventText(event) }}
            </span>
          </Card>
        </div>
      </div>
    </QueryState>
  </div>
</template>
