<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, reactive, ref } from 'vue';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useSettingsStore } from '../../state/settings';
import { getPlan } from './explainResults';
import type { PlanNode } from './planModel';

// P18 (v1.1) C12/D17: the plan-result sibling of ConsoleResultGrid.vue, mounted instead of it when
// the active result set's `kind` is 'plan' (ConsoleView.vue). Reads its own data from
// explainResults.ts by `pageKey` — same "one prop, resolve everything else from a store" shape
// ConsoleResultGrid.vue's own `pageKey` already uses.
const props = defineProps<{ pageKey: string }>();
const settingsStore = useSettingsStore();

const result = computed(() => getPlan(props.pageKey));
const plan = computed(() => result.value?.plan);

const NATIVE_COST_LABEL: Record<string, string> = {
  'postgres-planner': 'Postgres planner cost',
  'mysql-cost': 'MySQL cost',
  'mariadb-cost': 'MariaDB cost',
};
const nativeCostLabel = computed(() => {
  const cost = plan.value?.nativeCost;
  if (!cost) return null;
  const label = NATIVE_COST_LABEL[cost.unit] ?? 'cost';
  return `${label} ${cost.value.toLocaleString()}`;
});

// D14: the threshold is an estimated-rows-read number, never a cost unit (F17) — sqlite reports
// neither, so the verdict says the threshold doesn't apply here rather than showing a silent zero.
const verdict = computed(() => {
  const p = plan.value;
  if (!p) return '';
  if (p.estimatedRowsRead === undefined) {
    return p.kind === 'sqlite'
      ? "SQLite's query planner reports no row estimates, so the expensive-query threshold does not apply here."
      : 'No row estimate available for this plan.';
  }
  const rows = p.estimatedRowsRead.toLocaleString();
  return p.overThreshold
    ? `Estimated to read ${rows} rows — at or above the ${settingsStore.advanced.expensiveQueryRows.toLocaleString()}-row threshold`
    : `Estimated to read ${rows} rows`;
});

// D17: "tens of nodes" (Postgres's own parallel-worker plans top out in the low hundreds) — not
// virtualized, and flattened once here rather than rendered by a recursive component, the same
// "flatten, don't recurse" shape DocumentTree.vue's own visibleLines() already takes.
interface FlatRow {
  node: PlanNode;
  depth: number;
  id: string;
  hasChildren: boolean;
}

const collapsedIds = reactive(new Set<string>());
function toggleNode(id: string): void {
  if (collapsedIds.has(id)) collapsedIds.delete(id);
  else collapsedIds.add(id);
}

const flatRows = computed<FlatRow[]>(() => {
  const root = plan.value?.root;
  if (!root) return [];
  const out: FlatRow[] = [];
  const walk = (node: PlanNode, depth: number, id: string): void => {
    out.push({ node, depth, id, hasChildren: node.children.length > 0 });
    if (collapsedIds.has(id)) return;
    node.children.forEach((child, i) => {
      walk(child, depth + 1, `${id}.${i}`);
    });
  };
  walk(root, 0, '0');
  return out;
});

function metricsLine(node: PlanNode): string {
  return node.metrics.map((m) => `${m.label}: ${m.value}`).join(' · ');
}

const showRaw = ref(false);
// Postgres/MySQL/MariaDB's raw text is one JSON document; ClickHouse's is a JSON plan plus an
// appended ESTIMATE block (explain.ts's own composed text, not valid JSON on its own), and
// SQLite's is reconstructed tab-separated rows — 'plain' avoids CodeMirror's JSON linter flagging
// either of the latter two as broken.
const rawLanguage = computed(() =>
  plan.value?.kind === 'postgres' || plan.value?.kind === 'mysql' || plan.value?.kind === 'mariadb'
    ? 'json'
    : 'plain',
);
</script>

