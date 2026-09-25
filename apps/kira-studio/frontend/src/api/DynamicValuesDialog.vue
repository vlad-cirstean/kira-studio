<script setup lang="ts">
import { FAKE_NAMES, loadDynamicGenerator } from '@kira/api-core';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Empty, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { copyText } from '@workbench/util/clipboard';
import { computed, onMounted, reactive, ref } from 'vue';
import { useDynamicValuesStore } from './state/dynamicValues';

const dynamicValuesStore = useDynamicValuesStore();

// P6 D11: a read-only discovery surface for the dynamic-value catalogue — nothing here edits,
// saves, or reaches Go. `catalog.ts` carries names only (no description strings, D11: "the sample
// is the description" — a generated example says more precisely what Postman's own docs would in
// a sentence, for one call to a record this dialog is loading anyway).
const samples = reactive<Record<string, string>>({});

// P28 D15(b): one vocabulary. P17 D12 listed the Postman `$name` spellings after the `fake.` ones,
// tagged `postman alias`; this dialog is the app's own reference sheet for what to type, so it now
// teaches only the spelling the app offers. The `$name` catalogue is unchanged and still resolves —
// it is simply no longer taught, and a Postman import rewrites what it can up front.
interface CatalogueEntry {
  name: string;
}
const ALL_ENTRIES: CatalogueEntry[] = FAKE_NAMES.map((name): CatalogueEntry => ({ name }));

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
  dynamicValuesStore.closeDynamicValuesDialog();
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && close()">
    <DialogContent
      :show-close-button="false"
      data-testid="dynamic-values-dialog"
      class="flex flex-col p-0 gap-0 w-120 max-h-4/5"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Dynamic values</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="dynamic-values-dialog-close"
            @click="close"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="overflow-auto">
    <div class="flex flex-col gap-0.5 p-1 overflow-y-auto">
      <InputGroup>
        <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
        <InputGroupInput v-model="filterQuery" placeholder="Filter" data-testid="dynamic-values-filter" />
        <InputGroupAddon v-if="filterQuery" align="inline-end">
          <InputGroupButton aria-label="Clear filter" @click="filterQuery = ''">
            <CodiconIcon name="close" :size="13" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <Empty
        v-if="isFiltered && filteredEntries.length === 0"
        data-testid="dynamic-values-filter-empty"
      >
        <EmptyMedia><CodiconIcon name="search" :size="24" /></EmptyMedia>
        <EmptyTitle>No matches</EmptyTitle>
      </Empty>
      <Tooltip v-for="entry in filteredEntries" :key="entry.name">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="h-auto flex items-center justify-between gap-1 px-1.5 py-1 min-h-6.5 rounded-kira-sm text-fg text-kira-md cursor-pointer hover:bg-hover w-full border-0 text-left"
            data-testid="dynamic-values-fake-row"
            :data-name="entry.name"
            @click="onCopy(entry.name)"
          >
            <code class="shrink-0 text-fg font-data" data-testid="dynamic-values-reference">{{
              reference(entry.name)
            }}</code>
            <Badge variant="info" class="min-w-0 overflow-hidden text-ellipsis" data-testid="dynamic-values-sample">{{
              samples[entry.name] ?? ''
            }}</Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent>Copy</TooltipContent>
      </Tooltip>
    </div>
      </div>

      <DialogFooter class="border-t border-border bg-transparent">
        <span class="flex items-center gap-1.5 justify-end w-full">
          <Button variant="dialog" size="kira-lg" data-testid="dynamic-values-close" @click="close">Close</Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
