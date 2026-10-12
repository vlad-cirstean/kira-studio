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
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { computed, useId } from 'vue';

const props = defineProps<{
  prediction:
    | { readonly kind: 'clean' }
    | { readonly kind: 'conflicts'; readonly paths: readonly string[] }
    | { readonly kind: 'unknown'; readonly reason: string };
  noCommit: boolean;
}>();
const emit = defineEmits<{ 'update:noCommit': [value: boolean] }>();

const noCommitId = useId();
const noCommitModel = computed({
  get: () => props.noCommit,
  set: (value: boolean) => emit('update:noCommit', value),
});
</script>

<template>
  <div v-if="prediction.kind === 'clean'" class="text-ok">
    {{ t('git.dialog.preflight.clean.status') }}
  </div>
  <div v-else-if="prediction.kind === 'conflicts'" class="flex flex-col gap-3">
    <Alert variant="warn">
      <AlertDescription>
        <p>{{ t('git.dialog.preflight.conflicts.body') }}</p>
        <ul class="max-h-40 overflow-y-auto pl-3 font-data text-kira-md">
          <li v-for="path in prediction.paths" :key="path"
            ><code class="font-data">{{ path }}</code></li
          >
        </ul>
      </AlertDescription>
    </Alert>
    <Field orientation="horizontal">
      <Checkbox :id="noCommitId" v-model="noCommitModel" />
      <FieldLabel :for="noCommitId">
        <CatalogText k="git.dialog.preflight.noCommit.label">
          <template #flag><code class="font-data">--no-commit</code></template>
        </CatalogText>
      </FieldLabel>
    </Field>
  </div>
  <FieldDescription v-else-if="prediction.kind === 'unknown'">
    {{ t('git.dialog.preflight.unknown.error', { reason: prediction.reason }) }}
  </FieldDescription>
</template>
