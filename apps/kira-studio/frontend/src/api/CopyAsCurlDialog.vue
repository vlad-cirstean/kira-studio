<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import DialogFrame from '@theme/primitives/DialogFrame.vue';
import { computed } from 'vue';
import { useCopyAsCurlStore } from './state/curl';

const copyAsCurlStore = useCopyAsCurlStore();

// P7 D10: the generated command, masked by default. Secrets are still {{token}} until Show secret
// values is pressed — the gate is `revealSecretValues`'s own `revealVariable` calls
// (http/state/variables.ts's existing four-outcome flow), not anything here. Built on DialogFrame
// + the `.strip-note`/`.strip-warn` tone classes (ImportReportStrip.vue's own technique) — P104
// §3 leaves DialogFrame's own call sites unchanged (its P99 Part 2 comment declines shadcn's
// dialog vocabulary for this design system's pixel-exact chrome).
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
        class="p-textarea mono min-h-[180px]"
        :value="command"
        readonly
        rows="10"
        data-testid="copy-as-curl-command"
      />

      <Alert
        v-if="copyAsCurlStore.deferredNames.length > 0"
        :class="stripTone === 'warn' ? 'strip-warn' : 'strip-note'"
        data-testid="copy-as-curl-strip"
      >
        <AlertDescription
          :class="stripTone === 'warn' ? 'strip-warn-text' : 'strip-note-text'"
          class="flex items-start gap-1.5"
        >
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

    <template #footer>
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
    </template>
  </DialogFrame>
</template>

<style scoped>
@reference "@theme/base.css";

/* Alert tone classes replacing MessageStrip's note/warn markers (P104 §9 rule 5: literal hex,
   not a --kira-* token, so kept as-is rather than converted through §7.1's scale). */
.strip-note {
  @apply bg-info/8 border-info/20;
}
.strip-note-text {
  @apply text-[#a8c8ee];
}
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-[#d9c47a];
}
</style>
