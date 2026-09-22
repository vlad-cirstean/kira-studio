<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import { useGitClientsStore } from '../state/gitClients';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';

const gitClientsStore = useGitClientsStore();

// G1 D17: a separate, always-mounted dialog at App.vue's root, the same precedent ConfirmDialog
// sets — a pairing request must be able to appear with nothing else open. Renders nothing while
// gitClientsStore.pending is null.

// Bare $el shape (SearchToolbar.vue's own precedent) so this ref doesn't read as a type-only use
// of AppButton above — it's a real component, bound as a value by the template below.
const denyButton = ref<{ $el: HTMLElement } | null>(null);
const now = ref(Date.now());

// Perf (finding #19, M6): this component is always-mounted at App.vue's own root (never
// unmounted per pairing request), so a plain onMounted only ever fires once, at app boot — a 1s
// interval started there would tick for the app's entire lifetime even though the dialog itself
// renders nothing while gitClientsStore.pending is null (DialogFrame's own v-if below). useIntervalFn's
// own pause()/resume() (immediate: false) is started/stopped instead as pending flips non-null/null.
const { pause: pauseTick, resume: resumeTick } = useIntervalFn(
  () => {
    now.value = Date.now();
  },
  1000,
  { immediate: false },
);

// This also fixes denyButton's own focus call: run from onMounted, it only ever executed once, at
// that same app-boot mount — with DialogFrame's v-if false and nothing in the DOM yet, so
// denyButton.value was always null there and Deny was never actually focused. nextTick here runs
// it after each pairing request's own DOM update instead, so it sticks for real.
watch(
  () => gitClientsStore.pending !== null,
  (isPending) => {
    if (isPending) {
      now.value = Date.now();
      resumeTick();
      // D17's "Deny is the default focus" — a trust prompt whose Enter key grants access is the
      // wrong default.
      void nextTick(() => denyButton.value?.$el?.focus());
    } else {
      pauseTick();
    }
  },
  { immediate: true },
);

const remainingSeconds = computed(() => {
  const expires = gitClientsStore.pending?.expiresAtMs;
  if (expires === undefined) return 0;
  return Math.max(0, Math.ceil((expires - now.value) / 1000));
});

async function onDeny(): Promise<void> {
  const id = gitClientsStore.pending?.requestId;
  if (id) await gitClientsStore.denyPairing(id);
}

async function onApprove(): Promise<void> {
  const id = gitClientsStore.pending?.requestId;
  if (id) await gitClientsStore.approvePairing(id);
}
</script>

<template>
  <DialogFrame
    v-if="gitClientsStore.pending"
    title="Editor wants to connect"
    :width="420"
    test-id="git-pairing-dialog"
    @close="onDeny"
  >
    <p class="whitespace-pre-wrap" style="margin: 0 0 var(--kira-s-2); padding: var(--kira-s-4) var(--kira-s-5) 0">
      <strong>{{ gitClientsStore.pending.label || 'A VS Code editor' }}</strong> wants to connect
      to this repository's git data over <span class="mono">~/.kira-studio/git.sock</span>.
      Approving lets it read and change git state in repositories it opens.
    </p>
    <p
      class="m-0"
      style="padding: 0 var(--kira-s-5) var(--kira-s-4); color: var(--kira-fg-subtle)"
      data-testid="git-pairing-expires"
    >
      Expires in {{ remainingSeconds }}s
    </p>
    <p
      v-if="gitClientsStore.queued > 1"
      class="m-0"
      style="padding: 0 var(--kira-s-5) var(--kira-s-4); color: var(--kira-fg-subtle)"
      data-testid="git-pairing-queue-count"
    >
      1 of {{ gitClientsStore.queued }} waiting
    </p>

    <template #footer>
      <span class="p-dialog-actions end p-push" style="gap: var(--kira-s-2)">
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
