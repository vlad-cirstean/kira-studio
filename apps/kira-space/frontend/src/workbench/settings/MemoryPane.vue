<script setup lang="ts">
import { CLAUDE_MODELS, type ClaudeModel } from '@shared/domain/claudeModels';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { t } from '@theme/i18n';
import CheckHookSection from '@workbench/memory/settings/CheckHookSection.vue';
import ClaudeCodeMcpSection from '@workbench/memory/settings/ClaudeCodeMcpSection.vue';
import SemanticModelSection from '@workbench/memory/settings/SemanticModelSection.vue';
import { useId } from 'vue';
import type { SettingsPaneProps } from './types';

// P221: memory setup actions bypass draft/Save like ConnectedEditorsPane: a registration or a
// model download is an action, not a settings leaf. P314: the Claude model is a leaf and saves with
// the dialog.
const props = defineProps<SettingsPaneProps>();

function onModelChange(value: unknown): void {
  props.draft.memory.claudeModel = String(value) as ClaudeModel;
}

const modelId = useId();
function modelLabel(m: ClaudeModel): string {
  switch (m) {
    case 'haiku':
      return t('space.settings.memory.claudeModel.haiku.option');
    case 'sonnet':
      return t('space.settings.memory.claudeModel.sonnet.option');
    case 'opus':
      return t('space.settings.memory.claudeModel.opus.option');
  }
}
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="modelId">{{ t('space.settings.memory.claudeModel.label') }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
          data-testid="settings-reset-memory-claudeModel"
          :disabled-trigger="isAtDefault('memory', 'claudeModel')"
          :disabled="isAtDefault('memory', 'claudeModel')"
          @click="resetLeaf('memory', 'claudeModel')"
        />
      </div>
      <NativeSelect
        :id="modelId"
        variant="bordered"
        size="kira-lg"
        data-testid="settings-memory-claude-model"
        :model-value="draft.memory.claudeModel"
        @update:model-value="onModelChange"
      >
        <option v-for="m in CLAUDE_MODELS" :key="m" :value="m">{{ modelLabel(m) }}</option>
      </NativeSelect>
      <FieldDescription>{{ t('space.settings.memory.claudeModel.description') }}</FieldDescription>
    </Field>
    <ClaudeCodeMcpSection />
    <CheckHookSection />
    <SemanticModelSection />
  </div>
</template>
