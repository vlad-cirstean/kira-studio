<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { openDefinitionTab } from '../../state/tabs';
import type { ConstraintRow } from './structure';

const props = defineProps<{
  connectionId: string;
  constraints: ConstraintRow[];
}>();

// PK/FK get the same yellow/blue letter badge the Columns section and the SQL grid header use
// (DataGrid.vue's own FIX-8 law: "keys are labelled PK/FK, never inferred from colour alone") —
// check/unique/exclusion have no such single-letter convention, so they stay a text label.
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
  if (c.referencedPath) openDefinitionTab(props.connectionId, c.referencedPath);
}
</script>

<template>
  <section class="def-section" data-testid="definition-constraints">
    <header class="def-section-head">
      <span class="def-section-title">Constraints</span>
      <span class="p-badge">{{ constraints.length }}</span>
    </header>
    <table class="def-table">
      <thead>
        <tr class="def-head-row">
          <th>Name</th>
          <th>Type</th>
          <th>Definition</th>
          <th>Table</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in constraints" :key="`${c.type}:${c.name}`" class="def-row">
          <td class="def-con-name">{{ c.name }}</td>
          <td class="def-con-type">
            <span v-if="KEY_LABEL[c.type] === 'PK'" class="header-key">PK</span>
            <span v-else-if="KEY_LABEL[c.type] === 'FK'" class="header-key is-fk">FK</span>
            <span v-else class="p-badge">{{ TYPE_LABEL[c.type] }}</span>
          </td>
          <td class="def-con-detail mono">{{ c.detail }}</td>
          <td class="def-con-table">
            <button
              v-if="c.referencedPath"
              type="button"
              class="ref-link"
              v-tooltip="`Open ${referencedTableName(c)}'s definition`"
              @click="onNavigate(c)"
            >
              {{ referencedTableName(c) }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
/* Only these two aren't in the shared .def-table td rule (primitives.css) — see
   ColumnsSection.vue's own comment on why. */
.def-table td {
  border-right: var(--kira-border-width) solid var(--kira-border);
}
.def-table td:last-child {
  border-right: none;
}

.header-key {
  color: var(--kira-warn);
  font-size: var(--kira-t-xs);
}
.header-key.is-fk {
  color: var(--kira-info);
}

.def-con-detail {
  color: var(--kira-fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--kira-info);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}
.ref-link:hover {
  color: var(--kira-accent);
}
</style>
