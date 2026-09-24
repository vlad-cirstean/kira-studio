<script setup lang="ts">
import type { DefinitionSection } from '@shared/domain/definition';
import { Badge } from '@theme/components/ui/badge';

// P23 D6/D5/D9: one `definition.sections[]` entry — a Kafka topic's Partitions/Configuration, a
// consumer group's Group/Members/Committed offsets, an SQS queue's Attributes. Same section chrome
// and count badge IndexesSection.vue already uses, over a generic name/value/muted-detail row list
// rather than a per-kind table, since the adapter (not this component) decides what belongs here.
defineProps<{
  section: DefinitionSection;
}>();

// P110 B30: ColumnsSection.vue's own DEF_TD constant (see its comment) -- folded off
// primitives.css's old shared body-cell rule. No thead/border-r override here (see
// ColumnsSection.vue's own scoped-style comment on why).
const DEF_TD = 'px-1.5 py-1 align-middle text-fg';
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-properties" :data-title="section.title">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">{{ section.title }}</span>
      <Badge>{{ section.rows.length }}</Badge>
    </header>

    <p v-if="section.rows.length === 0" class="text-muted-foreground m-0">Nothing to show.</p>

    <table v-else class="w-full border-collapse text-kira-md">
      <tbody>
        <tr v-for="row in section.rows" :key="row.name" class="border-b border-border hover:bg-hover" data-testid="definition-row">
          <td :class="DEF_TD" class="def-prop-name font-data">{{ row.name }}</td>
          <td :class="DEF_TD" class="def-prop-value font-data">{{ row.value }}</td>
          <td :class="DEF_TD" class="def-prop-detail">{{ row.detail ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
@reference "@theme/base.css";

.def-prop-name {
  @apply whitespace-nowrap text-muted-foreground;
}

.def-prop-detail {
  @apply text-subtle text-kira-sm;
}
</style>
