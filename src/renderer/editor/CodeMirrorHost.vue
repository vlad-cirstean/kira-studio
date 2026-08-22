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
