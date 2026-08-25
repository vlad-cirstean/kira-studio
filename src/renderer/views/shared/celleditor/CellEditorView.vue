<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import CodeMirrorHost from '../../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../../editor/languages';
import { formatBytes } from '../../../format';
import { cellKey, clearSelectedCellFor, type SelectedCell } from '../../../state/cellSelection';
import { connectionRecord } from '../../../state/connections';
import { type MenuItem, openContextMenu } from '../../../state/contextMenu';
import CodiconIcon from '../../../theme/CodiconIcon.vue';
import IconButton from '../../../theme/primitives/IconButton.vue';
import ViewHeader from '../../../theme/primitives/ViewHeader.vue';
import EditBufferActions from '../EditBufferActions.vue';
import { sqlDialectFor } from '../sqlIdent';
import { useEditBuffer } from '../useEditBuffer';
import { decodeToText, encodeFromText } from './binary';
import { describeValue, detectFormat, type FormatGuess } from './detect';
import {
  beautifyFor,
  type CellFormat,
  canBeautify,
  FORMAT_GROUPS,
  FORMAT_HELP,
  FORMAT_LABEL,
  FORMAT_LANGUAGE,
} from './formats';
import { overrideFor, readOnlyReasonFor, setOverride } from './state';
import TimestampPane from './TimestampPane.vue';
import { validateFormat } from './validate';

// P24 D23: hoisted out of statusLine's own recompute — this sits on the 50 ms cell-selection
// path (§2.1), and a stateless TextEncoder never needs to be reallocated per keystroke.
const statusEncoder = new TextEncoder();

// P26 D4: the dock decides whether there is a cell to render at all (its own v-if) — this
// component is only ever mounted with one, so no downstream code needs to null-guard it. Named
// `selectedCell` rather than `cell` to avoid colliding with the `cell` prop itself.
// `readOnly` (P40 D11): forwarded from CellEditorDock — true when the mounting view (the query
// console) has no write path for its cells at all, distinct from a cell being individually
// uneditable (readOnlyReasonFor below, unaffected by this flag).
const props = withDefaults(defineProps<{ cell: SelectedCell; readOnly?: boolean }>(), {
  readOnly: false,
});
const selectedCell = computed(() => props.cell);
const viewerMode = computed(() => props.readOnly === true);

const override = computed<CellFormat | null>(() => overrideFor(selectedCell.value));

const isNullValue = computed(() => selectedCell.value.value === null);
const isEmptyValue = computed(() => selectedCell.value.value === '');
const isTruncatedValue = computed(() => selectedCell.value.truncated);

