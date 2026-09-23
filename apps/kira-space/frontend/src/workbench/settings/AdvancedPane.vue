<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import type { GitLogLevel } from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Advanced'"` branch — trimmed to the one leaf this app still owns,
// advanced.gitLogLevel (kira-space's own diagnostic log verbosity).
const props = defineProps<SettingsPaneProps>();

// P72 §9.2: kira-space's own diagnostic log verbosity — genuinely installation-wide.
function onGitLogLevelChange(e: Event): void {
  props.draft.advanced.gitLogLevel = (e.target as HTMLSelectElement).value as GitLogLevel;
}
</script>

<template>
  <div class="settings-pane" v-show="active">
    <Label class="field">
      <div class="field-head">
        <span>Git log level</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('advanced', 'gitLogLevel') }">
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
            </span>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <select
        class="p-select bordered md"
        data-testid="settings-git-log-level"
        :value="draft.advanced.gitLogLevel"
        @change="onGitLogLevelChange"
      >
        <option value="off">Off</option>
        <option value="error">Error</option>
        <option value="warn">Warn</option>
        <option value="info">Info</option>
        <option value="debug">Debug</option>
      </select>
      <span class="helper-text">Kira-version's own diagnostic log verbosity.</span>
    </Label>
  </div>
</template>
