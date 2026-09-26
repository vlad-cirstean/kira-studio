<script setup lang="ts">
/**
 * P113 F9: the "predicted outcome" block `RevertDialog.vue`/`CherryPickDialog.vue` each render
 * identically — clean/conflicts/unknown, plus the `--no-commit` checkbox that only makes sense
 * once a conflict is predicted. Each dialog's own outer `v-if` (whether a blocker or an unpicked
 * mainline choice gates reaching this point at all) stays with the caller — only the prediction
 * fork itself moved here.
 */
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
  <div v-if="prediction.kind === 'clean'" class="kv:my-2 kv:text-diff-added">
    No conflicts predicted.
  </div>
  <div v-else-if="prediction.kind === 'conflicts'" class="kv:my-2">
    <p>This will likely conflict in:</p>
    <ul class="kv:max-h-40 kv:overflow-y-auto kv:my-1 kv:pl-3 kv:font-data kv:text-base">
      <li v-for="path in prediction.paths" :key="path"><code>{{ path }}</code></li>
    </ul>
    <label class="kv:block kv:mt-1">
      <input type="checkbox" v-model="noCommitModel" />
      Stop before committing (<code>--no-commit</code>), so I can resolve first
    </label>
  </div>
  <div v-else-if="prediction.kind === 'unknown'" class="kv:my-2">
    Couldn't predict the outcome: {{ prediction.reason }}
  </div>
</template>
