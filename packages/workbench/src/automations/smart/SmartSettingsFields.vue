<script setup lang="ts">
import { SMART_MODELS, type SmartSettings } from '@shared/domain/scripts';
import { Field, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';

const smart = defineModel<SmartSettings>({ required: true });
</script>

<template>
  <div class="flex items-end gap-3" data-testid="smart-settings">
    <Field class="min-w-0 flex-1">
      <FieldLabel for="smart-model">Model</FieldLabel>
      <NativeSelect id="smart-model" v-model="smart.model" variant="bordered" size="kira-lg" data-testid="smart-model">
        <option v-for="m in SMART_MODELS" :key="m" :value="m">{{ m }}</option>
      </NativeSelect>
    </Field>
    <Field class="w-32">
      <FieldLabel for="smart-budget">Budget (USD)</FieldLabel>
      <Input
        id="smart-budget"
        v-model.number="smart.maxBudgetUsd"
        type="number"
        min="0.01"
        step="0.1"
        data-testid="smart-budget"
      />
    </Field>
    <Field class="w-28">
      <FieldLabel for="smart-timeout">Timeout</FieldLabel>
      <Input id="smart-timeout" v-model="smart.timeout" placeholder="15m" class="font-data" data-testid="smart-timeout" />
    </Field>
  </div>
</template>
