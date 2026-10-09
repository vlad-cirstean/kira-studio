<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { useId } from 'vue';
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
const notifyLeaves: { leaf: NotifyLeaf; testid: string; label: string }[] = [
  { leaf: 'notifyEnabled', testid: 'settings-claude-code-notify', label: 'Notify me when a Claude Code session needs me' },
  { leaf: 'notifyOnFinished', testid: 'settings-claude-code-notify-finished', label: 'When a session finishes' },
  { leaf: 'notifyOnNeedsInput', testid: 'settings-claude-code-notify-needs-input', label: 'When a session needs input' },
  { leaf: 'notifyOnRunEnded', testid: 'settings-claude-code-notify-run-ended', label: 'When a background ADE run ends' },
  { leaf: 'notifyIncludeMessage', testid: 'settings-claude-code-notify-include-message', label: 'Show the start of the reply in the notification' },
];

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

    <Field v-for="n in notifyLeaves" :key="n.leaf">
      <div class="flex items-center justify-between gap-1">
        <Label :for="`${switchId}-${n.leaf}`" :class="n.leaf === 'notifyEnabled' ? '' : 'pl-4'">{{ n.label }}</Label>
        <TooltipIconButton
          icon="discard"
          label="Reset to default"
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
        Posts to the system notification centre; clicking one opens that session. On macOS the
        first one asks for permission. Reply text only goes to the local notification centre,
        never off this Mac. Nothing shows while you are looking at that session.
      </FieldDescription>
    </Field>
    <Field>
      <Button
        variant="outline"
        size="sm"
        class="self-start"
        :disabled="!draft.claudeCode.notifyEnabled"
        data-testid="settings-claude-code-notify-test"
        @click="sendTest"
      >
        Send test notification
      </Button>
    </Field>

    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="`${switchId}-usage`">Show Claude Code usage limits in the ADE status bar</Label>
        <TooltipIconButton
          icon="discard"
          label="Reset to default"
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
        Shows the 5-hour and weekly limits that Claude Code sessions started from Kira Space
        report. Claude Code hands the numbers to a status-line hook on this Mac; nothing is
        sent anywhere and no login or token is read. Applies to sessions started after you
        change it. Pro and Max plans only.
      </FieldDescription>
    </Field>
  </div>
</template>
