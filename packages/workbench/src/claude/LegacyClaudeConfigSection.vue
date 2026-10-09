<script setup lang="ts">
import type { ClaudeLegacyCleanup, ClaudeLegacyStatus } from '@shared/domain/claudeConfig';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { useClipboard } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed, ref } from 'vue';

// P233: earlier versions registered MCP servers in the user's Claude Code config. Kira no longer
// needs them. Lists them read-only and removes them only after an explicit confirm.
const props = defineProps<{
  load: () => Promise<ClaudeLegacyStatus>;
  remove: () => Promise<ClaudeLegacyCleanup>;
  /** Where the app stores the pre-cleanup copy of the config file, shown in the confirm. */
  backupDir: string;
}>();

const KEY = ['claude', 'legacy'] as const;
const status = useQuery({ queryKey: KEY, queryFn: () => props.load() }, queryClient);
const cleanup = useMutation(
  {
    mutationKey: [...KEY, 'remove'],
    mutationFn: () => props.remove(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  },
  queryClient,
);

const confirming = ref(false);
const entries = computed(() => status.data.value?.entries ?? []);
const names = computed(() => entries.value.map((e) => e.name).join(', '));
const commands = computed(() => cleanup.data.value?.commands.join('\n') ?? '');
const { copy, copied } = useClipboard({ source: commands, copiedDuring: 1500 });

function onConfirm(): void {
  confirming.value = false;
  cleanup.mutate();
}

const message = computed(() => {
  const r = cleanup.data.value;
  if (!r) return null;
  switch (r.outcome) {
    case 'removed':
      return `Removed ${r.removed.join(', ')}. Backup: ${r.backupPath}`;
    case 'notFound':
      return "Claude Code's CLI isn't available. Run these commands yourself once it is installed:";
    case 'failed':
      return `Could not remove ${r.remaining.join(', ')}: ${r.detail}. Backup: ${r.backupPath}`;
    default:
      return 'Nothing to remove.';
  }
});
</script>

<template>
  <FieldSet v-if="entries.length > 0 || cleanup.data.value" data-testid="legacy-claude-section">
    <FieldLegend>Earlier Claude Code registrations</FieldLegend>
    <FieldDescription v-if="entries.length > 0">
      Earlier versions of Kira registered these MCP servers in your Claude Code configuration
      ({{ status.data.value?.file }}): {{ names }}. Kira no longer needs them. Remove only entries
      you did not add yourself.
    </FieldDescription>
    <ul v-if="entries.length > 0" class="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="legacy-claude-entries">
      <li v-for="e in entries" :key="e.name" class="text-kira-sm">
        <span class="font-data">{{ e.name }}</span>
        <span class="text-muted-foreground"> {{ e.summary }}</span>
      </li>
    </ul>
    <Alert v-if="cleanup.isError.value" variant="destructive">
      <AlertDescription>{{ cleanup.error.value?.message }}</AlertDescription>
    </Alert>
    <p v-if="message" class="m-0 text-kira-sm text-muted-foreground" data-testid="legacy-claude-outcome">{{ message }}</p>
    <template v-if="cleanup.data.value?.commands.length">
      <p
        class="font-data m-0 select-all whitespace-pre-wrap break-all rounded-kira-sm border border-border bg-field p-1 text-kira-sm leading-normal"
        data-testid="legacy-claude-commands"
      >{{ commands }}</p>
      <Button variant="dialog" size="kira-lg" class="self-start" data-testid="legacy-claude-copy" @click="copy(commands)">
        {{ copied ? 'Copied' : 'Copy commands' }}
      </Button>
    </template>
    <Button
      v-if="entries.length > 0"
      variant="dialog"
      size="kira-lg"
      class="self-start"
      :disabled="cleanup.isPending.value"
      data-testid="legacy-claude-remove"
      @click="confirming = true"
    >
      Remove…
    </Button>

    <Dialog v-if="confirming" :open="true" @update:open="(v) => !v && (confirming = false)">
      <DialogContent :show-close-button="false" data-testid="legacy-claude-dialog" class="w-100">
        <DialogHeader>
          <DialogTitle>Remove from Claude Code</DialogTitle>
          <DialogDescription>
            Removes {{ names }} from {{ status.data.value?.file }} through the claude CLI. A copy of
            the file is saved first in {{ backupDir }}. Your other servers and settings stay as they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="items-stretch gap-2 flex-col-reverse sm:flex-row sm:justify-end">
          <Button variant="dialog" size="kira-lg" data-testid="legacy-claude-cancel" @click="confirming = false">
            Cancel
          </Button>
          <Button variant="dialog-danger" size="kira-lg" data-testid="legacy-claude-confirm" @click="onConfirm">
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </FieldSet>
</template>
