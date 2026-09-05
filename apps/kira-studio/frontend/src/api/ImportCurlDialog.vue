<script setup lang="ts">
import { computed, ref } from 'vue';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import { closeImportCurlDialog, previewCurl, submitImportCurl } from './state/curl';

// P7 D12: paste, live preview, live warnings, Import. A plain <textarea> rather than CodeMirror —
// there is no grammar to highlight and P3 D1's bundle argument applies. Everything below the
// textarea recomputes on every input (parseCurl is pure and synchronous, D12) — the warnings are
// shown *before* Import is pressed, deliberately diverging from ImportReportStrip's post-hoc
// report (D4): a curl paste is a short string sitting right there, so the honest place to say
// "-k was ignored" is beside it, while it can still be edited.
const text = ref('');

const preview = computed(() => previewCurl(text.value));

function onImport(): void {
  submitImportCurl(text.value);
}

function close(): void {
  closeImportCurlDialog();
}
</script>

<template>
  <DialogFrame
    title="Import from curl"
    :width="560"
    max-height="80vh"
    test-id="import-curl-dialog"
    close-test-id="import-curl-dialog-close"
    @close="close"
  >
    <div class="import-curl-body">
      <textarea
        v-model="text"
        class="p-textarea curl-textarea"
        rows="6"
        placeholder="curl -X POST https://api.example.com/orders -H 'Content-Type: application/json' -d '{&quot;id&quot;: 1}'"
        data-testid="import-curl-textarea"
        autofocus
      />

      <MessageStrip v-if="preview.error" tone="err" data-testid="import-curl-error">
        {{ preview.error }}
      </MessageStrip>
      <template v-else-if="text.trim() !== ''">
        <div class="p-sm muted" data-testid="import-curl-summary">{{ preview.summary }}</div>
        <!-- D12: the same `.p-strip warn` + `<li :data-kind>` shape ImportReportStrip.vue
             established — shown live, before Import is pressed, rather than as a post-hoc report. -->
        <MessageStrip
          v-if="preview.warnings.length > 0"
          tone="warn"
          data-testid="import-curl-warnings"
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
      <span class="footer-actions p-push">
        <AppButton kind="dialog" data-testid="import-curl-cancel" @click="close">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="import-curl-submit"
          :disabled="text.trim() === '' || preview.error !== null"
          @click="onImport"
        >
          Import
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.import-curl-body {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
}

.curl-textarea {
  min-height: 120px;
}

.warnings {
  margin: 0;
  padding-left: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.footer-actions {
  display: flex;
  gap: var(--kira-s-2);
}
</style>
