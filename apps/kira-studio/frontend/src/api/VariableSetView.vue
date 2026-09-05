<script setup lang="ts">
import type { PaletteColor } from '@shared/domain/color';
import type { VariableSetTabRecord } from '@shared/domain/tabs';
import type { ApiVariable } from '@shared/domain/variables';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { connectionsState } from '../state/connections';
import AppButton from '../theme/primitives/AppButton.vue';
import ColorPicker from '../theme/primitives/ColorPicker.vue';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import PanelSearchBox from '../theme/primitives/PanelSearchBox.vue';
import TextField from '../theme/primitives/TextField.vue';
import ViewChrome from '../theme/primitives/ViewChrome.vue';
import BulkVariablesEditor from './BulkVariablesEditor.vue';
import { collectionRecord, collectionsState, initCollections } from './state/collections';
import {
  deleteVariable,
  duplicateEnvironment,
  initVariables,
  isDuplicateName,
  loadVariableSetRows,
  openHistoryMenu,
  reorderVariables,
  revealedValues,
  revealVariable,
  setVariableSetError,
  updateEnvironment,
  upsertVariable,
  variableSetError,
  variableSetRows,
  variablesState,
} from './state/variables';
import VariableRow from './VariableRow.vue';

// P17 D16: VariablesDialog.vue's own replacement — the exact same per-row draft/blur/reorder
// mechanics, re-hosted in a tab (ViewChrome) instead of a dialog (DialogFrame), keyed by `tab.id`
// (MainView.vue keys this component by it, so one instance <-> one tab, same discipline every
// other tab view already follows). `data-testid="variables-dialog"`/`"variables-filter"`/
// `"variables-error"` are kept byte-identical to the dialog's own — the row-level testids never
// changed at all (VariableRow.vue is untouched apart from D14's description cell) — so the
// existing http-variables.spec.ts/api-secret-reveal-isolation.spec.ts regression net passes with
// no edit.
const props = defineProps<{ tab: VariableSetTabRecord }>();

const scope = computed(() => props.tab.state.scope);
const ownerId = computed(() => props.tab.state.ownerId);

// D16: a restored tab whose owner no longer exists renders an EmptyState rather than an empty
// table (P4 D14's orphan posture) — gated on the owner list actually having loaded, so a
// freshly-mounted tab doesn't flash "no longer exists" before initCollections/initVariables ever
// resolve.
const ownersLoaded = computed(() =>
  scope.value === 'collection' ? collectionsState.loaded : variablesState.loaded,
);
const owningCollection = computed(() =>
  scope.value === 'collection' ? collectionRecord(ownerId.value) : undefined,
);
const owningEnvironment = computed(() =>
  scope.value === 'environment'
    ? variablesState.environments.find((e) => e.id === ownerId.value)
    : undefined,
);
const ownerExists = computed(() =>
  scope.value === 'collection' ? !!owningCollection.value : !!owningEnvironment.value,
);

onMounted(() => {
  initCollections();
  initVariables();
  void loadVariableSetRows(props.tab.id, scope.value, ownerId.value);
});

const rows = computed<ApiVariable[]>(() => variableSetRows(props.tab.id));
const error = computed(() => variableSetError(props.tab.id));

// ---- environment scope only: name + description + Duplicate (D16/D17) ----

const envNameDraft = ref('');
const envDescriptionDraft = ref('');
watch(
  owningEnvironment,
  (env) => {
    envNameDraft.value = env?.name ?? '';
    envDescriptionDraft.value = env?.description ?? '';
  },
  { immediate: true },
);
async function onEnvFieldBlur(): Promise<void> {
  const env = owningEnvironment.value;
  if (!env) return;
  const name = envNameDraft.value.trim();
  if (name === '') {
    envNameDraft.value = env.name;
    return;
  }
  if (name === env.name && envDescriptionDraft.value === env.description) return;
  // updateEnvironment writes name/description/color as one row update (D19) — color has its own
  // immediate handler below, so a name/description blur passes the environment's own current
  // colour through unchanged rather than defaulting it back to 'none'.
  await updateEnvironment(env.id, name, envDescriptionDraft.value, env.color);
}
// P18 D17/D19: a swatch click applies immediately, unlike name/description's blur-commit — a
// colour choice is a discrete action with its own visible feedback (the swatch's own selection
// ring), not text a user is still composing.
async function onEnvColorChange(color: PaletteColor): Promise<void> {
  const env = owningEnvironment.value;
  if (!env) return;
  await updateEnvironment(env.id, env.name, env.description, color);
}
async function onDuplicateEnvironment(): Promise<void> {
  if (owningEnvironment.value) await duplicateEnvironment(owningEnvironment.value.id);
}

// ---- the row table (VariablesDialog.vue's own mechanics, verbatim but tab-scoped) ----

interface Draft {
  name: string;
  value: string;
  isSecret: boolean;
  description: string;
}

const drafts = reactive<Record<string, Draft>>({});
const trailingDraft = reactive<Draft>({ name: '', value: '', isSecret: false, description: '' });
const order = ref<string[]>([]);

