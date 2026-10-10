<script setup lang="ts">
import type { ScriptRunPreview } from '@shared/domain/scriptRuns';
import VarText from '@theme/components/VarText.vue';
import type { TextPart } from '@theme/varText';
import { computed } from 'vue';

const props = defineProps<{ preview: ScriptRunPreview }>();

const MODE_LABEL = { kira: 'Kira automations folder', fixed: 'Chosen folder', home: 'Home folder' } as const;
const folderParts = computed<TextPart[]>(() => {
  const d = props.preview.dir;
  if (d.mode === 'worktree') {
    return [
      'Worktree of ',
      { name: 'branch', value: d.branch },
      ': ',
      { name: 'folder', value: d.path },
      ...(d.pending ? [' (created on Run)'] : []),
    ];
  }
  return [`${MODE_LABEL[d.mode]}: `, { name: 'folder', value: d.path }];
});
function envParts(e: ScriptRunPreview['env'][number]): TextPart[] {
  return [`${e.name}=`, ...(e.secret ? ['••••'] : [{ name: e.fromVar, value: e.value }])];
}
</script>

<template>
  <div class="flex flex-col gap-1.5 rounded-kira-sm border border-border p-2 text-kira-sm" data-testid="run-preview">
    <div data-testid="run-folder"><VarText :parts="folderParts" /></div>
    <template v-if="preview.kind === 'smart'">
      <div class="text-muted-foreground" data-testid="run-limits">
        Model {{ preview.model }}, budget {{ preview.maxBudgetUsd }} USD, timeout {{ preview.timeout }}
      </div>
      <div class="font-data" data-testid="run-tools">--tools {{ preview.tools.join(',') }}</div>
      <div class="font-data break-words" data-testid="run-allowed-tools">--allowedTools {{ preview.allowedTools.join(' ') }}</div>
      <div v-if="preview.mcpServers.length > 0" data-testid="run-mcp">MCP servers: {{ preview.mcpServers.join(', ') }}</div>
    </template>
    <div v-else class="font-data whitespace-pre-wrap break-words" data-testid="run-command">{{ preview.command }}</div>
    <div v-if="preview.env.length > 0" class="flex flex-col font-data" data-testid="run-env">
      <div v-for="e in preview.env" :key="e.name" data-testid="run-env-row"><VarText :parts="envParts(e)" /></div>
    </div>
    <div v-if="preview.kind === 'smart'" class="text-muted-foreground" data-testid="run-isolated">
      Your Claude settings files are not loaded.
    </div>
  </div>
</template>
