<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { copyAndAnnounce } from '../../behaviour/clipboard';
import { formatCurrency, formatPercent } from '../../behaviour/format';
import { errorText } from '../../bridge/codedError';
import AddMemoryDialog from '../AddMemoryDialog.vue';
import { useImportUiStore } from '../import/importStore';
import { useDistillLimits, useDistillToImport } from './distillQueries';
import { useDistillUiStore } from './distillStore';

// P285 Part 4: a distill result — sizes before and after, the lines to pick from, and what to do
// with the pick: copy, store through the gate, or import as a document.
const ui = useDistillUiStore();
const { result, resultSource, selected } = storeToRefs(ui);
const imports = useImportUiStore();
const limits = useDistillLimits();
const toImport = useDistillToImport();
const storeOpen = ref(false);

const lines = computed(() => result.value?.lines ?? []);
const picked = computed(() => lines.value.filter((_, i) => selected.value.has(i)));
const allPicked = computed(
  () => lines.value.length > 0 && picked.value.length === lines.value.length,
);
const storeMax = computed(() => limits.data.value?.storeMaxLines ?? 0);
const overStore = computed(() => storeMax.value > 0 && picked.value.length > storeMax.value);
const importError = computed(() => (toImport.isError.value ? errorText(toImport.error.value) : ''));
const summary = computed(() => {
  const r = result.value;
  if (!r) return '';
  return `${t('memory.distill.result.summary.status', {
    inChars: r.inChars,
    outChars: r.outChars,
    percent: formatPercent(r.inChars > 0 ? (r.outChars / r.inChars) * 100 : 0),
    inTokens: r.inTokens,
    outTokens: r.outTokens,
    cost: formatCurrency(r.costUsd),
  })} · ${t('memory.distill.result.parts.label', { count: r.chunks })}`;
});

function toggle(index: number, on: boolean): void {
  const next = new Set(selected.value);
  if (on) next.add(index);
  else next.delete(index);
  selected.value = next;
}

function toggleAll(on: boolean): void {
  selected.value = on ? new Set(lines.value.keys()) : new Set();
}

function copy(): void {
  void copyAndAnnounce(
    picked.value.join('\n'),
    t('memory.distill.copy.announce', { count: picked.value.length }),
  );
}

function importDocument(): void {
  toImport.mutate(
    { lines: picked.value, source: resultSource.value },
    {
      onSuccess: (job) => {
        imports.confirmJobId = job.id;
      },
    },
  );
}
</script>

<template>
  <div v-if="result" class="flex flex-col gap-2" data-testid="distill-result">
    <FieldDescription data-testid="distill-summary">{{ summary }}</FieldDescription>
    <EmptyState
      v-if="lines.length === 0"
      icon="list-flat"
      :title="t('memory.distill.empty.title')"
      :description="t('memory.distill.empty.description')"
      data-testid="distill-empty"
    />
    <template v-else>
      <div class="flex items-center gap-1.5">
        <Checkbox
          id="distill-select-all"
          class="size-3.5"
          :model-value="allPicked"
          data-testid="distill-select-all"
          @update:model-value="(v) => toggleAll(v === true)"
        >
          <CodiconIcon name="check" :size="12" />
        </Checkbox>
        <Label for="distill-select-all">{{ t('memory.distill.selectAll.label') }}</Label>
      </div>
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        <li v-for="(line, i) in lines" :key="i" class="flex items-start gap-1.5">
          <Checkbox
            :id="`distill-line-${i}`"
            class="mt-0.5 size-3.5 shrink-0"
            :model-value="selected.has(i)"
            :aria-label="t('memory.distill.result.line.aria', { number: i + 1 })"
            :data-testid="`distill-line-${i}`"
            @update:model-value="(v) => toggle(i, v === true)"
          >
            <CodiconIcon name="check" :size="12" />
          </Checkbox>
          <Label
            :for="`distill-line-${i}`"
            class="text-kira-md font-normal whitespace-pre-wrap"
            :data-testid="`distill-text-${i}`"
            >{{
              line
            }}</Label
          >
        </li>
      </ul>
      <div class="flex flex-wrap items-center gap-1.5">
        <Button
          variant="toolbar"
          size="kira"
          :disabled="picked.length === 0"
          data-testid="distill-copy"
          @click="copy"
          >{{
            t('common.action.copy.label')
          }}</Button
        >
        <Button
          variant="toolbar"
          size="kira"
          :disabled="picked.length === 0 || overStore"
          data-testid="distill-store"
          @click="storeOpen = true"
          >{{
            t('memory.distill.store.label')
          }}</Button
        >
        <Button
          variant="toolbar"
          size="kira"
          :pending="toImport.isPending.value"
          :disabled="picked.length === 0"
          data-testid="distill-import"
          @click="importDocument"
          >{{
            t('memory.distill.import.label')
          }}</Button
        >
      </div>
      <FieldDescription v-if="overStore" data-testid="distill-store-limit">{{
        t('memory.distill.store.limit.hint', { max: storeMax })
      }}</FieldDescription>
      <Alert v-if="importError" variant="error" data-testid="distill-import-error">
        <AlertDescription>{{ importError }}</AlertDescription>
      </Alert>
    </template>
    <AddMemoryDialog
      v-if="storeOpen"
      :lines="picked"
      :source="resultSource"
      @close="storeOpen = false"
    />
  </div>
</template>
