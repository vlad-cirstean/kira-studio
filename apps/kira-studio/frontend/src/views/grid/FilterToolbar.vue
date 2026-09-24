<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { useConnectionsStore } from '../../state/connections';
import type { DataTabRecord } from '../../state/tabDomain';
import AutocompleteField from '../shared/AutocompleteField.vue';
import FilterHistoryMenu from '../shared/FilterHistoryMenu.vue';
import { sqlDialectFor } from '../shared/sqlIdent';
import {
  orderByCandidates as buildOrderByCandidates,
  whereCandidates as buildWhereCandidates,
} from './filterCompletion';
import { useGridViewStore } from './state';

// P48 D10: takes `tab` as a prop like every other view's toolbar — see DataToolbar.vue's own note.
const props = defineProps<{ tab: DataTabRecord }>();
const connectionsStore = useConnectionsStore();
const gridViewStore = useGridViewStore();

const rt = computed(() => gridViewStore.runtime[props.tab.id]);

// A query that failed is shown by the WHERE field turning error-red — the failure itself is
// already reported by DataView.vue's error strip, this just points at the field that caused it.
const hasError = computed(() => rt.value?.status === 'error');

// Mirrors PreviewCommandPanel.vue's/ConsoleView.vue's own three-line dialect computed exactly —
// undefined for every non-SQL connection kind, which filterCompletion.ts's dialect-conditional
// vocabularies (ILIKE, NULLS FIRST/LAST) already treat as "the non-Postgres list".
const dialect = computed(() => sqlDialectFor(connectionsStore.connectionRecord(props.tab.connectionId)?.kind));
const whereCandidates = computed(() => buildWhereCandidates(props.tab.id, dialect.value));
const orderByCandidates = computed(() => buildOrderByCandidates(props.tab.id, dialect.value));

function sortToText(sort: SortSpec | null): string {
  if (!sort) return '';
  if (sort.kind === 'text') return sort.text;
  return sort.terms.map((t) => `${t.column} ${t.direction.toUpperCase()}`).join(', ');
}

const whereText = ref('');
const orderByText = ref('');

// Watched as two separate primitive-returning getters, not `watch(tab, ...)` on the whole
// object: DataView.vue keys this component's ancestor by tab.id (remounted on tab switch, so
// `immediate: true` alone covers "just opened"/"tab changed"), but within one tab's lifetime
// `patchDataTabState` mutates `tab.state` in place rather than replacing the tab object — a
// non-deep watch on `tab` itself never sees that mutation. That silently broke this box after a
// column-header click (DataGrid.vue's onHeaderClick calls setSort, which does exactly this
// in-place patch): the ORDER BY field kept showing whatever was there before the click, so
// blurring it (or pressing Enter) re-applied the stale text and clobbered the header's sort.
watch(
  () => props.tab.state.filter,
  (filter) => {
    whereText.value = filter ?? '';
  },
  { immediate: true },
);
watch(
  () => props.tab.state.sort,
  (sort) => {
    orderByText.value = sortToText(sort);
  },
  { immediate: true },
);

function recordHistory(where: string | null, orderBy: SortSpec | null): void {
  if (!props.tab.connectionId) return;
  // A no-op filter (both null) is dropped server-side (D19) — nothing to special-case here.
  void control.queriesHistoryRecord(props.tab.connectionId, props.tab.path, where, orderBy);
}

async function applyWhere(): Promise<void> {
  const value = whereText.value.trim() === '' ? null : whereText.value.trim();
  // A blur fires on every focus loss, not just an edit — re-applying an unchanged WHERE would
  // reset paging/count for no reason (and, worse, race an in-flight runCount for this same filter).
  if (value === (props.tab.state.filter ?? null)) return;
  await gridViewStore.setFilter(props.tab.id, value);
  recordHistory(value, props.tab.state.sort);
}

async function applyOrderBy(): Promise<void> {
  const text = orderByText.value.trim();
  const sort: SortSpec | null = text === '' ? null : { kind: 'text', text };
  await gridViewStore.setSort(props.tab.id, sort);
  recordHistory(props.tab.state.filter, sort);
}