// §5a: a NULL value runs no detector at all.
const detected = computed<FormatGuess[]>(() => {
  const c = selectedCell.value;
  if (c.value === null) return [];
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

const sqlDialect = computed(() => {
  const record = connectionRecord(selectedCell.value.connectionId);
  return sqlDialectFor(record?.kind);
});

// P40 D12: no reason chip in viewer mode — "No primary key" (or any other reason) is a statement
// about a write that was never on offer here (the query console's results have no addressable
// row to write back to at all), not an explanation of a refusal. `readOnlyChipText`/`Title` below
// are unreachable once this is null, since the template's own v-if gates on `readOnlyReason`.
const readOnlyReason = computed(() =>
  viewerMode.value ? null : readOnlyReasonFor(selectedCell.value),
);

// D4 (revised): editable only when the cell is genuinely writable (`readOnlyReason === null`)
// *and* whoever published it handed over a way to stage the write (`cell.onEdit`, today set only
// by `DataGrid.vue`). A future publisher that never sets `onEdit` — Document/KeyValue/Stream/
// Console — keeps its cells read-only here even once `readOnlyReasonFor()` says nothing's wrong,
// since there'd be nowhere for a save to go. `!viewerMode.value` is redundant with that (a viewer
// mount never sets onEdit either) but stated explicitly so this can't drift if one ever did.
const isEditable = computed(
  () => !viewerMode.value && readOnlyReason.value === null && !!selectedCell.value.onEdit,
);
const readOnlyChipText = computed(() => {
  switch (readOnlyReason.value) {
    case 'connection-read-only':
      return 'Connection is read-only';
    case 'value-truncated':
      return 'truncated — not editable';
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
    case 'value-truncated':
      // P24 D27: the value stays fully readable and copyable — only writing it back is refused,
      // since the buffer only ever holds the first 64 KB (§0 note 9).
      return 'Only the first 64 KB was fetched — committing it would overwrite the full value.';
    case 'no-primary-key':
      return "This table has no primary key, so a row can't be identified to write.";
    default:
      return undefined;
  }
});

// The display buffer (D6): what Beautify/Reset act on. Never the stored value itself, which
// stays reachable through `cell.value.value` for Reset. P27 D26: the state machine itself
// (dirty/beautify/bytes/revert) now lives in the shared useEditBuffer — this file only supplies
// what it means for a cell (the stored value, the beautifier for the effective format).
const buffer = useEditBuffer({
  original: () => selectedCell.value.value ?? '',
  beautifier: () =>
    canBeautify(effectiveFormat.value)
      ? (text, mode) => beautifyFor(effectiveFormat.value, text, mode)
      : null,
  onRevert: () => selectedCell.value.onRevert?.(),
});
const { doc, isDirty, formatted, beautifyFailure, writeDoc } = buffer;

let lastKey: string | null = null;
let lastValue: string | null = null;

// Populate path (§2.1's 50 ms budget): a republication of the same cell with the same value is
// a no-op — a background page refresh must not silently undo a user's beautify. Changing the
// format override recomputes `effectiveFormat`/`language` above without touching this watch.
watch(
  selectedCell,
  (c) => {
    const key = cellKey(c);
    if (key === lastKey && c.value === lastValue) return;
    lastKey = key;
    lastValue = c.value;
    buffer.reseed();
  },
  { immediate: true },
);

// P24 D14/D15: dates get the same translate-pane treatment as hex/base64 below — TimestampPane
// owns its own readings/editing entirely; this file only decides *whether* to show it.
const isTimestampFormat = computed(
  () =>
    effectiveFormat.value === 'epochSeconds' ||
    effectiveFormat.value === 'epochMillis' ||
    effectiveFormat.value === 'iso8601',
);

// Hex/base64 decoded-text pane: a second, editable view of the same bytes as plaintext. `null`
// means "not valid UTF-8" — shown as a note instead of a second editor rather than rendering
// garbled bytes. `skipNextDecode` breaks the encode<->decode cycle: onDecodedInput re-encodes into
// `doc`, and without the guard that write would immediately re-trigger a decode back into
// `decodedDoc`, fighting the very keystroke that just landed there (the same shape ConsoleView.vue's
// `lastEmitted` guard uses for its own doc-decoupling, D20).
const showDecodedPane = computed(
  () => effectiveFormat.value === 'hex' || effectiveFormat.value === 'base64',
);
// P24 D14: the translate pane shown below the encoded value — hex/base64's decoded-text pane or
// (D15) the timestamp pane — chosen by format, sharing one head/body/staging shape.
const showTranslatePane = computed(() => showDecodedPane.value || isTimestampFormat.value);
const decodedDoc = ref<string | null>('');
let skipNextDecode = false;

function syncDecodedFromDoc(): void {
  if (!showDecodedPane.value) {
    decodedDoc.value = '';
    return;
  }
  decodedDoc.value = decodeToText(effectiveFormat.value as 'hex' | 'base64', doc.value);
}

watch(
  [doc, effectiveFormat],
  () => {
    if (skipNextDecode) {
      skipNextDecode = false;
      return;
    }
    syncDecodedFromDoc();
  },
  { immediate: true },
);

function onDecodedInput(text: string): void {
  decodedDoc.value = text;
  if (!showDecodedPane.value) return;
  const next = encodeFromText(effectiveFormat.value as 'hex' | 'base64', text, doc.value);
  if (writeDoc(next)) skipNextDecode = true;
}

// Stages into the exact same pending-change set the grid's own inline edit and the toolbar's
// Commit/Discard already operate on (§P5) — nothing here writes to the server directly, and
// there is no separate "commit" action in this panel.
function saveEdit(): void {
  const c = selectedCell.value;
  if (!isEditable.value || !c.onEdit) return;
  c.onEdit(doc.value);
}

// Auto-stages on blur, matching DataGrid.vue's own inline double-click edit (its `commitEdit`
// fires on the same event) — no separate Save button needed since leaving the editor is already
// the "I'm done with this value" signal, and the grid's own pending-edit row highlighting is the
// feedback that it landed. `focusout` (not `blur`, which doesn't bubble) on the wrapping div.
//
// `focusout` fires (and bubbles) whenever the *previously* focused element loses focus, whether
// the next focus target is outside this div or just another control inside it (the timestamp
// field -> the encoded box, the zone toggle, the calendar) — it says nothing on its own about
// whether focus actually left the panel. `relatedTarget` is the element gaining focus, so only
// treat this as "done editing" when that target is null (focus left the window/app entirely) or
// sits outside the wrapping div; a same-panel transition must fall through and stage nothing.
function onEditorBlur(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  const container = e.currentTarget as HTMLElement | null;
  if (next && container?.contains(next)) return;
  if (isEditable.value && isDirty.value) saveEdit();
}

// P26 OQ1: now that a backgrounded tab keeps its selection (commit 3) instead of losing it to a
// stale slot, a dirty buffer's destruction on unmount would otherwise become unconditional —
// mirrors onEditorBlur's own staging rule so switching tabs by keyboard (Ctrl+Tab, which moves no
// focus and so never fires onEditorBlur) can no longer silently drop an in-flight edit. Staging is
// not committing: the edit is still reversible via the grid's own Revert/Discard.
onBeforeUnmount(() => {
  if (isEditable.value && isDirty.value) saveEdit();
});

// Ctrl/Cmd+Enter alongside blur-to-stage, for staging without needing to move focus away —
// mirrors the same chord's common meaning elsewhere (submit/run). Caught on the wrapping div:
// CodeMirror's own keymap binds Enter for newlines, never Ctrl/Cmd+Enter, so the event still
// bubbles here unconsumed.
//
// P24 D26: Escape reverts the buffer, mirroring DataGrid.vue's own inline editor. CodeMirror's
// defaultKeymap binds Escape to simplifySelection, which calls preventDefault but does not stop
// propagation, so this handler still receives it — the same mechanism Ctrl/Cmd+Enter above
// already relies on.
function onEditorKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    saveEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    buffer.reset();
  }
}

