<script setup lang="ts">
import { KIRA_EDITOR_THEME, loadMonaco } from '@workbench/editor/monaco';
import { onMounted, onUnmounted, ref, watch } from 'vue';

type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;
type Model = import('monaco-editor').editor.ITextModel;

// Side-by-side diff of the default text (left) against the draft (right). Both sides are
// read-only; editing happens on the Edit tab.
const props = defineProps<{ original: string; modified: string }>();

const root = ref<HTMLElement | null>(null);
let diff: DiffEditor | null = null;
let originalModel: Model | null = null;
let modifiedModel: Model | null = null;

function syncDebugText(): void {
  if (!__KIRA_DEBUG_HOOKS__ || !root.value) return;
  root.value.setAttribute('data-kira-diff-original-text', props.original);
  root.value.setAttribute('data-kira-diff-modified-text', props.modified);
}

onMounted(async () => {
  const mod = await loadMonaco();
  if (!root.value) return;
  originalModel = mod.editor.createModel(props.original, 'plaintext');
  modifiedModel = mod.editor.createModel(props.modified, 'plaintext');
  diff = mod.editor.createDiffEditor(root.value, {
    theme: KIRA_EDITOR_THEME,
    readOnly: true,
    domReadOnly: true,
    originalEditable: false,
    renderMarginRevertIcon: false,
    renderGutterMenu: false,
    automaticLayout: true,
    renderSideBySide: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
  });
  diff.setModel({ original: originalModel, modified: modifiedModel });
  syncDebugText();
});

onUnmounted(() => {
  diff?.dispose();
  originalModel?.dispose();
  modifiedModel?.dispose();
  diff = null;
});

watch(
  () => [props.original, props.modified],
  () => {
    originalModel?.setValue(props.original);
    modifiedModel?.setValue(props.modified);
    syncDebugText();
  },
);
</script>

<template>
  <div
    ref="root"
    class="relative h-full min-h-40 overflow-hidden rounded-kira-sm border border-border"
  ></div>
</template>
