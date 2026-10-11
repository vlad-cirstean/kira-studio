<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { Badge } from '@theme/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@theme/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useTabsStore } from '../../state/tabs';
import type { ConstraintRow } from './structure';

const props = defineProps<{
  connectionId: string;
  constraints: ConstraintRow[];
}>();

// PK/FK get the same yellow/blue letter badge the Columns section and the SQL grid header use
// (FIX-8: "keys are labelled PK/FK, never inferred from colour alone" — SlickGridHost.vue's own
// header carries the same law now, originally the deleted DataGrid.vue's) — check/unique/exclusion
// have no such single-letter convention, so they stay a text label.
const KEY_LABEL: Partial<Record<ConstraintRow['type'], 'PK' | 'FK'>> = {
  primaryKey: 'PK',
  foreignKey: 'FK',
  referencedBy: 'FK',
};
const TYPE_LABEL: Record<ConstraintRow['type'], string> = {
  primaryKey: 'primary key',
  unique: 'unique',
  foreignKey: 'foreign key',
  check: 'check',
  exclusion: 'exclusion',
  referencedBy: 'referenced by',
};

function referencedTableName(c: ConstraintRow): string | null {
  if (!c.referencedPath) return null;
  return pathTail(c.referencedPath)?.name ?? c.referencedPath;
}

// Every foreignKey/referencedBy row carries the other table's own path (P7's field, carried
// through by structure.ts's merge) — opening its definition tab is the same "browse structure by
// following the schema" affordance P7 already gives cell-level FK navigation in the grid.
function onNavigate(c: ConstraintRow): void {
  if (c.referencedPath) useTabsStore().openDefinitionTab(props.connectionId, c.referencedPath);
}
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-constraints">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">Constraints</span>
      <Badge>{{ constraints.length }}</Badge>
    </header>
    <Table columns>
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Definition</TableHead>
          <TableHead>Table</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="c in constraints" :key="`${c.type}:${c.name}`" data-testid="definition-row">
          <TableCell class="def-con-name">{{ c.name }}</TableCell>
          <TableCell class="def-con-type">
            <span v-if="KEY_LABEL[c.type] === 'PK'" class="text-warn text-kira-sm">PK</span>
            <span v-else-if="KEY_LABEL[c.type] === 'FK'" class="text-info text-kira-sm">FK</span>
            <Badge v-else>{{ TYPE_LABEL[c.type] }}</Badge>
          </TableCell>
          <TableCell class="overflow-hidden text-ellipsis whitespace-nowrap font-data text-muted-foreground">{{ c.detail }}</TableCell>
          <TableCell class="def-con-table">
            <Tooltip v-if="c.referencedPath">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="border-0 bg-none p-0 cursor-pointer underline text-info hover:text-primary"
                  @click="onNavigate(c)"
                >
                  {{ referencedTableName(c) }}
                </button>
              </TooltipTrigger>
              <TooltipContent>Open {{ referencedTableName(c) }}'s definition</TooltipContent>
            </Tooltip>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
