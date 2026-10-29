<script setup lang="ts">
import type { MemoryScope } from '@shared/domain/memory';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import ProjectPicker from '@workbench/components/pickers/ProjectPicker.vue';
import { computed } from 'vue';
import { SCOPE_LABEL } from './labels';
import { useMemoryProjectOptions } from './queries';

// Scope tabs plus, for scope project, the project combobox. Test ids are `<prefix>-scope-*` and `<prefix>-project-*`.
const props = defineProps<{ prefix: string; scopes: readonly MemoryScope[] }>();
const scope = defineModel<MemoryScope>('scope', { required: true });
const project = defineModel<string>('project', { required: true });

const projects = useMemoryProjectOptions();
const scopeItems = computed(() =>
  props.scopes.map((value) => ({
    value,
    label: t(SCOPE_LABEL[value]),
    testid: `${props.prefix}-scope-${value}`,
  })),
);
</script>

<template>
  <div class="flex flex-col gap-1">
    <Label>{{ t('common.field.scope.label') }}</Label>
    <SecondaryTabs
      :model-value="scope"
      :items="scopeItems"
      variant="segmented"
      size="kira-lg"
      :aria-label="t('common.field.scope.label')"
      :data-testid="`${prefix}-scope`"
      @update:model-value="(v) => (scope = v as MemoryScope)"
    />
  </div>
  <div v-if="scope === 'project'" class="flex flex-col gap-1">
    <Label :for="`${prefix}-project`">{{ t('memory.common.project.label') }}</Label>
    <ProjectPicker
      :id="`${prefix}-project`"
      :model-value="project || null"
      custom
      :testid="`${prefix}-project`"
      :projects="projects.options.value"
      :placeholder="t('memory.add.project.placeholder')"
      :loading="projects.isPending.value"
      @update:model-value="(v) => (project = v ?? '')"
    />
  </div>
</template>
