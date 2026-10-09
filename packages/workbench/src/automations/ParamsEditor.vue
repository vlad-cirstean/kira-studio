<script setup lang="ts">
import type { ScriptKind, ScriptParam, ScriptParamType } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { useId } from 'vue';

const params = defineModel<ScriptParam[]>({ required: true });
defineProps<{ kind: ScriptKind }>();
const idBase = useId();

function add(): void {
  params.value = [
    ...params.value,
    { name: '', label: '', type: 'text', options: [], default: [], required: false, secret: false },
  ];
}

function remove(i: number): void {
  params.value = params.value.filter((_, j) => j !== i);
}

function patch(i: number, change: Partial<ScriptParam>): void {
  params.value = params.value.map((p, j) => (j === i ? { ...p, ...change } : p));
}

function setType(i: number, type: ScriptParamType): void {
  patch(i, { type, options: type === 'text' ? [] : (params.value[i]?.options ?? []), default: [], secret: false });
}

function addOption(i: number): void {
  patch(i, { options: [...(params.value[i]?.options ?? []), ''] });
}

function setOption(i: number, k: number, value: string): void {
  const p = params.value[i];
  if (!p) return;
  const old = p.options[k];
  patch(i, {
    options: p.options.map((o, j) => (j === k ? value : o)),
    default: p.default.map((d) => (d === old ? value : d)),
  });
}

function removeOption(i: number, k: number): void {
  const p = params.value[i];
  if (!p) return;
  const old = p.options[k];
  patch(i, { options: p.options.filter((_, j) => j !== k), default: p.default.filter((d) => d !== old) });
}

function moveOption(i: number, k: number, by: -1 | 1): void {
  const p = params.value[i];
  const to = k + by;
  if (!p || to < 0 || to >= p.options.length) return;
  const next = [...p.options];
  const [moved] = next.splice(k, 1);
  next.splice(to, 0, moved ?? '');
  patch(i, { options: next });
}

function toggleDefault(i: number, option: string, on: boolean): void {
  const p = params.value[i];
  if (!p) return;
  const rest = p.default.filter((d) => d !== option);
  patch(i, { default: p.type === 'multiselect' ? (on ? [...rest, option] : rest) : on ? [option] : [] });
}
</script>

<template>
  <FieldSet data-testid="params-editor">
    <div class="flex items-center gap-2">
      <FieldLegend class="mb-0">Parameters</FieldLegend>
      <Button variant="dialog" size="kira-lg" class="ml-auto" data-testid="param-add" @click="add">Add parameter</Button>
    </div>
    <FieldDescription v-if="kind === 'script'">Params reach the command as $KIRA_PARAM_&lt;NAME&gt;</FieldDescription>
    <FieldDescription v-else>
      Use {name} in the prompt. A secret reaches the run as $KIRA_PARAM_&lt;NAME&gt; only, never in the prompt.
    </FieldDescription>
    <div
      v-for="(p, i) in params"
      :key="i"
      class="flex flex-col gap-1.5 rounded-kira-sm border border-border p-2"
      data-testid="param-row"
    >
      <div class="flex items-center gap-1.5">
        <Input
          :model-value="p.name"
          placeholder="name"
          class="w-32 font-data"
          :data-testid="`param-name-${i}`"
          @update:model-value="(v) => patch(i, { name: String(v) })"
        />
        <Input
          :model-value="p.label"
          placeholder="Label"
          class="min-w-0 flex-1"
          :data-testid="`param-label-${i}`"
          @update:model-value="(v) => patch(i, { label: String(v) })"
        />
        <NativeSelect
          :model-value="p.type"
          variant="bordered"
          size="kira-lg"
          :data-testid="`param-type-${i}`"
          @update:model-value="(v) => setType(i, v as ScriptParamType)"
        >
          <option value="text">Text</option>
          <option value="select">Select</option>
          <option value="multiselect">Multiselect</option>
        </NativeSelect>
        <Button variant="ghost" size="icon-sm" :aria-label="`Remove parameter ${p.name}`" @click="remove(i)">
          <CodiconIcon name="trash" :size="12" />
        </Button>
      </div>
      <Input
        v-if="p.type === 'text'"
        :model-value="p.default[0] ?? ''"
        placeholder="Default"
        :data-testid="`param-default-${i}`"
        @update:model-value="(v) => patch(i, { default: String(v) === '' ? [] : [String(v)] })"
      />
      <div v-else class="flex flex-col gap-1" :data-testid="`param-options-${i}`">
        <div v-for="(o, k) in p.options" :key="k" class="flex items-center gap-1">
          <Checkbox
            class="size-3.5"
            :model-value="p.default.includes(o)"
            :aria-label="`Default ${o}`"
            @update:model-value="(v) => toggleDefault(i, o, v === true)"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          <Input
            :model-value="o"
            placeholder="Option"
            class="min-w-0 flex-1"
            :data-testid="`param-option-${i}-${k}`"
            @update:model-value="(v) => setOption(i, k, String(v))"
          />
          <Button variant="ghost" size="icon-sm" aria-label="Move up" @click="moveOption(i, k, -1)">
            <CodiconIcon name="arrow-up" :size="12" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Move down" @click="moveOption(i, k, 1)">
            <CodiconIcon name="arrow-down" :size="12" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Remove option" @click="removeOption(i, k)">
            <CodiconIcon name="close" :size="12" />
          </Button>
        </div>
        <Button variant="dialog" size="kira-lg" class="self-start" :data-testid="`param-option-add-${i}`" @click="addOption(i)">
          Add option
        </Button>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-1.5">
          <Checkbox
            :id="`${idBase}-req-${i}`"
            class="size-3.5"
            :model-value="p.required"
            @update:model-value="(v) => patch(i, { required: v === true })"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          <Label :for="`${idBase}-req-${i}`">Required</Label>
        </div>
        <div v-if="p.type === 'text'" class="flex items-center gap-1.5">
          <Checkbox
            :id="`${idBase}-sec-${i}`"
            class="size-3.5"
            :model-value="p.secret"
            :data-testid="`param-secret-${i}`"
            @update:model-value="(v) => patch(i, { secret: v === true })"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          <Label :for="`${idBase}-sec-${i}`">Secret</Label>
        </div>
      </div>
    </div>
  </FieldSet>
</template>
