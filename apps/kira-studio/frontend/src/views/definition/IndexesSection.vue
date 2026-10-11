<script setup lang="ts">
import type { IndexMeta } from '@shared/domain/tree';
import { Badge } from '@theme/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@theme/components/ui/table';

defineProps<{
  indexes: IndexMeta[];
}>();
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-indexes">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">Indexes</span>
      <Badge>{{ indexes.length }}</Badge>
    </header>
    <Table columns>
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Columns</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="idx in indexes" :key="idx.name" data-testid="definition-row">
          <TableCell class="def-idx-name">{{ idx.name }}</TableCell>
          <TableCell class="def-idx-badges">
            <Badge v-if="idx.primary">primary</Badge>
            <Badge v-else-if="idx.unique">unique</Badge>
          </TableCell>
          <TableCell class="def-idx-method font-data">{{ idx.method ?? '' }}</TableCell>
          <TableCell class="font-data text-muted-foreground">({{ idx.columns.join(', ') }})</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
