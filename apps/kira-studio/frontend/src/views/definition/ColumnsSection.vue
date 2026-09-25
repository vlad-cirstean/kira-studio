<script setup lang="ts">
import type { ColumnMeta } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { columnTypeColor, columnTypeIcon } from '../../theme/icons';
import { typeDescription } from '../shared/typeGlossary';
import { columnsSectionMenu } from './columnsMenu';

const contextMenuStore = useContextMenuStore();

// P110 B30: the shared definition-table header/body cell shape, folded off primitives.css's old
// shared header-row and body-cell rules into these two constants -- the class string repeats
// across 7 columns in this file alone (plan §5.11's "4+ times, extract a const" rule). DEF_TH_LAST
// omits the column-divider border for the last header cell, matching the old rule's own
// last-child exception.
const DEF_TH =
  'text-left px-1.5 py-1 bg-elevated border-b border-border-strong border-r border-border text-muted-foreground text-kira-sm whitespace-nowrap';
const DEF_TH_LAST =
  'text-left px-1.5 py-1 bg-elevated border-b border-border-strong text-muted-foreground text-kira-sm whitespace-nowrap';
const DEF_TD = 'px-1.5 py-1 align-middle text-fg border-r border-border last:border-r-0';

const props = defineProps<{
  columns: ColumnMeta[];
  foreignKeyColumnNames: ReadonlySet<string>;
  connectionId: string;
  tablePath: string;
}>();

function keyLabel(col: ColumnMeta): 'PK' | 'FK' | null {
  if (col.isPrimaryKey) return 'PK';
  if (props.foreignKeyColumnNames.has(col.name)) return 'FK';
  return null;
}

// D9: the tree's former column-row context menu (Copy name / Add to projection / Sort by),
// relocated here — the table path is `tablePath` directly, not derived from a tree row's path.
function onContextMenu(ev: MouseEvent, col: ColumnMeta): void {
  ev.preventDefault();
  contextMenuStore.openContextMenu(ev, columnsSectionMenu(props.connectionId, props.tablePath, col.name));
}
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-columns">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">Columns</span>
      <Badge>{{ columns.length }}</Badge>
    </header>
    <table class="w-full border-collapse text-kira-md">
      <thead>
        <tr>
          <th :class="DEF_TH" class="text-muted-foreground w-4"></th>
          <th :class="DEF_TH" class="def-col-name">Name</th>
          <th :class="DEF_TH" class="w-6">Key</th>
          <th :class="DEF_TH" class="whitespace-nowrap text-muted-foreground">Type</th>
          <th :class="DEF_TH" class="whitespace-nowrap text-muted-foreground w-20">Null?</th>
          <th :class="DEF_TH" class="whitespace-nowrap text-muted-foreground">Default</th>
          <th :class="DEF_TH_LAST" class="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground max-w-60">Comment</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="col in columns"
          :key="col.name"
          class="border-b border-border hover:bg-hover"
          data-testid="definition-row"
          @contextmenu="onContextMenu($event, col)"
        >
          <td :class="DEF_TD" class="text-muted-foreground w-4">
            <CodiconIcon
              :name="columnTypeIcon(col.dataType)"
              :size="13"
              :style="{ color: columnTypeColor(col.dataType) }"
            />
          </td>
          <td :class="DEF_TD" class="def-col-name">{{ col.name }}</td>
          <td :class="DEF_TD" class="w-6">
            <span v-if="keyLabel(col) === 'PK'" class="text-warn text-kira-xs">PK</span>
            <span v-else-if="keyLabel(col) === 'FK'" class="text-info text-kira-xs">FK</span>
          </td>
          <td :class="DEF_TD" class="whitespace-nowrap text-muted-foreground font-data">
            <span :style="{ color: columnTypeColor(col.dataType) }">{{ col.dataType }}</span>
            <Tooltip v-if="typeDescription(col.dataType)">
              <TooltipTrigger as-child>
                <span class="align-middle cursor-help text-subtle ml-0.5" :aria-label="typeDescription(col.dataType) ?? ''">
                  <CodiconIcon name="info" :size="13" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ typeDescription(col.dataType) }}</TooltipContent>
            </Tooltip>
          </td>
          <td :class="DEF_TD" class="whitespace-nowrap text-muted-foreground w-20 font-data">{{ col.nullable ? 'NULL' : 'NOT NULL' }}</td>
          <td :class="DEF_TD" class="whitespace-nowrap text-muted-foreground font-data">{{ col.defaultExpr ?? '' }}</td>
          <td :class="DEF_TD" class="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground max-w-60">{{ col.comment ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
  <!-- P110 I2-16: `.definition-table td`/`td:last-child` folded into DEF_TD (`border-r border-border
       last:border-r-0`, `last:` compiles to `:last-child` — every DEF_TD <td> is a direct <tr> child).
       `.header-key`/`.is-fk` dropped from this file: checked slick-grid.spec.ts/clickhouse.frontend.
       spec.ts (the only 2 test files referencing either name) — both assertions are scoped to the
       SlickGrid column header (columns.ts/SlickGridHost.vue), never to this table, so no test
       dependency exists here. PK/FK now a plain ternary (text-warn/text-info) on the <span> itself. -->
</template>
