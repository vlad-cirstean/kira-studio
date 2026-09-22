<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
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
            <Tooltip v-if="c.referencedPath">
              <TooltipTrigger as-child>
                <button type="button" class="ref-link" @click="onNavigate(c)">
                  {{ referencedTableName(c) }}
                </button>
              </TooltipTrigger>
              <TooltipContent>Open {{ referencedTableName(c) }}'s definition</TooltipContent>
            </Tooltip>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
@reference "@theme/base.css";

/* Only these two aren't in the shared .def-table td rule (primitives.css) — see
   ColumnsSection.vue's own comment on why. */
.def-table td {
  @apply border-r border-border;
}
.def-table td:last-child {
  @apply border-r-0;
}

.header-key {
  @apply text-warn text-kira-xs;
}
.header-key.is-fk {
  @apply text-info;
}

.def-con-detail {
  @apply overflow-hidden text-ellipsis whitespace-nowrap text-muted;
}

.ref-link {
  @apply border-0 bg-none p-0 cursor-pointer underline font-[inherit] text-info;
}
/* P104 §7.2: text-primary, not text-accent — shadcn-bridge.css maps --color-accent to
   --kira-hover (grey); --primary is the real brand accent. */
.ref-link:hover {
  @apply text-primary;
}
</style>
