<script setup lang="ts">
import type { DefinitionSection } from '@shared/domain/definition';

// P23 D6/D5/D9: one `definition.sections[]` entry — a Kafka topic's Partitions/Configuration, a
// consumer group's Group/Members/Committed offsets, an SQS queue's Attributes. Same section chrome
// and count badge IndexesSection.vue already uses, over a generic name/value/muted-detail row list
// rather than a per-kind table, since the adapter (not this component) decides what belongs here.
defineProps<{
  section: DefinitionSection;
}>();
</script>

<template>
  <section class="def-section" data-testid="definition-properties" :data-title="section.title">
    <header class="def-section-head">
      <span class="def-section-title">{{ section.title }}</span>
      <span class="p-badge">{{ section.rows.length }}</span>
    </header>

    <p v-if="section.rows.length === 0" class="def-empty">Nothing to show.</p>

    <table v-else class="def-table">
      <tbody>
        <tr v-for="row in section.rows" :key="row.name" class="def-row">
          <td class="def-prop-name mono">{{ row.name }}</td>
          <td class="def-prop-value mono">{{ row.value }}</td>
          <td class="def-prop-detail">{{ row.detail ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.def-prop-name {
  color: var(--kira-fg-muted);
  white-space: nowrap;
}

.def-prop-detail {
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-sm);
}
</style>