function closePanel(): void {
  clearSelectedCellFor(selectedCell.value.tabId);
}

// P42 D26: validated against the *effective* format, on the live buffer — a value that fails
// says so right beside the status badge, whether the format was auto-detected or overridden.
const formatProblem = computed(() =>
  isNullValue.value ? null : validateFormat(effectiveFormat.value, doc.value),
);

// P42 D28: the trigger's own tooltip explains the effective format, the same map the picker's
// own rows read (FORMAT_HELP) — one source, two surfaces, no way to drift.
const formatHint = computed(() => FORMAT_HELP[effectiveFormat.value]);

function setFormat(format: CellFormat | null): void {
  setOverride(selectedCell.value, format);
}

// P42 D27: an app-drawn picker, not a native <select> — the only way a per-row hover explanation
// (item 16) can exist at all, since a native <option> is drawn outside the DOM elementFromPoint
// can reach. An "Auto — X" row first, then FORMAT_GROUPS' own three groups separated, `checked`
// on whichever is effective right now.
function openFormatMenu(e: MouseEvent): void {
  if (isNullValue.value) return;
  const rows: MenuItem[] = [
    {
      type: 'item',
      id: 'format-auto',
      label: `Auto — ${FORMAT_LABEL[detectedFormat.value]}`,
      checked: override.value === null,
      hint: detectedReason.value || undefined,
      run: () => setFormat(null),
    },
  ];
  FORMAT_GROUPS.forEach((group, i) => {
    if (i > 0) rows.push({ type: 'separator' });
    for (const f of group) {
      rows.push({
        type: 'item',
        id: `format-${f}`,
        label: FORMAT_LABEL[f],
        checked: override.value === f,
        hint: FORMAT_HELP[f],
        run: () => setFormat(f),
      });
    }
  });
  openContextMenu(e, rows);
}

