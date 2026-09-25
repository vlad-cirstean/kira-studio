<script setup lang="ts">
import type { EditorLanguageId } from '@shared/domain/editor';
import { pathTail } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { nativeSelectVariants } from '@theme/components/ui/native-select';
import { Popover, PopoverAnchor, PopoverContent } from '@theme/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { useEventListener } from '@vueuse/core';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { formatBytes } from '@workbench/util/format';
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import type { ConsoleDiagnostic } from '../../../editor/diagnostics';
import { findRanges } from '../../../editor/findRanges';
import MonacoHost from '../../../editor/MonacoHost.vue';
import { cellKey, type SelectedCell, useCellSelectionStore } from '../../../state/cellSelection';
import { useConnectionsStore } from '../../../state/connections';
import { typeClassColor } from '../../../theme/icons';
import EditBufferActions from '../EditBufferActions.vue';
import ResponseFindBar, { type FindBarHost, type FindBarTarget } from '../ResponseFindBar.vue';
import { sqlDialectFor } from '../sqlIdent';
import { typeDescription } from '../typeGlossary';
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
import { GENERATORS, type Generator } from './generate';
import { useCellEditorFormatStore } from './state';
import TimestampPane from './TimestampPane.vue';
import { validateFormat } from './validate';

const cellEditorFormatStore = useCellEditorFormatStore();
const cellSelectionStore = useCellSelectionStore();
const contextMenuStore = useContextMenuStore();
const connectionsStore = useConnectionsStore();

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

const override = computed<CellFormat | null>(() => cellEditorFormatStore.overrideFor(selectedCell.value));

const isNullValue = computed(() => selectedCell.value.value === null);
const isEmptyValue = computed(() => selectedCell.value.value === '');
const isTruncatedValue = computed(() => selectedCell.value.truncated);

