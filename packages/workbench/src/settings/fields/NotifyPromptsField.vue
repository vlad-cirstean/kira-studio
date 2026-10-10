<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { useId } from 'vue';

// P246: `advanced.notifyPrompts`, identical in both apps: the switch, its reset, and a button that
// posts a test notification through the saved setting.
const props = defineProps<{
  advanced: { notifyPrompts: boolean };
  isAtDefault: (section: 'advanced', key: 'notifyPrompts') => boolean;
  resetLeaf: (section: 'advanced', key: 'notifyPrompts') => void;
  sendTest: () => Promise<void>;
}>();

const switchId = useId();

function onSendTest(): void {
  void props.sendTest().catch(() => undefined);
}
</script>

<template>
  <Field>
    <div class="flex items-center justify-between gap-1">
      <Label :for="switchId">Notify me when a popup waits for an answer</Label>
      <TooltipIconButton
        icon="discard"
        label="Reset to default"
        data-testid="settings-reset-advanced-notifyPrompts"
        :disabled-trigger="isAtDefault('advanced', 'notifyPrompts')"
        :disabled="isAtDefault('advanced', 'notifyPrompts')"
        @click="resetLeaf('advanced', 'notifyPrompts')"
      />
    </div>
    <Switch
      :id="switchId"
      :model-value="advanced.notifyPrompts"
      data-testid="settings-notify-prompts"
      @update:model-value="(v) => (advanced.notifyPrompts = v === true)"
    />
    <FieldDescription>
      Posts a system notification when a popup waits in a window that is not in front.
    </FieldDescription>
    <Button
      variant="dialog"
      size="kira-lg"
      class="self-start"
      data-testid="settings-notify-prompts-test"
      @click="onSendTest"
    >
      Send test notification
    </Button>
  </Field>
</template>
