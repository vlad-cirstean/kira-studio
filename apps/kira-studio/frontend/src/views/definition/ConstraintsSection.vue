<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { Badge } from '@theme/components/ui/badge';
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

// P110 B30: ColumnsSection.vue's own DEF_TH/DEF_TH_LAST/DEF_TD constants (see its comment) --
// folded off primitives.css's old shared header-row and body-cell rules.
const DEF_TH =
  'text-left px-1.5 py-1 bg-elevated border-b border-border-strong border-r border-border text-muted-foreground text-kira-sm whitespace-nowrap';
const DEF_TH_LAST =
  'text-left px-1.5 py-1 bg-elevated border-b border-border-strong text-muted-foreground text-kira-sm whitespace-nowrap';
const DEF_TD = 'px-1.5 py-1 align-middle text-fg';
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-constraints">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">Constraints</span>
      <Badge>{{ constraints.length }}</Badge>
    </header>
    <table class="w-full border-collapse text-kira-md definition-table">
      <thead>
        <tr>
          <th :class="DEF_TH">Name</th>
          <th :class="DEF_TH">Type</th>
          <th :class="DEF_TH">Definition</th>
          <th :class="DEF_TH_LAST">Table</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="c in constraints"
          :key="`${c.type}:${c.name}`"
          class="border-b border-border hover:bg-hover"
          data-testid="definition-row"
        >
          <td :class="DEF_TD" class="def-con-name">{{ c.name }}</td>
          <td :class="DEF_TD" class="def-con-type">
            <span v-if="KEY_LABEL[c.type] === 'PK'" class="header-key">PK</span>
            <span v-else-if="KEY_LABEL[c.type] === 'FK'" class="header-key is-fk">FK</span>
            <Badge v-else>{{ TYPE_LABEL[c.type] }}</Badge>
          </td>
          <td :class="DEF_TD" class="def-con-detail font-data">{{ c.detail }}</td>
          <td :class="DEF_TD" class="def-con-table">
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

/* Only these two aren't in the shared cell utility list above — see ColumnsSection.vue's own
   comment on why. */
.definition-table td {
  @apply border-r border-border;
}
.definition-table td:last-child {
  @apply border-r-0;
}

.header-key {
  @apply text-warn text-kira-xs;
}
.header-key.is-fk {
  @apply text-info;
}

.def-con-detail {
  @apply overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground;
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
