<script setup lang="ts">
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Switch } from '@theme/components/ui/switch';
import { computed, ref } from 'vue';
import { toNumber } from '../lib/editDiff';

const props = defineProps<{ modelValue: number; allowUnlimited?: boolean; disabled?: boolean; testid: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const unit = ref<'MiB' | 'GiB'>(props.modelValue >= GIB && props.modelValue % GIB === 0 ? 'GiB' : 'MiB');
const factor = computed(() => (unit.value === 'GiB' ? GIB : MIB));
const unlimited = computed(() => props.modelValue === -1);
const amount = computed(() => (props.modelValue > 0 ? String(props.modelValue / factor.value) : ''));

function setAmount(v: string | number): void {
  const n = toNumber(v);
  emit('update:modelValue', n > 0 ? Math.round(n * factor.value) : 0);
}
</script>

<template>
  <div class="flex items-center gap-2">
    <Input
      type="number"
      min="0"
      step="any"
      class="w-28"
      placeholder="none"
      :model-value="amount"
      :disabled="disabled || unlimited"
      :data-testid="testid"
      @update:model-value="setAmount"
    />
    <NativeSelect v-model="unit" class="w-20" :disabled="disabled || unlimited" :data-testid="`${testid}-unit`">
      <option value="MiB">MiB</option>
      <option value="GiB">GiB</option>
    </NativeSelect>
    <span v-if="allowUnlimited" class="flex items-center gap-1.5 text-muted-foreground">
      <Switch
        :model-value="unlimited"
        :disabled="disabled"
        :data-testid="`${testid}-unlimited`"
        @update:model-value="emit('update:modelValue', $event ? -1 : 0)"
      aria-label="Unlimited"
      />Unlimited
    </span>
  </div>
</template>
