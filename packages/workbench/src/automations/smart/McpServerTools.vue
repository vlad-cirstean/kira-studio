<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { queryClient } from '@workbench/state/queryClient';
import { computed, useId } from 'vue';
import { useAutomationsModule } from '../module';

// One enabled MCP server's tools; the query runs only while this is mounted, so a switch that is off
// never starts the server.
const props = defineProps<{ server: string; chosen: readonly string[]; typed: string }>();
const emit = defineEmits<{ tool: [name: string, on: boolean]; typed: [value: string]; add: [] }>();
const { runs } = useAutomationsModule();
const idBase = useId();

const tools = useQuery(
  {
    queryKey: ['scriptRuns', 'mcp', props.server],
    queryFn: () => runs.mcpTools(props.server),
    staleTime: 0,
    retry: false,
  },
  queryClient,
);
const listed = computed(() => tools.data.value ?? []);
// Ticked tools the server did not list (typed by name).
const extra = computed(() => props.chosen.filter((c) => !listed.value.some((t) => t.name === c)));
</script>

<template>
  <div class="ml-9 flex flex-col gap-1" data-testid="smart-mcp-tools">
    <Alert v-if="tools.isError.value" variant="destructive" class="w-auto" data-testid="smart-mcp-error">
      <AlertDescription>{{ tools.error.value?.message }}</AlertDescription>
    </Alert>
    <div v-for="t in listed" :key="t.name" class="flex items-start gap-1.5">
      <Checkbox
        :id="`${idBase}-${t.name}`"
        class="mt-0.5 size-3.5"
        :model-value="chosen.includes(t.name)"
        :data-testid="`smart-mcp-tool-${t.name}`"
        @update:model-value="(v) => emit('tool', t.name, v === true)"
      >
        <CodiconIcon name="check" :size="12" />
      </Checkbox>
      <Label :for="`${idBase}-${t.name}`" class="flex flex-col items-start">
        <span class="font-data">{{ t.name }}</span>
        <span v-if="t.description" class="text-kira-sm text-muted-foreground">{{ t.description.split('\n')[0] }}</span>
      </Label>
    </div>
    <div v-for="name in extra" :key="name" class="flex items-center gap-1.5">
      <span class="font-data">{{ name }}</span>
      <TooltipIconButton icon="close" :label="`Remove ${name}`" @click="emit('tool', name, false)" />
    </div>
    <div v-if="tools.isError.value" class="flex items-center gap-1">
      <Input
        :model-value="typed"
        placeholder="Add tool by name"
        class="font-data"
        data-testid="smart-mcp-add-input"
        @update:model-value="(v) => emit('typed', String(v))"
        @keydown.enter.prevent="emit('add')"
      />
      <Button variant="dialog" size="kira-lg" data-testid="smart-mcp-add" @click="emit('add')">Add</Button>
    </div>
  </div>
</template>
