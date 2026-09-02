<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { settingsState } from '../../state/settings';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import { getPlan } from './explainResults';
import type { PlanNode } from './planModel';

// P18 (v1.1) C12/D17: the plan-result sibling of ConsoleResultGrid.vue, mounted instead of it when
// the active result set's `kind` is 'plan' (ConsoleView.vue). Reads its own data from
// explainResults.ts by `pageKey` — same "one prop, resolve everything else from a store" shape
// ConsoleResultGrid.vue's own `pageKey` already uses.
const props = defineProps<{ pageKey: string }>();

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
    ? `Estimated to read ${rows} rows — at or above the ${settingsState.advanced.expensiveQueryRows.toLocaleString()}-row threshold`
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
  <div class="explain-view" data-testid="explain-result-view">
    <template v-if="plan && result">
      <div class="explain-header">
        <div
          class="verdict"
          :class="{ warn: plan.overThreshold }"
          data-testid="explain-verdict"
          :data-over-threshold="plan.overThreshold"
        >
          <CodiconIcon :name="plan.overThreshold ? 'warning' : 'check'" :size="14" />
          <span>{{ verdict }}</span>
        </div>
        <span
          v-if="nativeCostLabel"
          class="native-cost"
          data-testid="explain-native-cost"
          v-tooltip="'Not comparable to another engine’s own cost figure — see the plan doc’s F17.'"
          >{{ nativeCostLabel }}</span
        >
      </div>
      <p class="statement-excerpt mono" data-testid="explain-statement">{{ result.statement }}</p>

      <ul v-if="plan.issues.length > 0" class="issue-list" data-testid="explain-issues">
        <li v-for="(issue, i) in plan.issues" :key="i" :class="issue.severity" :data-severity="issue.severity">
          <CodiconIcon :name="issue.severity === 'warn' ? 'warning' : 'info'" :size="12" />
          <span>{{ issue.message }}</span>
        </li>
      </ul>
      <p v-else class="no-issues" data-testid="explain-no-issues">No issues found.</p>

      <div class="plan-tree" data-testid="explain-tree">
        <div
          v-for="row in flatRows"
          :key="row.id"
          class="plan-row"
          data-testid="explain-plan-node"
          :style="{ paddingLeft: `${row.depth * 18 + 4}px` }"
        >
          <span
            v-if="row.hasChildren"
            class="plan-toggle"
            role="button"
            :aria-label="collapsedIds.has(row.id) ? 'Expand' : 'Collapse'"
            @click="toggleNode(row.id)"
          >
            <CodiconIcon :name="collapsedIds.has(row.id) ? 'chevron-right' : 'chevron-down'" :size="12" />
          </span>
          <span v-else class="plan-toggle-spacer"></span>
          <span class="plan-label">{{ row.node.label }}</span>
          <span v-if="row.node.estimatedRows !== undefined" class="plan-meta muted"
            >~{{ row.node.estimatedRows.toLocaleString() }} rows</span
          >
          <span v-if="row.node.cost" class="plan-meta muted">cost {{ row.node.cost.total.toLocaleString() }}</span>
          <span v-if="row.node.detail" class="plan-detail mono muted">{{ row.node.detail }}</span>
          <span v-if="row.node.metrics.length" class="plan-metrics muted">{{ metricsLine(row.node) }}</span>
        </div>
      </div>

      <div class="raw-toggle-row">
        <IconButton
          icon="code"
          :active="showRaw"
          data-testid="explain-raw-toggle"
          v-tooltip="'Show the raw EXPLAIN output the server returned'"
          @click="showRaw = !showRaw"
        />
        <span class="p-sm muted">Raw</span>
      </div>
      <div v-if="showRaw" class="raw-body" data-testid="explain-raw">
        <CodeMirrorHost :doc="plan.raw" :language="rawLanguage" :read-only="true" :autocomplete="false" />
      </div>
    </template>
    <p v-else class="no-plan muted">No plan.</p>
  </div>
</template>

<style scoped>
.explain-view {
  height: 100%;
  overflow: auto;
  padding: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
  font-size: var(--kira-t-sm);
}

.explain-header {
  display: flex;
  align-items: center;
  gap: var(--kira-s-4);
  flex-wrap: wrap;
}

.verdict {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  color: var(--kira-ok);
}

.verdict.warn {
  color: var(--kira-warn);
}

.native-cost {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
  cursor: default;
}

.statement-excerpt {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.issue-list {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  list-style: none;
  padding: 0;
  margin: 0;
}

.issue-list li {
  display: flex;
  align-items: flex-start;
  gap: var(--kira-s-2);
}

.issue-list li.warn {
  color: var(--kira-warn);
}

.issue-list li.info {
  color: var(--kira-fg-muted);
}

.no-issues,
.no-plan {
  color: var(--kira-fg-disabled);
  margin: 0;
}

.plan-tree {
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  padding: var(--kira-s-2) 0;
}

.plan-row {
  display: flex;
  align-items: baseline;
  gap: var(--kira-s-3);
  padding: 2px var(--kira-s-3);
  flex-wrap: wrap;
}

.plan-row:hover {
  background: var(--kira-hover);
}

.plan-toggle,
.plan-toggle-spacer {
  display: inline-flex;
  align-items: center;
  width: 12px;
  flex-shrink: 0;
  cursor: pointer;
}

.plan-label {
  font-family: var(--kira-font-family);
}

.muted {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
}

.plan-detail {
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
}

.raw-toggle-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.raw-body {
  height: 260px;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  overflow: hidden;
}
</style>
