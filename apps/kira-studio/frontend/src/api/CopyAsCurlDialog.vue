<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Textarea } from '@theme/components/ui/textarea';
import { computed } from 'vue';
import { useCopyAsCurlStore } from './state/curl';

const copyAsCurlStore = useCopyAsCurlStore();

// P7 D10: the generated command, masked by default. Secrets are still {{token}} until Show secret
// values is pressed — the gate is `revealSecretValues`'s own `revealVariable` calls
// (http/state/variables.ts's existing four-outcome flow), not anything here. Built on ui/dialog
// + the shared Alert `note`/`warn` variants (ImportReportStrip.vue's own technique).
const command = computed(() => copyAsCurlStore.currentCurlCommand());

const maskedNames = computed(() =>
  copyAsCurlStore.deferredNames.filter(
    (name) => copyAsCurlStore.revealedSecretValues[name] === undefined,
  ),
);
const hasRevealedAny = computed(
  () => Object.keys(copyAsCurlStore.revealedSecretValues).length > 0,
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
  (copyAsCurlStore.resolved?.refs ?? []).some(
    (r) => r.kind === 'resolved' && r.name.startsWith('$'),
  ),
);
// Built in script rather than the template: a literal '{{$…}}' inside a template mustache would
// be misread by the Vue compiler as the interpolation's own closing '}}'.
const dynamicNote =
  '{{$…}} values are generated once for this command; running it twice sends the same values.';

function onReveal(): void {
  void copyAsCurlStore.revealSecretValues();
}

function onCopy(): void {
  copyAsCurlStore.copyCurlCommand();
}

function close(): void {
  copyAsCurlStore.closeCopyAsCurlDialog();
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && close()">
    <DialogContent
      :show-close-button="false"
      data-testid="copy-as-curl-dialog"
      class="flex flex-col p-0 gap-0"
      style="width: 680px; max-width: min(680px, calc(100% - 2rem)); max-height: 80vh"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Copy as curl</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="copy-as-curl-dialog-close"
            @click="close"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="overflow-auto">
    <div class="p-dialog-body">
      <Textarea
        class="font-data min-h-44"
        :model-value="command"
        readonly
        rows="10"
        data-testid="copy-as-curl-command"
      />

      <Alert
        v-if="copyAsCurlStore.deferredNames.length > 0"
        :variant="stripTone"
        data-testid="copy-as-curl-strip"
      >
        <AlertDescription class="flex items-start gap-1.5">
          <span>{{ stripText }}</span>
          <Button
            v-if="maskedNames.length > 0"
            variant="dialog"
            size="kira"
            class="ml-auto shrink-0"
            :disabled="copyAsCurlStore.revealing"
            data-testid="copy-as-curl-reveal"
            @click="onReveal"
          >
            Show secret values
          </Button>
        </AlertDescription>
      </Alert>

      <div v-if="hasDynamicValue" class="p-sm muted" data-testid="copy-as-curl-dynamic-note">
        {{ dynamicNote }}
      </div>

      <Alert v-if="copyAsCurlStore.error" variant="destructive" data-testid="copy-as-curl-error">
        <AlertDescription>{{ copyAsCurlStore.error }}</AlertDescription>
      </Alert>
    </div>
      </div>

      <DialogFooter class="border-t border-border">
        <span class="p-dialog-actions p-push">
          <Button variant="dialog" size="kira-lg" data-testid="copy-as-curl-close" @click="close">Close</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="copy-as-curl-copy"
            @click="onCopy"
          >
            Copy
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

