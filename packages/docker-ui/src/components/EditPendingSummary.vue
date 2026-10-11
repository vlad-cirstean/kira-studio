<script setup lang="ts">
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { computed } from 'vue';
import type { PendingChange } from '../lib/editDiff';

const props = defineProps<{ changes: PendingChange[] }>();

const groups = computed(() => [
  { mode: 'now' as const, title: t('docker.edit.appliesNow.title'), rows: props.changes.filter((c) => c.mode === 'now') },
  { mode: 'recreate' as const, title: t('docker.edit.recreates.title'), rows: props.changes.filter((c) => c.mode === 'recreate') },
]);
</script>

<template>
  <div v-if="changes.length" class="flex flex-col gap-2" data-testid="docker-edit-summary">
    <template v-for="g in groups" :key="g.mode">
      <div v-if="g.rows.length" class="flex flex-col gap-0.5">
        <h4 class="text-kira-sm uppercase tracking-wider text-muted-foreground">{{ g.title }}</h4>
        <div
          v-for="(c, i) in g.rows"
          :key="`${c.field}:${i}`"
          class="break-all font-data"
          data-testid="docker-edit-pending"
          :data-mode="c.mode"
          :data-field="c.field"
        >
          <CatalogText k="docker.edit.change.label" :params="{ label: c.label, to: c.to }">
            <template #from><span class="text-muted-foreground">{{ c.from }}</span></template>
          </CatalogText>
        </div>
      </div>
    </template>
  </div>
</template>
