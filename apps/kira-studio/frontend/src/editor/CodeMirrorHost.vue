<script setup lang="ts">
import {
  acceptCompletion,
  autocompletion,
  type CompletionSource,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { type Diagnostic, linter } from '@codemirror/lint';
import { Annotation, Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
import {
  EditorView,
  type HoverTooltipSource,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { settingsState } from '../state/settings';
import type { SqlDialect } from '../views/shared/sqlIdent';
import type { ConsoleDiagnostic } from './diagnostics';
import { type EditorLanguageId, languageExtension } from './languages';
import { kiraEditorTheme, kiraHighlightStyle } from './theme';
import { wrapSelectionOnType } from './wrapSelection';

const props = defineProps<{
  doc: string;
  language: EditorLanguageId;
  /** Only consulted when `language === 'sql'` (D17). */
  sqlDialect?: SqlDialect;
  readOnly: boolean;
  /** P18 D10: off everywhere by default. On only for the query console on a SQL connection — the
   *  cell editor, definition viewer, document editor and op-log detail rows must not sprout a popup. */
  autocomplete?: boolean;
  /** P18 addendum D21/D22/D23: replaces language-data completion sources
   *  (autocompletion({ override })) — the Mongo/Redis consoles pass a tab-specific source here;
   *  SQL passes nothing and keeps lang-sql's own keyword source. Ignored when `autocomplete` is
   *  false. */
  completionSources?: readonly CompletionSource[];
  /** P18 addendum D24: pure text in, diagnostics out — the host owns linter()/its compartment/its
   *  theming, so a caller (the console) never imports @codemirror/lint. Ignored (no linting) when
   *  absent, which every prior host stays. */
  lintSource?: (doc: string) => ConsoleDiagnostic[];
  /** P18 (v1.1) C6/D8: a real, ready-to-use HoverTooltipSource (editor/hover.ts's
   *  buildHoverSource is what a caller uses to build one from a pure text-in lookup) — this host
   *  never sees SQL-specific logic, only plugs the value straight into hoverTooltip(). Ignored
   *  (no hover) when absent, which every prior host stays. */
  hoverSource?: HoverTooltipSource;
  /** A one-line toolbar field's own syntax-highlighted overlay (AutocompleteField.vue) rather
   *  than a document editor: no line-number gutter, no wrapping regardless of the appearance
   *  setting (there is only ever one line to wrap), and the root sizes to that one line instead of
   *  filling its container. */
  singleLine?: boolean;
}>();

// Every prior use of this host is read-only (definitions, previews, op-log detail rows); the query
// console (P5.5) is the first editable one. `update:doc` only ever fires from the user's own
// typing (`EditorState.readOnly` already blocks programmatic edits from mattering when
// `readOnly` is true), so a read-only host never emits.
// `update:cursor` fires alongside `update:doc` on typing and also on a bare selection move (a
// click or arrow key with no text change) — the query console (P5.5) needs the latter to know
// which statement "Run statement" targets even when the user just clicked into one without
// editing it.
const emit = defineEmits<{ 'update:doc': [value: string]; 'update:cursor': [pos: number] }>();

const rootRef = ref<HTMLElement | null>(null);

// Never a ref/shallowRef/reactive — Vue must not see the view, its state or its DOM (§0's
// no-reactivity rule, D4). Wrapping it would proxy every internal object CodeMirror touches
// on every transaction, spending the 50 ms selection budget (§2.1) inside the proxy.
let view: EditorView | null = null;
// Tags the props.doc watcher's own dispatch below (line ~184) so the updateListener can tell it
// apart from a real keystroke — `update.docChanged` is true for either kind of transaction, and
// without this a *sync* here (this view catching up to some other write to `doc`, e.g. a sibling
// pane's own edit re-encoding through the same cell's doc) re-emits `update:doc` right back out as
// if the user had typed it, corrupting whatever the real edit in flight was.
const externalSync = Annotation.define<boolean>();
const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const autocompleteCompartment = new Compartment();
const lintCompartment = new Compartment();
const hoverCompartment = new Compartment();
const wordWrapCompartment = new Compartment();

// P42 D14/D14a: every editable and read-only surface mounts through this one host, so this is
// the one place a wrap setting has to live. `settingsState.appearance.wordWrap` defaults to
// `true` (the unconditional behavior this replaces, F11), read fresh on every (re)configure
// rather than captured once, same as the other four compartments' own resolve*() functions.
function resolveWordWrap(): Extension[] {
  if (props.singleLine) return [];
  return settingsState.appearance.wordWrap ? [EditorView.lineWrapping] : [];
}

function resolveLanguage(): ReturnType<typeof languageExtension> {
  return languageExtension(props.language, props.sqlDialect);
}

// P18 addendum D15: undo/redo lives here, not in a console special case, because History is a
// general editor capability — every prior host was read-only, which is why this went unnoticed.
// Folded into readOnlyCompartment (not a fifth compartment) and gated on !readOnly: undo is
// already inert under EditorState.readOnly, but the state field would otherwise accumulate one
// ChangeSet per programmatic doc swap in the definition viewer/cell editor/op-log rows, each
// retaining the previous document, against §2.2's memory target.
function resolveReadOnly(readOnly: boolean): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    // EditorState.readOnly only blocks transactions (typing is already inert without this); the
    // DOM's own contenteditable attribute is a separate facet (EditorView.editable) that CodeMirror
    // never infers from the former — every prior host stayed permanently read-only, so nothing ever
    // needed the DOM itself to say so until D27's truncated-value case, which refuses edits on a
    // cell that was previously editable and needs the panel to visibly reflect that.
    EditorView.editable.of(!readOnly),
    // newGroupDelay: 500 is the library default (undocumented as such, restated here so the
    // grouping window this editor relies on — a run of typed characters is one undo step, not one
    // per keystroke — is a decision this file states rather than one it merely inherits) — every
    // editable CodeMirrorHost (the query console, the cell editor) gets it from this one call.
    ...(readOnly ? [] : [history({ newGroupDelay: 500 }), keymap.of(historyKeymap)]),
  ];
}

// P18 addendum D18: completionKeymap's Enter is dropped and Tab takes over accepting a
// suggestion — the console is multi-line, so Enter must stay a newline (D6 applied to this
// surface); Escape/Ctrl-Space/Arrow/Page keys are the library's own.
const CONSOLE_COMPLETION_KEYMAP = [
  ...completionKeymap.filter((binding) => binding.key !== 'Enter'),
  { key: 'Tab', run: acceptCompletion },
];

// P18 D10: autocompletion() activates lang-sql's own keyword completion source (already
// registered as language data — languages.ts is unchanged) when `completionSources` is empty, or
// a tab-specific source (P18 addendum D21/D22/D23's Mongo/Redis consoles) when given one.
// addendum D17: every source this app registers is a synchronous lookup over a static array or an
// already-loaded list, so the library's default debounce (which exists to keep expensive/async
// sources off the keystroke path) only adds latency here — zeroed out. `interactionDelay: 0` is
// safe only because D18 moves accept off Enter onto Tab, which is never in flight while typing.
function resolveAutocomplete(): Extension[] {
  if (!props.autocomplete) return [];
  return [
    autocompletion({
      activateOnTypingDelay: 0,
      interactionDelay: 0,
      maxRenderedOptions: 25,
      defaultKeymap: false,
      override: props.completionSources?.length ? [...props.completionSources] : undefined,
    }),
    // P31 D36: mirrors @codemirror/autocomplete's own completionKeymapExt
    // (Prec.highest(keymap.computeN([completionConfig], …))) — with defaultKeymap: false above,
    // this app builds its own keymap instead of getting that wrapper for free, and without it
    // defaultKeymap's ArrowUp/ArrowDown (bound earlier in the extension array, CodeMirrorHost's
    // own keymap.of(defaultKeymap) below) win by array order and the popup never sees the key.
    // Prec.highest states the requirement outright rather than depending on that ordering.
    Prec.highest(keymap.of(CONSOLE_COMPLETION_KEYMAP)),
  ];
}

// D24/D25: no lint gutter, no lint panel/keymap — diagnostics show as an underline plus a hover
// tooltip only (theme.ts's `.cm-lintRange-*`/`.cm-diagnostic*` rules). `delay: 400` mirrors D17's
// reasoning in reverse: unlike completion, linting a whole document on every keystroke is not
// obviously free, so this keeps the library's own debounce rather than zeroing it like D17 did.
function resolveLint(): Extension[] {
  if (!props.lintSource) return [];
  const source = props.lintSource;
  return [
    linter(
      (view): Diagnostic[] =>
        source(view.state.doc.toString()).map((d) => ({
          from: d.from,
          to: d.to,
          severity: d.severity,
          message: d.message,
        })),
      { delay: 400 },
    ),
  ];
}

// C6: additive — an absent hoverSource is simply no extension, same shape as resolveLint().
function resolveHover(): Extension[] {
  return props.hoverSource ? [hoverTooltip(props.hoverSource)] : [];
}

onMounted(() => {
  const state = EditorState.create({
    doc: props.doc,
    extensions: [
      ...(props.singleLine ? [] : [lineNumbers()]),
      highlightSpecialChars(),
      wordWrapCompartment.of(resolveWordWrap()),
      // Item 5 (task batch P46-2): wrapSelection.ts's own doc comment covers why this is a custom,
      // selection-only handler rather than @codemirror/autocomplete's closeBrackets(). Static (no
      // prop toggles it, hence no compartment) — a read-only host sets EditorView.editable.of(false)
      // below, so its DOM is never actually editable and no beforeinput event (this handler's only
      // trigger) ever fires there; safe to include on every host regardless of `readOnly`.
      wrapSelectionOnType,
      keymap.of(defaultKeymap),
      autocompleteCompartment.of(resolveAutocomplete()),
      lintCompartment.of(resolveLint()),
      hoverCompartment.of(resolveHover()),
      syntaxHighlighting(kiraHighlightStyle),
      kiraEditorTheme,
      languageCompartment.of(resolveLanguage()),
      readOnlyCompartment.of(resolveReadOnly(props.readOnly)),
      EditorView.updateListener.of((update) => {
        const isExternalSync = update.transactions.some((tr) => tr.annotation(externalSync));
        if (update.docChanged && !isExternalSync) {
          emit('update:doc', update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          emit('update:cursor', update.state.selection.main.head);
        }
      }),
    ],
  });
  view = new EditorView({ state, parent: rootRef.value ?? undefined });
});

onUnmounted(() => {
  view?.destroy();
  view = null;
});

// A caller-driven refocus point: e.g. the query console's saved-queries popover unmounts its
// focused list entry on close (P18 addendum), which browsers resolve by dropping focus to
// <body> rather than back to the editor — there's nothing else in this component tree that
// would naturally reclaim it.
defineExpose({
  focus: () => view?.focus(),
});

watch(
  () => props.doc,
  (doc) => {
    if (!view) return;
    // Guards the editable round trip: a parent that binds `doc` to `update:doc`'s own value
    // sees this watcher fire right after the emit above — without the guard it would reset the
    // document to what's already there and jump the cursor to 0 on every keystroke.
    if (doc === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
      selection: { anchor: 0 },
      annotations: externalSync.of(true),
    });
    view.scrollDOM.scrollTop = 0;
  },
);

watch(
  () => [props.language, props.sqlDialect],
  () => {
    if (!view) return;
    view.dispatch({ effects: languageCompartment.reconfigure(resolveLanguage()) });
  },
);

watch(
  () => props.readOnly,
  (readOnly) => {
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.reconfigure(resolveReadOnly(readOnly)) });
  },
);

