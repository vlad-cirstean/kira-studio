<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { useIntervalFn } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import { useGitClientsStore } from '../state/gitClients';

const gitClientsStore = useGitClientsStore();

// G1 D17: a separate, always-mounted dialog at App.vue's root, the same precedent ConfirmDialog
// sets — a pairing request must be able to appear with nothing else open. Renders nothing while
// gitClientsStore.pending is null.
const denyButton = ref<InstanceType<typeof Button> | null>(null);
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
  <Dialog v-if="gitClientsStore.pending" :open="true" @update:open="(v) => !v && onDeny()">
    <DialogContent
      :show-close-button="false"
      data-testid="git-pairing-dialog"
      class="flex flex-col p-0 gap-0 w-105 max-h-4/5"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <DialogTitle class="text-kira-lg font-normal">Editor wants to connect</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close" @click="onDeny">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="overflow-auto">
        <p class="whitespace-pre-wrap mb-1.5 px-3 pt-2">
          <strong>{{ gitClientsStore.pending.label || 'A VS Code editor' }}</strong> wants to connect
          to this repository's git data over <span class="font-data">~/.kira-studio/git.sock</span>.
          Approving lets it read and change git state in repositories it opens.
        </p>
        <p class="m-0 text-subtle px-3 pb-2" data-testid="git-pairing-expires">
          Expires in {{ remainingSeconds }}s
        </p>
        <p
          v-if="gitClientsStore.queued > 1"
          class="m-0 text-subtle px-3 pb-2"
          data-testid="git-pairing-queue-count"
        >
          1 of {{ gitClientsStore.queued }} waiting
        </p>
      </div>

      <DialogFooter class="border-t border-border">
        <span class="flex items-center gap-1 ml-auto">
          <Button ref="denyButton" variant="dialog" size="kira-lg" data-testid="git-pairing-deny" @click="onDeny">
            Deny
          </Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="git-pairing-approve"
            @click="onApprove"
          >
            Approve
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