const targetLabel = computed(() => {
  const c = selectedCell.value;
  const tail = pathTail(c.path);
  return `${tail?.name ?? c.path}.${c.column.name}`;
});

// The format itself is never restated here — the format-select right next to this badge already
// shows it ("Auto — X" when detected, or the manually chosen format), so a leading "detected X" /
// "X (manual)" segment here would just repeat what's a few pixels to the right. A timestamp
// reading runs in its own translate pane below (TimestampPane) rather than sharing this badge —
// it was crowding out the byte count and truncation/beautify notes that live here.
// P24 D23/F7e: reads the buffer, not the stored value — the timestamp reading beside it already
// read the buffer, so the two disagreeing the moment you typed was the bug.
const statusLine = computed(() => {
  if (isNullValue.value) return 'NULL';
  const value = doc.value;
  const parts: string[] = [];
  parts.push(formatBytes(statusEncoder.encode(value).length));
  const reading = describeValue(effectiveFormat.value, value);
  if (reading) parts.push(reading);
  if (isTruncatedValue.value) parts.push('showing the first 64 KB');
  if (beautifyFailure.value) parts.push(beautifyFailure.value);
  return parts.join(' · ');
});
</script>

<template>
  <div
    class="cell-editor"
    data-testid="cell-editor-panel"
    :data-cell-key="cellKey(selectedCell)"
    :data-format="effectiveFormat"
    :data-detected="detectedFormat"
    :data-read-only="viewerMode || undefined"
    :data-read-only-reason="readOnlyReason"
    :data-formatted="formatted"
    :data-dirty="isDirty"
    :data-invalid="!!formatProblem || undefined"
  >
    <!-- every non-grid view opens with the same 28px header (LAW 09) — identity, then facts as
         badges, then this panel's own controls, then the trailing group pushed to the edge.
         ViewHeader's target has no separate prefix/suffix slot, so the row number rides along in
         `name` itself (cell-editor-target's toContainText assertions don't care about styling). -->
    <ViewHeader
      icon="symbol-string"
      :name="`${targetLabel} · row ${selectedCell.row + 1}`"
      target-testid="cell-editor-target"
    >
      <span class="p-badge">{{ selectedCell.column.dataType }}</span>
      <span v-if="isNullValue" class="p-chip info" data-testid="cell-editor-badge-null">NULL</span>
      <span v-if="isEmptyValue" class="p-chip info" data-testid="cell-editor-badge-empty">empty</span>
      <span v-if="isTruncatedValue" class="p-chip warn" data-testid="cell-editor-badge-truncated">truncated</span>
      <span class="p-badge status-badge" v-tooltip="statusLine" data-testid="cell-editor-status">{{
        statusLine
      }}</span>
      <span
        v-if="formatProblem"
        class="p-chip warn"
        data-testid="cell-editor-invalid"
        v-tooltip="formatProblem.message"
        >invalid</span
      >

      <span class="format-group">
        <button
          type="button"
          class="p-select bordered format-select"
          data-testid="cell-editor-format"
          :class="{ 'is-invalid': !!formatProblem }"
          :disabled="isNullValue"
          v-tooltip="formatHint"
          @click="openFormatMenu"
        >
          <span class="format-select-label">{{
            override ? FORMAT_LABEL[override] : `Auto — ${FORMAT_LABEL[detectedFormat]}`
          }}</span>
          <CodiconIcon name="chevron-down" :size="12" />
        </button>

        <!-- P40 D13: EditBufferActions' own modified chip/byte badge/Beautify/Revert describe an
             edit buffer that, in a viewer, can never be dirty. (P42: the UUID-generate button
             that used to sit beside it is gone — D29's generators panel replaces it in a later
             commit; the tree between the two commits simply has no generator, which is honest.) -->
        <template v-if="!viewerMode">
          <EditBufferActions :buffer="buffer" testid-prefix="cell-editor" />
        </template>
      </span>

      <template #trailing>
        <span v-if="readOnlyReason" class="p-chip warn" v-tooltip="readOnlyChipTitle">
          <CodiconIcon name="lock" :size="13" />
          {{ readOnlyChipText }}
        </span>
        <IconButton
          icon="close"
          data-testid="cell-editor-close"
          v-tooltip="'Close'"
          @click="closePanel"
        />
      </template>
    </ViewHeader>

    <!-- Auto-stages on blur (onEditorBlur) — focusout bubbles, plain blur doesn't. Ctrl/Cmd+Enter
         (onEditorKeydown) stages without needing to move focus away; neither is on CodeMirrorHost
         itself, since its own keymap only binds plain Enter (for newlines) and lets everything
         else bubble. Both are on the wrapping div, so they cover the translate pane too — TimestampPane
         lives inside here (not in its own strip, as the native picker used to) precisely so it
         inherits this same staging rule instead of needing its own (P24 D14/D15). -->
    <div
      class="editor-body"
      :class="{ 'has-translate': showTranslatePane }"
      @keydown="onEditorKeydown"
      @focusout="onEditorBlur"
    >
      <div class="encoded-pane" data-testid="cell-editor-encoded">
        <CodeMirrorHost
          :doc="doc"
          :language="language"
          :sql-dialect="sqlDialect"
          :read-only="!isEditable"
          @update:doc="doc = $event"
        />
      </div>

      <!-- Hex/base64: the same bytes as editable plaintext, kept in lockstep with the encoded box
           above in both directions (encode<->decode, see onDecodedInput). -->
      <template v-if="showDecodedPane">
        <div class="translate-head">
          <CodiconIcon name="symbol-string" :size="13" />
          <span>Decoded text</span>
        </div>
        <div v-if="decodedDoc !== null" class="translate-pane" data-testid="cell-editor-decoded">
          <CodeMirrorHost
            :doc="decodedDoc"
            language="plain"
            :read-only="!isEditable"
            @update:doc="onDecodedInput"
          />
        </div>
        <div
          v-else
          class="p-strip note translate-pane-empty"
          data-testid="cell-editor-decoded-empty"
        >
          Not valid UTF-8 text — showing the raw {{ FORMAT_LABEL[effectiveFormat] }} value only.
        </div>
      </template>

      <!-- The three timestamp formats: TimestampPane owns its own readings, zone switch, editable
           field and calendar entirely — this file only decides whether to show it. -->
      <template v-else-if="isTimestampFormat">
        <div class="translate-head">
          <CodiconIcon name="calendar" :size="13" />
          <span>Date &amp; time</span>
        </div>
        <TimestampPane
          class="translate-pane"
          :doc="doc"
          :format="effectiveFormat"
          :read-only="!isEditable"
          @update:doc="writeDoc($event)"
        />
      </template>
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

