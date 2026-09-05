<script setup lang="ts">
import { DYNAMIC_NAMES, FAKE_NAMES, loadDynamicGenerator } from '@kira/api-core';
import { computed, onMounted, reactive, ref } from 'vue';
import { copyText } from '../clipboard';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import EmptyState from '../theme/primitives/EmptyState.vue';
import PanelSearchBox from '../theme/primitives/PanelSearchBox.vue';
import { closeDynamicValuesDialog } from './state/dynamicValues';

// P6 D11: a read-only discovery surface for the dynamic-value catalogue — nothing here edits,
// saves, or reaches Go. `catalog.ts` carries names only (no description strings, D11: "the sample
// is the description" — a generated example says more precisely what Postman's own docs would in
// a sentence, for one call to a record this dialog is loading anyway).
const samples = reactive<Record<string, string>>({});

// P17 D12: both vocabularies, `fake.` names first — the namespace this app wants a user to reach
// for first, with the Postman `$name` spellings listed after and tagged `postman alias` so it is
// visible, not hidden, that they are two spellings of the same catalogue rather than two
// catalogues. Neither list is rewritten or migrated (D12) — this dialog only ever reads them.
interface CatalogueEntry {
  name: string;
  isAlias: boolean;
}
const ALL_ENTRIES: CatalogueEntry[] = [
  ...FAKE_NAMES.map((name): CatalogueEntry => ({ name, isAlias: false })),
  ...DYNAMIC_NAMES.map((name): CatalogueEntry => ({ name, isAlias: true })),
];

// D11: awaits loadDynamicGenerator() on open — a user-initiated action, exactly like *Generate
// data…*'s own first open, and the same memoised promise a send would use. One sample per name,
// freshly generated every time the dialog opens (closing and reopening shows a different one).
// `generate` already accepts either spelling (generators.ts's own D12 dispatch).
onMounted(async () => {
  const generate = await loadDynamicGenerator();
  for (const entry of ALL_ENTRIES) {
    samples[entry.name] = generate(entry.name) ?? '';
  }
});

function reference(name: string): string {
  return `{{${name}}}`;
}

// P16 D15: matches the name or its generated sample — a filter over the flat, merged list.
const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');
const filteredEntries = computed(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return ALL_ENTRIES;
  return ALL_ENTRIES.filter(
    (entry) =>
      entry.name.toLowerCase().includes(q) || (samples[entry.name] ?? '').toLowerCase().includes(q),
  );
});

function onCopy(name: string): void {
  void copyText(reference(name));
}

function close(): void {
  closeDynamicValuesDialog();
}
</script>

<template>
  <DialogFrame
    title="Dynamic values"
    :width="480"
    max-height="80vh"
    test-id="dynamic-values-dialog"
    close-test-id="dynamic-values-dialog-close"
    @close="close"
  >
    <div class="p-dialog-body list dynamic-values-body">
      <PanelSearchBox v-model="filterQuery" placeholder="Filter" testid="dynamic-values-filter" />
      <EmptyState
        v-if="isFiltered && filteredEntries.length === 0"
        icon="search"
        label="No matches"
        data-testid="dynamic-values-filter-empty"
      />
      <div
        v-for="entry in filteredEntries"
        :key="entry.name"
        class="p-row dynamic-values-row"
        :data-testid="entry.isAlias ? 'dynamic-values-row' : 'dynamic-values-fake-row'"
        :data-name="entry.name"
        role="button"
        tabindex="0"
        v-tooltip="'Copy'"
        @click="onCopy(entry.name)"
        @keydown.enter="onCopy(entry.name)"
      >
        <code class="reference" data-testid="dynamic-values-reference">{{
          reference(entry.name)
        }}</code>
        <span
          v-if="entry.isAlias"
          class="p-chip"
          style="background: var(--kira-bg-input); color: var(--kira-fg-muted)"
          data-testid="dynamic-values-alias"
          >postman alias</span
        >
        <span class="p-chip info sample" data-testid="dynamic-values-sample">{{
          samples[entry.name] ?? ''
        }}</span>
      </div>
    </div>

    <template #footer>
      <span class="p-dialog-actions end">
        <AppButton kind="dialog" data-testid="dynamic-values-close" @click="close">Close</AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
/* p-dialog-body.list supplies display/flex-direction/padding/gap; this body also needs to scroll
   within the dialog's own fixed max-height. */
.dynamic-values-body {
  overflow-y: auto;
}

.dynamic-values-row {
  justify-content: space-between;
  height: auto;
  min-height: var(--kira-h-md);
  padding: var(--kira-s-2) var(--kira-s-3);
}

.reference {
  font-family: var(--kira-font-family);
  color: var(--kira-fg);
  flex-shrink: 0;
}

.sample {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
