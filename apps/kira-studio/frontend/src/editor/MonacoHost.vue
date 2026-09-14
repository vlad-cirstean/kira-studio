<script setup lang="ts">
// P60a §3: a drop-in for `CodeMirrorHost.vue` — same prop names, same emits, same exposed
// methods, so every mount site changes only its import and its tag name. Two prop *types* change
// (§3.1) because their old types were CodeMirror types; everything else here is deliberately the
// same shape as `CodeMirrorHost.vue`, restated for Monaco's own API rather than redesigned.
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { settingsState } from '../state/settings';
import type { SqlDialect } from '../views/shared/sqlIdent';
import type { EditorCompletionKind, EditorCompletionSource } from './completion';
import type { ConsoleDiagnostic } from './diagnostics';
import type { ConsoleHoverInfo } from './hover';
import type { EditorLanguageId } from './languages';
import {
  KIRA_EDITOR_THEME,
  loadMonaco,
  type MonacoModule,
  overflowWidgetsContainer,
} from './monaco';
import { monacoLanguageIdFor } from './monacoLanguages';
import type { RangeHighlight } from './variableHighlight';

// `import('monaco-editor').X` inline type references, not a static `import type {...}` — matches
// `views/repo/editors.ts`/`monaco.ts`'s own established style for this ambient module's types.
type StandaloneCodeEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type TextModel = import('monaco-editor').editor.ITextModel;
type DecorationsCollection = import('monaco-editor').editor.IEditorDecorationsCollection;
type ConstructionOptions = import('monaco-editor').editor.IStandaloneEditorConstructionOptions;
type MonacoDisposable = import('monaco-editor').IDisposable;
type CompletionItemProvider = import('monaco-editor').languages.CompletionItemProvider;
type HoverProvider = import('monaco-editor').languages.HoverProvider;
type CompletionItemKind = import('monaco-editor').languages.CompletionItemKind;
type MonacoRange = import('monaco-editor').IRange;
type MarkdownString = import('monaco-editor').IMarkdownString;
type DeltaDecoration = import('monaco-editor').editor.IModelDeltaDecoration;
type MarkerData = import('monaco-editor').editor.IMarkerData;

const props = defineProps<{
  doc: string;
  language: EditorLanguageId;
  /** Only consulted when `language === 'sql'` — kept for prop-shape parity with
   *  `CodeMirrorHost.vue`; Monaco's own `sql` Monarch has no per-dialect keyword set (P60b's own
   *  scope owns SQL language services proper). */
  sqlDialect?: SqlDialect;
  readOnly: boolean;
  autocomplete?: boolean;
  /** §3.1: pure data in, pure data out — replaces `@codemirror/autocomplete`'s `CompletionSource`
   *  at this seam. */
  completionSources?: readonly EditorCompletionSource[];
  lintSource?: (doc: string) => ConsoleDiagnostic[];
  /** §3.1: simpler than the CodeMirror shape it replaces — `hover.ts`'s own `buildHoverSource`
   *  existed only to turn a pure lookup into a CodeMirror object; that glue collapses into the
   *  pure lookup itself here. */
  hoverSource?: (doc: string, offset: number) => ConsoleHoverInfo | null;
  singleLine?: boolean;
  rangeHighlights?: (doc: string) => readonly RangeHighlight[];
  autoCloseBrackets?: boolean;
  keepSelectionOnExternalSync?: boolean;
}>();

const emit = defineEmits<{ 'update:doc': [value: string]; 'update:cursor': [pos: number] }>();

const rootRef = ref<HTMLElement | null>(null);
// §3.3: renders the raw doc as text while loadMonaco()'s import is in flight — never an empty box.
const pending = ref(true);

// §3.2: never a ref/shallowRef/reactive — same no-reactivity rule as CodeMirrorHost.vue's own
// `view` (D4), restated here for the same reason: Vue must not proxy Monaco's internals on every
// keystroke.
let mod: MonacoModule | null = null;
let editor: StandaloneCodeEditor | null = null;
let model: TextModel | null = null;
let decorations: DecorationsCollection | null = null;
let completionDisposable: MonacoDisposable | null = null;
let hoverDisposable: MonacoDisposable | null = null;
let wrapDisposable: MonacoDisposable | null = null;
let lintTimer: ReturnType<typeof setTimeout> | undefined;
// §4.7's own `externalSync` annotation equivalent — a plain flag, no annotation machinery needed.
let applyingExternal = false;

