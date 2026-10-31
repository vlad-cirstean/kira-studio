<script setup lang="ts">
import { FieldDescription, FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import { setStageValue, stageValueValid } from '../../board/stageSettings';
import { useWorkflows } from '../../queries';
import type { StageSettingSpec } from '../../wire';

// A step's per-provider agent settings, one field per catalog entry.
const props = defineProps<{ settings: Record<string, Record<string, string>>; stepId: string }>();
const emit = defineEmits<{ patch: [settings: Record<string, Record<string, string>>] }>();
const workflows = useWorkflows();
const groups = computed(() => {
  const out = new Map<string, { label: string; specs: StageSettingSpec[] }>();
  for (const s of workflows.data.value?.stageSettings ?? []) {
    const g = out.get(s.provider) ?? { label: s.providerLabel, specs: [] };
    g.specs.push(s);
    out.set(s.provider, g);
  }
  return [...out].map(([provider, g]) => ({ provider, ...g }));
});
const value = (s: StageSettingSpec): string => props.settings[s.provider]?.[s.key] ?? '';
const key = (s: StageSettingSpec): string => `${s.provider}-${s.key}`;
const id = (s: StageSettingSpec): string => `ade-wf-setting-${key(s)}-${props.stepId}`;
const onInput = (s: StageSettingSpec, v: string | number): void =>
  emit('patch', setStageValue(props.settings, s.provider, s.key, String(v).trim()));
</script>

<template>
  <div v-if="groups.length > 0" class="flex flex-col gap-2" data-testid="ade-wf-step-settings">
    <Label class="text-kira-sm text-muted-foreground">{{
      t('space.ade.workflows.settings.title.label')
    }}</Label>
    <div v-for="g in groups" :key="g.provider" class="flex flex-col gap-2">
      <span v-if="groups.length > 1" class="text-kira-sm text-subtle">{{ g.label }}</span>
      <div v-for="s in g.specs" :key="s.key" class="flex flex-col gap-1">
        <Label :for="id(s)" class="text-kira-sm text-muted-foreground">{{ s.label }}</Label>
        <Input
          :id="id(s)"
          type="number"
          :min="s.min"
          :max="s.max"
          :model-value="value(s)"
          :placeholder="t('common.state.default.option')"
          :aria-invalid="!stageValueValid(s, value(s)) || undefined"
          size="kira"
          class="font-data"
          :data-testid="`ade-wf-setting-${key(s)}`"
          @update:model-value="(v: string | number) => onInput(s, v)"
        />
        <FieldError
          v-if="!stageValueValid(s, value(s))"
          :data-testid="`ade-wf-setting-error-${key(s)}`"
        >
          {{ t('space.ade.workflows.settings.range.error', { min: s.min, max: s.max }) }}
        </FieldError>
        <FieldDescription v-else :data-testid="`ade-wf-setting-hint-${key(s)}`">{{
          s.hint
        }}</FieldDescription>
      </div>
    </div>
  </div>
</template>
