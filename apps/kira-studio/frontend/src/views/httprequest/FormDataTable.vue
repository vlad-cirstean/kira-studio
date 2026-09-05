<script setup lang="ts">
import type { HttpFormDataFieldState } from '@shared/domain/http';
import { contentTypeForFilename } from '@shared/domain/object-store';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { patchHttpRequestTabState } from '../../api/tabs';
import { formatBytes } from '../../format';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import FieldRowsTable from './FieldRowsTable.vue';
import { chooseBodyFile } from './files';

// P3 C8/D4/D15: form-data over C6's shared table, with real file fields. D4's whole point: a
// picked file's bytes never reach here — chooseBodyFile returns only {path, name, size}, and only
// `path` (D8's own `path`/`fileName`/`fileSize` fields) ever lands in state or on the wire.
const props = defineProps<{ tab: HttpRequestTabRecord }>();

function blankField(): HttpFormDataFieldState {
  return {
    name: '',
    kind: 'text',
    value: '',
    path: '',
    fileName: '',
    fileSize: 0,
    contentType: '',
    enabled: true,
  };
}

function onUpdateRows(formData: HttpFormDataFieldState[]): void {
  patchHttpRequestTabState(props.tab.id, { formData });
}

function updateRow(index: number, patch: Partial<HttpFormDataFieldState>): void {
  const rows = props.tab.state.formData;
  const next = [...rows];
  if (index === next.length) next.push(blankField());
  next[index] = { ...next[index], ...patch };
  patchHttpRequestTabState(props.tab.id, { formData: next });
}

function onKindChange(index: number, e: Event): void {
  const kind = (e.target as HTMLSelectElement).value as 'text' | 'file';
  updateRow(index, { kind });
}

// D4: chooseBodyFile is Go's own picker, wrapped once (files.ts) — the result never carries the
// file's bytes, only {path, name, size}. contentTypeForFilename prefills the per-part override
// from the same small extension table UploadObjectDialog.vue already uses (object-store.ts).
async function onChooseFile(index: number): Promise<void> {
  const file = await chooseBodyFile('Choose file');
  if (!file) return;
  updateRow(index, {
    path: file.path,
    fileName: file.name,
    fileSize: file.size,
    contentType: contentTypeForFilename(file.name),
  });
}

function onClearFile(index: number): void {
  updateRow(index, { path: '', fileName: '', fileSize: 0 });
}
</script>

<template>
  <FieldRowsTable
    :rows="tab.state.formData"
    :blank-row="blankField"
    show-enabled
    name-placeholder="key"
    value-placeholder="value"
    testid-prefix="http-formdata"
    container-testid="http-formdata-table"
    @update:rows="onUpdateRows"
  >
    <template #value="{ row, update }">
      <div class="field-cell">
        <TextField
          v-if="row.kind === 'text'"
          :model-value="row.value"
          placeholder="value"
          data-testid="http-formdata-value"
          @update:model-value="update"
        />
      </div>
    </template>

    <template #trailing="{ row, index }">
      <select
        class="p-select bordered kind-select"
        data-testid="http-formdata-kind"
        :value="row.kind"
        @change="onKindChange(index, $event)"
      >
        <option value="text">Text</option>
        <option value="file">File</option>
      </select>
      <template v-if="row.kind === 'file'">
        <AppButton data-testid="http-formdata-choose-file" @click="onChooseFile(index)">
          Choose file…
        </AppButton>
        <span v-if="row.fileName" class="p-xs muted formdata-file-caption" data-testid="http-formdata-file-caption">
          {{ row.fileName }} ({{ formatBytes(row.fileSize) }})
        </span>
        <IconButton
          v-if="row.fileName"
          icon="close"
          v-tooltip="'Clear file'"
          data-testid="http-formdata-clear-file"
          @click="onClearFile(index)"
        />
        <div class="field-cell">
          <TextField
            :model-value="row.contentType"
            placeholder="Content type"
            data-testid="http-formdata-content-type"
            @update:model-value="(v) => updateRow(index, { contentType: v })"
          />
        </div>
      </template>
    </template>
  </FieldRowsTable>
</template>

<style scoped>
/* Vue scoped CSS attributes slotted content with the *passing* component's scope id, not
   FieldRowsTable's — so its own .field-cell rule doesn't reach these slots; repeated here. */
.field-cell {
  flex: 1;
  min-width: 0;
}

.formdata-file-caption {
  white-space: nowrap;
  padding: 0;
}

/* .p-select.bordered defaults to --kira-h-md (26px) — taller than the 22px TextFields/
   IconButtons beside it in this .field-row; match --kira-h-sm like CellEditorView.vue's own
   .format-select does. */
.kind-select {
  height: var(--kira-h-sm);
}
</style>
