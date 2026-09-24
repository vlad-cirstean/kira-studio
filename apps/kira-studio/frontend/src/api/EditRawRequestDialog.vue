<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import MonacoHost from '../editor/MonacoHost.vue';
import { useEditRawStore } from './state/raw';

const editRawStore = useEditRawStore();

// P9 D8/D9: a raw HTTP/1.1 text buffer the user hand-edits, parsed back into the structured model
// on Apply — never a second send path (there is exactly one, and it takes tab state). MonacoHost
// editable (RequestBodyPane.vue's own `:read-only="false"` shape), not a plain <textarea>: unlike a
// single-line curl command, a raw request is genuinely multi-line and benefits from real line
// numbers (F17 — no new primitive, no new dependency).
const text = ref('');

// Round-2 review finding 7 (the same class ImportCurlDialog.vue's own finding 15 fixed for curl
// import, worse here since this buffer is always the full generated request, not something
// typically hand-pasted small): re-parsing the whole buffer on every single keystroke just to
// update a preview has no business running that often — the editor itself (`text`) stays bound
// immediately so typing never stutters; the preview below reads a debounced copy instead. 400ms
// mirrors ImportCurlDialog.vue's own precedent for the identical shape. P99 Part 3: useDebounceFn
// over refDebounced(text, 400) — an external open must write debouncedText immediately (below), not
// 400ms later, matching project/SchemaDialog.vue's own identical-shape precedent (P99 Part 2).
const debouncedText = ref('');
const setDebouncedText = useDebounceFn((value: string) => {
  debouncedText.value = value;
}, 400);
onBeforeUnmount(() => setDebouncedText.cancel());

watch(
  () => editRawStore.open,
  (open) => {
    if (!open) return;
    text.value = editRawStore.initialText;
    setDebouncedText.cancel();
    debouncedText.value = editRawStore.initialText;
  },
  { immediate: true },
);
watch(text, (value) => {
  void setDebouncedText(value);
});

const preview = computed(() => editRawStore.previewRaw(debouncedText.value));

// Built in script rather than the template: a literal '{{variables}}' inside a template mustache
// would be misread by the Vue compiler as the interpolation's own closing '}}' — CopyAsCurlDialog.vue's
// own dynamicNote hit the identical parse error and states the same fix.
const hint =
  'This is the request as you authored it — {{variables}} are resolved when you send. To see what actually went out, use the response pane’s Raw view.';

function onDocChange(value: string): void {
  text.value = value;
}

function onApply(): void {
  editRawStore.applyEditRaw(text.value);
}

function close(): void {
  editRawStore.closeEditRawDialog();
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && close()">
    <DialogContent
      :show-close-button="false"
      data-testid="edit-raw-dialog"
      class="flex flex-col p-0 gap-0 w-170 max-h-4/5"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Edit as raw HTTP</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="edit-raw-dialog-close"
            @click="close"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="overflow-auto">
    <div class="flex flex-col gap-2 p-3">
      <div class="text-kira-sm text-muted-foreground" data-testid="edit-raw-hint">{{ hint }}</div>

      <div class="raw-editor">
        <MonacoHost
          :doc="text"
          language="plain"
          :read-only="false"
          data-testid="edit-raw-textarea"
          @update:doc="onDocChange"
        />
      </div>

      <Alert v-if="preview.error" variant="destructive" data-testid="edit-raw-error">
        <AlertDescription>{{ preview.error }}</AlertDescription>
      </Alert>
      <template v-else>
        <Alert v-if="preview.modeChanged" variant="warn" data-testid="edit-raw-mode-changed">
          <AlertDescription>
            The body mode changes from <strong>{{ preview.modeChanged.from }}</strong> to
            <strong>{{ preview.modeChanged.to }}</strong> — the bytes and headers this sends are
            unchanged, only the editor for the body is.
          </AlertDescription>
        </Alert>
        <Alert v-if="preview.warnings.length > 0" variant="warn" data-testid="edit-raw-warnings">
          <AlertDescription>
            <ul class="warnings">
              <li v-for="(warning, i) in preview.warnings" :key="i" :data-kind="warning.kind">
                {{ warning.detail }}
              </li>
            </ul>
          </AlertDescription>
        </Alert>
      </template>
    </div>
      </div>

      <DialogFooter class="border-t border-border bg-transparent">
        <span class="flex items-center gap-1.5 ml-auto">
          <Button variant="dialog" size="kira-lg" data-testid="edit-raw-cancel" @click="close">Cancel</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="edit-raw-apply"
            :disabled="preview.error !== null"
            @click="onApply"
          >
            Apply
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
@reference "@theme/base.css";

.raw-editor {
  @apply h-80 overflow-hidden rounded-kira border border-border;
}

.warnings {
  @apply m-0 flex flex-col gap-0.5 pl-2;
}
</style>
