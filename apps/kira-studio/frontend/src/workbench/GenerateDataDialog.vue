<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { control } from '../bridge/control';
import { data } from '../bridge/data';
import CodeMirrorHost from '../editor/CodeMirrorHost.vue';
import { connectionRecord, connectionsState } from '../state/connections';
import { closeGenerateDataDialog, fakeDataDialogState } from '../state/fakeData';
import { findDataTab } from '../state/tabs';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import RunState from '../theme/primitives/RunState.vue';
import TextField from '../theme/primitives/TextField.vue';
import {
  BATCH_SIZE,
  GenerationError,
  previewFirstRows,
  runGeneration,
} from '../views/grid/fakeData/generate';
import { planWarnings, RECIPE_CATALOG, recipeFor } from '../views/grid/fakeData/recipes';
import type { ColumnPlan, GeneratorId, Recipe } from '../views/grid/fakeData/types';
import { getPage } from '../views/grid/page';
import { reloadAfterMutation, runtime } from '../views/grid/state';
import { sqlDialectFor } from '../views/shared/sqlIdent';

// P15 D11: driven by state/fakeData.ts's own open/close state, mounted in App.vue beside
// UploadObjectDialog.vue — the established shape for a feature dialog reachable from the toolbar
// and the command palette alike. App.vue mounts this fresh (v-if) on every open, so onMounted below
// is the one and only place a run's fields get their starting values (D8).

const tabId = computed(() => fakeDataDialogState.tabId);
const tab = computed(() => (tabId.value ? findDataTab(tabId.value) : null));
const connRecord = computed(() => connectionRecord(tab.value?.connectionId));
const caps = computed(() =>
  tab.value?.connectionId ? (connectionsState.states[tab.value.connectionId]?.caps ?? null) : null,
);
const meta = computed(() => (tabId.value ? (runtime[tabId.value]?.meta ?? null) : null));

const rowCount = ref(100);
const seed = ref(0);
const plans = ref<ColumnPlan[]>([]);

const previewOpen = ref(false);
const previewStatements = ref<string[]>([]);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

const running = ref(false);
const committedRows = ref(0);
const runError = ref<string | null>(null);
const currentOpId = ref<string | null>(null);
let abortController: AbortController | null = null;

// D9: recomputed on every plan change, not baked into recipeFor's own one-time proposal.
const warnings = computed(() => planWarnings(plans.value, meta.value));

// P12 round 1 finding #2: with no plans at all (the tab's page hadn't loaded yet when the dialog
// opened, so `page?.columns ?? []` came back empty) or every plan set to Skip, a run has no column
// left to write — generateBatch would emit `{kind:'insert', values:{}}` per row, which sqlmutate.go
// turns into `INSERT INTO t () VALUES ()`: silently committed all-defaults rows on MySQL/MariaDB,
// a confusing syntax error on Postgres/SQLite. Neither Generate nor Preview should ever run then.
const noColumnsLoaded = computed(() => plans.value.length === 0);
const allColumnsSkipped = computed(
  () => plans.value.length > 0 && plans.value.every((p) => p.recipe.kind === 'skip'),
);
const noUsableColumns = computed(() => noColumnsLoaded.value || allColumnsSkipped.value);

onMounted(() => {
  const id = tabId.value;
  const page = id ? getPage(id) : undefined;
  plans.value = (page?.columns ?? []).map((c) => recipeFor(c, meta.value));
  rowCount.value = 100;
  // D8: a fresh random seed per open, shown and editable — pinning it is what makes a run
  // reproducible, and it is also what makes the Preview panel show the run's real first rows.
  seed.value = Math.floor(Math.random() * 1_000_000_000);
});

function onClose(): void {
  if (running.value) return; // Stop first — a run in flight owns the dialog until it stops.
  closeGenerateDataDialog();
}

const sqlDialect = computed(() => sqlDialectFor(connRecord.value?.kind));
const previewDoc = computed(
  () => previewStatements.value.join(';\n\n') + (previewStatements.value.length ? ';' : ''),
);

async function onTogglePreview(): Promise<void> {
  if (noUsableColumns.value) return;
  previewOpen.value = !previewOpen.value;
  if (!previewOpen.value) return;
  const t = tab.value;
  if (!t?.connectionId) return;
  previewLoading.value = true;
  previewError.value = null;
  try {
    // D10: the same seed as a real run, so this is literally the first rows that run would write.
    const ops = await previewFirstRows(plans.value, seed.value, Math.min(5, rowCount.value));
    previewStatements.value = ops.length
      ? (await data.preview({ connectionId: t.connectionId, path: t.path, ops })).statements
      : [];
  } catch (err) {
    previewError.value = err instanceof Error ? err.message : String(err);
  } finally {
    previewLoading.value = false;
  }
}

