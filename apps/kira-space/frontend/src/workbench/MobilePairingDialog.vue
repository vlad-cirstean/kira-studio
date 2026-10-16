<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { t } from '@theme/i18n';
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
    :title="t('space.mobilePairing.dialog.title')"
    :request-id="current?.requestId"
    :expires-at-ms="current?.expiresAtMs"
    :more="more"
    testid-prefix="mobile-pairing"
    @deny="onDeny"
    @approve="onApprove"
    @hide="emit('hide')"
  >
    <template v-if="current">
      <p class="m-0 whitespace-pre-wrap">
        {{ t('space.mobilePairing.intro.body') }}
      </p>
      <p class="m-0 font-data text-kira-xl tracking-widest" data-testid="mobile-pairing-code">
        {{ current.code }}
      </p>
      <p class="m-0 text-subtle break-all" data-testid="mobile-pairing-label">
        {{
          t('space.mobilePairing.says.label', { name: current.label || t('space.mobilePairing.unnamed.label') })
        }}
      </p>
      <p class="m-0 text-subtle break-all" data-testid="mobile-pairing-origin">
        {{ t('space.mobilePairing.from.label', { address: current.remoteIp }) }}
        <span v-if="current.userAgent">({{ current.userAgent }})</span>
      </p>
    </template>
  </PairingRequestDialog>
</template>
