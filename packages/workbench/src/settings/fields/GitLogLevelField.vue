<script setup lang="ts">
import type { GitLogLevel } from '@shared/domain/settings';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { useId } from 'vue';

// I2-18: the git-log-level select (options, reset button) was byte-identical between kira-studio's
// and kira-space's own AdvancedPane.vue; the helper text differs per app, so it stays app-side
// through the default slot.
const props = defineProps<{
  advanced: { gitLogLevel: GitLogLevel };
  isAtDefault: (section: 'advanced', key: 'gitLogLevel') => boolean;
  resetLeaf: (section: 'advanced', key: 'gitLogLevel') => void;
}>();

function onGitLogLevelChange(e: Event): void {
  props.advanced.gitLogLevel = (e.target as HTMLSelectElement).value as GitLogLevel;
}

// F3: see DateFormatField.vue's own comment -- `for` + `id` ties the label to the select
// explicitly, so the Reset button (a sibling, outside the label) is no longer what a title/helper
// click activates.
const fieldId = useId();
</script>

<template>
  <Field>
    <div class="flex items-center justify-between gap-1">
      <Label :for="fieldId">Git log level</Label>
      <TooltipIconButton
        icon="discard"
        label="Reset to default"
        data-testid="settings-reset-advanced-gitLogLevel"
        :disabled-trigger="isAtDefault('advanced', 'gitLogLevel')"
        :disabled="isAtDefault('advanced', 'gitLogLevel')"
        @click="resetLeaf('advanced', 'gitLogLevel')"
      />
    </div>
    <NativeSelect
      :id="fieldId"
      variant="bordered"
      size="kira-lg"
      data-testid="settings-git-log-level"
      :value="advanced.gitLogLevel"
      @change="onGitLogLevelChange"
    >
      <option value="off">Off</option>
      <option value="error">Error</option>
      <option value="warn">Warn</option>
      <option value="info">Info</option>
      <option value="debug">Debug</option>
    </NativeSelect>
    <slot />
  </Field>
</template>
