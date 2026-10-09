<script setup lang="ts">
import type { ScriptParam } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Command, CommandItem, CommandList } from '@theme/components/ui/command';
import { Field, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { useId } from 'vue';

const values = defineModel<Record<string, string[]>>({ required: true });
defineProps<{ params: readonly ScriptParam[] }>();
const idBase = useId();

function set(name: string, next: string[]): void {
  values.value = { ...values.value, [name]: next };
}

function summary(p: ScriptParam): string {
  const v = values.value[p.name] ?? [];
  return v.length === 0 ? 'Choose…' : v.join(', ');
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="run-params">
    <Field v-for="p in params" :key="p.name" :data-testid="`run-param-${p.name}`">
      <FieldLabel :for="`${idBase}-${p.name}`">
        {{ p.label || p.name }}<span v-if="p.required" class="text-error"> *<span class="sr-only"> required</span></span>
      </FieldLabel>
      <Input
        v-if="p.type === 'text'"
        :id="`${idBase}-${p.name}`"
        :type="p.secret ? 'password' : 'text'"
        :model-value="values[p.name]?.[0] ?? ''"
        :autocomplete="p.secret ? 'off' : undefined"
        :data-testid="`run-param-input-${p.name}`"
        @update:model-value="(v) => set(p.name, String(v) === '' ? [] : [String(v)])"
      />
      <NativeSelect
        v-else-if="p.type === 'select'"
        :id="`${idBase}-${p.name}`"
        :model-value="values[p.name]?.[0] ?? ''"
        variant="bordered"
        size="kira-lg"
        :data-testid="`run-param-input-${p.name}`"
        @update:model-value="(v) => set(p.name, v === '' ? [] : [String(v)])"
      >
        <option value="">Choose…</option>
        <option v-for="o in p.options" :key="o" :value="o">{{ o }}</option>
      </NativeSelect>
      <Popover v-else>
        <PopoverTrigger as-child>
          <Button
            :id="`${idBase}-${p.name}`"
            variant="dialog"
            size="kira-lg"
            class="justify-between"
            :data-testid="`run-param-input-${p.name}`"
          >
            <span class="truncate">{{ summary(p) }}</span>
            <CodiconIcon name="chevron-down" :size="12" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-64 p-0">
          <Command multiple :model-value="values[p.name] ?? []" @update:model-value="(v) => set(p.name, v as string[])">
            <CommandList>
              <CommandItem v-for="o in p.options" :key="o" :value="o" :data-testid="`run-param-option-${p.name}-${o}`">
                {{ o }}
              </CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  </div>
</template>
