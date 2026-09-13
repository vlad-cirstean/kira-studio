<script setup lang="ts">
/**
 * G-UX (item 3): "when checking out a branch that advanced, ask if I want to pull it too" —
 * `OpsState.runCheckout`'s own post-switch confirm step (`#maybePromptPostCheckoutPull`), mirroring
 * `PullDialog.vue`'s "a pending ref set by the state class, this dialog renders while it is set,
 * resolving it settles the promise the caller is awaiting" shape, one route simpler: there is only
 * ever Pull now / Not now, never a hazard to describe.
 */
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ ops: OpsState }>();

const pending = computed(() => props.ops.pendingPostCheckoutPull.value);
const active = computed(() => pending.value !== undefined);

function notNow(): void {
  props.ops.resolvePostCheckoutPullDialog(false);
}

function pullNow(): void {
  props.ops.resolvePostCheckoutPullDialog(true);
}
</script>

<template>
  <KuiDialog v-if="pending" :open="active" title="Pull the latest changes?" @close="notNow">
    <p>
      <strong>{{ pending.branch }}</strong> is {{ pending.behind }}
      {{ pending.behind === 1 ? 'commit' : 'commits' }} behind
      <code>{{ pending.upstreamShortName }}</code> — pull now?
    </p>

    <template #actions>
      <KuiButton variant="primary" data-testid="post-checkout-pull-now" @click="pullNow">
        Pull now
      </KuiButton>
      <KuiButton data-testid="post-checkout-pull-not-now" @click="notNow">Not now</KuiButton>
    </template>
  </KuiDialog>
</template>
