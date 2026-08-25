<script setup lang="ts">
import type { ColumnMeta } from '@shared/domain/tree';
import { columnTypeIcon } from '../../project/icons';
import { columnsSectionMenu } from '../../project/menus';
import { typeDescription } from '../../project/typeGlossary';
import { openContextMenu } from '../../state/contextMenu';
import CodiconIcon from '../../theme/CodiconIcon.vue';

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
  openContextMenu(ev, columnsSectionMenu(props.connectionId, props.tablePath, col.name));
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
            <CodiconIcon :name="columnTypeIcon(col.dataType)" :size="13" />
          </td>
          <td class="def-col-name">{{ col.name }}</td>
          <td class="def-col-key">
            <span v-if="keyLabel(col) === 'PK'" class="header-key">PK</span>
            <span v-else-if="keyLabel(col) === 'FK'" class="header-key is-fk">FK</span>
          </td>
          <td class="def-col-type mono">
            {{ col.dataType }}
            <span
              v-if="typeDescription(col.dataType)"
              class="type-info"
              v-tooltip="typeDescription(col.dataType) ?? ''"
            >
              <CodiconIcon name="info" :size="13" />
            </span>
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
/* Only these two — the vertical column dividers — aren't in the shared .def-table td rule
   (primitives.css): Validation/Properties are plain key-value tables that don't want them. */
.def-table td {
  border-right: var(--kira-border-width) solid var(--kira-border);
}
.def-table td:last-child {
  border-right: none;
}

.def-col-icon {
  width: var(--kira-icon-box);
  color: var(--kira-fg-muted);
}

.def-col-key {
  width: 24px;
}

.header-key {
  color: var(--kira-warn);
  font-size: var(--kira-t-xs);
}
.header-key.is-fk {
  color: var(--kira-info);
}

.def-col-type {
  color: var(--kira-fg-muted);
  white-space: nowrap;
}

.type-info {
  color: var(--kira-fg-disabled);
  vertical-align: middle;
  margin-left: var(--kira-s-1);
  cursor: help;
}

.def-col-null {
  width: 76px;
  white-space: nowrap;
  color: var(--kira-fg-muted);
}

.def-col-default {
  color: var(--kira-fg-muted);
  white-space: nowrap;
}

.def-col-comment {
  color: var(--kira-fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}
</style>
