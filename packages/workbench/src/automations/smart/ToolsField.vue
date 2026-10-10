<script setup lang="ts">
import { BUILTIN_TOOLS, DEFAULT_TOOLS, type SmartSettings } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { computed, ref, useId } from 'vue';
import { allowedToolsOf } from './smartSettings';

const smart = defineModel<SmartSettings>({ required: true });
const idBase = useId();
const draft = ref('');

const bashOn = computed(() => smart.value.tools.includes('Bash'));
const allowedLine = computed(() => allowedToolsOf(smart.value).join(' '));

function toggle(tool: string, on: boolean): void {
  const rest = smart.value.tools.filter((t) => t !== tool);
  smart.value.tools = on ? [...rest, tool] : rest;
  if (tool === 'Bash' && !on) smart.value.bashPatterns = [];
}

function addPattern(): void {
  const p = draft.value.trim();
  if (p === '' || smart.value.bashPatterns.includes(p)) return;
  smart.value.bashPatterns = [...smart.value.bashPatterns, p];
  draft.value = '';
}

function removePattern(p: string): void {
  smart.value.bashPatterns = smart.value.bashPatterns.filter((x) => x !== p);
}

function resetTools(): void {
  smart.value.tools = [...DEFAULT_TOOLS];
  smart.value.bashPatterns = [];
}
</script>

<template>
  <FieldSet data-testid="smart-tools">
    <div class="flex items-center gap-2">
      <FieldLegend class="mb-0">Tools</FieldLegend>
      <Button variant="dialog" size="kira-lg" class="ml-auto" data-testid="smart-tools-default" @click="resetTools">
        Default tools
      </Button>
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1">
      <div v-for="tool in BUILTIN_TOOLS" :key="tool" class="flex items-center gap-1.5">
        <Checkbox
          :id="`${idBase}-${tool}`"
          class="size-3.5"
          :model-value="smart.tools.includes(tool)"
          :data-testid="`smart-tool-${tool}`"
          @update:model-value="(v) => toggle(tool, v === true)"
        >
          <CodiconIcon name="check" :size="12" />
        </Checkbox>
        <Label :for="`${idBase}-${tool}`">{{ tool }}</Label>
      </div>
    </div>
    <div v-if="bashOn" class="flex flex-col gap-1" data-testid="smart-bash-patterns">
      <FieldDescription>Bash commands the script may run, such as git status:*. Empty allows any.</FieldDescription>
      <div v-for="p in smart.bashPatterns" :key="p" class="flex items-center gap-1" data-testid="smart-bash-pattern">
        <span class="min-w-0 flex-1 truncate font-data">{{ p }}</span>
        <TooltipIconButton icon="close" :label="`Remove ${p}`" @click="removePattern(p)" />
      </div>
      <InputGroup>
        <InputGroupInput
          v-model="draft"
          placeholder="git status:*"
          class="font-data"
          data-testid="smart-bash-input"
          @keydown.enter.prevent="addPattern"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Add pattern" data-testid="smart-bash-add" @click="addPattern">
            <CodiconIcon name="add" :size="12" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
    <FieldDescription class="font-data" data-testid="smart-allowed-line">--allowedTools {{ allowedLine || '(none)' }}</FieldDescription>
  </FieldSet>
</template>