function resolveWordWrap(): 'on' | 'off' {
  if (props.singleLine) return 'off';
  return settingsState.appearance.wordWrap ? 'on' : 'off';
}

// §4.6: `wrapSelection.ts`'s own selection-wrap handler, ported to Monaco's `onKeyDown` rather
// than relying on Monaco's own `autoSurround` (OQ-1) — `autoSurround` has no carve-out for a
// whole-document selection, and this app's own `mongo.spec.ts` depends on Select-All-then-retype
// staying a plain replace. A self-contained port guarantees the exact rule regardless of Monaco's
// internal behaviour, so `autoSurround` itself stays 'never' below and this handler is the only
// source of wrap-on-type. Deliberately unconditional (fires on every host, not gated by
// `autoCloseBrackets`) — wrapping a *non-empty* selection is never the thing that prop's own
// empty-pair auto-close would have silently "fixed" (`wrapSelection.ts`'s own reasoning).
const WRAP_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  "'": "'",
  '"': '"',
  '`': '`',
};

// §4.7/OQ-1: Select All, Undo and Redo are Monaco's only three core commands built on
// `EditorOrNativeTextInputCommand` (`coreCommands.js`, verified against the pinned 0.56.0) — its
// "editor has focus" branch checks `codeEditorService.getFocusedCodeEditor()?.hasTextFocus()`,
// which comes back false in WebKit even though the `.inputarea` textarea genuinely holds DOM
// focus (root cause not chased further: `view.isFocused()`'s own internal tracking, decoupled from
// `document.activeElement`, apparently lags a same-tick DOM focus + keypress here). All three then
// fall through to a "generic dom input" branch that runs a native `execCommand` on the hidden
// textarea instead of the real command — a plain no-op for Undo/Redo (the textarea has no
// undo/redo history of its own to speak of) and a same-DOM-node-only select for Select All. Each
// is handled directly here instead, calling the model's own API and bypassing that lookup
// entirely — this is the same code Monaco's own "editor has focus" branch would have run.
function attachWrapOnType(ed: StandaloneCodeEditor, m: TextModel): MonacoDisposable {
  return ed.onKeyDown((e) => {
    // `.toLowerCase()`, not a literal character: a real keypress always reports a lowercase
    // `key` when unshifted, but `page.keyboard.press('Control+A')` (several specs' own
    // capitalised `SELECT_ALL` constant) makes Playwright synthesize the browser event with the
    // literal key name it was given, `key: 'A'`, uppercase and shiftless both.
    const lowerKey = e.browserEvent.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (!e.shiftKey && lowerKey === 'a') {
        e.preventDefault();
        e.stopPropagation();
        ed.setSelection(m.getFullModelRange());
        return;
      }
      if (lowerKey === 'z') {
        e.preventDefault();
        e.stopPropagation();
        void (e.shiftKey ? m.redo() : m.undo());
        return;
      }
      // Ctrl+Y (not Cmd+Y, which is a no-op here): the Windows/Linux-only alternate redo chord.
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && lowerKey === 'y') {
        e.preventDefault();
        e.stopPropagation();
        void m.redo();
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.browserEvent.key;
    const close = WRAP_PAIRS[key];
    if (!close) return;
    const sel = ed.getSelection();
    if (!sel || sel.isEmpty()) return;
    const from = m.getOffsetAt(sel.getStartPosition());
    const to = m.getOffsetAt(sel.getEndPosition());
    // A whole-document selection (Select All, then retype) is a "replace everything" click, not a
    // "wrap everything" one — see `wrapSelection.ts:37`'s identical carve-out.
    if (from === 0 && to === m.getValue().length) return;
    e.preventDefault();
    e.stopPropagation();
    const selected = m.getValueInRange(sel);
    ed.executeEdits('kira-wrap-selection', [{ range: sel, text: `${key}${selected}${close}` }]);
    const newFrom = m.getPositionAt(from + key.length);
    const newTo = m.getPositionAt(to + key.length);
    ed.setSelection({
      startLineNumber: newFrom.lineNumber,
      startColumn: newFrom.column,
      endLineNumber: newTo.lineNumber,
      endColumn: newTo.column,
    });
  });
}

