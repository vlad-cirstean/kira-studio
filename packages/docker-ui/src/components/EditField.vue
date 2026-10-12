<script setup lang="ts">
import StatusDot from '@theme/components/StatusDot.vue';
import { FieldDescription, FieldError } from '@theme/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { useFormErrors } from '@workbench/behaviour/formErrors';
import { computed, inject } from 'vue';
import type { EditMode } from '../lib/editDiff';
import { inPlaceSectionKey } from '../lib/editSection';

const props = defineProps<{
  field: string;
  label: string;
  mode: EditMode;
  changed?: boolean;
  error?: string;
  description?: string;
}>();

const inPlaceTab = inject(inPlaceSectionKey, undefined);
const form = useFormErrors({
  field: { value: () => props.changed, error: () => props.error ?? null },
});
const needsRecreate = computed(() => inPlaceTab === true && props.mode === 'recreate');
</script>

<template>
  <fieldset
    class="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
    :aria-label="label"
    :data-testid="`docker-edit-field-${field}`"
    :data-changed="changed ? 'true' : 'false'"
  >
    <div class="flex items-center gap-2">
      <span class="text-muted-foreground">{{ label }}</span>
      <Tooltip v-if="changed">
        <TooltipTrigger as-child>
          <StatusDot tone="muted" :label="t('common.changed.status')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('common.changed.status') }}</TooltipContent>
      </Tooltip>
    </div>
    <slot v-bind="{ invalid: form.invalidAttrs('field') }" />
    <FieldError
      v-if="form.errorFor('field')"
      :id="form.errorId('field')"
      data-testid="docker-edit-field-error"
      >{{
        form.errorFor('field')
      }}</FieldError
    >
    <FieldDescription v-else-if="needsRecreate" data-testid="docker-edit-field-recreate-hint">{{
      t('docker.edit.needsRecreate.hint')
    }}</FieldDescription>
    <FieldDescription v-else-if="description">{{ description }}</FieldDescription>
  </fieldset>
</template>
