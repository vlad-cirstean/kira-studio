<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { computed } from 'vue';
import { useMobileAccessStore } from '../state/mobileAccess';
import PairingRequestDialog from './PairingRequestDialog.vue';

// Mounted by PromptHost for the routed `mobile-pairing` entry; shows when the broker's head is it.
const props = defineProps<{ entry: RoutedPrompt; more: number }>();
const emit = defineEmits<{ hide: [] }>();
const mobileStore = useMobileAccessStore();
const current = computed(() =>
  mobileStore.pending?.requestId === props.entry.ref ? mobileStore.pending : null,
);

async function onDeny(): Promise<void> {
  const id = current.value?.requestId;
  if (id) await mobileStore.deny(id);
}

async function onApprove(): Promise<void> {
  const id = current.value?.requestId;
  if (id) await mobileStore.approve(id);
}
</script>

<template>
  <PairingRequestDialog
    title="Phone wants to view Agents"
    :request-id="current?.requestId"
    :expires-at-ms="current?.expiresAtMs"
    :more="more"
    testid-prefix="mobile-pairing"
    @deny="onDeny"
    @approve="onApprove"
    @hide="emit('hide')"
  >
    <template v-if="current">
      <p class="whitespace-pre-wrap mb-1.5 px-3 pt-2">
        A phone on your network wants read-only access to the agents board. Approve only if the
        code below matches the one on the phone.
      </p>
      <p class="m-0 px-3 pb-1.5 font-data text-kira-xl tracking-widest" data-testid="mobile-pairing-code">
        {{ current.code }}
      </p>
      <p class="m-0 text-subtle px-3 pb-1.5 break-all" data-testid="mobile-pairing-label">
        Says it is: {{ current.label || 'unnamed phone' }}
      </p>
      <p class="m-0 text-subtle px-3 pb-1.5 break-all" data-testid="mobile-pairing-origin">
        From {{ current.remoteIp }}
        <span v-if="current.userAgent">({{ current.userAgent }})</span>
      </p>
    </template>
  </PairingRequestDialog>
</template>