function kindFor(m: MonacoModule, type?: EditorCompletionKind): CompletionItemKind {
  const K = m.languages.CompletionItemKind;
  switch (type) {
    case 'variable':
      return K.Variable;
    case 'method':
      return K.Method;
    case 'function':
      return K.Function;
    case 'class':
      return K.Class;
    case 'keyword':
      return K.Keyword;
    case 'property':
      return K.Property;
    default:
      return K.Text;
  }
}

// §4.8: registered per host instance, model-scoped (returning empty suggestions for any other
// model) — Monaco's provider registry is global per language id, so an unscoped registration would
// leak one pane's completions into every other pane of the same language.
function buildCompletionProvider(m: MonacoModule): CompletionItemProvider {
  return {
    provideCompletionItems(candidateModel, position) {
      if (candidateModel !== model || !props.completionSources?.length) {
        return { suggestions: [] };
      }
      const doc = candidateModel.getValue();
      const offset = candidateModel.getOffsetAt(position);
      for (const source of props.completionSources) {
        const result = source({ doc, offset, explicit: false });
        if (!result) continue;
        const start = candidateModel.getPositionAt(result.from);
        const range: MonacoRange = {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        };
        return {
          suggestions: result.options.map((opt, index) => ({
            label: opt.label,
            kind: kindFor(m, opt.type),
            detail: opt.detail,
            // §4.8: the six BSON constructors' own `#{}` snippet placeholder maps to Monaco's `$0`.
            insertText: opt.snippet ?? opt.insert ?? opt.label,
            insertTextRules: opt.snippet
              ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            // §4.8: `Completion.boost` -> a sort prefix; boosted entries sort before the rest,
            // stable order preserved among equals via the zero-padded index.
            sortText: `${opt.boost ? 0 : 1}${String(index).padStart(4, '0')}`,
            range,
          })),
        };
      }
      return { suggestions: [] };
    },
  };
}

// §4.4: registered per host instance, model-scoped the same way completion is.
function buildHoverProvider(): HoverProvider {
  return {
    provideHover(candidateModel, position) {
      if (candidateModel !== model || !props.hoverSource) return null;
      const offset = candidateModel.getOffsetAt(position);
      const info = props.hoverSource(candidateModel.getValue(), offset);
      if (!info) return null;
      const start = candidateModel.getPositionAt(info.from);
      const end = candidateModel.getPositionAt(info.to);
      const contents: MarkdownString[] = [];
      // §4.4: `value` -> one fenced block, so a pretty-printed value keeps its line breaks; fenced
      // content is never interpolated as markup, so this is safe even for arbitrary app data.
      if (info.value !== undefined) {
        contents.push({ value: `\`\`\`\n${info.value}\n\`\`\`` });
      }
      for (const line of info.lines) {
        contents.push({ value: line, supportHtml: false });
      }
      return {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        contents,
      };
    },
  };
}

function registerProviders(m: MonacoModule, languageId: string): void {
  completionDisposable?.dispose();
  completionDisposable = null;
  hoverDisposable?.dispose();
  hoverDisposable = null;
  if (props.completionSources?.length) {
    completionDisposable = m.languages.registerCompletionItemProvider(
      languageId,
      buildCompletionProvider(m),
    );
  }
  if (props.hoverSource) {
    hoverDisposable = m.languages.registerHoverProvider(languageId, buildHoverProvider());
  }
}

// §4.3: `variableHighlight.ts`'s `RangeHighlight` kept verbatim; the `ViewPlugin` becomes a
// decorations collection rebuilt on the same two triggers CodeMirror used — content change and a
// `rangeHighlights` prop-identity change.
function repaintRanges(): void {
  if (!decorations) return;
  if (!model || !props.rangeHighlights) {
    decorations.set([]);
    return;
  }
  const text = model.getValue();
  const built: DeltaDecoration[] = [];
  for (const r of props.rangeHighlights(text)) {
    // The same offset-validity filter `variableHighlight.ts:28` keeps — a caller's ranges can be
    // one keystroke stale.
    if (!(r.from >= 0 && r.from < r.to && r.to <= text.length)) continue;
    const start = model.getPositionAt(r.from);
    const end = model.getPositionAt(r.to);
    built.push({
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      options: { inlineClassName: r.class, inlineClassNameAffectsLetterSpacing: false },
    });
  }
  decorations.set(built);
}

