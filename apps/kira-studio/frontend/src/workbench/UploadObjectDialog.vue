<script setup lang="ts">
import { contentTypeForFilename } from '@shared/domain/object-store';
import { decodePath } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { formatBytes } from '@workbench/util/format';
import { computed, ref, watch } from 'vue';
import { control } from '../bridge/control';
import { useObjectStoreStore } from '../state/objectStore';
import { useTabsStore } from '../state/tabs';
import { browseInvalidate } from '../state/viewCommands';

const objectStoreStore = useObjectStoreStore();
const tabsStore = useTabsStore();

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
  const { connectionId, containerPath } = objectStoreStore;
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
  objectStoreStore.closeUploadDialog();
}

async function onUpload(): Promise<void> {
  const connectionId = objectStoreStore.connectionId;
  const file = chosenFile.value;
  if (!connectionId || !file || !key.value.trim()) return;
  saving.value = true;
  error.value = null;
  try {
    const newPath = await objectStoreStore.uploadObject({
      connectionId,
      containerPath: objectStoreStore.containerPath,
      key: key.value.trim(),
      sourcePath: file.path,
      contentType: contentType.value.trim() || 'application/octet-stream',
      tabId: null,
    });
    browseInvalidate(connectionId, objectStoreStore.containerPath);
    objectStoreStore.closeUploadDialog();
    tabsStore.openKeyValueTab(connectionId, newPath, { newTab: true });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

// Reset every time the dialog opens — a stale chosen file from a previous open must never carry
// over to a different bucket/prefix.
watch(
  () => objectStoreStore.open,
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
  <Dialog :open="true" @update:open="(v) => !v && onClose()">
    <DialogContent
      :show-close-button="false"
      data-testid="upload-dialog"
      class="flex flex-col p-0 gap-0"
      style="width: 480px; max-width: min(480px, calc(100% - 2rem)); max-height: 80vh"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Upload file</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="upload-close"
            @click="onClose"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex flex-col gap-1.5 px-3 py-2 overflow-auto">
        <Button variant="dialog" size="kira-lg" class="self-start" data-testid="upload-choose-file" @click="chooseFile">
          Choose file…
        </Button>
        <div v-if="chosenFile" class="p-sm muted p-0" data-testid="upload-chosen-file">
          {{ chosenFile.name }} ({{ formatBytes(chosenFile.size) }})
        </div>

        <template v-if="chosenFile">
          <Label class="p-sm muted p-0">Key</Label>
          <Input v-model="key" class="h-control w-full rounded-kira-sm border-border-strong bg-field px-2 font-data" data-testid="upload-key" />

          <Label class="p-sm muted p-0">Content type</Label>
          <Input v-model="contentType" class="h-control w-full rounded-kira-sm border-border-strong bg-field px-2 font-data" data-testid="upload-content-type" />
        </template>

        <Alert v-if="error" variant="destructive" data-testid="upload-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter class="border-t border-border">
        <span class="flex items-center gap-1 ml-auto">
          <Button variant="dialog" size="kira-lg" data-testid="upload-cancel" @click="onClose">Cancel</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="upload-submit"
            :disabled="!chosenFile || !key.trim() || saving"
            @click="onUpload"
          >
            Upload
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
