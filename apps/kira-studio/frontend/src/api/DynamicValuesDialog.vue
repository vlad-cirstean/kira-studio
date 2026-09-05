<script setup lang="ts">
import { DYNAMIC_NAMES, loadDynamicGenerator } from '@kira/api-core';
import { onMounted, reactive } from 'vue';
import { copyText } from '../clipboard';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import { closeDynamicValuesDialog } from './state/dynamicValues';

// P6 D11: a read-only discovery surface for the 58-name catalogue — nothing here edits, saves, or
// reaches Go. `catalog.ts` carries names only (no description strings, D11: "the sample is the
// description" — a generated example says more precisely what Postman's own docs would in a
// sentence, for one call to a record this dialog is loading anyway).
const samples = reactive<Record<string, string>>({});

// D11: awaits loadDynamicGenerator() on open — a user-initiated action, exactly like *Generate
// data…*'s own first open, and the same memoised promise a send would use. One sample per name,
// freshly generated every time the dialog opens (closing and reopening shows a different one).
onMounted(async () => {
  const generate = await loadDynamicGenerator();
  for (const name of DYNAMIC_NAMES) {
    samples[name] = generate(name) ?? '';
  }
});

function reference(name: string): string {
  return `{{${name}}}`;
}

function onCopy(name: string): void {
  void copyText(reference(name));
}

function close(): void {
  closeDynamicValuesDialog();
}
</script>

<template>
  <DialogFrame
    title="Dynamic values"
    :width="480"
    max-height="80vh"
    test-id="dynamic-values-dialog"
    close-test-id="dynamic-values-dialog-close"
    @close="close"
  >
    <div class="p-dialog-body list dynamic-values-body">
      <div
        v-for="name in DYNAMIC_NAMES"
        :key="name"
        class="p-row dynamic-values-row"
        data-testid="dynamic-values-row"
        :data-name="name"
        role="button"
        tabindex="0"
        v-tooltip="'Copy'"
        @click="onCopy(name)"
        @keydown.enter="onCopy(name)"
      >
        <code class="reference" data-testid="dynamic-values-reference">{{ reference(name) }}</code>
        <span class="p-chip info sample" data-testid="dynamic-values-sample">{{
          samples[name] ?? ''
        }}</span>
      </div>
    </div>

    <template #footer>
      <span class="p-dialog-actions end">
        <AppButton kind="dialog" data-testid="dynamic-values-close" @click="close">Close</AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
/* p-dialog-body.list supplies display/flex-direction/padding/gap; this body also needs to scroll
   within the dialog's own fixed max-height. */
.dynamic-values-body {
  overflow-y: auto;
}

.dynamic-values-row {
  justify-content: space-between;
  height: auto;
  min-height: var(--kira-h-md);
  padding: var(--kira-s-2) var(--kira-s-3);
}

.reference {
  font-family: var(--kira-font-family);
  color: var(--kira-fg);
  flex-shrink: 0;
}

.sample {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
