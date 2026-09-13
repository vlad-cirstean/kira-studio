<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { approvePairing, denyPairing, gitClientsState } from '../state/gitClients';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';

// G1 D17: a separate, always-mounted dialog at App.vue's root, the same precedent ConfirmDialog
// sets — a pairing request must be able to appear with nothing else open. Renders nothing while
// gitClientsState.pending is null.

// Bare $el shape (SearchToolbar.vue's own precedent) so this ref doesn't read as a type-only use
// of AppButton above — it's a real component, bound as a value by the template below.
const denyButton = ref<{ $el: HTMLElement } | null>(null);
let ticking = 0;
const now = ref(Date.now());

onMounted(() => {
  // Runs after DialogFrame's own onMounted (children mount before their parent — DialogFrame is
  // this component's child), so this focus call is the one that sticks: D17's "Deny is the
  // default focus" — a trust prompt whose Enter key grants access is the wrong default.
  denyButton.value?.$el?.focus();
  ticking = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => window.clearInterval(ticking));

const remainingSeconds = computed(() => {
  const expires = gitClientsState.pending?.expiresAtMs;
  if (expires === undefined) return 0;
  return Math.max(0, Math.ceil((expires - now.value) / 1000));
});

async function onDeny(): Promise<void> {
  const id = gitClientsState.pending?.requestId;
  if (id) await denyPairing(id);
}

async function onApprove(): Promise<void> {
  const id = gitClientsState.pending?.requestId;
  if (id) await approvePairing(id);
}
</script>

<template>
  <DialogFrame
    v-if="gitClientsState.pending"
    title="Editor wants to connect"
    :width="420"
    test-id="git-pairing-dialog"
    @close="onDeny"
  >
    <p class="message">
      <strong>{{ gitClientsState.pending.label || 'A VS Code editor' }}</strong> wants to connect
      to this repository's git data over <span class="mono">~/.kira-studio/git.sock</span>.
      Approving lets it read and change git state in repositories it opens.
    </p>
    <p class="detail" data-testid="git-pairing-expires">Expires in {{ remainingSeconds }}s</p>
    <p v-if="gitClientsState.queued > 1" class="detail" data-testid="git-pairing-queue-count">
      1 of {{ gitClientsState.queued }} waiting
    </p>

    <template #footer>
      <span class="p-dialog-actions end footer-actions p-push">
        <AppButton
          ref="denyButton"
          kind="dialog"
          data-testid="git-pairing-deny"
          @click="onDeny"
        >
          Deny
        </AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="git-pairing-approve"
          @click="onApprove"
        >
          Approve
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.message {
  margin: 0 0 var(--kira-s-2);
  padding: var(--kira-s-4) var(--kira-s-5) 0;
  white-space: pre-wrap;
}

.detail {
  margin: 0;
  padding: 0 var(--kira-s-5) var(--kira-s-4);
  color: var(--kira-fg-subtle);
}

.footer-actions {
  gap: var(--kira-s-2);
}
</style>
