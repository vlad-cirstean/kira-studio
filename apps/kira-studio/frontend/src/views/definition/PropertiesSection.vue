<script setup lang="ts">
import type { DefinitionSection } from '@shared/domain/definition';
import { Badge } from '@theme/components/ui/badge';
import { Table, TableBody, TableCell, TableRow } from '@theme/components/ui/table';

// P23 D6/D5/D9: one `definition.sections[]` entry — a Kafka topic's Partitions/Configuration, a
// consumer group's Group/Members/Committed offsets, an SQS queue's Attributes. Same section chrome
// and count badge IndexesSection.vue already uses, over a generic name/value/muted-detail row list
// rather than a per-kind table, since the adapter (not this component) decides what belongs here.
defineProps<{
  section: DefinitionSection;
}>();
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-properties" :data-title="section.title">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">{{ section.title }}</span>
      <Badge>{{ section.rows.length }}</Badge>
    </header>

    <p v-if="section.rows.length === 0" class="text-muted-foreground m-0">Nothing to show.</p>

    <Table v-else>
      <TableBody>
        <TableRow v-for="row in section.rows" :key="row.name" data-testid="definition-row">
          <TableCell class="whitespace-nowrap font-data text-muted-foreground">{{ row.name }}</TableCell>
          <TableCell class="def-prop-value font-data">{{ row.value }}</TableCell>
          <TableCell class="text-subtle text-kira-sm">{{ row.detail ?? '' }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
