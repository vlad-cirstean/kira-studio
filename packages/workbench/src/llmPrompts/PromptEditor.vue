<script setup lang="ts">
import type { LlmPromptProblem } from '@shared/domain/llmPrompts';
import { KIRA_EDITOR_THEME, loadMonaco, type MonacoModule } from '@workbench/editor/monaco';
import { onMounted, onUnmounted, ref, watch } from 'vue';

type Editor = import('monaco-editor').editor.IStandaloneCodeEditor;
type Model = import('monaco-editor').editor.ITextModel;

// Plain-text Monaco for one prompt. Template errors from the server render as markers; `insert`
// puts a variable reference at the caret.
const props = defineProps<{ problems?: readonly LlmPromptProblem[]; readonly?: boolean }>();
const text = defineModel<string>({ required: true });

const root = ref<HTMLElement | null>(null);
const ready = ref(false);
let mod: MonacoModule | null = null;
let editor: Editor | null = null;
let model: Model | null = null;
let applyingExternal = false;

function syncDebugText(): void {
  if (!__KIRA_DEBUG_HOOKS__) return;
  root.value?.setAttribute('data-kira-editor-text', model?.getValue() ?? text.value);
}

function paintProblems(): void {
  if (!mod || !model) return;
  const target = model;
  const monaco = mod;
  monaco.editor.setModelMarkers(
    target,
    'kira',
    (props.problems ?? []).map((p) => {
      const line = Math.min(Math.max(1, p.line), target.getLineCount());
      return {
        startLineNumber: line,
        startColumn: Math.max(1, p.col),
        endLineNumber: line,
        endColumn: target.getLineMaxColumn(line),
        severity: monaco.MarkerSeverity.Error,
        message: p.message,
      };
    }),
  );
}

onMounted(async () => {
  const loaded = await loadMonaco();
  if (!root.value) return;
  mod = loaded;
  model = loaded.editor.createModel(text.value, 'plaintext');
  editor = loaded.editor.create(root.value, {
    model,
    theme: KIRA_EDITOR_THEME,
    automaticLayout: true,
    readOnly: props.readonly,
    domReadOnly: props.readonly,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    folding: false,
    glyphMargin: false,
    renderLineHighlight: 'none',
    occurrencesHighlight: 'off',
    quickSuggestions: false,
    padding: { top: 8, bottom: 8 },
  });
  model.onDidChangeContent(() => {
    if (!applyingExternal && model) text.value = model.getValue();
    syncDebugText();
  });
  ready.value = true;
  paintProblems();
  syncDebugText();
});

onUnmounted(() => {
  editor?.dispose();
  model?.dispose();
  editor = null;
  model = null;
});

// An outside write (reset, a refresh) replaces the text as one undoable edit.
watch(text, (next) => {
  if (!model || model.getValue() === next) return;
  applyingExternal = true;
  model.pushStackElement();
  model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: next }], () => null);
  model.pushStackElement();
  applyingExternal = false;
  syncDebugText();
});

watch(() => props.problems, paintProblems);
watch(
  () => props.readonly,
  (readOnly) => editor?.updateOptions({ readOnly, domReadOnly: readOnly }),
);

defineExpose({
  insert(snippet: string): void {
    if (!editor) return;
    const range = editor.getSelection() ?? model?.getFullModelRange();
    if (!range) return;
    editor.executeEdits('llm-prompt-insert', [{ range, text: snippet, forceMoveMarkers: true }]);
  },
});
</script>

<template>
  <div
    ref="root"
    class="monaco-host relative h-full min-h-40 overflow-hidden rounded-kira-sm border border-border"
  >
    <pre
      v-if="!ready"
      class="m-0 h-full overflow-auto whitespace-pre-wrap bg-bg px-2 py-2 font-data text-kira-md text-fg"
    >{{ text }}</pre>
  </div>
</template>
