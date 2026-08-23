<script setup lang="ts">
import { defaultKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { settingsState } from '../state/settings';
import { type EditorLanguageId, languageExtension } from './languages';
import { kiraEditorTheme, kiraHighlightStyle } from './theme';

const props = defineProps<{
  doc: string;
  language: EditorLanguageId;
  /** Only consulted when `language === 'sql'` (D17). */
  sqlDialect?: 'postgres' | 'mariadb';
  readOnly: boolean;
}>();

// Every prior use of this host is read-only (DDL, previews, op-log detail rows); the query
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
const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

function resolveLanguage(): ReturnType<typeof languageExtension> {
  return languageExtension(props.language, props.sqlDialect);
}

onMounted(() => {
  const state = EditorState.create({
    doc: props.doc,
    extensions: [
      lineNumbers(),
      highlightSpecialChars(),
      EditorView.lineWrapping,
      keymap.of(defaultKeymap),
      syntaxHighlighting(kiraHighlightStyle),
      kiraEditorTheme,
      languageCompartment.of(resolveLanguage()),
      readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit('update:doc', update.state.doc.toString());
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
    view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)) });
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
  <div ref="rootRef" class="cm-host"></div>
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
</style>