// §5a: a NULL value runs no detector at all.
//
// Reads `detectionText` (declared below with the rest of `useEditBuffer` — a forward reference
// safe here since this is a lazy computed, not eagerly evaluated) rather than the stored value:
// auto-detection (and so validateFormat's "is my json broken" check below) used to be pinned to
// whatever the *original* value looked like, so typing a syntax error into an already-valid JSON
// cell was caught, but typing a fresh JSON/timestamp value into a plain-text or empty cell never
// was — the auto format never moved off `text` no matter what you typed, since nothing here re-ran
// against the keystrokes. `detectionText` mirrors the stored value on cell switch and the main
// editor's own direct edits, exactly reproducing the old "detect against the value in hand"
// behaviour but live — see its own declaration for why it deliberately does *not* mirror `doc`
// itself (a translate pane's byte-level round-trip would otherwise fight its own pane).
const detected = computed<FormatGuess[]>(() => {
  const c = selectedCell.value;
  if (c.value === null) return [];
  return detectFormat({
    text: detectionText.value,
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
  const record = connectionsStore.connectionRecord(selectedCell.value.connectionId);
  return sqlDialectFor(record?.kind);
});

// P40 D12: no reason chip in viewer mode — "No primary key" (or any other reason) is a statement
// about a write that was never on offer here (the query console's results have no addressable
// row to write back to at all), not an explanation of a refusal. `readOnlyChipText`/`Title` below
// are unreachable once this is null, since the template's own v-if gates on `readOnlyReason`.
const readOnlyReason = computed(() =>
  viewerMode.value ? null : cellEditorFormatStore.readOnlyReasonFor(selectedCell.value),
);

// D4 (revised): editable only when the cell is genuinely writable (`readOnlyReason === null`)
// *and* whoever published it handed over a way to stage the write (`cell.onEdit`, today set only
// by `SlickGridHost.vue`). A future publisher that never sets `onEdit` — Document/KeyValue/Stream/
// Console — keeps its cells read-only here even once `cellEditorFormatStore.readOnlyReasonFor()` says nothing's wrong,
// since there'd be nowhere for a save to go. `!viewerMode.value` is redundant with that (a viewer
// mount never sets onEdit either) but stated explicitly so this can't drift if one ever did.
const isEditable = computed(
  () => !viewerMode.value && readOnlyReason.value === null && !!selectedCell.value.onEdit,
);
const readOnlyChipText = computed(() => {
  switch (readOnlyReason.value) {
    case 'masked':
      return 'Masked preview';
    case 'connection-read-only':
      return 'Connection is read-only';
    case 'value-truncated':
      return 'truncated — not editable';
    case 'generated-column':
      return 'Generated column';
    case 'pending-delete':
      return 'Row pending delete';
    case 'no-primary-key':
      return 'No primary key';
    default:
      return '';
  }
});
const readOnlyChipTitle = computed(() => {
  switch (readOnlyReason.value) {
    case 'masked':
      // M5 §6.5: the one reason here the user can fix immediately, unlike the other three.
      return 'Values are masked for this tab — turn the preview off in the toolbar to see and edit the stored value.';
    case 'connection-read-only':
      return undefined;
    case 'value-truncated':
      // P24 D27: the value stays fully readable and copyable — only writing it back is refused,
      // since the buffer only ever holds the first 64 KB (§0 note 9).
      return 'Only the first 64 KB was fetched — committing it would overwrite the full value.';
    case 'generated-column':
      return "The server computes this column's value — an edit here would be refused at commit.";
    case 'pending-delete':
      return 'This row is staged for delete — revert the delete before editing it.';
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

// What `detected` above actually reads — deliberately a separate ref from `doc`, not an alias for
// it, and deliberately not updated on every keystroke either. `doc` also receives byte-level
// round-trip writes from the decoded-text pane (onDecodedInput) and TimestampPane, each re-encoding
// a pane-managed value that is *already* known to be that exact format; re-running detection
// against those intermediate encodings (or even the main editor's own direct edits, once a
// translate-pane format is already in effect) risks the pane's own output falling out of its own
// format mid-keystroke — base64's 20-char floor rejects plenty of genuinely valid short base64 —
// which would hide the very pane the user is typing into. Once the effective format is one of
// PINNED_FORMATS (hex/base64/the three timestamp encodings — every format with a translate pane),
// it stays put for the rest of that cell's editing session, same as before this feature existed;
// only the plain read-it-directly formats (text/json/xml/csv/sql, none of which own a pane) keep
// re-detecting live, which is exactly the set item 1's ask cares about ("is my json broken").
const PINNED_FORMATS = new Set<CellFormat>([
  'hex',
  'base64',
  'iso8601',
  'epochSeconds',
  'epochMillis',
]);
const detectionText = ref(selectedCell.value.value ?? '');

function onMainDocInput(text: string): void {
  doc.value = text;
  if (!PINNED_FORMATS.has(effectiveFormat.value)) detectionText.value = text;
}

let lastKey: string | null = null;
let lastValue: string | null = null;

// Populate path (§2.1's 50 ms budget): a republication of the same cell with the same value is
// a no-op — a background page refresh must not silently undo a user's beautify. Changing the
// format override recomputes `effectiveFormat`/`language` above without touching this watch.
watch(
  selectedCell,
  (c, prevCell) => {
    const key = cellKey(c);
    if (key === lastKey && c.value === lastValue) return;
    // F17 (P108 Part 10): mirrors onEditorBlur/onBeforeUnmount/onEditorKeydown's own "stage on
    // leave" rule — reseeding used to silently discard a dirty (unsaved) buffer whenever the
    // selected cell changed, or a background republish of the same cell changed its value (F1).
    //
    // Dirtiness here is judged against `prevCell.value` — what the buffer was seeded from, and
    // what the user could have actually diverged from — never the shared `isDirty` computed
    // (`doc.value !== opts.original()`): `original()` reads `selectedCell.value` live, which by
    // this point already IS `c`, the cell this watch just received. Comparing against `c.value`
    // instead of `prevCell.value` made an untouched buffer look "dirty" any time the same cell's
    // published value swaps representation with no user edit at all — the grid mask preview
    // toggling the same cell between its real and masked text is exactly that: `onEditorBlur`'s
    // literal next call (toggling preview back on, which moves focus to the toolbar toggle) would
    // then stage the buffer's stale-but-"dirty" text as a real edit, straight back into the page's
    // own unmasked value and bypassing the preview entirely (SlickGridHost.vue's own `dataSource`
    // extractor prefers a staged edit over `maskTransform`, by design — a real edit is never
    // masked once committed).
    const wasDirty = prevCell ? doc.value !== (prevCell.value ?? '') : false;
    if (
      wasDirty &&
      prevCell &&
      !viewerMode.value &&
      prevCell.onEdit &&
      cellEditorFormatStore.readOnlyReasonFor(prevCell) === null
    ) {
      prevCell.onEdit(doc.value);
    }
    lastKey = key;
    lastValue = c.value;
    buffer.reseed();
    detectionText.value = c.value ?? '';
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

// Auto-stages on blur, matching the deleted DataGrid.vue's own inline double-click edit (its
// `commitEdit` fired on the same event) — no separate Save button needed since leaving the editor is already
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
// P24 D26: Escape reverts the buffer, mirroring the deleted DataGrid.vue's own inline editor. CodeMirror's
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

// P105 §5.1: the wrapping div is not interactive -- both listeners bind via VueUse instead of raw
// template attributes. `e.currentTarget` inside onEditorBlur is still this same element.
const editorBodyEl = useTemplateRef<HTMLElement>('editorBodyEl');
useEventListener(editorBodyEl, 'keydown', onEditorKeydown);
useEventListener(editorBodyEl, 'focusout', onEditorBlur);

function closePanel(): void {
  cellSelectionStore.clearSelectedCellFor(selectedCell.value.tabId);
}

// P22b D14: one cell's own value, often a large JSON blob dumped straight from the console (F21),
// had no way to search it at all. Mirrors ResponsePane.vue's own find bar exactly — one target,
// the encoded pane's own doc, over the same editor/findRanges.ts seam. The decoded/timestamp
// translate pane is a re-encoding of the same bytes, not a second document worth its own search.
const findOpen = ref(false);
function toggleFind(): void {
  findOpen.value = !findOpen.value;
}
function closeFind(): void {
  findOpen.value = false;
}
const encodedHostRef = ref<FindBarHost | null>(null);
const findBarRef = ref<{ query: string; currentGlobal: number } | null>(null);
const findTargets = computed<readonly FindBarTarget[]>(() => {
  if (!findOpen.value) return [];
  return [{ doc: doc.value, host: encodedHostRef.value }];
});
const docHighlights = computed(() => {
  const bar = findBarRef.value;
  const query = bar?.query ?? '';
  if (!query || findTargets.value.length === 0) return undefined;
  const currentGlobal = bar?.currentGlobal ?? -1;
  return (text: string) => findRanges(text, query, currentGlobal);
});

// P42 D26: validated against the *effective* format, on the live buffer — a value that fails
// says so right beside the status badge, whether the format was auto-detected or overridden.
const formatProblem = computed(() =>
  isNullValue.value
    ? null
    : validateFormat(effectiveFormat.value, doc.value, isTruncatedValue.value),
);

// Item 1 (regression pass, task batch P46-2): a red border on the format picker read as "the
// format choice itself is wrong", which isn't the claim being made — the *value* doesn't parse as
// whatever format is in effect. Squiggly-underlining the actual offending text is what every code
// editor does for exactly this ("your JSON is broken, your timestamp is wrong"), and this app
// already has the whole mechanism built for the console (MonacoHost's `lintSource` prop,
// editor.setModelMarkers under the hood, P60a) — reused as-is rather than inventing a second lint
// UI. A validator with no offset (xml/csv/base64/hex/timestamp) underlines the whole value; one
// with an offset (json/sql) underlines the single character it points at.
function cellLintSource(): ConsoleDiagnostic[] {
  const problem = formatProblem.value;
  if (!problem) return [];
  const text = doc.value;
  const from = Math.min(problem.offset ?? 0, text.length);
  const to = problem.offset === undefined ? text.length : Math.min(from + 1, text.length);
  return [{ from, to: Math.max(to, from), severity: 'error', message: problem.message }];
}

// P42 D28: the trigger's own tooltip explains the effective format, the same map the picker's
// own rows read (FORMAT_HELP) — one source, two surfaces, no way to drift.
const formatHint = computed(() => FORMAT_HELP[effectiveFormat.value]);

function setFormat(format: CellFormat | null): void {
  cellEditorFormatStore.setOverride(selectedCell.value, format);
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
  contextMenuStore.openContextMenu(e, rows);
}

// P42 D29: never format-gated — a generator writes text into the buffer, and the buffer does not
// care what format the value is being read as (the old UUID-only button's disabled tooltip was a
// false statement precisely because that gate was arbitrary). Applying one overwrites the buffer
// outright, same as applyBeautify's own "replace doc.value" contract — Reset already exists for
// "I changed my mind." The button sits outside `.editor-body`, so no focusout ever reaches
// onEditorBlur — this is a one-shot action like Ctrl+Enter, not a keystroke mid-edit, so it stages
// immediately rather than waiting on a blur that will never come.
const generatePanelOpen = ref(false);
const generateAnchorRef = ref<HTMLElement | null>(null);
function applyGenerator(gen: Generator): void {
  if (!isEditable.value) return;
  doc.value = gen.run(effectiveFormat.value);
  saveEdit();
  generatePanelOpen.value = false;
}

const targetLabel = computed(() => {
  const c = selectedCell.value;
  const tail = pathTail(c.path);
  return `${tail?.name ?? c.path}.${c.column.name}`;
});

// Same glossary the grid's own column header reads (columnHeaderTooltip, SlickGridHost.vue) — hovering
// the data-type badge here should explain the type exactly as hovering the header already does.
const dataTypeHint = computed(
  () => typeDescription(selectedCell.value.column.dataType) ?? undefined,
);

// Item (regression pass, task batch P46-7): reads the column's own typeClass — the adapter's own
// authoritative typeClassFor() verdict — rather than re-guessing a category from its dataType
// string a second time (columnTypeColor, theme/icons.ts, still does that guess for the one
// caller, the Structure pane, that has no typeClass at all to read instead).
const dataTypeColor = computed(() => typeClassColor(selectedCell.value.column.typeClass));

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
    class="flex flex-col h-full min-h-0"
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
         ViewHeader inlined (P104 §3: layout container, no library counterpart) — the row number
         rides along in the target text itself (cell-editor-target's toContainText assertions
         don't care about styling). -->
    <ViewToolbar>
      <span class="size-4 flex items-center justify-center shrink-0">
        <CodiconIcon name="symbol-string" :size="13" />
      </span>
      <span class="text-kira-md text-fg truncate" data-testid="cell-editor-target"
        >{{ `${targetLabel} · row ${selectedCell.row + 1}` }}</span
      >
      <Tooltip v-if="dataTypeHint">
        <TooltipTrigger as-child>
          <Badge :style="{ color: dataTypeColor }">{{ selectedCell.column.dataType }}</Badge>
        </TooltipTrigger>
        <TooltipContent>{{ dataTypeHint }}</TooltipContent>
      </Tooltip>
      <Badge v-else :style="{ color: dataTypeColor }">{{ selectedCell.column.dataType }}</Badge>
      <Badge v-if="isNullValue" variant="info" data-testid="cell-editor-badge-null">NULL</Badge>
      <Badge v-if="isEmptyValue" variant="info" data-testid="cell-editor-badge-empty">empty</Badge>
      <Badge v-if="isTruncatedValue" variant="warn" data-testid="cell-editor-badge-truncated">truncated</Badge>
      <Tooltip>
        <TooltipTrigger as-child>
          <Badge class="max-w-56 overflow-hidden text-ellipsis" data-testid="cell-editor-status">{{ statusLine }}</Badge>
        </TooltipTrigger>
        <TooltipContent>{{ statusLine }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="formatProblem">
        <TooltipTrigger as-child>
          <Badge variant="err" class="max-w-56 overflow-hidden text-ellipsis whitespace-nowrap" data-testid="cell-editor-invalid">{{ formatProblem.message }}</Badge>
        </TooltipTrigger>
        <TooltipContent>{{ formatProblem.message }}</TooltipContent>
      </Tooltip>

      <!-- the format select + beautify/reset trio: this panel's own controls, set off from the
           identity badges with the standard s-4 gutter (mirrors CellEditor.html's inline group) -->
      <span class="flex items-center shrink-0 gap-1.5 ml-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <!-- P42 D27: an app-drawn menu trigger, not a native <select> — border/background/
                   padding/cursor still come from nativeSelectVariants({variant: 'bordered'})
                   (P110 B24, applied directly as a class function since this is a <button>, not a
                   NativeSelect component); its appearance:base-select/::picker(select)/option
                   selectors are select-only and simply don't match a <button>, which is why the
                   chevron below is drawn explicitly instead of relying on one. Its own
                   disabled:text-disabled/cursor-default already covers this button too, no local
                   duplicate needed. -->
              <button
                type="button"
                :class="[nativeSelectVariants({ variant: 'bordered' }), 'max-w-40 font-[family-name:var(--kira-font-ui)]']"
                data-testid="cell-editor-format"
                :disabled="isNullValue"
                @click="openFormatMenu"
              >
                <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{
                  override ? FORMAT_LABEL[override] : `Auto — ${FORMAT_LABEL[detectedFormat]}`
                }}</span>
                <CodiconIcon name="chevron-down" :size="12" />
              </button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ formatHint }}</TooltipContent>
        </Tooltip>

        <!-- P40 D13: neither affordance serves a purpose in viewer mode — nothing here exists to
             stage a write. showBytes=false (D31): the status badge above already carries a byte
             figure, alongside the decoded reading/truncation/beautify-failure notes it already
             said first — this row's own badge would be the same number shown twice. -->
        <template v-if="!viewerMode">
          <Popover :open="generatePanelOpen" @update:open="generatePanelOpen = $event">
            <span ref="generateAnchorRef" class="relative shrink-0">
              <Tooltip>
                <TooltipTrigger as-child>
                  <TooltipDisabledTrigger>
                    <Button
                      variant="toolbar"
                      size="kira-icon"
                      aria-label="Generate a value"
                      :disabled="!isEditable"
                      data-testid="cell-editor-generate"
                      @click="generatePanelOpen = !generatePanelOpen"
                    >
                      <CodiconIcon name="sparkle" :size="13" />
                    </Button>
                  </TooltipDisabledTrigger>
                </TooltipTrigger>
                <TooltipContent>Generate a value</TooltipContent>
              </Tooltip>
              <PopoverAnchor :reference="generateAnchorRef ?? undefined" />
            </span>
            <PopoverContent align="start" class="w-52 gap-0 p-0" data-testid="cell-editor-generate-popover">
              <div class="flex flex-col gap-px p-1">
                <Tooltip v-for="gen in GENERATORS" :key="gen.id">
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer hover:bg-hover w-full border-0 bg-transparent text-left font-[family-name:var(--kira-font-ui)]"
                      :data-testid="`cell-editor-generate-${gen.id}`"
                      @click="applyGenerator(gen)"
                    >
                      {{ gen.label }}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ gen.hint }}</TooltipContent>
                </Tooltip>
              </div>
            </PopoverContent>
          </Popover>
          <EditBufferActions :buffer="buffer" testid-prefix="cell-editor" :show-bytes="false" />
        </template>
      </span>

      <span class="ml-auto flex items-center gap-1">
        <Tooltip v-if="readOnlyReason && readOnlyChipTitle">
          <TooltipTrigger as-child>
            <Badge variant="warn">
              <CodiconIcon name="lock" :size="13" />
              {{ readOnlyChipText }}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{{ readOnlyChipTitle }}</TooltipContent>
        </Tooltip>
        <Badge v-else-if="readOnlyReason" variant="warn">
          <CodiconIcon name="lock" :size="13" />
          {{ readOnlyChipText }}
        </Badge>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-field text-fg': findOpen }"
              aria-label="Find in value"
              data-testid="cell-editor-search-toggle"
              @click="toggleFind"
            >
              <CodiconIcon name="search" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Find in value</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira-icon" aria-label="Close" data-testid="cell-editor-close" @click="closePanel">
              <CodiconIcon name="close" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </span>
    </ViewToolbar>

    <!-- Auto-stages on blur (onEditorBlur) — focusout bubbles, plain blur doesn't. Ctrl/Cmd+Enter
         (onEditorKeydown) stages without needing to move focus away; neither is on MonacoHost
         itself, since its own keymap only binds plain Enter (for newlines) and lets everything
         else bubble. Both are on the wrapping div, so they cover the translate pane too — TimestampPane
         lives inside here (not in its own strip, as the native picker used to) precisely so it
         inherits this same staging rule instead of needing its own (P24 D14/D15). -->
    <div ref="editorBodyEl" class="flex-1 min-h-0 flex flex-col">
      <!-- The translate pane (hex/base64's decoded text, or P24's timestamp pane) stacks below the
           encoded value, mirroring ConsoleView.vue's own stacked result panels rather than a
           side-by-side split — this panel is usually too narrow for two columns to read
           comfortably. -->
      <div
        :class="showTranslatePane ? 'flex-1 basis-7/12 border-b border-border min-h-0' : 'flex-auto min-h-0'"
        data-testid="cell-editor-encoded"
      >
        <MonacoHost
          ref="encodedHostRef"
          :doc="doc"
          :language="language"
          :sql-dialect="sqlDialect"
          :read-only="!isEditable"
          :lint-source="cellLintSource"
          :range-highlights="docHighlights"
          @update:doc="onMainDocInput"
        />
      </div>

      <!-- Hex/base64: the same bytes as editable plaintext, kept in lockstep with the encoded box
           above in both directions (encode<->decode, see onDecodedInput). -->
      <template v-if="showDecodedPane">
        <div class="flex shrink-0 items-center gap-1 bg-elevated border-b border-border text-subtle text-kira-xs py-0.5 px-2">
          <CodiconIcon name="symbol-string" :size="13" />
          <span>Decoded text</span>
        </div>
        <div v-if="decodedDoc !== null" class="flex-1 basis-5/12 min-h-0" data-testid="cell-editor-decoded">
          <MonacoHost
            :doc="decodedDoc"
            language="plain"
            :read-only="!isEditable"
            @update:doc="onDecodedInput"
          />
        </div>
        <Alert
          v-else
          variant="note"
          class="flex-1 basis-5/12 items-center text-subtle"
          data-testid="cell-editor-decoded-empty"
        >
          <AlertDescription>
            Not valid UTF-8 text — showing the raw {{ FORMAT_LABEL[effectiveFormat] }} value only.
          </AlertDescription>
        </Alert>
      </template>

      <!-- The three timestamp formats: TimestampPane owns its own readings, zone switch, editable
           field and calendar entirely — this file only decides whether to show it. -->
      <template v-else-if="isTimestampFormat">
        <div class="flex shrink-0 items-center gap-1 bg-elevated border-b border-border text-subtle text-kira-xs py-0.5 px-2">
          <CodiconIcon name="calendar" :size="13" />
          <span>Date &amp; time</span>
        </div>
        <TimestampPane
          class="flex-1 basis-5/12 min-h-0"
          :doc="doc"
          :format="effectiveFormat"
          :read-only="!isEditable"
          @update:doc="writeDoc($event)"
        />
      </template>
    </div>

    <!-- P22b D14: docked below the pane it searches (LAW 03), mirroring ResponsePane.vue's own
         find bar. -->
    <ResponseFindBar
      v-if="findOpen"
      ref="findBarRef"
      :targets="findTargets"
      @close="closeFind"
    />
    <!-- P110 I2-18: `.editor-body.has-translate .encoded-pane` moved to the ternary above. -->
  </div>
</template>