// README's "the filter row is permanent — Clear, never close": empties both fields and refetches,
// using the same setFilter/setSort the blur handlers already call — there is no separate "hide
// the row" affordance to build, since the row never goes away.
async function onClear(): Promise<void> {
  whereText.value = '';
  orderByText.value = '';
  await gridViewStore.setFilter(props.tab.id, null);
  await gridViewStore.setSort(props.tab.id, null);
  recordHistory(null, null);
}

// AutocompleteField's own @escape only ever fires once its suggestion dropdown is already closed
// (an open one consumes Escape itself, to dismiss just the dropdown) — so by the time this runs,
// focus is still genuinely on the field itself, and blurring the active element is exactly
// blurring it.
function onWhereEscape(): void {
  whereText.value = props.tab.state.filter ?? '';
  (document.activeElement as HTMLElement | null)?.blur();
}
function onOrderByEscape(): void {
  orderByText.value = sortToText(props.tab.state.sort);
  (document.activeElement as HTMLElement | null)?.blur();
}

const historyOpen = ref(false);
// P104: PopoverAnchor's own `:reference` takes the trigger's real DOM node directly (the
// established `.$el` idiom, e.g. GitPanel.vue's promptInput).
const historyTriggerEl = ref<{ $el: HTMLElement } | null>(null);

function applyFromHistory(where: string | null, orderBy: SortSpec | null): void {
  whereText.value = where ?? '';
  orderByText.value = sortToText(orderBy);
  void gridViewStore.setFilter(props.tab.id, where).then(() => gridViewStore.setSort(props.tab.id, orderBy));
}
</script>

<template>
  <!-- LAW 02 / README: one row, two prefixed inputs, one verb — permanent, so Clear rather than
       a close button that would make the grid change height under you. -->
  <div class="history-anchor">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          ref="historyTriggerEl"
          variant="toolbar"
          size="kira-icon"
          :class="{ 'bg-field text-fg': historyOpen }"
          data-testid="filter-history-button"
          aria-label="Saved & recent filters"
          @click="historyOpen = !historyOpen"
        >
          <CodiconIcon name="history" :size="13" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Saved & recent filters</TooltipContent>
    </Tooltip>
    <Popover :open="historyOpen" @update:open="(v) => (historyOpen = v)">
      <PopoverAnchor :reference="(historyTriggerEl?.$el as HTMLElement) ?? undefined" class="hidden" />
      <FilterHistoryMenu
        v-if="historyOpen"
        :connection-id="tab.connectionId"
        :path="tab.path"
        :current-filter="tab.state.filter"
        :current-sort="tab.state.sort"
        @apply="applyFromHistory"
        @close="historyOpen = false"
      />
    </Popover>
  </div>
  <div class="where-input">
    <AutocompleteField
      v-model="whereText"
      class="w-full"
      prefix="WHERE"
      :prefix-active="!!tab.state.filter"
      placeholder="status = 'paid'"
      data-testid="filter-where-input"
      :invalid="hasError"
      :candidates="whereCandidates"
      language="sql"
      :sql-dialect="dialect"
      @enter="applyWhere"
      @escape="onWhereEscape"
      @blur="applyWhere"
    />
  </div>
  <div class="orderby-input">
    <AutocompleteField
      v-model="orderByText"
      class="w-full"
      prefix="ORDER BY"
      :prefix-active="!!tab.state.sort"
      placeholder="placed_at DESC"
      data-testid="filter-orderby-input"
      :candidates="orderByCandidates"
      language="sql"
      :sql-dialect="dialect"
      @enter="applyOrderBy"
      @escape="onOrderByEscape"
      @blur="applyOrderBy"
    />
  </div>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button variant="toolbar" size="kira" @click="onClear">Clear</Button>
    </TooltipTrigger>
    <TooltipContent>Empty both fields and refetch</TooltipContent>
  </Tooltip>
</template>

<style scoped>
@reference "@theme/base.css";

/* Height, padding and colour come from the parent toolbar div's utility classes (P110 B28) and
   InputGroup's own kira variant — only the two fields' own widths live here. P110 B25: each
   field's width is now a `class="w-full"` prop straight on <AutocompleteField> (template above),
   not a scoped `:deep(.p-input)` rule reaching across the component boundary (DocumentView.vue's
   same `.filter-field` precedent). */
.history-anchor {
  @apply relative;
}

.where-input {
  @apply flex-1 min-w-0;
}

.orderby-input {
  @apply w-56 shrink-0;
}
</style>
