<script setup lang="ts">
import { useMutation } from '@tanstack/vue-query';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { computed } from 'vue';
import { useConnectionsStore } from '../state/connections';
import CredentialPastePanel from './credentialPaste/CredentialPastePanel.vue';
import type { PasteField } from './credentialPaste/parse';
import { useCredentialsDialogStore } from './state/credentialsDialog';

const dialogStore = useCredentialsDialogStore();
const connectionsStore = useConnectionsStore();

const ALLOWED: readonly PasteField[] = ['username', 'password'];

const record = computed(() => connectionsStore.connectionRecord(dialogStore.connectionId));
const live = computed(() => {
  const id = dialogStore.connectionId;
  return id !== null && connectionsStore.states[id]?.status === 'connected';
});

const update = useMutation({
  mutationFn: (values: Partial<Record<PasteField, string>>) => {
    const id = dialogStore.connectionId;
    if (!id) return Promise.resolve();
    return connectionsStore.updateConnectionCredentials(id, {
      username: values.username,
      password: values.password,
    });
  },
  onSuccess: () => dialogStore.close(),
});

function onOpenChange(open: boolean): void {
  if (!open) dialogStore.close();
}
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent :show-close-button="false" data-testid="credentials-update-dialog" class="flex flex-col gap-2 w-120">
      <DialogHeader>
        <DialogTitle>Update credentials — {{ record?.name }}</DialogTitle>
      </DialogHeader>
      <CredentialPastePanel
        v-if="record"
        :kind="record.kind"
        :allowed="ALLOWED"
        retain
        @apply="(values) => update.mutate(values)"
        @cancel="dialogStore.close()"
      />
      <p v-if="live" class="m-0 text-kira-sm text-muted-foreground" data-testid="credentials-update-live-note">
        Reconnects the live connection.
      </p>
      <Alert v-if="update.error.value" variant="destructive" data-testid="credentials-update-error">
        <AlertDescription>{{ update.error.value.message }}</AlertDescription>
      </Alert>
    </DialogContent>
  </Dialog>
</template>