async function onGenerate(): Promise<void> {
  const t = tab.value;
  if (!t?.connectionId || running.value || noUsableColumns.value) return;
  running.value = true;
  runError.value = null;
  committedRows.value = 0;
  abortController = new AbortController();
  try {
    await runGeneration({
      connectionId: t.connectionId,
      path: t.path,
      tabId: t.id,
      plans: plans.value,
      total: rowCount.value,
      seed: seed.value,
      onBatchStart: (opId) => {
        currentOpId.value = opId;
      },
      onProgress: (rows) => {
        committedRows.value = rows;
      },
      signal: abortController.signal,
    });
    running.value = false;
    currentOpId.value = null;
    closeGenerateDataDialog();
    await reloadAfterMutation(t.id);
  } catch (err) {
    running.value = false;
    currentOpId.value = null;
    if (err instanceof GenerationError) {
      committedRows.value = err.committedRows;
      const committedText = `${err.committedRows.toLocaleString()} row${err.committedRows === 1 ? '' : 's'}`;
      // D7: the server's own message, how many rows already committed, and — read from
      // caps.transactions, never assumed — whether the failing batch itself rolled back.
      runError.value =
        err.code === 'E_CANCELLED'
          ? `Stopped — ${committedText} committed.`
          : caps.value?.transactions
            ? `${err.message} — ${committedText} committed before this batch, which was rolled back.`
            : `${err.message} — ${committedText} committed before this batch. This connection has no transactions, so any rows the failing batch already wrote stay written.`;
    } else {
      runError.value = err instanceof Error ? err.message : String(err);
    }
    if (committedRows.value > 0) await reloadAfterMutation(t.id);
  }
}

function onStop(): void {
  abortController?.abort();
  if (currentOpId.value) void control.opsCancel(currentOpId.value);
}

type RecipeSelectValue = 'skip' | 'null' | 'constant' | 'sequence' | GeneratorId;

function recipeSelectValue(recipe: Recipe): RecipeSelectValue {
  return recipe.kind === 'faker' ? recipe.generatorId : recipe.kind;
}

function optionsFor(plan: ColumnPlan) {
  return RECIPE_CATALOG.filter((o) => o.typeClasses.includes(plan.column.typeClass));
}

function patchPlan(index: number, recipe: Recipe): void {
  plans.value = plans.value.map((p, i) => (i === index ? { ...p, recipe } : p));
}

function onRecipeChange(index: number, value: string): void {
  if (value === 'skip') patchPlan(index, { kind: 'skip' });
  else if (value === 'null') patchPlan(index, { kind: 'null' });
  else if (value === 'constant') patchPlan(index, { kind: 'constant', value: '' });
  else if (value === 'sequence') patchPlan(index, { kind: 'sequence', start: 1 });
  else patchPlan(index, { kind: 'faker', generatorId: value as GeneratorId });
}

function onConstantChange(index: number, value: string): void {
  patchPlan(index, { kind: 'constant', value });
}

function onSequenceStartChange(index: number, start: number): void {
  patchPlan(index, { kind: 'sequence', start });
}
</script>

