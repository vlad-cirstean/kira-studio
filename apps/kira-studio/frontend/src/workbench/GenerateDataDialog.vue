<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useNumberStepper } from '@theme/composables/useNumberStepper';
import { computed, onMounted, ref } from 'vue';
import { control } from '../bridge/control';
import { data } from '../bridge/data';
import MonacoHost from '../editor/MonacoHost.vue';
import { useConnectionsStore } from '../state/connections';
import { useFakeDataStore } from '../state/fakeData';
import { useTabsStore } from '../state/tabs';
import {
  BATCH_SIZE,
  GenerationError,
  previewFirstRows,
  runGeneration,
} from '../views/grid/fakeData/generate';
import { planWarnings, RECIPE_CATALOG, recipeFor } from '../views/grid/fakeData/recipes';
import type { ColumnPlan, GeneratorId, Recipe } from '../views/grid/fakeData/types';
import { getPage } from '../views/grid/page';
import { useGridViewStore } from '../views/grid/state';
import { sqlDialectFor } from '../views/shared/sqlIdent';

// P15 D11: driven by state/fakeData.ts's own open/close state, mounted in App.vue beside
// UploadObjectDialog.vue — the established shape for a feature dialog reachable from the toolbar
// and the command palette alike. App.vue mounts this fresh (v-if) on every open, so onMounted below
// is the one and only place a run's fields get their starting values (D8).

const fakeDataStore = useFakeDataStore();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();
const gridViewStore = useGridViewStore();
const tabId = computed(() => fakeDataStore.tabId);
const tab = computed(() => (tabId.value ? tabsStore.findDataTab(tabId.value) : null));
const connRecord = computed(() => connectionsStore.connectionRecord(tab.value?.connectionId));
const caps = computed(() =>
  tab.value?.connectionId ? (connectionsStore.states[tab.value.connectionId]?.caps ?? null) : null,
);
const meta = computed(() =>
  tabId.value ? (gridViewStore.runtime[tabId.value]?.meta ?? null) : null,
);

const rowCount = ref(100);
const seed = ref(0);
const plans = ref<ColumnPlan[]>([]);

