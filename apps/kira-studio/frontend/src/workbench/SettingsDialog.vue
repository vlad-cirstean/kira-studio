<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { FieldDescription, FieldError } from '@theme/components/ui/field';
import SettingsShell from '@workbench/components/SettingsShell.vue';
import { useSettingsDeepLinkReset } from '@workbench/settings/useSettingsDeepLinkReset';
import { sections, useSettingsStore } from '../state/settings';
import { defaultSettings, type SettingsPatch } from '../state/settingsDomain';
import AdvancedPane from './settings/AdvancedPane.vue';
import ApiPane from './settings/ApiPane.vue';
import AppearancePane from './settings/AppearancePane.vue';
import CachePane from './settings/CachePane.vue';
import ClaudeCodePane from './settings/ClaudeCodePane.vue';
import DatabaseMcpPane from './settings/DatabaseMcpPane.vue';
import DataPane from './settings/DataPane.vue';
import ScriptsPane from './settings/ScriptsPane.vue';

// P103 Part 2 (§5.5): the old single-file workbench/SettingsDialog.vue, now a thin composition
// over SettingsShell.vue plus this app's own eight panes (workbench/settings/*.vue, extracted
// verbatim from this file's own former inline `<template v-if>` branches — see SettingsShell.vue's
// own file-level comment for what stays app-side and why). Everything genuinely app-specific stays
// here: which six of Settings' sections this dialog edits, the dialog's own width/height, the
// deep-link reset, and the footer markup (its one small, real difference from Kira Space's own —
// see SettingsShell.vue's comment #2).
const emit = defineEmits<{ close: [] }>();

const settingsStore = useSettingsStore();

// §10.1: a later plain open (TitleBar.vue's gear icon, the command palette) must not inherit a
// deep link this instance was opened with.
useSettingsDeepLinkReset(settingsStore);

async function save(patch: SettingsPatch): Promise<void> {
  await settingsStore.patchSettings(patch);
}
</script>

<template>
  <SettingsShell
    :sections="sections"
    :initial-section="settingsStore.settingsSection ?? undefined"
    :width="780"
    :height="560"
    :defaults="{
      appearance: defaultSettings.appearance,
      data: defaultSettings.data,
      cache: defaultSettings.cache,
      advanced: defaultSettings.advanced,
      git: defaultSettings.git,
      api: defaultSettings.api,
    }"
    :current="{
      appearance: settingsStore.appearance,
      data: settingsStore.data,
      cache: settingsStore.cache,
      advanced: settingsStore.advanced,
      git: settingsStore.git,
      api: settingsStore.api,
    }"
    :save="save"
    @close="emit('close')"
  >
    <template #pane="s">
      <AppearancePane
        :active="s.activeSection === 'Appearance'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <DataPane
        :active="s.activeSection === 'Data'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <CachePane
        :active="s.activeSection === 'Cache'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <ApiPane
        :active="s.activeSection === 'Api'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <ScriptsPane
        :active="s.activeSection === 'Scripts'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <ClaudeCodePane
        :active="s.activeSection === 'Claude Code'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <DatabaseMcpPane
        :active="s.activeSection === 'Database MCP'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <AdvancedPane
        :active="s.activeSection === 'Advanced'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
    </template>

    <template #footer="f">
      <span class="flex-1 min-w-0 flex items-center">
        <FieldError v-if="f.saveError" data-testid="settings-save-error">{{ f.saveError }}</FieldError>
        <FieldDescription v-else data-testid="settings-footer-status"
          >Stored in <span class="font-data">~/.kira-studio/kira.sqlite</span><template v-if="f.isDirty">
          · Unsaved changes</template></FieldDescription
        >
      </span>
      <span class="flex items-center gap-1">
        <Button variant="dialog" size="kira-lg" data-testid="settings-cancel" @click="f.onDismiss">Cancel</Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          data-testid="settings-save"
          :disabled="!f.isValid"
          @click="f.onSave"
        >
          Save
        </Button>
      </span>
    </template>
  </SettingsShell>
</template>

