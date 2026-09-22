<script setup lang="ts">
import { connColorVar } from '@theme/connColor';
import EmptyState from '@theme/primitives/EmptyState.vue';
import PanelSearchBox from '@theme/primitives/PanelSearchBox.vue';
import { computed, ref } from 'vue';
import { copyText } from '../clipboard';
import PopoverPanel from '../theme/primitives/PopoverPanel.vue';
import { useCollectionsStore } from './state/collections';
import { useVariableSetStore, useVariablesStore, type VariableOverviewRow } from './state/variables';
import { openVariableSetTab } from './tabs';

const collectionsStore = useCollectionsStore();
const variablesStore = useVariablesStore();
const variableSetStore = useVariableSetStore();

// P17 D20/item 8: a read-only popover over the already-merged data (`overviewRows`) — one panel,
// reachable from any request tab (HttpRequestView.vue and GrpcRequestView.vue both mount this
// beside EnvironmentSelect in #toolbar-2), so a user never has to open the collection's or the
// environment's own tab just to check what a `{{name}}` in front of them resolves to right now.
//
// No reveal, at all (D20's own stated line): a secret's plaintext is not in the renderer to begin
// with (F3), and adding a third reveal surface after the row table and Copy as curl is exactly the
// surface-count growth P14's two rounds of findings were about. A secret row shows a `secret` chip
// and nothing else.
// P71 §3.4: `canEdit` defaults true (every existing caller renders byte-identically) — an
// incognito tab passes false, hiding the two Edit buttons below (the only route out of the tab
// into a persisting editor) while leaving the panel itself fully readable, as it already is by
// design.
const props = withDefaults(
  defineProps<{ collectionId: string; environmentId: string; canEdit?: boolean }>(),
  { canEdit: true },
);
const emit = defineEmits<{ close: [] }>();

const rows = computed<VariableOverviewRow[]>(() =>
  variableSetStore.overviewRows(props.collectionId, props.environmentId),
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

const collectionName = computed(() => collectionsStore.collectionRecord(props.collectionId)?.name ?? '');
const environmentName = computed(
  () => variablesStore.environments.find((e) => e.id === props.environmentId)?.name ?? '',
);
// P18 D17: the environment's own colour, beside "Edit environment variables…" — this panel
// already names the environment there (P17 D20).
const environmentColor = computed(
  () => variablesStore.environments.find((e) => e.id === props.environmentId)?.color ?? 'none',
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
  <PopoverPanel :width="360" anchor="left" test-id="variables-overview" backdrop-test-id="variables-overview-backdrop" @close="close">
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
          v-if="canEdit"
          type="button"
          class="overview-link"
          :disabled="!collectionId"
          data-testid="variables-overview-edit-collection"
          @click="editCollectionVariables"
        >
          Edit collection variables…
        </button>
        <button
          v-if="canEdit"
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
@reference "@theme/base.css";

.overview-panel {
  @apply flex max-h-[420px] flex-col;
}

.overview-list {
  @apply flex flex-col gap-[var(--kira-s-1)] overflow-y-auto p-[var(--kira-s-2)];
}

/* P22b D9: VariableRow.vue's own grid template, minus the columns a read-only popover has no use
   for (handle, secret toggle, history, remove) — name, value, scope, description, in the DOM
   order below. `description` is the last column specifically because it is the only one of the
   four that renders conditionally (F13/D9): a missing trailing grid item just leaves its own cell
   empty rather than shifting `scope` into its place, which an *earlier* optional column would. */
.overview-row {
  grid-template-columns: 1.2fr 2fr auto 1.5fr;
  @apply grid min-w-0 items-center gap-[var(--kira-s-2)] rounded-kira-sm px-[var(--kira-s-2)] py-[var(--kira-s-1)];
}

.overview-row.shadowed {
  @apply opacity-50;
}

.reference {
  @apply min-w-0 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap;
}

.overview-value {
  @apply min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-subtle;
}

.overview-description {
  @apply min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-subtle text-[length:var(--kira-t-xs)];
}

.scope-chip {
  @apply justify-self-start bg-input text-muted;
}
.scope-chip.environment {
  background: rgba(55, 148, 255, 0.16);
  @apply text-info;
}

.overview-footer {
  @apply flex flex-col gap-[var(--kira-s-1)] border-t border-border p-[var(--kira-s-2)];
}

.overview-link {
  all: unset;
  @apply inline-flex cursor-pointer items-center gap-[var(--kira-s-2)] text-info text-[length:var(--kira-t-sm)];
}
.overview-link:disabled {
  @apply cursor-default text-subtle opacity-60;
}
</style>
