<script setup lang="ts">
import { useGitClientsStore } from '../state/gitClients';
import PairingRequestDialog from './PairingRequestDialog.vue';

const gitClientsStore = useGitClientsStore();

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
  <PairingRequestDialog
    title="Editor wants to connect"
    :request-id="gitClientsStore.pending?.requestId"
    :expires-at-ms="gitClientsStore.pending?.expiresAtMs"
    :queued="gitClientsStore.queued"
    testid-prefix="git-pairing"
    @deny="onDeny"
    @approve="onApprove"
  >
    <template v-if="gitClientsStore.pending">
      <p class="whitespace-pre-wrap mb-1.5 px-3 pt-2">
        A local process wants to connect to this repository's git data over Kira Space's
        local git socket. Approving lets it read and change git state in repositories it opens.
      </p>
      <p class="m-0 px-3 pb-1.5 break-all" data-testid="git-pairing-process">
        Process:
        <strong>{{ gitClientsStore.pending.peerExe || 'unknown executable' }}</strong>
        (pid {{ gitClientsStore.pending.peerPid }})
      </p>
      <p class="m-0 text-subtle px-3 pb-1.5 break-all" data-testid="git-pairing-label">
        Says it is: {{ gitClientsStore.pending.label || 'unnamed client' }}
      </p>
    </template>
  </PairingRequestDialog>
</template>
