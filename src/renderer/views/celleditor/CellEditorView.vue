<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { computed, ref, watch } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import { cellKey, cellSelectionState } from '../../state/cellSelection';
import { connectionsState } from '../../state/connections';
import Codicon from '../../theme/Codicon.vue';
import EmptyState from '../../workbench/panels/EmptyState.vue';
import { toggleCellEditorPanel } from '../../workbench/state/layout';
import { type BeautifyMode, beautify } from './beautify';
import { describeValue, detectFormat, type FormatGuess } from './detect';
import {
  CELL_FORMATS,
  type CellFormat,
  canBeautify,
  FORMAT_LABEL,
  FORMAT_LANGUAGE,
} from './formats';
import { overrideFor, readOnlyReasonFor, setOverride } from './state';

const cell = computed(() => cellSelectionState.current);

const override = computed<CellFormat | null>(() => (cell.value ? overrideFor(cell.value) : null));

const isNullValue = computed(() => cell.value !== null && cell.value.value === null);
const isEmptyValue = computed(() => cell.value !== null && cell.value.value === '');
const isTruncatedValue = computed(() => cell.value?.truncated ?? false);

// §5a: a NULL value runs no detector at all.
const detected = computed<FormatGuess[]>(() => {
  const c = cell.value;
  if (!c || c.value === null) return [];
  return detectFormat({
    text: c.value,
    typeClass: c.column.typeClass,
    dataType: c.column.dataType,
    columnName: c.column.name,
  });
});
const detectedFormat = computed<CellFormat>(() => detected.value[0]?.format ?? 'text');
const detectedReason = computed<string>(() => detected.value[0]?.reason ?? '');

const effectiveFormat = computed<CellFormat>(() => override.value ?? detectedFormat.value);
const language = computed<EditorLanguageId>(() => FORMAT_LANGUAGE[effectiveFormat.value]);

const sqlDialect = computed<'postgres' | 'mariadb' | undefined>(() => {
  const c = cell.value;
  if (!c?.connectionId) return undefined;
  const record = connectionsState.records.find((r) => r.id === c.connectionId);
  return record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined;
});

const readOnlyReason = computed(() =>
  cell.value ? readOnlyReasonFor(cell.value) : 'not-editable-yet',
);
const readOnlyChipText = computed(() =>
  readOnlyReason.value === 'connection-read-only'
    ? 'Connection is read-only'
    : 'Read-only in this version',
);
const readOnlyChipTitle = computed(() =>
  readOnlyReason.value === 'connection-read-only'
    ? undefined
    : 'Editing a cell stages a pending change; that arrives in a later version.',
);

// The display buffer (D6): what Beautify/Reset act on. Never the stored value itself, which
// stays reachable through `cell.value.value` for Reset.
const doc = ref('');
const formatted = ref<'none' | 'indented' | 'compact'>('none');
const beautifyFailure = ref<string | null>(null);

let lastKey: string | null = null;
let lastValue: string | null = null;

// Populate path (§2.1's 50 ms budget): a republication of the same cell with the same value is
// a no-op — a background page refresh must not silently undo a user's beautify. Changing the
// format override recomputes `effectiveFormat`/`language` above without touching this watch.
watch(
  cell,
  (c) => {
    if (!c) {
      lastKey = null;
      lastValue = null;
      return;
    }
    const key = cellKey(c);
    if (key === lastKey && c.value === lastValue) return;
    lastKey = key;
    lastValue = c.value;
    doc.value = c.value ?? '';
    formatted.value = 'none';
    beautifyFailure.value = null;
  },
  { immediate: true },
);

const beautifyDisabledTitle = computed<string | undefined>(() =>
  canBeautify(effectiveFormat.value)
    ? undefined
    : 'Indented and compact formatting apply to JSON and XML/HTML.',
);
const resetDisabledTitle = computed<string | undefined>(() =>
  formatted.value === 'none' ? 'Already showing the stored value.' : undefined,
);

function applyBeautify(mode: BeautifyMode): void {
  const c = cell.value;
  if (!c || c.value === null || !canBeautify(effectiveFormat.value)) return;
  if (formatted.value === mode) return; // pressing the same button twice is a no-op
  const result = beautify(c.value, effectiveFormat.value, mode);
  if (result.ok) {
    doc.value = result.text;
    formatted.value = mode;
    beautifyFailure.value = null;
  } else {
    // §6c: a failed beautify leaves the buffer and `formatted` alone.
    beautifyFailure.value = result.reason ?? 'beautify failed';
  }
}

function resetBuffer(): void {
  const c = cell.value;
  if (!c) return;
  doc.value = c.value ?? '';
  formatted.value = 'none';
  beautifyFailure.value = null;
}

function onFormatSelect(e: Event): void {
  const c = cell.value;
  if (!c) return;
  const value = (e.target as HTMLSelectElement).value;
  setOverride(c, value === 'auto' ? null : (value as CellFormat));
}

