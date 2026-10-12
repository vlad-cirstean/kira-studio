<script setup lang="ts">
import { CONNECTION_THROTTLE_RANGE } from '@shared/domain/connection';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { TabsContent } from '@theme/components/ui/tabs';
import { t } from '@theme/i18n';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import { computed } from 'vue';
import { useConnectionDialogStore } from '../../state/connections';
import { schemaDialectFor } from '../../state/schemas';
import CheckboxRow from './CheckboxRow.vue';
import { injectConnectionForm } from './form';

const connectionDialogStore = useConnectionDialogStore();
const { errorFor, errorId, invalidAttrs } = injectConnectionForm();
const draft = computed(() => connectionDialogStore.draft);

// Auto-explain is SQL-only; absent, not disabled, on the other kinds. Read through
// state/schemas.ts because project/ must not import views/ directly.
const isSqlKind = computed(() => !!draft.value && schemaDialectFor(draft.value.kind) !== undefined);

function setThrottlePerSec(value: string): void {
  const d = draft.value;
  if (!d) return;
  const n = Number.parseFloat(value);
  d.throttlePerSec = Number.isNaN(n) ? 0 : n;
}
</script>

<template>
  <TabsContent v-if="draft" value="Advanced" class="flex flex-col gap-3 p-3">
    <CheckboxRow
      v-model="draft.readOnly"
      :label="t('common.state.readOnly.status')"
      :description="t('studio.project.connectionDialog.readOnly.description')"
      testid="connection-readonly"
    />
    <CheckboxRow
      v-if="isSqlKind"
      v-model="draft.autoExplain"
      :label="t('studio.project.connectionDialog.autoExplain.label')"
      :description="t('studio.project.connectionDialog.autoExplain.description')"
      testid="connection-auto-explain"
    />

    <Field class="flex-1">
      <FieldLabel>{{ t('studio.project.connectionDialog.throttle.label') }}</FieldLabel>
      <div class="w-24">
        <NumberStepperInput
          :min="0"
          :max="CONNECTION_THROTTLE_RANGE.max"
          step="0.5"
          v-bind="invalidAttrs('throttlePerSec')"
          data-testid="connection-throttle"
          :model-value="String(draft.throttlePerSec)"
          @update:model-value="(v: string | number) => setThrottlePerSec(String(v))"
        />
      </div>
      <FieldError
        v-if="errorFor('throttlePerSec')"
        :id="errorId('throttlePerSec')"
        data-testid="connection-throttle-error"
      >
        {{ errorFor('throttlePerSec') }}
      </FieldError>
      <FieldDescription v-else class="w-full">
        {{ t('studio.project.connectionDialog.throttle.description') }}
      </FieldDescription>
    </Field>
  </TabsContent>
</template>