function syncDrafts(): void {
  for (const key of Object.keys(drafts)) delete drafts[key];
  for (const row of rows.value) {
    drafts[row.id] = {
      name: row.name,
      value: row.value,
      isSecret: row.isSecret,
      description: row.description,
    };
  }
  trailingDraft.name = '';
  trailingDraft.value = '';
  trailingDraft.isSecret = false;
  trailingDraft.description = '';
  order.value = rows.value.map((row) => row.id);
}
watch(rows, syncDrafts, { immediate: true });

watch(revealedValues, (values) => {
  for (const [id, value] of Object.entries(values)) {
    const draft = drafts[id];
    if (draft && draft.value === '') draft.value = value;
  }
});

const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');

const allRealRows = computed<ApiVariable[]>(() => {
  const byId = new Map(rows.value.map((row) => [row.id, row]));
  return order.value.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const draft = drafts[id] ?? {
      name: row.name,
      value: row.value,
      isSecret: row.isSecret,
      description: row.description,
    };
    return [
      {
        ...row,
        name: draft.name,
        value: draft.value,
        isSecret: draft.isSecret,
        description: draft.description,
      },
    ];
  });
});

const trailingRow = computed<ApiVariable>(() => ({
  id: '',
  scope: scope.value,
  ownerId: ownerId.value,
  name: trailingDraft.name,
  value: trailingDraft.value,
  isSecret: trailingDraft.isSecret,
  description: trailingDraft.description,
  sortOrder: allRealRows.value.length,
}));

const displayRows = computed<ApiVariable[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  const real = q
    ? allRealRows.value.filter((row) => row.name.toLowerCase().includes(q))
    : allRealRows.value;
  return [...real, trailingRow.value];
});

function duplicateFor(row: ApiVariable): boolean {
  const full = [...allRealRows.value, trailingRow.value];
  const idx = row.id === '' ? full.length - 1 : allRealRows.value.findIndex((r) => r.id === row.id);
  if (idx === -1) return false;
  return isDuplicateName(full, idx);
}

function draftFor(id: string): Draft {
  if (id === '') return trailingDraft;
  if (!drafts[id]) drafts[id] = { name: '', value: '', isSecret: false, description: '' };
  return drafts[id];
}

function onUpdateName(id: string, value: string): void {
  draftFor(id).name = value;
}
function onUpdateValue(id: string, value: string): void {
  draftFor(id).value = value;
}
function onUpdateDescription(id: string, value: string): void {
  draftFor(id).description = value;
}

async function commitDraft(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    if (draft.name.trim() === '') return;
    const { value, isSecret, description } = draft;
    const name = draft.name.trim();
    trailingDraft.name = '';
    trailingDraft.value = '';
    trailingDraft.isSecret = false;
    trailingDraft.description = '';
    await upsertVariable(props.tab.id, scope.value, ownerId.value, {
      id: '',
      name,
      value,
      isSecret,
      description,
    });
    return;
  }
  const row = rows.value.find((r) => r.id === id);
  if (!row) return;
  if (draft.name.trim() === '') {
    draft.name = row.name;
    return;
  }
  await upsertVariable(props.tab.id, scope.value, ownerId.value, {
    id,
    name: draft.name.trim(),
    value: draft.value,
    isSecret: draft.isSecret,
    description: draft.description,
  });
}

async function onBlur(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    await commitDraft(id);
    return;
  }
  const row = rows.value.find((r) => r.id === id);
  if (!row) return;
  if (draft.name.trim() === '') {
    draft.name = row.name;
    return;
  }
  if (
    draft.name === row.name &&
    draft.value === row.value &&
    draft.isSecret === row.isSecret &&
    draft.description === row.description
  )
    return;
  await commitDraft(id);
}

function onRevealError(message: string): void {
  setVariableSetError(props.tab.id, message);
}

async function onUpdateSecret(id: string, checked: boolean): Promise<void> {
  const draft = draftFor(id);
  if (checked) {
    draft.isSecret = true;
    await commitDraft(id);
    return;
  }
  if (id !== '') {
    const value = await revealVariable(id, onRevealError);
    if (value === undefined) return;
    draft.value = value;
  }
  draft.isSecret = false;
  await commitDraft(id);
}

function onReveal(id: string): void {
  void revealVariable(id, onRevealError);
}

const dragIndex = ref<number | null>(null);

function onDragStart(index: number): void {
  if (isFiltered.value) return;
  dragIndex.value = index;
}
function onDragOver(index: number): void {
  if (isFiltered.value) return;
  const from = dragIndex.value;
  if (from === null || from === index || index >= order.value.length) return;
  const next = [...order.value];
  const [moved] = next.splice(from, 1);
  next.splice(index, 0, moved);
  order.value = next;
  dragIndex.value = index;
}
async function onDragEnd(): Promise<void> {
  if (isFiltered.value) {
    dragIndex.value = null;
    return;
  }
  dragIndex.value = null;
  await reorderVariables(props.tab.id, scope.value, ownerId.value, order.value);
}

