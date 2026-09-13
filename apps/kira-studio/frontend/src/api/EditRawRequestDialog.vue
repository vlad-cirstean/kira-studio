<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import CodeMirrorHost from '../editor/CodeMirrorHost.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import { applyEditRaw, closeEditRawDialog, editRawDialogState, previewRaw } from './state/raw';

// P9 D8/D9: a raw HTTP/1.1 text buffer the user hand-edits, parsed back into the structured model
// on Apply — never a second send path (there is exactly one, and it takes tab state). CodeMirrorHost
// editable (RequestBodyPane.vue's own `:read-only="false"` shape), not a plain <textarea>: unlike a
// single-line curl command, a raw request is genuinely multi-line and benefits from real line
// numbers (F17 — no new primitive, no new dependency).
const text = ref('');

// Round-2 review finding 7 (the same class ImportCurlDialog.vue's own finding 15 fixed for curl
// import, worse here since this buffer is always the full generated request, not something
// typically hand-pasted small): re-parsing the whole buffer on every single keystroke just to
// update a preview has no business running that often — the editor itself (`text`) stays bound
// immediately so typing never stutters; the preview below reads a debounced copy instead. 400ms
// mirrors ImportCurlDialog.vue's own precedent for the identical shape.
const debouncedText = ref('');
let previewTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(previewTimer));

watch(
  () => editRawDialogState.open,
  (open) => {
    if (!open) return;
    text.value = editRawDialogState.initialText;
    clearTimeout(previewTimer);
    debouncedText.value = editRawDialogState.initialText;
  },
  { immediate: true },
);
watch(text, (value) => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    debouncedText.value = value;
  }, 400);
});

const preview = computed(() => previewRaw(debouncedText.value));

// Built in script rather than the template: a literal '{{variables}}' inside a template mustache
// would be misread by the Vue compiler as the interpolation's own closing '}}' — CopyAsCurlDialog.vue's
// own dynamicNote hit the identical parse error and states the same fix.
const hint =
  'This is the request as you authored it — {{variables}} are resolved when you send. To see what actually went out, use the response pane’s Raw view.';

function onDocChange(value: string): void {
  text.value = value;
}

function onApply(): void {
  applyEditRaw(text.value);
}

function close(): void {
  closeEditRawDialog();
}
</script>

<template>
  <DialogFrame
    title="Edit as raw HTTP"
    :width="680"
    max-height="80vh"
    test-id="edit-raw-dialog"
    close-test-id="edit-raw-dialog-close"
    @close="close"
  >
    <div class="p-dialog-body">
      <div class="p-sm muted" data-testid="edit-raw-hint">{{ hint }}</div>

      <div class="raw-editor">
        <CodeMirrorHost
          :doc="text"
          language="plain"
          :read-only="false"
          data-testid="edit-raw-textarea"
          @update:doc="onDocChange"
        />
      </div>

      <MessageStrip v-if="preview.error" tone="err" data-testid="edit-raw-error">
        {{ preview.error }}
      </MessageStrip>
      <template v-else>
        <MessageStrip
          v-if="preview.modeChanged"
          tone="warn"
          data-testid="edit-raw-mode-changed"
        >
          The body mode changes from <strong>{{ preview.modeChanged.from }}</strong> to
          <strong>{{ preview.modeChanged.to }}</strong> — the bytes and headers this sends are
          unchanged, only the editor for the body is.
        </MessageStrip>
        <MessageStrip
          v-if="preview.warnings.length > 0"
          tone="warn"
          data-testid="edit-raw-warnings"
        >
          <ul class="warnings">
            <li v-for="(warning, i) in preview.warnings" :key="i" :data-kind="warning.kind">
              {{ warning.detail }}
            </li>
          </ul>
        </MessageStrip>
      </template>
    </div>

    <template #footer>
      <span class="p-dialog-actions p-push">
        <AppButton kind="dialog" data-testid="edit-raw-cancel" @click="close">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="edit-raw-apply"
          :disabled="preview.error !== null"
          @click="onApply"
        >
          Apply
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.raw-editor {
  height: 320px;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  overflow: hidden;
}

.warnings {
  margin: 0;
  padding-left: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
}

</style>
