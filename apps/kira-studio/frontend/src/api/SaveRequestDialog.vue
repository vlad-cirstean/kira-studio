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

/** Every collection, each carrying its own folders as a real <optgroup> (F7) — the value encodes
 *  both halves because a folder id alone does not say which collection it belongs to. */
const collectionTargets = computed(() =>
  collectionsState.collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    folders: folderPaths(collection.id),
  })),
);

const firstTargetValue = computed(() => {
  const first = collectionTargets.value[0];
  return first ? `${first.id}:` : '';
});

watch(
  () => saveDialogState.open,
  (open) => {
    if (!open) return;
    name.value = saveDialogState.suggestedName;
    target.value = firstTargetValue.value;
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
    :width="480"
    test-id="save-request-dialog"
    close-test-id="save-request-close"
    @close="closeSaveDialog"
  >
    <div class="p-dialog-body">
      <label class="field-label p-sm muted">Name</label>
      <TextField v-model="name" data-testid="save-request-name" @enter="onSave" />

      <label class="field-label p-sm muted">Save to</label>
      <select v-model="target" class="p-select bordered" data-testid="save-request-target">
        <optgroup v-for="c in collectionTargets" :key="c.id" :label="c.name">
          <option :value="`${c.id}:`">(collection root)</option>
          <option v-for="f in c.folders" :key="f.id" :value="`${c.id}:${f.id}`">{{ f.label }}</option>
        </optgroup>
      </select>

      <MessageStrip
        v-if="collectionTargets.length === 0"
        tone="warn"
        data-testid="save-request-no-target"
      >
        Create a collection first — a request needs somewhere to live.
      </MessageStrip>
      <MessageStrip v-if="error" tone="err" data-testid="save-request-error">{{ error }}</MessageStrip>
    </div>

    <template #footer>
      <span class="p-dialog-actions p-push">
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
.field-label {
  margin-top: var(--kira-s-2);
}
</style>