watch(
  () => [props.autocomplete, props.completionSources],
  () => {
    if (!view) return;
    view.dispatch({ effects: autocompleteCompartment.reconfigure(resolveAutocomplete()) });
  },
);

watch(
  () => props.lintSource,
  () => {
    if (!view) return;
    view.dispatch({ effects: lintCompartment.reconfigure(resolveLint()) });
  },
);

watch(
  () => props.hoverSource,
  () => {
    if (!view) return;
    view.dispatch({ effects: hoverCompartment.reconfigure(resolveHover()) });
  },
);

watch(
  () => settingsState.appearance.wordWrap,
  () => {
    if (!view) return;
    view.dispatch({ effects: wordWrapCompartment.reconfigure(resolveWordWrap()) });
  },
);

watch(
  () => [settingsState.appearance.fontFamily, settingsState.appearance.fontSize],
  () => {
    view?.requestMeasure();
  },
);
</script>

<template>
  <div ref="rootRef" class="cm-host" :class="{ 'cm-host--single-line': singleLine }"></div>
</template>

<style scoped>
.cm-host {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.cm-host :deep(.cm-editor) {
  height: 100%;
}

.cm-host--single-line,
.cm-host--single-line :deep(.cm-editor) {
  height: auto;
}

.cm-host--single-line :deep(.cm-scroller) {
  overflow: hidden;
  font-family: inherit;
}

.cm-host--single-line :deep(.cm-content) {
  padding: 0;
}

/* Item 2 regression (task batch P46-2): CodeMirror's base theme puts 6px of left/right padding
   on .cm-line itself, independent of .cm-content's own padding above — zeroing only .cm-content
   left this untouched, so AutocompleteField.vue's overlay painted every character ~6px (about one
   monospace character at this font size) to the right of the real, invisible <input>'s own text
   and caret. Looked like the colored text was permanently "one character behind" the actual
   cursor as you typed. */
.cm-host--single-line :deep(.cm-line) {
  padding-left: 0;
  padding-right: 0;
}

.cm-host--single-line :deep(.cm-gutters) {
  display: none;
}
</style>
