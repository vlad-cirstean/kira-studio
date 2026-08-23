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
import { describeTimestamp, describeValue, detectFormat, type FormatGuess } from './detect';
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
  isDirty.value ? undefined : 'Already showing the stored value.',
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

// Bug fix: this used to only reset the local display buffer. Auto-stage-on-blur (onEditorBlur)
// fires on the same click that opens this button — clicking Reset moves focus off the editor
// first, which fires `focusout` (staging whatever was in the buffer as a pending edit) *before*
// this handler runs — so the buffer looked reverted while the just-staged edit silently stayed
// pending underneath it, which is what "Revert doesn't work, it commits the change" looked like.
// `onRevert` (set by DataGrid.vue alongside onEdit) un-stages that pending edit outright, so the
// order those two events fire in no longer matters — either way this call is what wins last.
function resetBuffer(): void {
  const c = cell.value;
  if (!c) return;
  doc.value = c.value ?? '';
  formatted.value = 'none';
  beautifyFailure.value = null;
  c.onRevert?.();
}

// The buffer diverging from the stored value is what "there's something to save" means — true
// for a beautified reformat as much as for a hand-typed edit (D6: Save stages whatever's on
// screen, exactly like `stageEdit`'s own "verbatim, formatting included" contract).
const isDirty = computed(() => cell.value !== null && doc.value !== (cell.value.value ?? ''));

// Stages into the exact same pending-change set the grid's own inline edit and the toolbar's
// Commit/Discard already operate on (§P5) — nothing here writes to the server directly, and
// there is no separate "commit" action in this panel.
function saveEdit(): void {
  const c = cell.value;
  if (!c || !isEditable.value || !c.onEdit) return;
  c.onEdit(doc.value);
}

// Auto-stages on blur, matching DataGrid.vue's own inline double-click edit (its `commitEdit`
// fires on the same event) — no separate Save button needed since leaving the editor is already
// the "I'm done with this value" signal, and the grid's own pending-edit row highlighting is the
// feedback that it landed. `focusout` (not `blur`, which doesn't bubble) on the wrapping div.
function onEditorBlur(): void {
  if (isEditable.value && isDirty.value) saveEdit();
}

// Ctrl/Cmd+Enter alongside blur-to-stage, for staging without needing to move focus away —
// mirrors the same chord's common meaning elsewhere (submit/run). Caught on the wrapping div:
// CodeMirror's own keymap binds Enter for newlines, never Ctrl/Cmd+Enter, so the event still
// bubbles here unconsumed.
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

// The format itself is never restated here — the format-select right next to this badge already
// shows it ("Auto — X" when detected, or the manually chosen format), so a leading "detected X" /
// "X (manual)" segment here would just repeat what's a few pixels to the right. A decoded
// timestamp reading runs its own row below (timestampReading) rather than sharing this badge —
// it was crowding out the byte count and truncation/beautify notes that live here.
const statusLine = computed(() => {
  const c = cell.value;
  if (!c) return '';
  if (isNullValue.value) return 'NULL';
  const value = c.value ?? '';
  const parts: string[] = [];
  parts.push(`${new TextEncoder().encode(value).length} bytes`);
  const reading = describeValue(effectiveFormat.value, value);
  if (reading) parts.push(reading);
  if (isTruncatedValue.value) parts.push('showing the first 64 KB');
  if (beautifyFailure.value) parts.push(beautifyFailure.value);
  return parts.join(' · ');
});

// Local first, then UTC (as asked) — its own row under the header rather than squeezed into the
// status badge alongside the byte count.
const timestampReading = computed(() => {
  const c = cell.value;
  if (!c || c.value === null) return null;
  return describeTimestamp(effectiveFormat.value, c.value);
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
      <span class="p-badge status-badge" :title="statusLine" data-testid="cell-editor-status">{{
        statusLine
      }}</span>

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
          :disabled="!isDirty"
          :title="resetDisabledTitle"
          @click="resetBuffer"
        />
      </span>

      <template #trailing>
        <span v-if="readOnlyReason" class="p-chip warn" :title="readOnlyChipTitle">
          <Codicon name="lock" :size="12" />
          {{ readOnlyChipText }}
        </span>
      </template>
    </ViewHeader>

    <!-- Local first, then UTC (own row — too long to share the header's status badge). -->
    <div v-if="timestampReading" class="p-strip note timestamp-row" data-testid="cell-editor-timestamp">
      <Codicon name="clock" :size="13" />
      <span data-testid="cell-editor-timestamp-local">{{ timestampReading.local }}</span>
      <span class="ts-sep">·</span>
      <span data-testid="cell-editor-timestamp-utc">{{ timestampReading.utc }}</span>
    </div>

    <!-- Auto-stages on blur (onEditorBlur) — focusout bubbles, plain blur doesn't. Ctrl/Cmd+Enter
         (onEditorKeydown) stages without needing to move focus away; neither is on CodeMirrorHost
         itself, since its own keymap only binds plain Enter (for newlines) and lets everything
         else bubble. -->
    <div class="editor-body" @keydown="onEditorKeydown" @focusout="onEditorBlur">
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
  /* .p-select.bordered defaults to --kira-h-md (26px) — taller than the IconButtons/28px header
     row it sits in here; match --kira-h-sm like everything else alongside it. */
  height: var(--kira-h-sm);
}

.format-select:disabled {
  color: var(--kira-fg-disabled);
}

/* the relocated statusLine (bytes / decoded reading — e.g. a base64/hex byte count / truncation
   note / beautify failure) now lives in the header as a badge — LAW: no editor status line,
   everything it used to say already exists in the view header. Still truncates with an ellipsis
   (title carries the full text) rather than growing unbounded and pushing the trailing
   read-only chip around. */
.status-badge {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Local first, then UTC — its own row so the (fairly long) pair of translations don't crowd the
   header's badges. Reuses .p-strip.note's subtle info-row look rather than inventing a new one. */
.timestamp-row {
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-4);
}

.ts-sep {
  opacity: 0.5;
}

.editor-body {
  flex: 1;
  min-height: 0;
}
</style>
