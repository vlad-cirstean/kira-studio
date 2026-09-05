<script setup lang="ts">
import { computed } from 'vue';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import {
  closeCopyAsCurlDialog,
  copyAsCurlDialogState,
  copyCurlCommand,
  currentCurlCommand,
  revealSecretValues,
} from './state/curl';

// P7 D10: the generated command, masked by default. Secrets are still {{token}} until Show secret
// values is pressed — the gate is `revealSecretValues`'s own `revealVariable` calls
// (http/state/variables.ts's existing four-outcome flow), not anything here. Built on DialogFrame
// + the existing `.p-strip note`/`.p-strip warn` shape (ImportReportStrip.vue's own technique) —
// no new theme/primitives/ component (§0.2).
const command = computed(() => currentCurlCommand());

const maskedNames = computed(() =>
  copyAsCurlDialogState.deferredNames.filter(
    (name) => copyAsCurlDialogState.revealedSecretValues[name] === undefined,
  ),
);
const hasRevealedAny = computed(
  () => Object.keys(copyAsCurlDialogState.revealedSecretValues).length > 0,
);

const stripTone = computed<'note' | 'warn'>(() => (hasRevealedAny.value ? 'warn' : 'note'));
// D10 step 5: "the strip says which names are still masked" — true whether nothing has been
// revealed yet, or a reveal for one name succeeded while another was cancelled/errored/declined.
const stripText = computed(() => {
  const masked = maskedNames.value;
  if (masked.length === 0) return 'This command contains real secret values.';
  const label = masked.length === 1 ? 'value is' : 'values are';
  const names = masked.join(', ');
  if (!hasRevealedAny.value) {
    return `${masked.length} secret ${label} not shown: ${names}. The command will not run as-is.`;
  }
  return `This command contains real secret values. ${masked.length} ${label} still hidden: ${names}.`;
});

// P6 D12 fact 2: {{$…}} values are frozen into the command on open (D10 whole reason to exist) —
// a `resolved` ref whose name still starts with '$' is exactly a generated dynamic value, since a
// deferred (secret) ref never reaches 'resolved' until applySecretValues fills it in later.
const hasDynamicValue = computed(() =>
  (copyAsCurlDialogState.resolved?.refs ?? []).some(
    (r) => r.kind === 'resolved' && r.name.startsWith('$'),
  ),
);
// Built in script rather than the template: a literal '{{$…}}' inside a template mustache would
// be misread by the Vue compiler as the interpolation's own closing '}}'.
const dynamicNote =
  '{{$…}} values are generated once for this command; running it twice sends the same values.';

function onReveal(): void {
  void revealSecretValues();
}

function onCopy(): void {
  copyCurlCommand();
}

function close(): void {
  closeCopyAsCurlDialog();
}
</script>

<template>
  <DialogFrame
    title="Copy as curl"
    :width="680"
    max-height="80vh"
    test-id="copy-as-curl-dialog"
    close-test-id="copy-as-curl-dialog-close"
    @close="close"
  >
    <div class="p-dialog-body">
      <textarea
        class="p-textarea mono command-text"
        :value="command"
        readonly
        rows="10"
        data-testid="copy-as-curl-command"
      />

      <MessageStrip
        v-if="copyAsCurlDialogState.deferredNames.length > 0"
        :tone="stripTone"
        data-testid="copy-as-curl-strip"
      >
        {{ stripText }}
        <AppButton
          v-if="maskedNames.length > 0"
          class="strip-action"
          kind="dialog"
          :disabled="copyAsCurlDialogState.revealing"
          data-testid="copy-as-curl-reveal"
          @click="onReveal"
        >
          Show secret values
        </AppButton>
      </MessageStrip>

      <div v-if="hasDynamicValue" class="p-sm muted" data-testid="copy-as-curl-dynamic-note">
        {{ dynamicNote }}
      </div>

      <MessageStrip v-if="copyAsCurlDialogState.error" tone="err" data-testid="copy-as-curl-error">
        {{ copyAsCurlDialogState.error }}
      </MessageStrip>
    </div>

    <template #footer>
      <span class="p-dialog-actions p-push">
        <AppButton kind="dialog" data-testid="copy-as-curl-close" @click="close">Close</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="copy-as-curl-copy"
          @click="onCopy"
        >
          Copy
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.command-text {
  min-height: 180px;
}
</style>
