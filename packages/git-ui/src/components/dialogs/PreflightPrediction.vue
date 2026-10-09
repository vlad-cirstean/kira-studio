<script setup lang="ts">
/**
 * P113 F9: the "predicted outcome" block `RevertDialog.vue`/`CherryPickDialog.vue` each render
 * identically — clean/conflicts/unknown, plus the `--no-commit` checkbox that only makes sense
 * once a conflict is predicted. Each dialog's own outer `v-if` (whether a blocker or an unpicked
 * mainline choice gates reaching this point at all) stays with the caller — only the prediction
 * fork itself moved here.
 *
 * P131 Part 1 §6.2: the raw checkbox is shadcn's Checkbox + Label now.
 */
import { Checkbox } from '@theme/components/ui/checkbox';
import { Label } from '@theme/components/ui/label';
import { computed } from 'vue';

const props = defineProps<{
  prediction:
    | { readonly kind: 'clean' }
    | { readonly kind: 'conflicts'; readonly paths: readonly string[] }
    | { readonly kind: 'unknown'; readonly reason: string };
  noCommit: boolean;
}>();
const emit = defineEmits<{ 'update:noCommit': [value: boolean] }>();

const noCommitModel = computed({
  get: () => props.noCommit,
  set: (value: boolean) => emit('update:noCommit', value),
});
</script>

<template>
  <div v-if="prediction.kind === 'clean'" class="text-ok">
    No conflicts predicted.
  </div>
  <div v-else-if="prediction.kind === 'conflicts'">
    <p>This will likely conflict in:</p>
    <ul class="max-h-40 overflow-y-auto pl-3 font-data text-kira-md">
      <li v-for="path in prediction.paths" :key="path"><code>{{ path }}</code></li>
    </ul>
    <Label class="flex flex-row items-center gap-1 mt-1">
      <Checkbox v-model="noCommitModel" />
      Stop before committing (<code>--no-commit</code>), so I can resolve first
    </Label>
  </div>
  <div v-else-if="prediction.kind === 'unknown'">
    Couldn't predict the outcome: {{ prediction.reason }}
  </div>
</template>