async function onMove(id: string, direction: 'up' | 'down'): Promise<void> {
  if (isFiltered.value) return;
  const from = order.value.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= order.value.length) return;
  const next = [...order.value];
  [next[from], next[to]] = [next[to], next[from]];
  order.value = next;
  await reorderVariables(props.tab.id, scope.value, ownerId.value, order.value);
}

async function onRemove(id: string): Promise<void> {
  if (id === '') return;
  await deleteVariable(props.tab.id, scope.value, ownerId.value, id);
}

function onHistoryClickFor(row: ApiVariable): void {
  void openHistoryMenu(props.tab.id, scope.value, ownerId.value, row.id);
}

// ---- bulk `.env` mode (R11, item 5) ----
//
// A component-local lens, not tab state (D16's "a lens, not a setting" rule, same as filterQuery
// above): reopening this tab must never silently resurrect an unapplied text buffer. `v-if` below
// (not `v-show`) is load-bearing — it means BulkVariablesEditor is freshly mounted every time bulk
// mode is entered, so its own baseline snapshot is always taken from the rows the table holds *at
// that moment*, never a stale one from an earlier visit.
const bulkMode = ref(false);
function onBulkClose(): void {
  bulkMode.value = false;
}
</script>

<template>
  <div class="variable-set-view" data-testid="variables-dialog" :data-scope="scope">
    <ViewChrome
      :tab="tab"
      :icon="scope === 'environment' ? 'settings-gear' : 'symbol-variable'"
      :name="tab.state.name || 'Variables'"
      :can-refresh="false"
      :can-stop="false"
      target-testid="variable-set-target"
      :env-color="scope === 'environment' ? (owningEnvironment?.color ?? 'none') : undefined"
    >
      <template #toolbar-2>
        <PanelSearchBox
          v-if="!bulkMode"
          v-model="filterQuery"
          placeholder="Filter by name"
          testid="variables-filter"
        />
        <IconButton
          v-if="ownerExists"
          icon="code"
          :active="bulkMode"
          aria-label="Edit as .env text"
          v-tooltip="'Edit as .env text'"
          data-testid="variables-bulk-toggle"
          @click="bulkMode = !bulkMode"
        />
      </template>

      <EmptyState
        v-if="ownersLoaded && !ownerExists"
        icon="warning"
        label="This variable set no longer exists"
        data-testid="variable-set-orphan"
      />
      <BulkVariablesEditor
        v-else-if="bulkMode"
        :tab-id="tab.id"
        :scope="scope"
        :owner-id="ownerId"
        :rows="rows"
        @close="onBulkClose"
      />
      <div v-else class="p-dialog-body list">
        <MessageStrip v-if="error" tone="err" data-testid="variables-error">
          {{ error }}
        </MessageStrip>
        <MessageStrip
          v-else-if="connectionsState.secretStorage && !connectionsState.secretStorage.available"
          tone="warn"
          data-testid="variables-secrets-unavailable"
        >
          {{ connectionsState.secretStorage.reason }}
        </MessageStrip>

        <div v-if="scope === 'environment' && owningEnvironment" class="env-fields">
          <TextField
            v-model="envNameDraft"
            placeholder="name"
            data-testid="environment-name"
            @blur="onEnvFieldBlur"
          />
          <TextField
            v-model="envDescriptionDraft"
            placeholder="description"
            data-testid="environment-description"
            @blur="onEnvFieldBlur"
          />
          <ColorPicker
            :model-value="owningEnvironment.color"
            label="Environment color"
            data-testid="environment-color-picker"
            @update:model-value="onEnvColorChange"
          />
          <AppButton data-testid="environment-duplicate" @click="onDuplicateEnvironment">
            Duplicate
          </AppButton>
        </div>

        <div class="header-row">
          <span class="cell">Name</span>
          <span class="cell">Value</span>
          <span class="cell">Description</span>
        </div>
        <VariableRow
          v-for="(row, i) in displayRows"
          :key="row.id || 'trailing'"
          :row="row"
          :index="i"
          :dragging="dragIndex === i"
          :duplicate="duplicateFor(row)"
          :trailing="row.id === ''"
          :filtered="isFiltered"
          :secrets-unavailable="!!connectionsState.secretStorage && !connectionsState.secretStorage.available"
          @update:name="onUpdateName(row.id, $event)"
          @update:value="onUpdateValue(row.id, $event)"
          @update:is-secret="onUpdateSecret(row.id, $event)"
          @update:description="onUpdateDescription(row.id, $event)"
          @blur="onBlur(row.id)"
          @remove="onRemove(row.id)"
          @reveal="onReveal(row.id)"
          @history="onHistoryClickFor(row)"
          @dragstart="onDragStart"
          @dragover="onDragOver"
          @dragend="onDragEnd"
          @move="onMove(row.id, $event)"
        />
      </div>
    </ViewChrome>
  </div>
</template>

<style scoped>
.variable-set-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.p-dialog-body.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.env-fields {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.header-row {
  display: flex;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-sm);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.header-row .cell {
  flex: 1;
}
</style>
