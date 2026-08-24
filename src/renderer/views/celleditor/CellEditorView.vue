<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { computed, ref, watch } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import { cellKey, cellSelectionState } from '../../state/cellSelection';
import { connectionsState } from '../../state/connections';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import ViewHeader from '../../theme/primitives/ViewHeader.vue';
import { type BeautifyMode, beautify } from './beautify';
import { decodeToText, encodeFromText } from './binary';
import { describeValue, detectFormat, type FormatGuess } from './detect';
import {
  CELL_FORMATS,
  type CellFormat,
  canBeautify,
  FORMAT_LABEL,
  FORMAT_LANGUAGE,
} from './formats';
import { overrideFor, readOnlyReasonFor, setOverride } from './state';
import TimestampPane from './TimestampPane.vue';

// P24 D23: hoisted out of statusLine's own recompute — this sits on the 50 ms cell-selection
// path (§2.1), and a stateless TextEncoder never needs to be reallocated per keystroke.
const statusEncoder = new TextEncoder();

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
// stays reachable through `cell.value.value` for Reset.
const doc = ref('');
const beautifyFailure = ref<string | null>(null);

// P24 D22: `formatted` is derived, not a flag every doc-writing call site has to remember to
// clear — it reads 'indented'/'compact' only while the buffer still equals exactly what
// applyBeautify last produced, and falls back to 'none' the instant doc changes by ANY other path
// (a hand edit, a fresh cell, Reset, the decoded/timestamp panes). Otherwise the Beautify button
// stayed lit over text that was no longer beautified, and `data-formatted` reported a formatting
// the buffer no longer had.
const formattedMode = ref<'indented' | 'compact'>('indented');
const formattedForDoc = ref<string | null>(null);
const formatted = computed<'none' | 'indented' | 'compact'>(() =>
  formattedForDoc.value !== null && formattedForDoc.value === doc.value
    ? formattedMode.value
    : 'none',
);

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
    formattedForDoc.value = null;
    beautifyFailure.value = null;
  },
  { immediate: true },
);

const beautifyDisabledTitle = computed<string>(() =>
  canBeautify(effectiveFormat.value)
    ? ''
    : 'Indented and compact formatting apply to JSON and XML/HTML.',
);
// Bug fix (tooltip audit follow-up): these two buttons previously had no title at all once
// enabled — `beautifyDisabledTitle` was written to only ever describe the *disabled* case, so a
// working Beautify/Minify pair had no hover hint explaining what "list-tree"/"list-flat" even do.
const beautifyIndentedTitle = computed<string>(() =>
  canBeautify(effectiveFormat.value)
    ? 'Beautify — pretty-print with indentation'
    : beautifyDisabledTitle.value,
);
const beautifyCompactTitle = computed<string>(() =>
  canBeautify(effectiveFormat.value)
    ? 'Minify — remove all whitespace'
    : beautifyDisabledTitle.value,
);
// P24 D24/F7a: the enabled case previously had no title at all — beautifyIndentedTitle/
// beautifyCompactTitle above already got this same fix in an earlier pass (see their own
// comment); Reset was missed.
const resetTitle = computed<string>(() =>
  isDirty.value ? 'Reset to the stored value' : 'Already showing the stored value.',
);

// UUID generation: overwrites the buffer outright, same shape as applyBeautify's own "replace
// doc.value" contract — Reset already exists for "I changed my mind."
const canGenerateUuid = computed(() => effectiveFormat.value === 'uuid' && isEditable.value);
const uuidGenerateTitle = computed<string>(() =>
  canGenerateUuid.value ? 'Generate a new random UUID' : 'Available when the format is UUID.',
);
function generateUuid(): void {
  if (!canGenerateUuid.value) return;
  doc.value = crypto.randomUUID();
  // The button sits outside `.editor-body`, so no focusout ever reaches onEditorBlur — this is a
  // one-shot action like Ctrl+Enter, not a keystroke mid-edit, so it stages immediately rather
  // than waiting on a blur that will never come.
  saveEdit();
}

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

