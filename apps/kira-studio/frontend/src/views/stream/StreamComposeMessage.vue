<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { computed, ref } from 'vue';
import { produceKafkaMessage, sendSqsMessage } from './mutations';

// Item 3/4's "Add message" panel — Kafka gets key/body/headers (kafka/produce.ts's three
// sentinel fields); SQS gets body/headers but no key (SendMessage has no key concept on this
// app's model — see sqs/mutate.ts's own scoping note; task #61 added SQS's MessageAttributes
// support, so headers is now shared by both kinds). One popover, one shape switch, rather than
// two near-identical components.
const props = defineProps<{
  tabId: string;
  kind: 'kafka' | 'sqs';
}>();
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
  <div class="compose-inner">
    <div class="compose-header flex items-center shrink-0 h-control-lg gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
      <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
      <span>{{ isKafka ? 'Produce a message' : 'Send a message' }}</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            class="p-push"
            aria-label="Close"
            @click="emit('close')"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close</TooltipContent>
      </Tooltip>
    </div>

    <div class="compose-body">
      <Label v-if="isKafka" class="field">
        <span class="p-sm muted">Key (optional)</span>
        <Input
          :model-value="key"
          placeholder="(none)"
          class="h-control w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
          data-testid="stream-add-message-key"
          @update:model-value="(v) => (key = String(v))"
        />
      </Label>

      <Label class="field">
        <span class="p-sm muted">Body</span>
        <Textarea
          v-model="body"
          class="font-data"
          rows="6"
          placeholder="Message body"
          data-testid="stream-add-message-body"
          @keydown="wrapSelectionOnType"
        />
      </Label>

      <Label class="field">
        <span class="p-sm muted">Headers (optional JSON object)</span>
        <Textarea
          v-model="headers"
          class="font-data"
          rows="3"
          placeholder='{"source": "manual"}'
          data-testid="stream-add-message-headers"
          @keydown="wrapSelectionOnType"
        />
      </Label>

      <span v-if="error" class="p-sm error-text" data-testid="stream-add-message-error">{{
        error
      }}</span>
    </div>

    <div class="compose-actions">
      <Button variant="dialog" size="kira-lg" @click="emit('close')">Cancel</Button>
      <Button
        variant="dialog-primary"
        size="kira-lg"
        :disabled="!canSubmit"
        data-testid="stream-add-message-submit"
        @click="submit"
      >
        {{ isKafka ? 'Produce' : 'Send' }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.compose-inner {
  @apply flex flex-col;
}

.compose-header {
  @apply normal-case tracking-normal;
}

.compose-body {
  @apply flex flex-col gap-1.5 p-2;
}

.field {
  @apply flex flex-col gap-0.5;
}

.field-inline {
  @apply flex-row items-center gap-1;
}

.error-text {
  @apply text-error;
}

.compose-actions {
  @apply flex justify-end gap-1.5 border-t border-border py-1.5 px-2;
}
</style>
