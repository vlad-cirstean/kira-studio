<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import DialogFrame from '@theme/primitives/DialogFrame.vue';
import { computed, ref, watch } from 'vue';
import { useCollectionsStore } from './state/collections';

const collectionsStore = useCollectionsStore();

// P4 D15: Save as… — one TextField for the name and one indented <select> of every collection and
// folder as the target, on the existing DialogFrame. Driven by the store's own saveDialog state so
// the request view can open it without importing this component (the same shape
// state/objectStore.ts's own upload dialog uses).
const name = ref('');
const target = ref('');
const saving = ref(false);
const error = ref<string | null>(null);

/** Every collection, each carrying its own folders as a real <optgroup> (F7) — the value encodes
 *  both halves because a folder id alone does not say which collection it belongs to. */
const collectionTargets = computed(() =>
  collectionsStore.collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    folders: collectionsStore.folderPaths(collection.id),
  })),
);

const firstTargetValue = computed(() => {
  const first = collectionTargets.value[0];
  return first ? `${first.id}:` : '';
});

watch(
  () => collectionsStore.open,
  (open) => {
    if (!open) return;
    name.value = collectionsStore.suggestedName;
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
    await collectionsStore.submitSaveDialog(collectionId, parentId, trimmed);
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
    @close="collectionsStore.closeSaveDialog"
  >
    <div class="p-dialog-body">
      <label class="p-sm muted mt-1">Name</label>
      <Input v-model="name" data-testid="save-request-name" @keydown.enter="onSave" />

      <label class="p-sm muted mt-1">Save to</label>
      <select v-model="target" class="p-select bordered" data-testid="save-request-target">
        <optgroup v-for="c in collectionTargets" :key="c.id" :label="c.name">
          <option :value="`${c.id}:`">(collection root)</option>
          <option v-for="f in c.folders" :key="f.id" :value="`${c.id}:${f.id}`">{{ f.label }}</option>
        </optgroup>
      </select>

      <Alert v-if="collectionTargets.length === 0" class="strip-warn" data-testid="save-request-no-target">
        <AlertDescription class="strip-warn-text">
          Create a collection first — a request needs somewhere to live.
        </AlertDescription>
      </Alert>
      <Alert v-if="error" variant="destructive" data-testid="save-request-error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>

    <template #footer>
      <span class="p-dialog-actions p-push">
        <Button variant="dialog" size="kira-lg" data-testid="save-request-cancel" @click="collectionsStore.closeSaveDialog">Cancel</Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          data-testid="save-request-submit"
          :disabled="!name.trim() || !target || saving"
          @click="onSave"
        >
          Save
        </Button>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
@reference "@theme/base.css";

/* Alert tone class replacing MessageStrip's warn marker (P104 §9 rule 5: literal hex, not a
   --kira-* token, so kept as-is rather than converted through §7.1's scale). */
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-[#d9c47a];
}
</style>
