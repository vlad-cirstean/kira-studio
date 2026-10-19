<script setup lang="ts">
import { PRECONNECT_DELAY_RANGE } from '@shared/domain/connection';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { TabsContent } from '@theme/components/ui/tabs';
import { Textarea } from '@theme/components/ui/textarea';
import { t } from '@theme/i18n';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { computed } from 'vue';
import { useConnectionDialogStore } from '../../state/connections';
import CheckboxRow from './CheckboxRow.vue';
import { injectConnectionForm } from './form';

const connectionDialogStore = useConnectionDialogStore();
const { errorFor, errorId, invalidAttrs } = injectConnectionForm();
const draft = computed(() => connectionDialogStore.draft);

// '' maps to null so an emptied field means "no script", not a min(1) violation the user cannot see.
const preconnectText = computed({
  get: () => draft.value?.preconnect ?? '',
  set: (value: string) => {
    if (draft.value) draft.value.preconnect = value.trim() === '' ? null : value;
  },
});

function setDelaySec(value: string): void {
  const d = draft.value;
  if (!d) return;
  const n = Number.parseInt(value, 10);
  d.preconnectDelaySec = Number.isNaN(n) ? 0 : n;
}
</script>

<template>
  <TabsContent v-if="draft" value="Pre-connect" class="flex flex-col gap-3 p-3">
    <Field class="flex-1">
      <FieldLabel>{{ t('studio.project.connectionDialog.preconnect.label') }}</FieldLabel>
      <Textarea
        v-model="preconnectText"
        v-bind="invalidAttrs('preconnect')"
        class="font-data"
        rows="4"
        maxlength="2000"
        data-testid="connection-preconnect"
        @keydown="wrapSelectionOnType"
      />
      <FieldDescription class="w-full">
        {{ t('studio.project.connectionDialog.preconnect.description') }}
      </FieldDescription>
      <span
        v-if="preconnectText"
        class="text-warn text-kira-sm"
        data-testid="connection-preconnect-warning"
      >
        {{ t('studio.project.connectionDialog.preconnect.warning.body') }}
      </span>
      <FieldError v-if="errorFor('preconnect')" :id="errorId('preconnect')">{{
        errorFor('preconnect')
      }}</FieldError>
    </Field>

    <CheckboxRow
      v-if="preconnectText"
      v-model="draft.preconnectSidecar"
      :label="t('studio.project.connectionDialog.sidecar.label')"
      :description="t('studio.project.connectionDialog.sidecar.description')"
      testid="connection-preconnect-sidecar"
    />

    <Field v-if="preconnectText" class="flex-1">
      <FieldLabel>{{ t('studio.project.connectionDialog.preconnectDelay.label') }}</FieldLabel>
      <div class="w-24">
        <NumberStepperInput
          :min="0"
          :max="PRECONNECT_DELAY_RANGE.max"
          step="1"
          v-bind="invalidAttrs('preconnectDelaySec')"
          data-testid="connection-preconnect-delay"
          :model-value="String(draft.preconnectDelaySec)"
          @update:model-value="(v: string | number) => setDelaySec(String(v))"
        />
      </div>
      <FieldError
        v-if="errorFor('preconnectDelaySec')"
        :id="errorId('preconnectDelaySec')"
        data-testid="connection-preconnect-delay-error"
      >
        {{ errorFor('preconnectDelaySec') }}
      </FieldError>
      <FieldDescription v-else class="w-full">
        {{ t('studio.project.connectionDialog.preconnectDelay.description') }}
      </FieldDescription>
    </Field>
  </TabsContent>
</template>
