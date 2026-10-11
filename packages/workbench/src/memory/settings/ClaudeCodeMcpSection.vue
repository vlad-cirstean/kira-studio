<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Card } from '@theme/components/ui/card';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { computed } from 'vue';
import { useCopy } from '../../behaviour/clipboard';
import QueryState from '../../components/QueryState.vue';
import { useInstallMemoryMcp, useMemoryMcpStatus } from '../queries';

// P201: registers the kira-memory stdio server with Claude Code, or shows the command to run.
const status = useMemoryMcpStatus();
const install = useInstallMemoryMcp();
const command = computed(() => status.data.value?.command ?? '');
const { copy, copied } = useCopy();

const message = computed(() => {
  const r = install.data.value;
  if (!r) return null;
  switch (r.outcome) {
    case 'installed':
      return t('common.claudeCodeRegistered.description');
    case 'notFound':
      return t('common.claudeCliNotFound.error');
    default:
      return t('common.claudeRegistrationRefused.error', { detail: r.detail });
  }
});
</script>

<template>
  <FieldSet data-testid="memory-mcp-section">
    <FieldLegend>{{ t('memory.mcp.connect.title') }}</FieldLegend>
    <FieldDescription>{{ t('memory.mcp.connect.description') }}</FieldDescription>
    <QueryState :query="status" variant="inline" :is-empty="() => false">
      <template #error="{ message: statusMessage }">
        <Alert variant="error">
          <AlertDescription>{{ statusMessage }}</AlertDescription>
        </Alert>
      </template>
      <Card
        v-if="command"
        class="font-data whitespace-pre-wrap break-all select-all text-kira-sm leading-normal"
        data-testid="memory-mcp-command"
      >{{ command }}</Card>
    </QueryState>
    <p v-if="command" class="m-0 text-kira-sm text-muted-foreground">
      <CatalogText k="memory.mcp.command.hint">
        <template #command><code class="font-data">memory-mcp</code></template>
      </CatalogText>
    </p>
    <p v-if="message" class="m-0 text-kira-sm text-muted-foreground" data-testid="memory-mcp-install-outcome">{{ message }}</p>
    <div class="flex items-center gap-1">
      <Button variant="dialog" size="kira-lg" :disabled="!command" data-testid="memory-mcp-copy" @click="copy(command)">
        {{ copied ? t('common.copy.copied.announce') : t('common.copyCommand.label') }}
      </Button>
      <Button
        variant="dialog-primary"
        size="kira-lg"
        :disabled="install.isPending.value || !status.data.value?.claudeAvailable"
        data-testid="memory-mcp-install"
        @click="install.mutate()"
      >
        <CodiconIcon name="plug" :size="12" /> {{ t('common.registerWithClaudeCode.label') }}
      </Button>
    </div>
  </FieldSet>
</template>
