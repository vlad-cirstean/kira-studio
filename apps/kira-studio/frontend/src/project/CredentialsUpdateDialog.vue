<script setup lang="ts">
import { useMutation } from '@tanstack/vue-query';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
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
    <DialogContent size="md" data-testid="credentials-update-dialog">
      <DialogHeader closable>
        <DialogTitle>Update credentials — {{ record?.name }}</DialogTitle>
      </DialogHeader>
      <DialogBody>
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
      </DialogBody>
    </DialogContent>
  </Dialog>
</template>
