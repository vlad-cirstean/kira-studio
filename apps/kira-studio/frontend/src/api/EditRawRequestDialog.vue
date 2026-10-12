<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { useDebounceFn } from '@vueuse/core';
import { TIMING } from '@workbench/behaviour/timing';
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
// immediately so typing never stutters; the preview below reads a debounced copy instead
// (TIMING.preview). P99 Part 3: useDebounceFn over refDebounced(text) — an external open must write debouncedText immediately (below), not
// a debounce later, matching project/SchemaDialog.vue's own identical-shape precedent (P99 Part 2).
const debouncedText = ref('');
const setDebouncedText = useDebounceFn((value: string) => {
  debouncedText.value = value;
}, TIMING.preview);
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
const hint = t('studio.api.editRaw.hint', { variables: '{{variables}}' });

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
    <DialogContent size="xl" data-testid="edit-raw-dialog">
      <DialogHeader close-testid="edit-raw-dialog-close">
        <DialogTitle>{{ t('studio.api.editRaw.title') }}</DialogTitle>
      </DialogHeader>
      <DialogBody>
      <div class="text-kira-sm text-muted-foreground" data-testid="edit-raw-hint">{{ hint }}</div>

      <div class="h-80 overflow-hidden rounded-kira border border-border">
        <MonacoHost
          :doc="text"
          language="plain"
          :read-only="false"
          data-testid="edit-raw-textarea"
          @update:doc="onDocChange"
        />
      </div>

      <Alert v-if="preview.error" variant="error" data-testid="edit-raw-error">
        <AlertDescription>{{ preview.error }}</AlertDescription>
      </Alert>
      <template v-else>
        <Alert v-if="preview.modeChanged" variant="warn" data-testid="edit-raw-mode-changed">
          <AlertDescription>
            <CatalogText k="studio.api.editRaw.modeChanged.body">
              <template #from><strong>{{ preview.modeChanged.from }}</strong></template>
              <template #to><strong>{{ preview.modeChanged.to }}</strong></template>
            </CatalogText>
          </AlertDescription>
        </Alert>
        <Alert v-if="preview.warnings.length > 0" variant="warn" data-testid="edit-raw-warnings">
          <AlertDescription>
            <ul class="m-0 flex flex-col gap-0.5 pl-2">
              <li v-for="(warning, i) in preview.warnings" :key="i" :data-kind="warning.kind">
                {{ t(warning.detail.key, warning.detail.params) }}
              </li>
            </ul>
          </AlertDescription>
        </Alert>
      </template>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="edit-raw-cancel" @click="close">{{ t('common.action.cancel.label') }}</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="edit-raw-apply"
            :disabled="preview.error !== null"
            @click="onApply"
          >
            {{ t('common.action.apply.label') }}
          </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
