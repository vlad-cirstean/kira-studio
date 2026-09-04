<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import TextField from '../theme/primitives/TextField.vue';
import {
  closeSaveDialog,
  collectionsState,
  folderPaths,
  saveDialogState,
  submitSaveDialog,
} from './state/collections';

// P4 D15: Save as… — one TextField for the name and one indented <select> of every collection and
// folder as the target, on the existing DialogFrame. Driven by saveDialogState so the request
// view can open it without importing this component (the same shape state/objectStore.ts's own
// upload dialog uses).
const name = ref('');
const target = ref('');
const saving = ref(false);
const error = ref<string | null>(null);

/** Every collection, each followed by its own folders indented beneath it. The value encodes both
 *  halves because a folder id alone does not say which collection it belongs to. */
const targets = computed(() => {
  const out: { value: string; label: string }[] = [];
  for (const collection of collectionsState.collections) {
    out.push({ value: `${collection.id}:`, label: collection.name });
    for (const folder of folderPaths(collection.id)) {
      out.push({ value: `${collection.id}:${folder.id}`, label: `    ${folder.label}` });
    }
  }
  return out;
});

watch(
  () => saveDialogState.open,
  (open) => {
    if (!open) return;
    name.value = saveDialogState.suggestedName;
    target.value = targets.value[0]?.value ?? '';
    saving.value = false;
    error.value = null;
  },
  { immediate: true },
);

async function onSave(): Promise<void> {
  const trimmed = name.value.trim();
  if (!trimmed || !target.value) return;
  const [collectionId, parentId] = splitTarget(target.value);
  saving.value = true;
  error.value = null;
  try {
    await submitSaveDialog(collectionId, parentId, trimmed);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    saving.value = false;
  }
}

function splitTarget(value: string): [string, string | null] {
  const idx = value.indexOf(':');
  const collectionId = value.slice(0, idx);
  const folderId = value.slice(idx + 1);
  return [collectionId, folderId === '' ? null : folderId];
}
</script>

<template>
  <DialogFrame
    title="Save request"
    :width="440"
    test-id="save-request-dialog"
    close-test-id="save-request-close"
    @close="closeSaveDialog"
  >
    <div class="save-form">
      <label class="field-label p-sm muted">Name</label>
      <TextField v-model="name" data-testid="save-request-name" @enter="onSave" />

      <label class="field-label p-sm muted">Save to</label>
      <select v-model="target" class="p-select bordered" data-testid="save-request-target">
        <option v-for="option in targets" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>

      <MessageStrip v-if="targets.length === 0" tone="warn" data-testid="save-request-no-target">
        Create a collection first — a request needs somewhere to live.
      </MessageStrip>
      <MessageStrip v-if="error" tone="err" data-testid="save-request-error">{{ error }}</MessageStrip>
    </div>

    <template #footer>
      <span class="footer-actions p-push">
        <AppButton kind="dialog" data-testid="save-request-cancel" @click="closeSaveDialog">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="save-request-submit"
          :disabled="!name.trim() || !target || saving"
          @click="onSave"
        >
          Save
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.save-form {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
}

.field-label {
  margin-top: var(--kira-s-2);
}

.footer-actions {
  display: flex;
  gap: var(--kira-s-2);
}
</style>
