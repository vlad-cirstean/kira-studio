<script setup lang="ts">
import { useMobileAccessStore } from '../state/mobileAccess';
import PairingRequestDialog from './PairingRequestDialog.vue';

const mobileStore = useMobileAccessStore();

async function onDeny(): Promise<void> {
  const id = mobileStore.pending?.requestId;
  if (id) await mobileStore.deny(id);
}

async function onApprove(): Promise<void> {
  const id = mobileStore.pending?.requestId;
  if (id) await mobileStore.approve(id);
}
</script>

<template>
  <PairingRequestDialog
    title="Phone wants to view Agents"
    :request-id="mobileStore.pending?.requestId"
    :expires-at-ms="mobileStore.pending?.expiresAtMs"
    :queued="mobileStore.queued"
    testid-prefix="mobile-pairing"
    @deny="onDeny"
    @approve="onApprove"
  >
    <template v-if="mobileStore.pending">
      <p class="whitespace-pre-wrap mb-1.5 px-3 pt-2">
        A phone on your network wants read-only access to the agents board. Approve only if the
        code below matches the one on the phone.
      </p>
      <p class="m-0 px-3 pb-1.5 font-data text-kira-xl tracking-widest" data-testid="mobile-pairing-code">
        {{ mobileStore.pending.code }}
      </p>
      <p class="m-0 text-subtle px-3 pb-1.5 break-all" data-testid="mobile-pairing-label">
        Says it is: {{ mobileStore.pending.label || 'unnamed phone' }}
      </p>
      <p class="m-0 text-subtle px-3 pb-1.5 break-all" data-testid="mobile-pairing-origin">
        From {{ mobileStore.pending.remoteIp }}
        <span v-if="mobileStore.pending.userAgent">({{ mobileStore.pending.userAgent }})</span>
      </p>
    </template>
  </PairingRequestDialog>
</template>
