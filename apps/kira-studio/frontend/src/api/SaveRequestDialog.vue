<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { computed, ref, watch } from 'vue';
import { useCollectionsStore } from './state/collections';
import { useSaveRequestDialogStore } from './state/saveRequestDialog';

const collectionsStore = useCollectionsStore();
const saveDialogStore = useSaveRequestDialogStore();

// P4 D15: Save as… — one TextField for the name and one indented <select> of every collection and
// folder as the target, on the existing DialogFrame. Driven by useSaveRequestDialogStore's own
// open/suggestedName state (P108 F16) so the request view can open it without importing this
// component (the same shape state/objectStore.ts's own upload dialog uses).
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
  () => saveDialogStore.open,
  (open) => {
    if (!open) return;
    name.value = saveDialogStore.suggestedName;
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
  <Dialog :open="true" @update:open="(v) => !v && saveDialogStore.closeSaveDialog()">
    <DialogContent
      :show-close-button="false"
      data-testid="save-request-dialog"
      class="flex flex-col p-0 gap-0 w-120"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Save request</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="save-request-close"
            @click="saveDialogStore.closeSaveDialog"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="overflow-auto">
    <div class="p-dialog-body">
      <Label class="p-sm text-muted-foreground mt-1">Name</Label>
      <Input v-model="name" data-testid="save-request-name" @keydown.enter="onSave" />

      <Label class="p-sm text-muted-foreground mt-1">Save to</Label>
      <select v-model="target" class="p-select bordered" data-testid="save-request-target">
        <optgroup v-for="c in collectionTargets" :key="c.id" :label="c.name">
          <option :value="`${c.id}:`">(collection root)</option>
          <option v-for="f in c.folders" :key="f.id" :value="`${c.id}:${f.id}`">{{ f.label }}</option>
        </optgroup>
      </select>

      <Alert v-if="collectionTargets.length === 0" variant="warn" data-testid="save-request-no-target">
        <AlertDescription>
          Create a collection first — a request needs somewhere to live.
        </AlertDescription>
      </Alert>
      <Alert v-if="error" variant="destructive" data-testid="save-request-error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>
      </div>

      <DialogFooter class="border-t border-border">
        <span class="p-dialog-actions p-push">
          <Button variant="dialog" size="kira-lg" data-testid="save-request-cancel" @click="saveDialogStore.closeSaveDialog">Cancel</Button>
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
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

