<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { usePendingDecision } from '@workbench/util/usePendingDecision';
import { useGitClientsStore } from '../state/gitClients';

const gitClientsStore = useGitClientsStore();

// G1 D17: a separate, always-mounted dialog at App.vue's root, the same precedent ConfirmDialog
// sets — a pairing request must be able to appear with nothing else open. Renders nothing while
// gitClientsStore.pending is null.
//
// P113 F5 (fix): was keyed on `pending !== null`, a boolean — the queue advancing from request A
// straight to request B (no null in between) never re-fired it, so Deny focus and the countdown
// reset silently stayed on A. usePendingDecision keys on the request id instead.
const { remainingSeconds } = usePendingDecision({
  pendingId: () => gitClientsStore.pending?.requestId,
  expiresAtMs: () => gitClientsStore.pending?.expiresAtMs,
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
      <DialogHeader>
        <DialogTitle>Editor wants to connect</DialogTitle>
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

      <DialogFooter>
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