// P24 D20: the one write-guard both translate-pane update paths route through — only actually
// writes `doc` when the candidate differs, and reports whether it did so the caller can decide
// what side effect (if any) rides along. Replaces arming skipNextDecode unconditionally *before*
// a write that might not happen: F7b — that left the flag permanently set once a no-op write
// occurred (edit the decoded pane to text that re-encodes identically), silently swallowing the
// *next* genuine edit with no way back except reselecting the cell.
function writeDoc(next: string): boolean {
  if (next === doc.value) return false;
  doc.value = next;
  return true;
}

function onDecodedInput(text: string): void {
  decodedDoc.value = text;
  if (!showDecodedPane.value) return;
  const next = encodeFromText(effectiveFormat.value as 'hex' | 'base64', text, doc.value);
  if (writeDoc(next)) skipNextDecode = true;
}

// P24 D21/F7d: acts on the buffer (`doc`), not the stored value — beautifying used to silently
// discard a hand-edit, applying formatting to `c.value` and overwriting whatever the user had
// just typed. The `formatted.value === mode` early return is also gone: with `formatted` now
// derived (above), pressing Beautify twice on an unmodified buffer is merely a harmless re-run,
// not the previously-permanent dead click that made re-formatting your own edit impossible.
function applyBeautify(mode: BeautifyMode): void {
  const c = cell.value;
  if (!c || c.value === null || !canBeautify(effectiveFormat.value)) return;
  const result = beautify(doc.value, effectiveFormat.value, mode);
  if (result.ok) {
    formattedMode.value = mode;
    formattedForDoc.value = result.text;
    doc.value = result.text;
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
  formattedForDoc.value = null;
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
    resetBuffer();
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
// "X (manual)" segment here would just repeat what's a few pixels to the right. A timestamp
// reading runs in its own translate pane below (TimestampPane) rather than sharing this badge —
// it was crowding out the byte count and truncation/beautify notes that live here.
// P24 D23/F7e: reads the buffer, not the stored value — the timestamp reading beside it already
// read the buffer, so the two disagreeing the moment you typed was the bug.
const statusLine = computed(() => {
  const c = cell.value;
  if (!c) return '';
  if (isNullValue.value) return 'NULL';
  const value = doc.value;
  const parts: string[] = [];
  parts.push(`${statusEncoder.encode(value).length} bytes`);
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
    :data-dirty="isDirty"
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
      <span class="p-badge status-badge" v-tooltip="statusLine" data-testid="cell-editor-status">{{
        statusLine
      }}</span>

      <span class="format-group">
        <select
          class="p-select bordered format-select"
          data-testid="cell-editor-format"
          :disabled="isNullValue"
          :value="override ?? 'auto'"
          v-tooltip="detectedReason"
          @change="onFormatSelect"
        >
          <option value="auto">Auto — {{ FORMAT_LABEL[detectedFormat] }}</option>
          <option v-for="f in CELL_FORMATS" :key="f" :value="f">{{ FORMAT_LABEL[f] }}</option>
        </select>

        <IconButton
          icon="sparkle"
          data-testid="cell-editor-uuid-generate"
          :disabled="!canGenerateUuid"
          v-tooltip="uuidGenerateTitle"
          @click="generateUuid"
        />
        <IconButton
          icon="expand-all"
          :active="formatted === 'indented'"
          data-testid="cell-editor-beautify-indented"
          :disabled="!canBeautify(effectiveFormat)"
          v-tooltip="beautifyIndentedTitle"
          @click="applyBeautify('indented')"
        />
        <IconButton
          icon="collapse-all"
          :active="formatted === 'compact'"
          data-testid="cell-editor-beautify-compact"
          :disabled="!canBeautify(effectiveFormat)"
          v-tooltip="beautifyCompactTitle"
          @click="applyBeautify('compact')"
        />
        <IconButton
          icon="discard"
          data-testid="cell-editor-beautify-reset"
          :disabled="!isDirty"
          v-tooltip="resetTitle"
          @click="resetBuffer"
        />
      </span>

      <template #trailing>
        <!-- P24 D25/F10: the mockup's own trailing chip when the buffer diverges from the stored
             value — the only visible signal today that Ctrl+Enter (no focus change, so no other
             feedback) did anything at all. -->
        <span v-if="isDirty" class="p-chip warn" data-testid="cell-editor-modified">modified</span>
        <span v-if="readOnlyReason" class="p-chip warn" v-tooltip="readOnlyChipTitle">
          <CodiconIcon name="lock" :size="13" />
          {{ readOnlyChipText }}
        </span>
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
