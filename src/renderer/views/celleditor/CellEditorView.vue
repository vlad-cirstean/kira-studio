<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { computed, ref, watch } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import { cellKey, cellSelectionState } from '../../state/cellSelection';
import { connectionsState } from '../../state/connections';
import Codicon from '../../theme/Codicon.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import ViewHeader from '../../theme/primitives/ViewHeader.vue';
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

const readOnlyReason = computed(() => (cell.value ? readOnlyReasonFor(cell.value) : null));

// D4 (revised): editable only when the cell is genuinely writable (`readOnlyReason === null`)
// *and* whoever published it handed over a way to stage the write (`cell.onEdit`, today set only
// by `DataGrid.vue`). A future publisher that never sets `onEdit` — Document/KeyValue/Stream/
// Console — keeps its cells read-only here even once `readOnlyReasonFor()` says nothing's wrong,
// since there'd be nowhere for a save to go.
const isEditable = computed(() => readOnlyReason.value === null && !!cell.value?.onEdit);
const readOnlyChipText = computed(() => {
  switch (readOnlyReason.value) {
    case 'connection-read-only':
      return 'Connection is read-only';
    case 'no-primary-key':
      return 'No primary key';
    default:
      return '';
  }
});
const readOnlyChipTitle = computed(() => {
  switch (readOnlyReason.value) {
    case 'connection-read-only':
      return undefined;
    case 'no-primary-key':
      return "This table has no primary key, so a row can't be identified to write.";
    default:
      return undefined;
  }
});

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

// The buffer diverging from the stored value is what "there's something to save" means — true
// for a beautified reformat as much as for a hand-typed edit (D6: Save stages whatever's on
// screen, exactly like `stageEdit`'s own "verbatim, formatting included" contract).
const isDirty = computed(() => cell.value !== null && doc.value !== (cell.value.value ?? ''));
const saveDisabledTitle = computed<string | undefined>(() => {
  if (!isDirty.value) return 'No changes to stage.';
  return undefined;
});

// D5: a discoverable button, not an auto-stage-on-blur — this panel is for careful editing of
// larger values (JSON, long text) where an accidental blur must never silently stage a change.
// `stageEdit` (via `cell.onEdit`) only ever touches the SAME pending-change set the grid's own
// inline edit and the toolbar's Commit/Discard already operate on (§P5) — nothing here writes to
// the server directly, and there is no separate "commit" action in this panel.
function saveEdit(): void {
  const c = cell.value;
  if (!c || !isEditable.value || !c.onEdit) return;
  c.onEdit(doc.value);
}

// Ctrl/Cmd+Enter alongside the button, matching the beautify/reset trio's own click-only
// affordances but for the one action here worth a keyboard shortcut — mirrors the same chord's
// common meaning elsewhere (submit/run). Caught on the wrapping div: CodeMirror's own keymap
// binds Enter for newlines, never Ctrl/Cmd+Enter, so the event still bubbles here unconsumed.
function onEditorKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    saveEdit();
  }
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
    <!-- every non-grid view opens with the same 28px header (LAW 09) — identity, then facts as
         badges, then this panel's own controls, then the trailing group pushed to the edge.
         ViewHeader's target has no separate prefix/suffix slot, so the row number rides along in
         `name` itself (cell-editor-target's toContainText assertions don't care about styling). -->
    <ViewHeader
      icon="symbol-string"
      :name="`${targetLabel} · row ${cell.row + 1}`"
      target-testid="cell-editor-target"
    >
      <span class="p-badge">{{ cell.column.dataType }}</span>
      <span v-if="isNullValue" class="p-chip info" data-testid="cell-editor-badge-null">NULL</span>
      <span v-if="isEmptyValue" class="p-chip info" data-testid="cell-editor-badge-empty">empty</span>
      <span v-if="isTruncatedValue" class="p-chip warn" data-testid="cell-editor-badge-truncated">truncated</span>
      <span class="p-badge status-badge" data-testid="cell-editor-status">{{ statusLine }}</span>

      <span class="format-group">
        <select
          class="p-select bordered format-select"
          data-testid="cell-editor-format"
          :disabled="isNullValue"
          :value="override ?? 'auto'"
          :title="detectedReason"
          @change="onFormatSelect"
        >
          <option value="auto">Auto — {{ FORMAT_LABEL[detectedFormat] }}</option>
          <option v-for="f in CELL_FORMATS" :key="f" :value="f">{{ FORMAT_LABEL[f] }}</option>
        </select>

        <IconButton
          icon="list-tree"
          :size="14"
          :active="formatted === 'indented'"
          data-testid="cell-editor-beautify-indented"
          :disabled="!canBeautify(effectiveFormat)"
          :title="beautifyDisabledTitle"
          @click="applyBeautify('indented')"
        />
        <IconButton
          icon="list-flat"
          :size="14"
          :active="formatted === 'compact'"
          data-testid="cell-editor-beautify-compact"
          :disabled="!canBeautify(effectiveFormat)"
          :title="beautifyDisabledTitle"
          @click="applyBeautify('compact')"
        />
        <IconButton
          icon="discard"
          :size="14"
          data-testid="cell-editor-beautify-reset"
          :disabled="formatted === 'none'"
          :title="resetDisabledTitle"
          @click="resetBuffer"
        />

        <!-- Only exists when this cell's publisher handed over a way to stage the write at all
             (`cell.onEdit` — today only `DataGrid.vue`); disabled rather than hidden once that's
             true but `readOnlyReason` or an empty buffer diff says there's nothing to do right
             now, same convention as beautify/reset above. -->
        <IconButton
          v-if="cell.onEdit"
          icon="check"
          :size="14"
          tone="primary"
          data-testid="cell-editor-save"
          :disabled="!isEditable || !isDirty"
          :title="!isEditable ? readOnlyChipTitle ?? readOnlyChipText : saveDisabledTitle"
          @click="saveEdit"
        />
      </span>

      <template #trailing>
        <span v-if="readOnlyReason" class="p-chip warn" :title="readOnlyChipTitle">
          <Codicon name="lock" :size="12" />
          {{ readOnlyChipText }}
        </span>
      </template>
    </ViewHeader>

    <!-- Ctrl/Cmd+Enter alongside the Save button: caught here, not on CodeMirrorHost itself,
         since its own keymap only binds plain Enter (for newlines) and lets everything else
         bubble. -->
    <div class="editor-body" @keydown="onEditorKeydown">
      <CodeMirrorHost
        :doc="doc"
        :language="language"
        :sql-dialect="sqlDialect"
        :read-only="!isEditable"
        @update:doc="doc = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.cell-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* the format select + beautify/reset trio: this panel's own controls, set off from the
   identity badges with the standard s-4 gutter (mirrors CellEditor.html's inline group) */
.format-group {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  margin-left: var(--kira-s-4);
  flex-shrink: 0;
}

.format-select {
  max-width: 160px;
}

.format-select:disabled {
  color: var(--kira-fg-disabled);
}

/* the relocated statusLine (detected format / bytes / decoded reading / truncation note /
   beautify failure) now lives in the header as a badge — LAW: no editor status line, everything
   it used to say already exists in the view header. */
.status-badge {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-body {
  flex: 1;
  min-height: 0;
}
</style>
