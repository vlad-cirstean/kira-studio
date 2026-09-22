<script setup lang="ts">
import type { Settings } from '@shared/domain/settings';
import IconButton from '@theme/primitives/IconButton.vue';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Advanced'"` branch — trimmed to the one leaf this app still owns,
// advanced.gitLogLevel (kira-space's own diagnostic log verbosity).
const props = defineProps<SettingsPaneProps>();

// P72 §9.2: kira-space's own diagnostic log verbosity — genuinely installation-wide.
function onGitLogLevelChange(e: Event): void {
  props.draft.advanced.gitLogLevel = (e.target as HTMLSelectElement)
    .value as Settings['advanced']['gitLogLevel'];
}
</script>

<template>
  <div class="settings-pane" v-show="active">
    <label class="field">
      <div class="field-head">
        <span>Git log level</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-advanced-gitLogLevel"
          :disabled="isAtDefault('advanced', 'gitLogLevel')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('advanced', 'gitLogLevel')"
        />
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
    </label>
  </div>
</template>