// §4.5: 400 ms-debounced, mapped to `editor.setModelMarkers` — a themed wavy underline plus a
// hover, no gutter and no lint panel (D24/D25's own reasoning, restated for Monaco).
function scheduleLint(m: MonacoModule): void {
  clearTimeout(lintTimer);
  if (!model || !props.lintSource) {
    if (model) m.editor.setModelMarkers(model, 'kira', []);
    return;
  }
  const source = props.lintSource;
  const targetModel = model;
  lintTimer = setTimeout(() => {
    if (targetModel.isDisposed()) return;
    const markers: MarkerData[] = source(targetModel.getValue()).map((d) => {
      const start = targetModel.getPositionAt(d.from);
      const end = targetModel.getPositionAt(d.to);
      return {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        severity: d.severity === 'error' ? m.MarkerSeverity.Error : m.MarkerSeverity.Warning,
        message: d.message,
      };
    });
    m.editor.setModelMarkers(targetModel, 'kira', markers);
  }, 400);
}

function applyBaseOptions(): ConstructionOptions {
  return {
    automaticLayout: true,
    readOnly: props.readOnly,
    domReadOnly: props.readOnly,
    lineNumbers: props.singleLine ? 'off' : 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    folding: false,
    glyphMargin: false,
    fixedOverflowWidgets: true,
    // §4.4/dogfooding: `fixedOverflowWidgets` alone keeps a widget a DOM descendant of this host
    // (only escaping ancestor `overflow: hidden` visually, via `position: fixed`) — this is what
    // actually reparents it to `document.body`, matching capability 20's own requirement and
    // `CodeMirrorHost.vue`'s old `tooltips({ parent: document.body })`.
    overflowWidgetsDomNode: overflowWidgetsContainer(),
    wordWrap: resolveWordWrap(),
    autoSurround: 'never', // §4.6: this host's own onKeyDown handler owns wrap-on-type instead.
    autoClosingBrackets: props.autoCloseBrackets ? 'languageDefined' : 'never',
    autoClosingQuotes: props.autoCloseBrackets ? 'languageDefined' : 'never',
    quickSuggestions: Boolean(props.autocomplete),
    quickSuggestionsDelay: 0,
    suggestOnTriggerCharacters: Boolean(props.autocomplete),
    acceptSuggestionOnEnter: 'off',
    tabCompletion: 'on',
    wordBasedSuggestions: props.completionSources?.length ? 'off' : undefined,
    occurrencesHighlight: 'off',
    hover: { delay: 400, above: true },
    fontFamily: settingsState.appearance.fontFamily,
    fontSize: settingsState.appearance.fontSize,
    ...(props.singleLine
      ? { lineDecorationsWidth: 0, lineNumbersMinChars: 0, padding: { top: 0, bottom: 0 } }
      : { padding: { top: 8, bottom: 8 } }),
  };
}

onMounted(async () => {
  const resolved = await loadMonaco();
  // Unmounted while the import was in flight — dispose nothing, mount nothing.
  if (!rootRef.value) return;
  mod = resolved;

  model = mod.editor.createModel(props.doc, monacoLanguageIdFor(props.language));
  editor = mod.editor.create(rootRef.value, {
    ...applyBaseOptions(),
    model,
    theme: KIRA_EDITOR_THEME,
  });
  decorations = editor.createDecorationsCollection();
  // Only now — Monaco's own DOM already exists inside `rootRef`, so the pending <pre>'s v-if
  // removal (Vue's own, batched) never has a window where neither one nor both are showing real
  // content.
  pending.value = false;

  wrapDisposable = attachWrapOnType(editor, model);
  registerProviders(mod, monacoLanguageIdFor(props.language));
  repaintRanges();
  scheduleLint(mod);
  updateDebugHook();

  model.onDidChangeContent(() => {
    if (!applyingExternal) emit('update:doc', model?.getValue() ?? '');
    repaintRanges();
    if (mod) scheduleLint(mod);
    updateDebugHook();
  });
  editor.onDidChangeCursorPosition((e) => {
    if (!model) return;
    emit('update:cursor', model.getOffsetAt(e.position));
  });
});