// P104 §2: TextField's number stepper -> ui/input-group recipe. Rows/Seed are singular fields;
// each recipe row's own sequence-start field is per-row, so its group elements live in a Map
// keyed by column name (same convention as RepoMultiDiffView.vue's own per-path container Map).
const rowCountGroupRef = ref<HTMLElement | null>(null);
const rowCountStepper = useNumberStepper(rowCountGroupRef);
const seedGroupRef = ref<HTMLElement | null>(null);
const seedStepper = useNumberStepper(seedGroupRef);
const sequenceStartGroups = new Map<string, HTMLElement>();
function setSequenceStartGroup(columnName: string, el: Element | null): void {
  if (el instanceof HTMLElement) sequenceStartGroups.set(columnName, el);
  else sequenceStartGroups.delete(columnName);
}
function stepSequenceStart(columnName: string, dir: 1 | -1): void {
  const container = sequenceStartGroups.get(columnName);
  const el = container?.querySelector('input');
  if (!el || el.disabled) return;
  if (dir > 0) el.stepUp();
  else el.stepDown();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

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
  fakeDataStore.closeGenerateDataDialog();
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
    const ops = await previewFirstRows(
      plans.value,
      seed.value,
      Math.min(5, rowCount.value),
      sqlDialect.value,
    );
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
      dialect: sqlDialect.value,
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
    fakeDataStore.closeGenerateDataDialog();
    await gridViewStore.reloadAfterMutation(t.id);
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
    if (committedRows.value > 0) await gridViewStore.reloadAfterMutation(t.id);
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
  <Dialog :open="true" @update:open="(v) => !v && onClose()">
    <DialogContent
      :show-close-button="false"
      data-testid="generate-data-dialog"
      class="flex flex-col p-0 gap-0 w-170 max-h-[82vh]"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Generate data</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="generate-data-close"
            @click="onClose"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="overflow-auto">
    <div class="generate-form">
      <div class="run-fields">
        <Label class="field-label p-sm muted">Rows</Label>
        <!-- P104 §2: `ref` on a wrapping display:contents span (not the InputGroup component
             itself, which forwards no DOM ref) -- keeps run-fields' flex layout untouched since the
             wrapper contributes no box of its own. -->
        <span ref="rowCountGroupRef" class="contents">
        <InputGroup class="h-control w-full rounded-kira-sm border-border-strong bg-field">
          <InputGroupInput
            :model-value="String(rowCount)"
            type="number"
            class="h-full font-data"
            data-testid="generate-data-row-count"
            :disabled="running"
            @update:model-value="(v: string | number) => (rowCount = Math.max(1, Math.trunc(Number(v)) || 1))"
          />
          <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  :disabled="running"
                  @mousedown.prevent="rowCountStepper.stepBy(1)"
                >
                  <CodiconIcon name="chevron-up" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Increase</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  :disabled="running"
                  @mousedown.prevent="rowCountStepper.stepBy(-1)"
                >
                  <CodiconIcon name="chevron-down" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Decrease</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
        </span>
        <Label class="field-label p-sm muted">Seed</Label>
        <span ref="seedGroupRef" class="contents">
        <InputGroup class="h-control w-full rounded-kira-sm border-border-strong bg-field">
          <InputGroupInput
            :model-value="String(seed)"
            type="number"
            class="h-full font-data"
            data-testid="generate-data-seed"
            :disabled="running"
            @update:model-value="(v: string | number) => (seed = Math.trunc(Number(v)) || 0)"
          />
          <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  :disabled="running"
                  @mousedown.prevent="seedStepper.stepBy(1)"
                >
                  <CodiconIcon name="chevron-up" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Increase</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                  tabindex="-1"
                  aria-hidden="true"
                  :disabled="running"
                  @mousedown.prevent="seedStepper.stepBy(-1)"
                >
                  <CodiconIcon name="chevron-down" :size="9" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Decrease</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
        </span>
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
          <Input
            v-if="plan.recipe.kind === 'constant'"
            :model-value="plan.recipe.value"
            class="h-control w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
            :data-testid="`generate-data-constant-${plan.column.name}`"
            :disabled="running"
            @update:model-value="(v) => onConstantChange(index, String(v))"
          />
          <span
            v-else-if="plan.recipe.kind === 'sequence'"
            class="contents"
            :ref="(el) => setSequenceStartGroup(plan.column.name, el as Element | null)"
          >
            <InputGroup class="h-control w-full rounded-kira-sm border-border-strong bg-field">
              <InputGroupInput
                :model-value="String(plan.recipe.start)"
                type="number"
                class="h-full font-data"
                :data-testid="`generate-data-sequence-start-${plan.column.name}`"
                :disabled="running"
                @update:model-value="(v: string | number) => onSequenceStartChange(index, Math.trunc(Number(v)) || 0)"
              />
              <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
                      class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                      tabindex="-1"
                      aria-hidden="true"
                      :disabled="running"
                      @mousedown.prevent="stepSequenceStart(plan.column.name, 1)"
                    >
                      <CodiconIcon name="chevron-up" :size="9" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Increase</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
                      class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                      tabindex="-1"
                      aria-hidden="true"
                      :disabled="running"
                      @mousedown.prevent="stepSequenceStart(plan.column.name, -1)"
                    >
                      <CodiconIcon name="chevron-down" :size="9" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Decrease</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
          </span>
          <span v-else class="muted"></span>
        </div>
      </div>

      <Alert v-if="noColumnsLoaded" class="strip-warn" data-testid="generate-data-no-columns">
        <CodiconIcon name="warning" :size="14" class="strip-warn-text" />
        <AlertDescription class="strip-warn-text">
          No column information available yet. Close this dialog, let the page load, then try again.
        </AlertDescription>
      </Alert>
      <Alert v-else-if="allColumnsSkipped" class="strip-warn" data-testid="generate-data-no-columns">
        <CodiconIcon name="warning" :size="14" class="strip-warn-text" />
        <AlertDescription class="strip-warn-text">
          Every column is set to Skip — pick a recipe for at least one column to generate rows.
        </AlertDescription>
      </Alert>

      <Alert v-if="warnings.length" class="strip-warn" data-testid="generate-data-warnings">
        <CodiconIcon name="warning" :size="14" class="strip-warn-text" />
        <AlertDescription class="strip-warn-text">
          <ul class="warning-list">
            <li v-for="w in warnings" :key="w">{{ w }}</li>
          </ul>
        </AlertDescription>
      </Alert>

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
          <MonacoHost
            v-else
            :doc="previewDoc"
            language="sql"
            :sql-dialect="sqlDialect"
            :read-only="true"
          />
        </div>
      </div>

      <Alert v-if="runError" variant="destructive" data-testid="generate-data-error">
        <CodiconIcon name="warning" :size="14" />
        <AlertDescription>{{ runError }}</AlertDescription>
      </Alert>
    </div>
      </div>

      <DialogFooter class="border-t border-border">
        <span class="flex items-center gap-1 ml-auto">
          <!-- P104 §3: RunState inlined -- status is always 'running' here (elapsedMs is always
               null, so the label is always the em dash RunState's own computed would give it). -->
          <Tooltip v-if="running">
            <TooltipTrigger as-child>
              <span class="inline-flex items-center gap-1 font-data text-kira-xs text-info">
                <span class="min-w-[7ch] text-right">—</span>
                <span
                  class="h-3 w-3 shrink-0 rounded-full border-2 border-t-primary border-r-transparent border-b-primary border-l-primary animate-kira-spin"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>{{ `${committedRows} / ${rowCount} rows committed` }}</TooltipContent>
          </Tooltip>
          <Button v-if="running" variant="dialog" size="kira-lg" data-testid="generate-data-stop" @click="onStop">
            Stop
          </Button>
          <template v-else>
            <Button variant="dialog" size="kira-lg" data-testid="generate-data-cancel" @click="onClose">
              Cancel
            </Button>
            <Button
              variant="dialog-primary"
              size="kira-lg"
              data-testid="generate-data-submit"
              :disabled="rowCount < 1 || noUsableColumns"
              @click="onGenerate"
            >
              Generate
            </Button>
          </template>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
@reference "@theme/base.css";

.generate-form {
  @apply flex flex-col;
  gap: var(--kira-s-4);
  padding: var(--kira-s-4) var(--kira-s-5);
}

.run-fields {
  @apply flex items-center;
  gap: var(--kira-s-3);
}

.field-label {
  @apply p-0;
}

.recipe-table {
  @apply flex flex-col overflow-y-auto max-h-64;
  gap: var(--kira-s-1);
}

.recipe-row {
  @apply grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-center;
  gap: var(--kira-s-2);
}

.recipe-head {
  @apply p-0;
}

.col-type {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}

.warning-list {
  @apply m-0;
  padding-left: var(--kira-s-4);
}

.preview-toggle {
  @apply bg-none border-none cursor-pointer p-0;
  color: var(--kira-accent);
}

.preview-toggle:disabled {
  @apply cursor-not-allowed;
  color: var(--kira-fg-muted);
}

.preview-body {
  @apply h-52;
  margin-top: var(--kira-s-2);
}

/* Alert tone classes replacing MessageStrip's own warn-tone colors (now --kira-warn-text/--kira-
   note-text in tokens.css, promoted off this rule's literal-hex carve-out). */
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-warn-text;
}
</style>
