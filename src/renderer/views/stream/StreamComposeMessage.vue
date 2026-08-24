<script setup lang="ts">
import { computed, ref } from 'vue';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { produceKafkaMessage, sendSqsMessage } from './streamMutations';

// Item 3/4's "Add message" panel — Kafka gets key/body/headers (kafka/produce.ts's three
// sentinel fields); SQS gets body/headers but no key (SendMessage has no key concept on this
// app's model — see sqs/mutate.ts's own scoping note; task #61 added SQS's MessageAttributes
// support, so headers is now shared by both kinds). One popover, one shape switch, rather than
// two near-identical components.
const props = defineProps<{ tabId: string; kind: 'kafka' | 'sqs' }>();
const emit = defineEmits<{ close: [] }>();

const key = ref('');
const body = ref('');
const headers = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

const isKafka = computed(() => props.kind === 'kafka');
const canSubmit = computed(() => body.value.trim() !== '' && !submitting.value);

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = null;
  try {
    if (isKafka.value) {
      await produceKafkaMessage(props.tabId, {
        key: key.value.trim() === '' ? null : key.value,
        body: body.value,
        headers: headers.value.trim() === '' ? null : headers.value,
      });
    } else {
      await sendSqsMessage(
        props.tabId,
        body.value,
        headers.value.trim() === '' ? null : headers.value,
      );
    }
    emit('close');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <PopoverPanel
    anchor="right"
    :width="380"
    test-id="stream-add-message-panel"
    backdrop-test-id="stream-add-message-backdrop"
    @close="emit('close')"
  >
    <div class="compose-inner">
      <div class="compose-header p-panel-head">
        <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
        <span>{{ isKafka ? 'Produce a message' : 'Send a message' }}</span>
        <IconButton icon="close" class="p-push" v-tooltip="'Close'" @click="emit('close')" />
      </div>

      <div class="compose-body">
        <label v-if="isKafka" class="field">
          <span class="p-sm muted">Key (optional)</span>
          <TextField v-model="key" placeholder="(none)" data-testid="stream-add-message-key" />
        </label>

        <label class="field">
          <span class="p-sm muted">Body</span>
          <textarea
            v-model="body"
            class="p-input-styled"
            rows="6"
            placeholder="Message body"
            data-testid="stream-add-message-body"
          />
        </label>

        <label class="field">
          <span class="p-sm muted">Headers (optional JSON object)</span>
          <textarea
            v-model="headers"
            class="p-input-styled"
            rows="3"
            placeholder='{"source": "manual"}'
            data-testid="stream-add-message-headers"
          />
        </label>

        <span v-if="error" class="p-sm error-text" data-testid="stream-add-message-error">{{
          error
        }}</span>
      </div>

      <div class="compose-actions">
        <AppButton kind="dialog" @click="emit('close')">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          :disabled="!canSubmit"
          data-testid="stream-add-message-submit"
          @click="submit"
        >
          {{ isKafka ? 'Produce' : 'Send' }}
        </AppButton>
      </div>
    </div>
  </PopoverPanel>
</template>

<style scoped>
.compose-inner {
  display: flex;
  flex-direction: column;
}

.compose-header {
  text-transform: none;
  letter-spacing: normal;
}

.compose-body {
  padding: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
}

.p-input-styled {
  width: 100%;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  padding: var(--kira-s-2);
  resize: vertical;
  box-sizing: border-box;
}

.error-text {
  color: var(--kira-error);
}

.compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--kira-s-3);
  padding: var(--kira-s-3) var(--kira-s-4);
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