/* P42 D27: an app-drawn menu trigger, not a native <select> — border/background/padding/cursor
   still come from .p-select.bordered (plain CSS, unaffected by the element swap); its own
   appearance:base-select/::picker(select)/option rules are select-only and simply don't match a
   <button>, which is why the chevron below is drawn explicitly instead of relying on one. */
.format-select {
  max-width: 160px;
  /* .p-select.bordered defaults to --kira-h-md (26px) — taller than the IconButtons/28px header
     row it sits in here; match --kira-h-sm like everything else alongside it. */
  height: var(--kira-h-sm);
  font-family: var(--kira-font-family);
}

.format-select-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.format-select:disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

.format-select.is-invalid {
  border-color: var(--kira-error);
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

.editor-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.encoded-pane {
  flex: 1 1 auto;
  min-height: 0;
}

/* The translate pane (hex/base64's decoded text, or P24's timestamp pane) stacks below the
   encoded value, mirroring ConsoleView.vue's own stacked result panels rather than a side-by-side
   split — this panel is usually too narrow for two columns to read comfortably. */
.editor-body.has-translate .encoded-pane {
  flex: 1 1 55%;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.translate-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-1) var(--kira-s-4);
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.translate-pane {
  flex: 1 1 45%;
  min-height: 0;
}

.translate-pane-empty {
  flex: 1 1 45%;
  align-items: center;
  color: var(--kira-fg-disabled);
}
</style>
