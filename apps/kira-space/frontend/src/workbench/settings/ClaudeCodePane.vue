<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { t } from '@theme/i18n';
import { computed, useId } from 'vue';
import { control } from '../../bridge/control';
import type { Settings } from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P188: independent of the title bar's own keep-awake button: either source is enough to hold the
// assertion. Edited through the dialog's draft/Save flow like every other leaf here.
const props = defineProps<SettingsPaneProps>();
const switchId = useId();

type NotifyLeaf = Exclude<
  keyof Settings['claudeCode'],
  'keepAwakeWithAgents' | 'usageEnabled'
>;

// P238: master first; the rest are disabled while it is off.
const notifyLeaves = computed<{ leaf: NotifyLeaf; testid: string; label: string }[]>(() => [
  { leaf: 'notifyEnabled', testid: 'settings-claude-code-notify', label: t('space.workbench.claudeCode.notify.label') },
  { leaf: 'notifyOnFinished', testid: 'settings-claude-code-notify-finished', label: t('space.workbench.claudeCode.notifyFinished.label') },
  { leaf: 'notifyOnNeedsInput', testid: 'settings-claude-code-notify-needs-input', label: t('space.workbench.claudeCode.notifyNeedsInput.label') },
  { leaf: 'notifyOnRunEnded', testid: 'settings-claude-code-notify-run-ended', label: t('space.workbench.claudeCode.notifyRunEnded.label') },
  { leaf: 'notifyIncludeMessage', testid: 'settings-claude-code-notify-include-message', label: t('space.workbench.claudeCode.notifyIncludeMessage.label') },
]);

function setNotify(leaf: NotifyLeaf, on: boolean): void {
  props.draft.claudeCode[leaf] = on;
}

function sendTest(): void {
  void control.agentNotifySendTest().catch((err: unknown) => {
    console.error('agent notify: test failed', err);
  });
}

function setUsage(on: boolean): void {
  props.draft.claudeCode.usageEnabled = on;
}

function setKeepAwake(on: boolean): void {
  props.draft.claudeCode.keepAwakeWithAgents = on;
}
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="switchId">{{ t('space.workbench.claudeCode.keepAwake.label') }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
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
        {{ t('space.workbench.claudeCode.keepAwake.description') }}
      </FieldDescription>
    </Field>

    <Field v-for="n in notifyLeaves" :key="n.leaf">
      <div class="flex items-center justify-between gap-1">
        <Label :for="`${switchId}-${n.leaf}`" :class="n.leaf === 'notifyEnabled' ? '' : 'pl-4'">{{ n.label }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
          :data-testid="`settings-reset-claudeCode-${n.leaf}`"
          :disabled-trigger="isAtDefault('claudeCode', n.leaf)"
          :disabled="isAtDefault('claudeCode', n.leaf)"
          @click="resetLeaf('claudeCode', n.leaf)"
        />
      </div>
      <Switch
        :id="`${switchId}-${n.leaf}`"
        :model-value="draft.claudeCode[n.leaf]"
        :disabled="n.leaf !== 'notifyEnabled' && !draft.claudeCode.notifyEnabled"
        :data-testid="n.testid"
        @update:model-value="(v) => setNotify(n.leaf, v === true)"
      />
      <FieldDescription v-if="n.leaf === 'notifyEnabled'">
        {{ t('space.workbench.claudeCode.notify.description') }}
      </FieldDescription>
    </Field>
    <Field>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        :disabled="!draft.claudeCode.notifyEnabled"
        data-testid="settings-claude-code-notify-test"
        @click="sendTest"
      >
        {{ t('common.sendTest.label') }}
      </Button>
    </Field>

    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="`${switchId}-usage`">{{ t('space.workbench.claudeCode.usage.label') }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
          data-testid="settings-reset-claudeCode-usageEnabled"
          :disabled-trigger="isAtDefault('claudeCode', 'usageEnabled')"
          :disabled="isAtDefault('claudeCode', 'usageEnabled')"
          @click="resetLeaf('claudeCode', 'usageEnabled')"
        />
      </div>
      <Switch
        :id="`${switchId}-usage`"
        :model-value="draft.claudeCode.usageEnabled"
        data-testid="settings-claude-code-usage"
        @update:model-value="(v) => setUsage(v === true)"
      />
      <FieldDescription>
        {{ t('space.workbench.claudeCode.usage.description') }}
      </FieldDescription>
    </Field>
  </div>
</template>
