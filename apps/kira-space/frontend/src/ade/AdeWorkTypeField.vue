<script setup lang="ts">
import { NativeSelect } from '@theme/components/ui/native-select';
import { ref, watch } from 'vue';
import { useAdeSetWorkType } from './mutations';
import type { QueuePanel } from './useQueue';
import type { AdeWorkType } from './wire';
import { workTypeOptions } from './workType';

// P136: the Kind row. `kind` follows on the Go side, so the select reads the stored value back
// from the snapshot and reverts to it when a write is refused.
const props = defineProps<{ panel: QueuePanel; codeRepoId: string }>();

const setWorkType = useAdeSetWorkType(() => props.codeRepoId);
const selected = ref<AdeWorkType>(props.panel.workType);
const error = ref<string | null>(null);

watch(
  () => [props.panel.id, props.panel.workType] as const,
  () => {
    selected.value = props.panel.workType;
    error.value = null;
  },
);

async function onChange(value: unknown): Promise<void> {
  const workType = value as AdeWorkType;
  selected.value = workType;
  error.value = null;
  try {
    await setWorkType.mutateAsync({ codeRepoId: props.codeRepoId, item: props.panel.id, workType });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Save failed';
    selected.value = props.panel.workType;
  }
}
</script>

<template>
  <label for="ade-work-type" class="text-kira-sm text-muted-foreground">Kind</label>
  <div class="flex min-w-0 flex-col gap-0.5">
    <NativeSelect
      id="ade-work-type"
      :model-value="selected"
      class="h-7 text-kira-sm"
      data-testid="ade-work-type"
      @update:model-value="onChange"
    >
      <option
        v-for="o in workTypeOptions(panel)"
        :key="o.value"
        :value="o.value"
        :disabled="o.disabled"
        :title="o.tip"
      >
        {{ o.label }}
      </option>
    </NativeSelect>
    <span v-if="error" class="text-kira-sm text-error" data-testid="ade-work-type-error">{{
      error
    }}</span>
  </div>
</template>