<template>
  <div class="h-full overflow-auto flex flex-col text-kira-sm gap-1.5 p-2" data-testid="explain-result-view">
    <template v-if="plan && result">
      <div class="flex items-center flex-wrap gap-2">
        <div
          class="flex items-center gap-1"
          :class="plan.overThreshold ? 'text-warn' : 'text-ok'"
          data-testid="explain-verdict"
          :data-over-threshold="plan.overThreshold"
        >
          <CodiconIcon :name="plan.overThreshold ? 'warning' : 'check'" :size="14" />
          <span>{{ verdict }}</span>
        </div>
        <Tooltip v-if="nativeCostLabel">
          <TooltipTrigger as-child>
            <span class="text-muted-foreground text-kira-xs cursor-default" data-testid="explain-native-cost">{{ nativeCostLabel }}</span>
          </TooltipTrigger>
          <TooltipContent>Not comparable to another engine’s own cost figure — see the plan doc’s F17.</TooltipContent>
        </Tooltip>
      </div>
      <p class="text-muted-foreground text-kira-xs whitespace-pre-wrap break-words font-data" data-testid="explain-statement">{{ result.statement }}</p>

      <ul v-if="plan.issues.length > 0" class="flex flex-col list-none m-0 p-0 gap-1" data-testid="explain-issues">
        <li
          v-for="(issue, i) in plan.issues"
          :key="i"
          class="flex items-start gap-1"
          :class="issue.severity === 'warn' ? 'text-warn' : 'text-muted-foreground'"
          :data-severity="issue.severity"
        >
          <CodiconIcon :name="issue.severity === 'warn' ? 'warning' : 'info'" :size="12" />
          <span>{{ issue.message }}</span>
        </li>
      </ul>
      <p v-else class="text-subtle m-0" data-testid="explain-no-issues">No issues found.</p>

      <div class="border border-border rounded-kira-sm py-1" data-testid="explain-tree">
        <div
          v-for="row in flatRows"
          :key="row.id"
          class="flex items-baseline flex-wrap gap-1.5 py-0.5 px-1.5 hover:bg-hover"
          data-testid="explain-plan-node"
          :style="{ paddingLeft: `${row.depth * 18 + 4}px` }"
        >
          <button
            v-if="row.hasChildren"
            type="button"
            class="inline-flex items-center w-3 shrink-0 cursor-pointer border-0 bg-transparent p-0"
            :aria-label="collapsedIds.has(row.id) ? 'Expand' : 'Collapse'"
            @click="toggleNode(row.id)"
          >
            <CodiconIcon :name="collapsedIds.has(row.id) ? 'chevron-right' : 'chevron-down'" :size="12" />
          </button>
          <span v-else class="inline-flex items-center w-3 shrink-0 cursor-pointer"></span>
          <span class="font-data">{{ row.node.label }}</span>
          <span v-if="row.node.estimatedRows !== undefined" class="plan-meta text-muted-foreground text-kira-xs"
            >~{{ row.node.estimatedRows.toLocaleString() }} rows</span
          >
          <span v-if="row.node.cost" class="plan-meta text-muted-foreground text-kira-xs">cost {{ row.node.cost.total.toLocaleString() }}</span>
          <span v-if="row.node.detail" class="text-subtle text-kira-xs font-data">{{ row.node.detail }}</span>
          <span v-if="row.node.metrics.length" class="plan-metrics text-muted-foreground text-kira-xs">{{ metricsLine(row.node) }}</span>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-field text-fg': showRaw }"
              aria-label="Show the raw EXPLAIN output"
              data-testid="explain-raw-toggle"
              @click="showRaw = !showRaw"
            >
              <CodiconIcon name="code" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show the raw EXPLAIN output the server returned</TooltipContent>
        </Tooltip>
        <span class="text-muted-foreground text-kira-xs">Raw</span>
      </div>
      <div v-if="showRaw" class="h-64 border border-border rounded-kira-sm overflow-hidden" data-testid="explain-raw">
        <MonacoHost :doc="plan.raw" :language="rawLanguage" :read-only="true" :autocomplete="false" />
      </div>
    </template>
    <p v-else class="text-muted-foreground text-kira-xs m-0">No plan.</p>
  </div>
  <!-- P110 I2-16: `.verdict.warn`/`.issue-list li[.warn/.info]`/`.plan-row:hover` all moved onto
       the template as ternaries/utilities -- `issue.severity` is exhaustively 'warn'/'info'
       (planModel.ts's own PlanIssue), so the <li> ternary needs no default branch. -->
</template>
