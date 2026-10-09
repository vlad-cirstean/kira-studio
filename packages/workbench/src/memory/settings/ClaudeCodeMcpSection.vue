<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { useClipboard } from '@vueuse/core';
import { computed } from 'vue';
import { useInstallMemoryMcp, useMemoryMcpStatus } from '../queries';

// P201: registers the kira-memory stdio server with Claude Code, or shows the command to run.
const status = useMemoryMcpStatus();
const install = useInstallMemoryMcp();
const command = computed(() => status.data.value?.command ?? '');
const { copy, copied } = useClipboard({ source: command, copiedDuring: 1500 });

const message = computed(() => {
  const r = install.data.value;
  if (!r) return null;
  switch (r.outcome) {
    case 'installed':
      return 'Registered with Claude Code.';
    case 'notFound':
      return "Claude Code's CLI isn't available. Copy the command above and run it yourself once it is installed.";
    default:
      return `Claude Code refused the registration: ${r.detail}. Copy the command above and run it yourself.`;
  }
});
</script>

<template>
  <FieldSet data-testid="memory-mcp-section">
    <FieldLegend>Connect Claude Code</FieldLegend>
    <FieldDescription>
      Registers the kira-memory MCP server. Claude Code then gets the store_memory, search_memories and
      memory_history tools and the /mcp__kira-memory__remember command. The Claude Code CLI must be on
      PATH for the store check to run.
    </FieldDescription>
    <Alert v-if="status.isError.value" variant="destructive">
      <AlertDescription>{{ status.error.value?.message }}</AlertDescription>
    </Alert>
    <p
      v-else-if="command"
      class="font-data m-0 whitespace-pre-wrap break-all select-all rounded-kira-sm p-1 bg-field border border-border text-kira-sm leading-normal"
      data-testid="memory-mcp-command"
    >{{ command }}</p>
    <p v-if="command" class="m-0 text-kira-sm text-muted-foreground">
      The server runs this app's executable with <code class="font-data">memory-mcp</code>. Install again if the app moves.
    </p>
    <p v-if="message" class="m-0 text-kira-sm text-muted-foreground" data-testid="memory-mcp-install-outcome">{{ message }}</p>
    <div class="flex items-center gap-1">
      <Button variant="dialog" size="kira-lg" :disabled="!command" data-testid="memory-mcp-copy" @click="copy(command)">
        {{ copied ? 'Copied' : 'Copy command' }}
      </Button>
      <Button
        variant="dialog-primary"
        size="kira-lg"
        :disabled="install.isPending.value || !status.data.value?.claudeAvailable"
        data-testid="memory-mcp-install"
        @click="install.mutate()"
      >
        <CodiconIcon name="plug" :size="12" /> Register with Claude Code
      </Button>
    </div>
  </FieldSet>
</template>