<template>
  <DialogFrame
    title="Generate data"
    :width="680"
    max-height="82vh"
    test-id="generate-data-dialog"
    close-test-id="generate-data-close"
    @close="onClose"
  >
    <div class="generate-form">
      <div class="run-fields">
        <label class="field-label p-sm muted">Rows</label>
        <TextField
          :model-value="String(rowCount)"
          type="number"
          data-testid="generate-data-row-count"
          :disabled="running"
          @update:model-value="(v) => (rowCount = Math.max(1, Math.trunc(Number(v)) || 1))"
        />
        <label class="field-label p-sm muted">Seed</label>
        <TextField
          :model-value="String(seed)"
          type="number"
          data-testid="generate-data-seed"
          :disabled="running"
          @update:model-value="(v) => (seed = Math.trunc(Number(v)) || 0)"
        />
        <span v-if="rowCount > BATCH_SIZE" class="p-sm muted" data-testid="generate-data-batch-note">
          {{ Math.ceil(rowCount / BATCH_SIZE) }} batches of {{ BATCH_SIZE }}
        </span>
      </div>

      <div class="recipe-table">
        <div class="recipe-row recipe-head p-sm muted">
          <span>Column</span>
          <span>Type</span>
          <span>Recipe</span>
          <span>Value</span>
        </div>
        <div
          v-for="(plan, index) in plans"
          :key="plan.column.name"
          class="recipe-row"
          data-testid="generate-data-column-row"
          :data-column="plan.column.name"
        >
          <span class="col-name">{{ plan.column.name }}</span>
          <span class="col-type muted">{{ plan.column.dataType }}</span>
          <select
            class="p-select bordered"
            :data-testid="`generate-data-recipe-${plan.column.name}`"
            :value="recipeSelectValue(plan.recipe)"
            :disabled="running"
            @change="onRecipeChange(index, ($event.target as HTMLSelectElement).value)"
          >
            <option value="skip">Skip</option>
            <option value="null">NULL</option>
            <option value="constant">Constant</option>
            <option v-if="plan.column.typeClass === 'number'" value="sequence">Sequence</option>
            <option v-for="opt in optionsFor(plan)" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
          <TextField
            v-if="plan.recipe.kind === 'constant'"
            :model-value="plan.recipe.value"
            :data-testid="`generate-data-constant-${plan.column.name}`"
            :disabled="running"
            @update:model-value="(v) => onConstantChange(index, v)"
          />
          <TextField
            v-else-if="plan.recipe.kind === 'sequence'"
            :model-value="String(plan.recipe.start)"
            type="number"
            :data-testid="`generate-data-sequence-start-${plan.column.name}`"
            :disabled="running"
            @update:model-value="(v) => onSequenceStartChange(index, Math.trunc(Number(v)) || 0)"
          />
          <span v-else class="muted"></span>
        </div>
      </div>

      <MessageStrip
        v-if="noColumnsLoaded"
        tone="warn"
        icon="warning"
        data-testid="generate-data-no-columns"
      >
        No column information available yet. Close this dialog, let the page load, then try again.
      </MessageStrip>
      <MessageStrip
        v-else-if="allColumnsSkipped"
        tone="warn"
        icon="warning"
        data-testid="generate-data-no-columns"
      >
        Every column is set to Skip — pick a recipe for at least one column to generate rows.
      </MessageStrip>

      <MessageStrip
        v-if="warnings.length"
        tone="warn"
        icon="warning"
        data-testid="generate-data-warnings"
      >
        <ul class="warning-list">
          <li v-for="w in warnings" :key="w">{{ w }}</li>
        </ul>
      </MessageStrip>

      <div class="preview-section">
        <button
          type="button"
          class="preview-toggle p-sm"
          data-testid="generate-data-preview-toggle"
          :disabled="noUsableColumns"
          @click="onTogglePreview"
        >
          {{ previewOpen ? 'Hide preview' : 'Preview SQL' }}
        </button>
        <div v-if="previewOpen" class="preview-body" data-testid="generate-data-preview">
          <div v-if="previewLoading" class="muted p-sm">Loading…</div>
          <div v-else-if="previewError" class="p-sm" data-testid="generate-data-preview-error">
            {{ previewError }}
          </div>
          <CodeMirrorHost
            v-else
            :doc="previewDoc"
            language="sql"
            :sql-dialect="sqlDialect"
            :read-only="true"
          />
        </div>
      </div>

      <MessageStrip v-if="runError" tone="err" icon="warning" data-testid="generate-data-error">
        {{ runError }}
      </MessageStrip>
    </div>

    <template #footer>
      <span class="p-dialog-actions end p-push">
        <RunState
          v-if="running"
          status="running"
          :elapsed-ms="null"
          :title="`${committedRows} / ${rowCount} rows committed`"
        />
        <AppButton v-if="running" kind="dialog" data-testid="generate-data-stop" @click="onStop">
          Stop
        </AppButton>
        <template v-else>
          <AppButton kind="dialog" data-testid="generate-data-cancel" @click="onClose">
            Cancel
          </AppButton>
          <AppButton
            kind="dialog"
            variant="primary"
            data-testid="generate-data-submit"
            :disabled="rowCount < 1 || noUsableColumns"
            @click="onGenerate"
          >
            Generate
          </AppButton>
        </template>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.generate-form {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-4);
  padding: var(--kira-s-4) var(--kira-s-5);
}

.run-fields {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
}

.field-label {
  padding: 0;
}

.recipe-table {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  max-height: 260px;
  overflow-y: auto;
}

.recipe-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--kira-s-2);
}

.recipe-head {
  padding: 0;
}

.col-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warning-list {
  margin: 0;
  padding-left: var(--kira-s-4);
}

.preview-toggle {
  background: none;
  border: none;
  color: var(--kira-accent);
  cursor: pointer;
  padding: 0;
}

.preview-toggle:disabled {
  color: var(--kira-fg-muted);
  cursor: not-allowed;
}

.preview-body {
  height: 200px;
  margin-top: var(--kira-s-2);
}
</style>