onUnmounted(() => {
  clearTimeout(lintTimer);
  decorations?.clear();
  decorations = null;
  completionDisposable?.dispose();
  completionDisposable = null;
  hoverDisposable?.dispose();
  hoverDisposable = null;
  wrapDisposable?.dispose();
  wrapDisposable = null;
  editor?.dispose();
  editor = null;
  model?.dispose();
  model = null;
});

// tests/ui's own text-reading seam (P60a §9.1/OQ-3) — Monaco virtualises `.view-lines`, so a full
// read needs the model, not the DOM. Compiled out of every non-debug build, matching
// `vite.config.ts`'s own `__KIRA_DEBUG_HOOKS__` convention (main.ts's `window.__kira*` hooks).
function updateDebugHook(): void {
  if (!__KIRA_DEBUG_HOOKS__) return;
  rootRef.value?.setAttribute('data-kira-editor-text', model?.getValue() ?? '');
}

defineExpose({
  focus: (): void => editor?.focus(),
  // §4.9: `getTargetAtClientPoint` + `getOffsetAt` — `null` when the point falls outside any
  // character, matching `EditorView.posAtCoords`'s own contract.
  posAtCoords: (x: number, y: number): number | null => {
    if (!editor || !model) return null;
    const target = editor.getTargetAtClientPoint(x, y);
    return target?.position ? model.getOffsetAt(target.position) : null;
  },
  scrollRangeIntoView: (from: number, to: number): void => {
    if (!editor || !model) return;
    const start = model.getPositionAt(from);
    const end = model.getPositionAt(to);
    editor.revealRangeInCenter({
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    });
  },
  setCursor: (pos: number): void => {
    if (!editor || !model) return;
    const clamped = Math.min(Math.max(0, pos), model.getValue().length);
    const position = model.getPositionAt(clamped);
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
  },
});

watch(
  () => props.doc,
  (doc) => {
    if (!editor || !model) return;
    // Guards the editable round trip — same as `CodeMirrorHost.vue:329`.
    if (doc === model.getValue()) return;
    const currentPosition = editor.getPosition();
    const priorOffset = currentPosition ? model.getOffsetAt(currentPosition) : 0;
    // §4.7: the hard undo boundary around every external write — both `pushStackElement()` calls
    // are mandatory (one alone leaves the write mergeable on one side); `model.setValue()` is never
    // used here, since it discards the whole undo stack instead of isolating just this edit.
    applyingExternal = true;
    model.pushStackElement();
    model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: doc }], () => null);
    model.pushStackElement();
    applyingExternal = false;
    if (props.keepSelectionOnExternalSync) {
      const clamped = Math.min(priorOffset, doc.length);
      const position = model.getPositionAt(clamped);
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
    } else {
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.setScrollTop(0);
    }
  },
);

watch(
  () => [props.language, props.sqlDialect],
  () => {
    if (!mod || !model) return;
    const languageId = monacoLanguageIdFor(props.language);
    mod.editor.setModelLanguage(model, languageId);
    registerProviders(mod, languageId);
  },
);

watch(
  () => props.readOnly,
  (readOnly) => {
    editor?.updateOptions({ readOnly, domReadOnly: readOnly });
  },
);

watch(
  () => [props.autocomplete, props.completionSources],
  () => {
    if (!mod) return;
    editor?.updateOptions({
      quickSuggestions: Boolean(props.autocomplete),
      suggestOnTriggerCharacters: Boolean(props.autocomplete),
      wordBasedSuggestions: props.completionSources?.length ? 'off' : undefined,
    });
    registerProviders(mod, monacoLanguageIdFor(props.language));
  },
);

watch(
  () => props.lintSource,
  () => {
    if (mod) scheduleLint(mod);
  },
);

watch(
  () => props.hoverSource,
  () => {
    if (mod) registerProviders(mod, monacoLanguageIdFor(props.language));
  },
);

watch(
  () => props.rangeHighlights,
  () => repaintRanges(),
);

watch(
  () => props.autoCloseBrackets,
  (on) => {
    editor?.updateOptions({
      autoClosingBrackets: on ? 'languageDefined' : 'never',
      autoClosingQuotes: on ? 'languageDefined' : 'never',
    });
  },
);

