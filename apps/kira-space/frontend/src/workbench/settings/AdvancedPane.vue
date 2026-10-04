<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Field, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import LogLevelField from '@workbench/settings/fields/LogLevelField.vue';
import { computed, useId } from 'vue';
import { useSettingsStore } from '../../state/settings';
import { defaultSettings } from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Advanced'"` branch — trimmed to the one leaf this app still owns,
// advanced.gitLogLevel (kira-space's own diagnostic log verbosity).
defineProps<SettingsPaneProps>();

// ade.headlessSettingSources is not in the dialog draft (SettingsDialog.vue builds it from three
// sections), so this switch writes immediately instead of on Save.
const settings = useSettingsStore();
const ignoreRepoSettings = computed(() => settings.ade.headlessSettingSources === 'user');
const defaultIgnore = defaultSettings.ade.headlessSettingSources === 'user';
const switchId = useId();

function setSources(ignore: boolean): void {
  void settings.patchSettings({ ade: { headlessSettingSources: ignore ? 'user' : 'all' } });
}
</script>

<template>
  <div class="contents" v-show="active">
    <LogLevelField
      :advanced="draft.advanced"
      leaf="gitLogLevel"
      label="Git log level"
      select-test-id="settings-git-log-level"
      :is-at-default="isAtDefault"
      :reset-leaf="resetLeaf"
    >
      <FieldDescription>Kira-version's own diagnostic log verbosity.</FieldDescription>
    </LogLevelField>
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="switchId">Background agents ignore repo settings</Label>
        <TooltipIconButton
          icon="discard"
          label="Reset to default"
          data-testid="settings-reset-ade-headlessSettingSources"
          :disabled-trigger="ignoreRepoSettings === defaultIgnore"
          :disabled="ignoreRepoSettings === defaultIgnore"
          @click="setSources(defaultIgnore)"
        />
      </div>
      <Switch
        :id="switchId"
        :model-value="ignoreRepoSettings"
        data-testid="settings-ade-headless-sources"
        @update:model-value="(v) => setSources(v === true)"
      />
      <FieldDescription>Runs claude -p with --setting-sources user. Off: repo .claude settings also load; their deny rules still apply.</FieldDescription>
    </Field>
  </div>
</template>
