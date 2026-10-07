<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { useId } from 'vue';
import type { SettingsPaneProps } from './types';

// P188: independent of the title bar's own keep-awake button: either source is enough to hold the
// assertion. Edited through the dialog's draft/Save flow like every other leaf here.
const props = defineProps<SettingsPaneProps>();
const switchId = useId();

function setKeepAwake(on: boolean): void {
  props.draft.claudeCode.keepAwakeWithAgents = on;
}
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="switchId">Keep this Mac awake while a Claude Code session is running</Label>
        <TooltipIconButton
          icon="discard"
          label="Reset to default"
          data-testid="settings-reset-claudeCode-keepAwakeWithAgents"
          :disabled-trigger="isAtDefault('claudeCode', 'keepAwakeWithAgents')"
          :disabled="isAtDefault('claudeCode', 'keepAwakeWithAgents')"
          @click="resetLeaf('claudeCode', 'keepAwakeWithAgents')"
        />
      </div>
      <Switch
        :id="switchId"
        :model-value="draft.claudeCode.keepAwakeWithAgents"
        data-testid="settings-claude-code-keep-awake"
        @update:model-value="(v) => setKeepAwake(v === true)"
      />
      <FieldDescription>
        Prevents idle sleep, and system sleep on AC power, while a Claude Code terminal tab or a
        background agent is running. Independent of the title bar's own keep-awake button: either
        one is enough to keep the machine awake.
      </FieldDescription>
    </Field>
  </div>
</template>
