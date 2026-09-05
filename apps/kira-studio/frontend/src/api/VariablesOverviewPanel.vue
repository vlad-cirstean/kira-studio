<script setup lang="ts">
import { computed, ref } from 'vue';
import { copyText } from '../clipboard';
import { connColorVar } from '../theme/connColor';
import EmptyState from '../theme/primitives/EmptyState.vue';
import PanelSearchBox from '../theme/primitives/PanelSearchBox.vue';
import PopoverPanel from '../theme/primitives/PopoverPanel.vue';
import { collectionRecord } from './state/collections';
import { overviewRows, type VariableOverviewRow, variablesState } from './state/variables';
import { openVariableSetTab } from './tabs';

// P17 D20/item 8: a read-only popover over the already-merged data (`overviewRows`) — one panel,
// reachable from any request tab (HttpRequestView.vue and GrpcRequestView.vue both mount this
// beside EnvironmentSelect in #toolbar-2), so a user never has to open the collection's or the
// environment's own tab just to check what a `{{name}}` in front of them resolves to right now.
//
// No reveal, at all (D20's own stated line): a secret's plaintext is not in the renderer to begin
// with (F3), and adding a third reveal surface after the row table and Copy as curl is exactly the
// surface-count growth P14's two rounds of findings were about. A secret row shows a `secret` chip
// and nothing else.
const props = defineProps<{ collectionId: string; environmentId: string }>();
const emit = defineEmits<{ close: [] }>();

const rows = computed<VariableOverviewRow[]>(() =>
  overviewRows(props.collectionId, props.environmentId),
);

// P16 D14's rule, restated here (D20): name-only, never value — a value-matching filter over a
// secret-carrying list is an oracle (P16's own §5), and that reasoning applies verbatim to a panel
// that merges secrets from two scopes at once.
const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');
const filteredRows = computed(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((row) => row.name.toLowerCase().includes(q));
});

function reference(name: string): string {
  return `{{${name}}}`;
}
function onCopy(name: string): void {
  void copyText(reference(name));
}

const collectionName = computed(() => collectionRecord(props.collectionId)?.name ?? '');
const environmentName = computed(
  () => variablesState.environments.find((e) => e.id === props.environmentId)?.name ?? '',
);
// P18 D17: the environment's own colour, beside "Edit environment variables…" — this panel
// already names the environment there (P17 D20).
const environmentColor = computed(
  () => variablesState.environments.find((e) => e.id === props.environmentId)?.color ?? 'none',
);

function close(): void {
  emit('close');
}

function editCollectionVariables(): void {
  if (!props.collectionId) return;
  openVariableSetTab('collection', props.collectionId, collectionName.value);
  close();
}
function editEnvironmentVariables(): void {
  if (!props.environmentId) return;
  openVariableSetTab('environment', props.environmentId, environmentName.value);
  close();
}
</script>

<template>
  <PopoverPanel :width="360" test-id="variables-overview" backdrop-test-id="variables-overview-backdrop" @close="close">
    <div class="overview-panel">
      <PanelSearchBox v-model="filterQuery" placeholder="Filter by name" testid="variables-overview-filter" />

      <div class="overview-list">
        <EmptyState
          v-if="isFiltered && filteredRows.length === 0"
          icon="search"
          label="No matches"
          data-testid="variables-overview-empty"
        />
        <EmptyState
          v-else-if="rows.length === 0"
          icon="symbol-variable"
          label="No variables in scope"
          data-testid="variables-overview-empty"
        />
        <div
          v-for="row in filteredRows"
          :key="`${row.scope}:${row.id}`"
          class="overview-row"
          :class="{ shadowed: row.shadowed }"
          data-testid="variables-overview-row"
          :data-scope="row.scope"
          :data-shadowed="row.shadowed"
        >
          <code
            class="reference"
            role="button"
            tabindex="0"
            v-tooltip="'Copy'"
            data-testid="variables-overview-name"
            @click="onCopy(row.name)"
            @keydown.enter="onCopy(row.name)"
            >{{ reference(row.name) }}</code
          >
          <span v-if="row.isSecret" class="p-chip warn" data-testid="variables-overview-secret">secret</span>
          <span v-else class="overview-value" data-testid="variables-overview-value">{{ row.value }}</span>
          <span
            class="p-chip scope-chip"
            :class="row.scope"
            v-tooltip="row.shadowed ? `Shadowed by an environment variable of the same name` : undefined"
            data-testid="variables-overview-scope"
            >{{ row.scope }}</span
          >
          <span v-if="row.description" class="overview-description" data-testid="variables-overview-description">{{
            row.description
          }}</span>
        </div>
      </div>

      <div class="overview-footer">
        <button
          type="button"
          class="overview-link"
          :disabled="!collectionId"
          data-testid="variables-overview-edit-collection"
          @click="editCollectionVariables"
        >
          Edit collection variables…
        </button>
        <button
          type="button"
          class="overview-link"
          :disabled="!environmentId"
          data-testid="variables-overview-edit-environment"
          @click="editEnvironmentVariables"
        >
          <span
            v-if="environmentId"
            class="p-conn-dot"
            :class="{ none: environmentColor === 'none' }"
            :style="{ '--kira-rail': connColorVar(environmentColor) }"
            data-testid="variables-overview-environment-dot"
          />
          Edit environment variables…
        </button>
      </div>
    </div>
  </PopoverPanel>
</template>

<style scoped>
.overview-panel {
  display: flex;
  flex-direction: column;
  max-height: 420px;
}

.overview-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: var(--kira-s-2);
  gap: var(--kira-s-1);
}

.overview-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-1) var(--kira-s-2);
  border-radius: var(--kira-radius-sm);
  min-width: 0;
}

.overview-row.shadowed {
  opacity: 0.5;
}

.reference {
  cursor: pointer;
  flex-shrink: 0;
}

.overview-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg-subtle);
}

.overview-description {
  flex-shrink: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
}

.scope-chip {
  flex-shrink: 0;
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
}
.scope-chip.environment {
  background: rgba(55, 148, 255, 0.16);
  color: var(--kira-info);
}

.overview-footer {
  display: flex;
  flex-direction: column;
  border-top: var(--kira-border-width) solid var(--kira-border);
  padding: var(--kira-s-2);
  gap: var(--kira-s-1);
}

.overview-link {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: var(--kira-s-2);
  cursor: pointer;
  color: var(--kira-info);
  font-size: var(--kira-t-sm);
}
.overview-link:disabled {
  cursor: default;
  color: var(--kira-fg-subtle);
  opacity: 0.6;
}
</style>
