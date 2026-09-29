<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { NativeSelect } from '@theme/components/ui/native-select';
import { ref } from 'vue';

// P129 Part 6 §0.15: shown in place of the new-work `from` select once `branchCandidates.length >
// 1` — Claude created more than one branch since the draft started, and the queue can't guess
// which one is the real one.
const props = defineProps<{
  candidates: readonly string[];
  error: string | null;
}>();

const emit = defineEmits<{ pick: [branch: string] }>();

const selected = ref(props.candidates[0] ?? '');

function onUse(): void {
  if (selected.value) emit('pick', selected.value);
}
</script>

<template>
  <div class="col-span-2 flex h-7 items-center gap-2" data-testid="ade-candidate-picker">
    <span
      class="rounded-kira-sm bg-[rgba(232,163,61,0.14)] px-1.5 py-0.5 text-kira-sm font-semibold text-[#f0b85c]"
    >
      Pick the branch Claude created
    </span>
    <NativeSelect
      v-model="selected"
      class="max-w-[220px] font-data text-kira-sm"
      aria-label="Candidate branch"
    >
      <option v-for="name in candidates" :key="name" :value="name">{{ name }}</option>
    </NativeSelect>
    <Button variant="dialog" size="sm" class="h-6 shrink-0 px-2" @click="onUse">Use branch</Button>
    <span v-if="error" class="text-kira-sm text-error">{{ error }}</span>
  </div>
</template>
