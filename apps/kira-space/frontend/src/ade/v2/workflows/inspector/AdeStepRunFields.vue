<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { FieldDescription } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import ProjectPicker from '@workbench/components/pickers/ProjectPicker.vue';
import { computed } from 'vue';
import { useProjectOptions } from '../../../../repo/state/projectOptions';
import type { WorkflowStep } from '../../wire';

const props = defineProps<{ step: WorkflowStep }>();
const emit = defineEmits<{ patch: [p: Partial<WorkflowStep>] }>();
const gates = [
  {
    value: 'auto',
    label: t('space.ade.workflows.gate.auto.option'),
    testid: 'ade-wf-step-gate-auto',
  },
  {
    value: 'approval',
    label: t('space.ade.workflows.gate.approval.option'),
    testid: 'ade-wf-step-gate-approval',
  },
];
const scopes = [
  {
    value: 'once',
    label: t('space.ade.workflows.runsOn.once.label'),
    testid: 'ade-wf-step-scope-once',
  },
  {
    value: 'each repo',
    label: t('space.ade.workflows.runsOn.each.label'),
    testid: 'ade-wf-step-scope-each',
  },
  {
    value: 'one repo',
    label: t('space.ade.workflows.runsOn.oneRepo.option'),
    testid: 'ade-wf-step-scope-one',
  },
];

// `only <name>` stores the repo by its nickname or name.
const projects = useProjectOptions();
const scope = computed(() => {
  const v = props.step.runsOn;
  return v === 'once' || v === 'each repo' ? v : 'one repo';
});
const stored = computed(() =>
  props.step.runsOn.startsWith('only ') ? props.step.runsOn.slice(5) : '',
);
const matched = computed(() => projects.options.value.find((o) => o.label === stored.value));
const missing = computed(
  () =>
    scope.value === 'one repo' &&
    stored.value !== '' &&
    !matched.value &&
    !projects.isPending.value,
);

function setScope(v: string): void {
  if (v === 'one repo') {
    const first = projects.options.value[0];
    if (first) emit('patch', { runsOn: `only ${first.label}` });
    return;
  }
  emit('patch', { runsOn: v as WorkflowStep['runsOn'] });
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <span class="text-kira-sm text-muted-foreground">{{
      t('space.ade.workflows.field.runsOn.label')
    }}</span>
    <SecondaryTabs
      :model-value="scope"
      :aria-label="t('space.ade.workflows.field.runsOn.label')"
      :items="scopes"
      data-testid="ade-wf-step-scope"
      @update:model-value="setScope"
    />
    <ProjectPicker
      v-if="scope === 'one repo'"
      :model-value="matched?.value ?? (stored || null)"
      testid="ade-wf-step-scope-repo"
      :projects="projects.options.value"
      :placeholder="t('common.action.choose.label')"
      :loading="projects.isPending.value"
      :error="projects.error.value"
      @select="(o) => emit('patch', { runsOn: `only ${o.label}` })"
    />
    <FieldDescription v-if="missing" data-testid="ade-wf-step-scope-missing">{{
      t('space.ade.workflows.runsOn.missing.hint', { name: stored })
    }}</FieldDescription>
  </div>
  <div class="flex flex-col gap-1">
    <span class="text-kira-sm text-muted-foreground">{{ t('common.action.start.label') }}</span>
    <SecondaryTabs
      :model-value="step.before || 'auto'"
      :items="gates"
      data-testid="ade-wf-step-gate"
      @update:model-value="(v) => emit('patch', { before: v === 'approval' ? 'approval' : 'auto' })"
    />
  </div>
</template>
