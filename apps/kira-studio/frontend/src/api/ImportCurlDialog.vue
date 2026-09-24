<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Textarea } from '@theme/components/ui/textarea';
import { refDebounced } from '@vueuse/core';
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';
import { useImportCurlStore } from './state/curl';

const importCurlStore = useImportCurlStore();

// P7 D12: paste, live preview, live warnings, Import. A plain <textarea> rather than CodeMirror —
// there is no grammar to highlight and P3 D1's bundle argument applies. Everything below the
// textarea recomputes on every input (parseCurl is pure and synchronous, D12) — the warnings are
// shown *before* Import is pressed, deliberately diverging from ImportReportStrip's post-hoc
// report (D4): a curl paste is a short string sitting right there, so the honest place to say
// "-k was ignored" is beside it, while it can still be edited.
const text = ref('');

// Finding 15: for a large pasted curl command (a big JSON body, say), re-lexing the whole text on
// every single keystroke just to update a one-line summary has no business running that often —
// the textarea itself (`text`) stays bound immediately so typing never stutters; the preview below
// reads a debounced copy instead. 400ms mirrors this app's own precedent for the identical
// shape (project/SchemaDialog.vue's own parse-summary debounce). Unlike EditRawRequestDialog.vue's
// own copy, this one has no external-open reset to preserve, so refDebounced (P99 Part 3) is a
// direct fit — no manual watch/setTimeout needed.
const debouncedText = refDebounced(text, 400);

const preview = computed(() => importCurlStore.previewCurl(debouncedText.value));

function onImport(): void {
  importCurlStore.submitImportCurl(text.value);
}

function close(): void {
  importCurlStore.closeImportCurlDialog();
}

// P105 §8: reka-ui's Dialog, unlike KuiDialog, auto-focuses nothing on its own — focus the textarea
// explicitly once it renders.
const bodyEl = useTemplateRef<HTMLElement>('bodyEl');
onMounted(() => {
  void nextTick(() => {
    bodyEl.value?.querySelector<HTMLTextAreaElement>('.curl-textarea')?.focus();
  });
});
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && close()">
    <DialogContent
      :show-close-button="false"
      data-testid="import-curl-dialog"
      class="flex flex-col p-0 gap-0 w-140 max-h-4/5"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Import from curl</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="import-curl-dialog-close"
            @click="close"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="overflow-auto">
    <div ref="bodyEl" class="flex flex-col gap-2 p-3">
      <Textarea
        v-model="text"
        class="font-data curl-textarea"
        rows="6"
        placeholder="curl -X POST https://api.example.com/orders -H 'Content-Type: application/json' -d '{&quot;id&quot;: 1}'"
        data-testid="import-curl-textarea"
      />

      <Alert v-if="preview.error" variant="destructive" data-testid="import-curl-error">
        <AlertDescription>{{ preview.error }}</AlertDescription>
      </Alert>
      <template v-else-if="text.trim() !== ''">
        <div class="text-kira-sm text-muted-foreground" data-testid="import-curl-summary">{{ preview.summary }}</div>
        <!-- D12: the same `warn` variant + `<li :data-kind>` shape ImportReportStrip.vue
             established — shown live, before Import is pressed, rather than as a post-hoc report. -->
        <Alert v-if="preview.warnings.length > 0" variant="warn" data-testid="import-curl-warnings">
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
          <Button variant="dialog" size="kira-lg" data-testid="import-curl-cancel" @click="close">Cancel</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="import-curl-submit"
            :disabled="text.trim() === '' || preview.error !== null"
            @click="onImport"
          >
            Import
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
@reference "@theme/base.css";

.curl-textarea {
  @apply min-h-32;
}

.warnings {
  @apply m-0 flex flex-col gap-0.5 pl-2;
}
</style>
