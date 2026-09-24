<script setup lang="ts">
import type { GitLogLevel } from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Field } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Tooltip, TooltipContent, TooltipDisabledTrigger, TooltipTrigger } from '@theme/components/ui/tooltip';
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
      <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('advanced', 'gitLogLevel') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-advanced-gitLogLevel"
              :disabled="isAtDefault('advanced', 'gitLogLevel')"
              aria-label="Reset to default"
              @click="resetLeaf('advanced', 'gitLogLevel')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
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
