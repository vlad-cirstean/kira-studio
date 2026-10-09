<script setup lang="ts">
import type { SmartSettings } from '@shared/domain/scripts';
import { useQuery } from '@tanstack/vue-query';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { queryClient } from '@workbench/state/queryClient';
import { computed, ref, useId } from 'vue';
import { useAutomationsModule } from '../module';
import McpServerTools from './McpServerTools.vue';
import { withMcp } from './smartSettings';

const smart = defineModel<SmartSettings>({ required: true });
const { runs } = useAutomationsModule();
const idBase = useId();

const servers = useQuery(
  { queryKey: ['scriptRuns', 'mcp'], queryFn: () => runs.mcpServers(), staleTime: 0 },
  queryClient,
);

function chosen(server: string): string[] | null {
  return smart.value.mcp.find((c) => c.server === server)?.tools ?? null;
}

function setServer(server: string, on: boolean): void {
  smart.value.mcp = on
    ? withMcp(smart.value.mcp, server, [])
    : smart.value.mcp.filter((c) => c.server !== server);
}

function setTool(server: string, tool: string, on: boolean): void {
  const cur = chosen(server) ?? [];
  const next = on ? [...cur.filter((t) => t !== tool), tool] : cur.filter((t) => t !== tool);
  smart.value.mcp = withMcp(smart.value.mcp, server, next);
}

const typed = ref<Record<string, string>>({});
function addByName(server: string): void {
  const name = (typed.value[server] ?? '').trim();
  if (name === '') return;
  setTool(server, name, true);
  typed.value = { ...typed.value, [server]: '' };
}

const enabled = computed(() => smart.value.mcp.map((c) => c.server));
</script>

<template>
  <FieldSet data-testid="smart-mcp">
    <FieldLegend>MCP tools</FieldLegend>
    <FieldDescription>Only servers from your user Claude config are listed.</FieldDescription>
    <span v-if="servers.data.value?.length === 0" class="text-kira-sm text-muted-foreground" data-testid="smart-mcp-none">
      No MCP servers.
    </span>
    <Alert v-if="servers.isError.value" variant="destructive" class="w-auto">
      <AlertDescription>{{ servers.error.value?.message }}</AlertDescription>
    </Alert>
    <div v-for="s in servers.data.value ?? []" :key="s.name" class="flex flex-col gap-1" data-testid="smart-mcp-server" :data-server="s.name">
      <div class="flex items-center gap-2">
        <Switch
          :id="`${idBase}-${s.name}`"
          :model-value="enabled.includes(s.name)"
          :data-testid="`smart-mcp-switch-${s.name}`"
          @update:model-value="(v) => setServer(s.name, v === true)"
        />
        <Label :for="`${idBase}-${s.name}`">{{ s.name }}</Label>
        <span class="truncate font-data text-kira-sm text-muted-foreground">{{ s.transport }} {{ s.target }}</span>
      </div>
      <McpServerTools
        v-if="enabled.includes(s.name)"
        :server="s.name"
        :chosen="chosen(s.name) ?? []"
        :typed="typed[s.name] ?? ''"
        @tool="(tool, on) => setTool(s.name, tool, on)"
        @typed="(v) => (typed = { ...typed, [s.name]: v })"
        @add="addByName(s.name)"
      />
    </div>
  </FieldSet>
</template>
