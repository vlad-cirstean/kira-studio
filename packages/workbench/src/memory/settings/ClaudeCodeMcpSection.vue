<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { useMemoryMcpStatus } from '../queries';

// P233: status only. Sessions Kira Space starts get kira-memory per launch; nothing is written to
// the user's Claude Code config.
const status = useMemoryMcpStatus();
</script>

<template>
  <FieldSet data-testid="memory-mcp-section">
    <FieldLegend>Claude Code</FieldLegend>
    <FieldDescription>
      Claude Code sessions Kira Space starts (agent terminal tabs, ADE sessions) get the kira-memory
      tools: store_memory, search_memories, memory_history and /mcp__kira-memory__remember. Kira Space
      does not change your Claude Code configuration.
    </FieldDescription>
    <Alert v-if="status.isError.value" variant="destructive">
      <AlertDescription>{{ status.error.value?.message }}</AlertDescription>
    </Alert>
    <p v-else-if="status.data.value" class="m-0 text-kira-sm text-muted-foreground" data-testid="memory-mcp-cli">
      <template v-if="status.data.value.claudeAvailable">
        Claude Code CLI found at <code class="font-data">{{ status.data.value.claudePath }}</code>.
      </template>
      <template v-else>
        Claude Code CLI not found. Looked in
        <code class="font-data">{{ status.data.value.probed.join(', ') || 'PATH' }}</code>. The memory
        store check needs it.
      </template>
    </p>
  </FieldSet>
</template>
