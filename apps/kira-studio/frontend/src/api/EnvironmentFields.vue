<script setup lang="ts">
import type { PaletteColor } from '@shared/domain/color';
import { PALETTE_COLOR_CHOICES } from '@shared/domain/color';
import type { ApiEnvironment } from '@shared/domain/variables';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { colourLabel } from '@theme/connColor';
import { t } from '@theme/i18n';
import SwatchRadio from '@theme/SwatchRadio.vue';
import { ref, watch } from 'vue';
import { useVariablesStore } from './state/variables';

// Environment scope of the variable-set tab: name, description, colour and Duplicate.
const props = defineProps<{ environment: ApiEnvironment }>();
const variablesStore = useVariablesStore();

const envNameDraft = ref('');
const envDescriptionDraft = ref('');
watch(
  () => props.environment,
  (env) => {
    envNameDraft.value = env.name;
    envDescriptionDraft.value = env.description;
  },
  { immediate: true },
);
async function onEnvFieldBlur(): Promise<void> {
  const env = props.environment;
  const name = envNameDraft.value.trim();
  if (name === '') {
    envNameDraft.value = env.name;
    return;
  }
  if (name === env.name && envDescriptionDraft.value === env.description) return;
  // updateEnvironment writes name/description/color as one row update: pass the colour through.
  await variablesStore.updateEnvironment(env.id, name, envDescriptionDraft.value, env.color);
}
// A swatch click applies immediately; text fields commit on blur.
async function onEnvColorChange(color: PaletteColor): Promise<void> {
  const env = props.environment;
  await variablesStore.updateEnvironment(env.id, env.name, env.description, color);
}
async function onDuplicateEnvironment(): Promise<void> {
  await variablesStore.duplicateEnvironment(props.environment.id);
}
</script>

<template>
  <div class="flex items-end gap-1 border-b border-border px-1.5 py-1">
    <Label class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="pl-0.5 text-kira-sm text-subtle">{{ t('common.field.name.label') }}</span>
      <Input
        v-model="envNameDraft"
        :placeholder="t('common.field.name.label')"
        size="kira"
        data-testid="environment-name"
        @blur="onEnvFieldBlur"
      />
    </Label>
    <Label class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="pl-0.5 text-kira-sm text-subtle">{{ t('common.field.description.label') }}</span>
      <Input
        v-model="envDescriptionDraft"
        :placeholder="t('common.field.description.label')"
        size="kira"
        data-testid="environment-description"
        @blur="onEnvFieldBlur"
      />
    </Label>
    <fieldset
      class="color-picker m-0 flex h-6.5 flex-wrap items-center gap-1 border-0 p-0"
      :aria-label="t('studio.api.variableSet.colour.aria')"
      data-testid="environment-color-picker"
    >
      <Tooltip v-for="color in PALETTE_COLOR_CHOICES" :key="color">
        <TooltipTrigger as-child>
          <SwatchRadio
            name="environment-color"
            :value="color"
            :color="color"
            :checked="environment.color === color"
            @change="onEnvColorChange(color)"
          />
        </TooltipTrigger>
        <TooltipContent>{{ colourLabel(color) }}</TooltipContent>
      </Tooltip>
    </fieldset>
    <Button
      variant="toolbar"
      size="kira"
      data-testid="environment-duplicate"
      @click="onDuplicateEnvironment"
    >
      {{ t('common.action.duplicate.label') }}
    </Button>
  </div>
</template>
