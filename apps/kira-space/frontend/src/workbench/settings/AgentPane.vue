<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { t } from '@theme/i18n';
import { useAgentInfo } from '@workbench/agent/agentInfo';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import { computed, useId } from 'vue';
import { control } from '../../bridge/control';
import type { Settings } from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P188: independent of the title bar's own keep-awake button: either source is enough to hold the
// assertion. Edited through the dialog's draft/Save flow like every other leaf here.
const props = defineProps<SettingsPaneProps>();
const switchId = useId();
const { info } = useAgentInfo();

type NotifyLeaf = Exclude<
  keyof Settings['agent'],
  'provider' | 'keepAwakeWithAgents' | 'usageEnabled'
>;

// P238: master first; the rest are disabled while it is off.
const notifyLeaves = computed<{ leaf: NotifyLeaf; testid: string; label: string }[]>(() => [
  {
    leaf: 'notifyEnabled',
    testid: 'settings-agent-notify',
    label: t('space.settings.agent.notify.label'),
  },
  {
    leaf: 'notifyOnFinished',
    testid: 'settings-agent-notify-finished',
    label: t('space.settings.agent.notifyFinished.label'),
  },
  {
    leaf: 'notifyOnNeedsInput',
    testid: 'settings-agent-notify-needs-input',
    label: t('space.settings.agent.notifyNeedsInput.label'),
  },
  {
    leaf: 'notifyOnRunEnded',
    testid: 'settings-agent-notify-run-ended',
    label: t('space.settings.agent.notifyRunEnded.label'),
  },
  {
    leaf: 'notifyIncludeMessage',
    testid: 'settings-agent-notify-include-message',
    label: t('space.settings.agent.notifyIncludeMessage.label'),
  },
]);

// Finished and needs-input notes come from interactive session events.
const shownNotifyLeaves = computed(() =>
  notifyLeaves.value.filter(
    (n) => info.value.hooks || (n.leaf !== 'notifyOnFinished' && n.leaf !== 'notifyOnNeedsInput'),
  ),
);

function setNotify(leaf: NotifyLeaf, on: boolean): void {
  props.draft.agent[leaf] = on;
}

function sendTest(): void {
  fireAndForget(control.agentNotifySendTest(), 'agentNotify');
}

function setUsage(on: boolean): void {
  props.draft.agent.usageEnabled = on;
}

function setSandboxKeychain(on: boolean): void {
  props.draft.ade.sandboxKeychain = on;
}

function setKeepAwake(on: boolean): void {
  props.draft.agent.keepAwakeWithAgents = on;
}
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="switchId">{{ t('space.settings.agent.keepAwake.label') }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
          data-testid="settings-reset-agent-keepAwakeWithAgents"
          :disabled-trigger="isAtDefault('agent', 'keepAwakeWithAgents')"
          :disabled="isAtDefault('agent', 'keepAwakeWithAgents')"
          @click="resetLeaf('agent', 'keepAwakeWithAgents')"
        />
      </div>
      <Switch
        :id="switchId"
        :model-value="draft.agent.keepAwakeWithAgents"
        data-testid="settings-agent-keep-awake"
        @update:model-value="(v) => setKeepAwake(v === true)"
      />
      <FieldDescription>
        {{ t('space.settings.agent.keepAwake.description') }}
      </FieldDescription>
    </Field>

    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="`${switchId}-sandboxKeychain`">{{
          t('space.settings.agent.sandboxKeychain.label')
        }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
          data-testid="settings-reset-ade-sandboxKeychain"
          :disabled-trigger="isAtDefault('ade', 'sandboxKeychain')"
          :disabled="isAtDefault('ade', 'sandboxKeychain')"
          @click="resetLeaf('ade', 'sandboxKeychain')"
        />
      </div>
      <Switch
        :id="`${switchId}-sandboxKeychain`"
        :model-value="draft.ade.sandboxKeychain"
        data-testid="settings-agent-sandbox-keychain"
        @update:model-value="(v) => setSandboxKeychain(v === true)"
      />
      <FieldDescription>
        {{ t('space.settings.agent.sandboxKeychain.description') }}
      </FieldDescription>
    </Field>

    <Field v-for="n in shownNotifyLeaves" :key="n.leaf">
      <div class="flex items-center justify-between gap-1">
        <Label :for="`${switchId}-${n.leaf}`" :class="n.leaf === 'notifyEnabled' ? '' : 'pl-4'">{{
          n.label
        }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
          :data-testid="`settings-reset-agent-${n.leaf}`"
          :disabled-trigger="isAtDefault('agent', n.leaf)"
          :disabled="isAtDefault('agent', n.leaf)"
          @click="resetLeaf('agent', n.leaf)"
        />
      </div>
      <Switch
        :id="`${switchId}-${n.leaf}`"
        :model-value="draft.agent[n.leaf]"
        :disabled="n.leaf !== 'notifyEnabled' && !draft.agent.notifyEnabled"
        :data-testid="n.testid"
        @update:model-value="(v) => setNotify(n.leaf, v === true)"
      />
      <FieldDescription v-if="n.leaf === 'notifyEnabled'">
        {{ t('space.settings.agent.notify.description') }}
      </FieldDescription>
    </Field>
    <Field>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        :disabled="!draft.agent.notifyEnabled"
        data-testid="settings-agent-notify-test"
        @click="sendTest"
      >
        {{ t('common.sendTest.label') }}
      </Button>
    </Field>

    <Field v-if="info.usage">
      <div class="flex items-center justify-between gap-1">
        <Label :for="`${switchId}-usage`">{{ t('space.settings.agent.usage.label') }}</Label>
        <TooltipIconButton
          icon="discard"
          :label="t('common.action.resetToDefault.label')"
          data-testid="settings-reset-agent-usageEnabled"
          :disabled-trigger="isAtDefault('agent', 'usageEnabled')"
          :disabled="isAtDefault('agent', 'usageEnabled')"
          @click="resetLeaf('agent', 'usageEnabled')"
        />
      </div>
      <Switch
        :id="`${switchId}-usage`"
        :model-value="draft.agent.usageEnabled"
        data-testid="settings-agent-usage"
        @update:model-value="(v) => setUsage(v === true)"
      />
      <FieldDescription>
        {{ t('space.settings.agent.usage.description') }}
      </FieldDescription>
    </Field>
  </div>
</template>
