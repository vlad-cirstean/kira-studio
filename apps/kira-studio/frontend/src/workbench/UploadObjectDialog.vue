<script setup lang="ts">
import { contentTypeForFilename } from '@shared/domain/object-store';
import { decodePath } from '@shared/domain/tree';
import { computed, ref, watch } from 'vue';
import { control } from '../bridge/control';
import { formatBytes } from '../format';
import { closeUploadDialog, uploadDialogState, uploadObject } from '../state/objectStore';
import { openKeyValueTab } from '../state/tabs';
import { browseInvalidate } from '../state/viewCommands';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import TextField from '../theme/primitives/TextField.vue';

// P33 D17: three entry points as of P41 (the Browse panel's own container rows/toolbar and — until
// the tree stops rendering bucket/prefix rows, P41 D5 — the tree's own bucket/prefix menu) — driven
// entirely by state/objectStore.ts's uploadDialogState so project/menus.ts can open it without
// importing this component or any views/ module (§11's dependency rule).

const chosenFile = ref<{ path: string; name: string; size: number } | null>(null);
const key = ref('');
const contentType = ref('');
const saving = ref(false);
const error = ref<string | null>(null);

// P43 F1/D1: every ancestor `prefix` segment of the container path, joined — not just the last
// one. A bucket has none; a one-level-nested container has one; `bucket/prefix:a/prefix:b` joins
// to `a/b/`. The old `pathTail`-only version silently dropped every segment above the immediate
// parent, so an upload two or more levels deep prefilled a key that was missing its own ancestry
// and landed at the wrong place in the bucket. Mirrors `s3/catalog.ts`'s own
// `prefixSegments.join('/') + '/'` reconstruction on the engine side, so the two agree by
// construction rather than by coincidence.
const containerPrefix = computed(() => {
  const { connectionId, containerPath } = uploadDialogState;
  if (!connectionId || containerPath === '') return '';
  const prefixes = decodePath(connectionId, containerPath).segments.filter(
    (s) => s.kind === 'prefix',
  );
  return prefixes.length > 0 ? `${prefixes.map((s) => s.name).join('/')}/` : '';
});

async function chooseFile(): Promise<void> {
  const res = await control.filesChooseOpen();
  if (res.canceled || !res.file) return;
  chosenFile.value = res.file;
  key.value = `${containerPrefix.value}${res.file.name}`;
  contentType.value = contentTypeForFilename(res.file.name);
  error.value = null;
}

function onClose(): void {
  closeUploadDialog();
}

async function onUpload(): Promise<void> {
  const connectionId = uploadDialogState.connectionId;
  const file = chosenFile.value;
  if (!connectionId || !file || !key.value.trim()) return;
  saving.value = true;
  error.value = null;
  try {
    const newPath = await uploadObject({
      connectionId,
      containerPath: uploadDialogState.containerPath,
      key: key.value.trim(),
      sourcePath: file.path,
      contentType: contentType.value.trim() || 'application/octet-stream',
      tabId: null,
    });
    browseInvalidate(connectionId, uploadDialogState.containerPath);
    closeUploadDialog();
    openKeyValueTab(connectionId, newPath, { newTab: true });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

// Reset every time the dialog opens — a stale chosen file from a previous open must never carry
// over to a different bucket/prefix.
watch(
  () => uploadDialogState.open,
  (open) => {
    if (!open) return;
    chosenFile.value = null;
    key.value = '';
    contentType.value = '';
    error.value = null;
    saving.value = false;
  },
);
</script>

<template>
  <DialogFrame
    title="Upload file"
    :width="480"
    test-id="upload-dialog"
    close-test-id="upload-close"
    @close="onClose"
  >
    <div class="upload-form">
      <AppButton kind="dialog" data-testid="upload-choose-file" @click="chooseFile">
        Choose file…
      </AppButton>
      <div v-if="chosenFile" class="chosen-file p-sm muted" data-testid="upload-chosen-file">
        {{ chosenFile.name }} ({{ formatBytes(chosenFile.size) }})
      </div>

      <template v-if="chosenFile">
        <label class="field-label p-sm muted">Key</label>
        <TextField v-model="key" data-testid="upload-key" />

        <label class="field-label p-sm muted">Content type</label>
        <TextField v-model="contentType" data-testid="upload-content-type" />
      </template>

      <MessageStrip v-if="error" tone="err" data-testid="upload-error">{{ error }}</MessageStrip>
    </div>

    <template #footer>
      <span class="p-dialog-actions end footer-actions p-push">
        <AppButton kind="dialog" data-testid="upload-cancel" @click="onClose">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="upload-submit"
          :disabled="!chosenFile || !key.trim() || saving"
          @click="onUpload"
        >
          Upload
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.upload-form {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
  padding: var(--kira-s-4) var(--kira-s-5);
}

.chosen-file {
  padding: 0;
}

.field-label {
  padding: 0;
}

/* p-dialog-actions.end supplies display/align-items/justify-content/width; this dialog keeps its
   own tighter s-2 gap rather than the shared s-3. */
.footer-actions {
  gap: var(--kira-s-2);
}
</style>
