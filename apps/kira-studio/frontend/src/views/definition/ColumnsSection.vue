<script setup lang="ts">
import type { ColumnMeta } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { columnTypeColor, columnTypeIcon } from '../../theme/icons';
import { typeDescription } from '../shared/typeGlossary';
import { columnsSectionMenu } from './columnsMenu';

const contextMenuStore = useContextMenuStore();

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
  <section class="def-section" data-testid="definition-columns">
    <header class="def-section-head">
      <span class="def-section-title">Columns</span>
      <span class="p-badge">{{ columns.length }}</span>
    </header>
    <table class="def-table">
      <thead>
        <tr class="def-head-row">
          <th class="def-col-icon"></th>
          <th class="def-col-name">Name</th>
          <th class="def-col-key">Key</th>
          <th class="def-col-type">Type</th>
          <th class="def-col-null">Null?</th>
          <th class="def-col-default">Default</th>
          <th class="def-col-comment">Comment</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="col in columns"
          :key="col.name"
          class="def-row"
          @contextmenu="onContextMenu($event, col)"
        >
          <td class="def-col-icon">
            <CodiconIcon
              :name="columnTypeIcon(col.dataType)"
              :size="13"
              :style="{ color: columnTypeColor(col.dataType) }"
            />
          </td>
          <td class="def-col-name">{{ col.name }}</td>
          <td class="def-col-key">
            <span v-if="keyLabel(col) === 'PK'" class="header-key">PK</span>
            <span v-else-if="keyLabel(col) === 'FK'" class="header-key is-fk">FK</span>
          </td>
          <td class="def-col-type mono">
            <span :style="{ color: columnTypeColor(col.dataType) }">{{ col.dataType }}</span>
            <Tooltip v-if="typeDescription(col.dataType)">
              <TooltipTrigger as-child>
                <span class="type-info" :aria-label="typeDescription(col.dataType) ?? ''">
                  <CodiconIcon name="info" :size="13" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ typeDescription(col.dataType) }}</TooltipContent>
            </Tooltip>
          </td>
          <td class="def-col-null mono">{{ col.nullable ? 'NULL' : 'NOT NULL' }}</td>
          <td class="def-col-default mono">{{ col.defaultExpr ?? '' }}</td>
          <td class="def-col-comment">{{ col.comment ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
@reference "@theme/base.css";

/* Only these two — the vertical column dividers — aren't in the shared .def-table td rule
   (primitives.css): Validation/Properties are plain key-value tables that don't want them. */
.def-table td {
  @apply border-r border-border;
}
.def-table td:last-child {
  @apply border-r-0;
}

.def-col-icon {
  @apply text-muted w-4;
}

.def-col-key {
  @apply w-6;
}

.header-key {
  @apply text-warn text-kira-xs;
}
.header-key.is-fk {
  @apply text-info;
}

.def-col-type {
  @apply whitespace-nowrap text-muted;
}

.type-info {
  @apply align-middle cursor-help text-subtle ml-0.5;
}

.def-col-null {
  @apply whitespace-nowrap text-muted w-[76px];
}

.def-col-default {
  @apply whitespace-nowrap text-muted;
}

.def-col-comment {
  @apply overflow-hidden text-ellipsis whitespace-nowrap text-muted max-w-[240px];
}
</style>