const targetLabel = computed(() => {
  const c = cell.value;
  if (!c) return '';
  const tail = pathTail(c.path);
  return `${tail?.name ?? c.path}.${c.column.name}`;
});

const statusLine = computed(() => {
  const c = cell.value;
  if (!c) return '';
  if (isNullValue.value) return 'NULL';
  const value = c.value ?? '';
  const parts: string[] = [];
  parts.push(
    override.value
      ? `${FORMAT_LABEL[effectiveFormat.value]} (manual)`
      : `detected ${FORMAT_LABEL[effectiveFormat.value]}`,
  );
  parts.push(`${new TextEncoder().encode(value).length} bytes`);
  const reading = describeValue(effectiveFormat.value, value);
  if (reading) parts.push(reading);
  if (isTruncatedValue.value) parts.push('showing the first 64 KB');
  if (beautifyFailure.value) parts.push(beautifyFailure.value);
  return parts.join(' · ');
});
</script>

<template>
  <EmptyState v-if="!cell" icon="edit" label="No cell selected" data-testid="cell-editor-empty" />
  <div
    v-else
    class="cell-editor"
    data-testid="cell-editor-panel"
    :data-cell-key="cellKey(cell)"
    :data-format="effectiveFormat"
    :data-detected="detectedFormat"
    :data-read-only-reason="readOnlyReason"
    :data-formatted="formatted"
  >
    <div class="header">
      <span class="target-group">
        <span class="target" data-testid="cell-editor-target">{{ targetLabel }} · row {{ cell.row + 1 }}</span>
        <span class="type-pill">{{ cell.column.dataType }}</span>
      </span>
      <span v-if="isNullValue" class="badge" data-testid="cell-editor-badge-null">NULL</span>
      <span v-if="isEmptyValue" class="badge" data-testid="cell-editor-badge-empty">empty</span>
      <span v-if="isTruncatedValue" class="badge" data-testid="cell-editor-badge-truncated">truncated</span>

      <span class="spacer" />

      <select
        class="format-select"
        data-testid="cell-editor-format"
        :disabled="isNullValue"
        :value="override ?? 'auto'"
        :title="detectedReason"
        @change="onFormatSelect"
      >
        <option value="auto">Auto — {{ FORMAT_LABEL[detectedFormat] }}</option>
        <option v-for="f in CELL_FORMATS" :key="f" :value="f">{{ FORMAT_LABEL[f] }}</option>
      </select>

      <button
        type="button"
        class="icon-button"
        data-testid="cell-editor-beautify-indented"
        :disabled="!canBeautify(effectiveFormat)"
        :title="beautifyDisabledTitle"
        @click="applyBeautify('indented')"
      >
        <Codicon name="list-tree" :size="14" />
      </button>
      <button
        type="button"
        class="icon-button"
        data-testid="cell-editor-beautify-compact"
        :disabled="!canBeautify(effectiveFormat)"
        :title="beautifyDisabledTitle"
        @click="applyBeautify('compact')"
      >
        <Codicon name="list-flat" :size="14" />
      </button>
      <button
        type="button"
        class="icon-button"
        data-testid="cell-editor-beautify-reset"
        :disabled="formatted === 'none'"
        :title="resetDisabledTitle"
        @click="resetBuffer"
      >
        <Codicon name="discard" :size="14" />
      </button>

      <span class="read-only-chip" :title="readOnlyChipTitle">
        <Codicon name="lock" :size="12" />
        {{ readOnlyChipText }}
      </span>

      <button
        type="button"
        class="icon-button"
        data-testid="cell-editor-collapse"
        title="Hide cell editor"
        @click="toggleCellEditorPanel"
      >
        <Codicon name="chevron-down" :size="14" />
      </button>
    </div>

    <div class="editor-body">
      <CodeMirrorHost :doc="doc" :language="language" :sql-dialect="sqlDialect" :read-only="true" />
    </div>

    <div class="status-line" data-testid="cell-editor-status">{{ statusLine }}</div>
  </div>
</template>

<style scoped>
.cell-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 11px;
  flex-shrink: 0;
}

.target-group {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  min-width: 32px;
}

.target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg);
  font-weight: 600;
  min-width: 0;
}

.type-pill {
  padding: 1px 5px;
  border-radius: var(--kira-radius);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  font-weight: 400;
  font-size: 10px;
  flex-shrink: 0;
}

.badge {
  padding: 1px 5px;
  border-radius: var(--kira-radius);
  background: var(--kira-badge);
  color: var(--kira-fg);
  font-size: 10px;
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.format-select {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  padding: 2px 4px;
  font-size: 11px;
  max-width: 160px;
}

.format-select:disabled {
  color: var(--kira-fg-disabled);
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: var(--kira-radius);
  color: var(--kira-fg-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.icon-button:hover:not(:disabled) {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.icon-button:disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

.read-only-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: var(--kira-radius);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  font-size: 10px;
  flex-shrink: 0;
  white-space: nowrap;
}

.editor-body {
  flex: 1;
  min-height: 0;
}

.status-line {
  padding: 3px 8px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: 10px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