watch(
  () => settingsState.appearance.wordWrap,
  () => {
    editor?.updateOptions({ wordWrap: resolveWordWrap() });
  },
);

watch(
  () => [settingsState.appearance.fontFamily, settingsState.appearance.fontSize],
  () => {
    if (!editor) return;
    editor.updateOptions({
      fontFamily: settingsState.appearance.fontFamily,
      fontSize: settingsState.appearance.fontSize,
    });
    editor.layout();
  },
);
</script>

<template>
  <!-- A single root, not `pending`'s <pre> and this <div> as two siblings — a multi-root template
       gets no automatic $attrs fallthrough at all (Vue silently drops every data-testid/class a
       call site passes on the <MonacoHost> tag, e.g. RawExchangePane's own `data-testid="http-
       wire-request-editor"`), which every mount site's own drop-in contract (§3) depends on.
       Monaco mounts into this same div (`rootRef`); the pending <pre> is a child of it, removed by
       `v-if` the instant `pending` flips false, which is also the instant `editor.create()` has
       already appended Monaco's own DOM into the same container — briefly (one microtask) both
       are present, never observably so.

       No `data-testid` of its own on the root, deliberately: a static attribute set here would win
       Vue's own fallthrough merge over whatever `data-testid` a call site passes on `<MonacoHost>`
       (`class`/`style` concatenate on fallthrough; every other attribute, the child's own explicit
       value wins) — exactly the drop-in contract this host exists to keep
       (`CodeMirrorHost.vue`'s own root carried no `data-testid` for the identical reason). `.monaco-host`
       (the class, which DOES merge) is what `tests/ui/support/editorText.ts` and every UI spec use
       instead to find "the Monaco host" generically inside a call site's own more specific one. -->
  <div
    ref="rootRef"
    class="monaco-host"
    :class="{ 'monaco-host--single-line': singleLine }"
  >
    <pre
      v-if="pending"
      class="monaco-host-pending"
      :class="{ 'monaco-host--single-line': singleLine }"
      >{{ doc }}</pre
    >
  </div>
</template>

<style scoped>
.monaco-host {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.monaco-host-pending {
  margin: 0;
  padding: 8px 0;
  font-family: var(--kira-font-data);
  font-size: var(--kira-font-size);
  color: var(--kira-fg);
  background-color: var(--kira-bg);
  white-space: pre-wrap;
  overflow: auto;
}

.monaco-host--single-line.monaco-host-pending {
  padding: 0;
  white-space: pre;
}

.monaco-host--single-line,
.monaco-host--single-line :deep(.monaco-editor) {
  height: auto;
}

/* §4.1: app-owned `{{variable}}`/find-bar classes — byte-identical values to `theme.ts:176-251`,
   only the class prefix renamed (`.cm-kira-*` -> `.kira-ed-*`). */
.monaco-host :deep(.kira-ed-var) {
  color: var(--kira-var-resolved);
}

.monaco-host :deep(.kira-ed-var-secret) {
  color: var(--kira-var-resolved);
  text-decoration: underline dotted var(--kira-syntax-meta);
}

.monaco-host :deep(.kira-ed-var-unknown) {
  color: var(--kira-warn);
  text-decoration: underline wavy var(--kira-warn);
}

.monaco-host :deep(.kira-ed-find-match) {
  background: var(--kira-search-match);
}

.monaco-host :deep(.kira-ed-find-match-current) {
  background: var(--kira-search-match-current);
}

/* §4.4/dogfooding: the hover widget's value/caption split — `theme.ts:200,213`'s own two
   registers, ported here. `:global()`, not `:deep()` — `overflowWidgetsDomNode`
   (`editor/monaco.ts`) reparents every hover/suggest widget from every MonacoHost instance to one
   shared `document.body`-level container, so they are never a DOM descendant of `.monaco-host` to
   scope a selector against. */
:global(.monaco-hover) {
  z-index: var(--kira-z-tooltip);
}

:global(.monaco-hover .hover-contents pre) {
  background-color: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  padding: 4px 6px;
}

:global(.monaco-hover .hover-contents p) {
  font-family: var(--kira-font-ui);
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-muted);
}

:global(.suggest-widget) {
  z-index: var(--kira-z-tooltip);
}
</style>
