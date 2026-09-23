<script setup lang="ts">
import GitLogLevelField from '@workbench/settings/fields/GitLogLevelField.vue';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Advanced'"` branch — trimmed to the one leaf this app still owns,
// advanced.gitLogLevel (kira-space's own diagnostic log verbosity).
defineProps<SettingsPaneProps>();
</script>

<template>
  <div class="settings-pane" v-show="active">
    <GitLogLevelField :advanced="draft.advanced" :is-at-default="isAtDefault" :reset-leaf="resetLeaf">
      <span class="helper-text">Kira-version's own diagnostic log verbosity.</span>
    </GitLogLevelField>
  </div>
</template>
