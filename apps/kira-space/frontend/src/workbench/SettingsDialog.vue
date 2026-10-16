<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import SettingsShell from '@workbench/components/SettingsShell.vue';
import PromptsPane from '@workbench/llmPrompts/PromptsPane.vue';
import { useSettingsDeepLinkReset } from '@workbench/settings/useSettingsDeepLinkReset';
import { useLlmPromptsShellExtra } from '@workbench/state/llmPromptDrafts';
import { computed } from 'vue';
import { type Section, sections, useSettingsStore } from '../state/settings';
import { defaultSettings, type SettingsPatch } from '../state/settingsDomain';
import AdvancedPane from './settings/AdvancedPane.vue';
import AppearancePane from './settings/AppearancePane.vue';
import ClaudeCodePane from './settings/ClaudeCodePane.vue';
import GitPane from './settings/GitPane.vue';
import MemoryPane from './settings/MemoryPane.vue';
import MobileAccessPane from './settings/MobileAccessPane.vue';

// P100 Part 2: Kira Studio's own workbench/SettingsDialog.vue, the plan's own "small rewrite" —
// only the sections still relevant to a repo-only workbench (state/settings.ts's own `sections`).
// P103 Part 2 (§5.5): now a thin composition over SettingsShell.vue plus this app's own panes
// (workbench/settings/*.vue, extracted verbatim from this file's own former inline
// `<template v-if>` branches — see SettingsShell.vue's own file-level comment for what stays
// app-side and why). Everything genuinely app-specific stays here: which three of Settings'
// sections this dialog edits, the dialog's own width/height, the deep-link reset, and the footer
// markup (its one small, real difference from Kira Studio's own — see SettingsShell.vue's
// comment #2).
const emit = defineEmits<{ close: [] }>();

const settingsStore = useSettingsStore();
const promptsExtra = useLlmPromptsShellExtra();

const sectionLabels = computed<Record<Section, string>>(() => ({
  Appearance: t('common.appearance.label'),
  Git: t('common.module.git.label'),
  'Mobile access': t('space.settings.nav.mobileAccess.label'),
  'Claude Code': t('common.product.claudeCode.label'),
  Memory: t('common.module.memory.label'),
  Prompts: t('llmPrompts.nav.label'),
  Advanced: t('common.advanced.label'),
}));

// §10.1: a later plain open (the title bar's gear icon) must not inherit a deep link this instance
// was opened with.
useSettingsDeepLinkReset(settingsStore);

async function save(patch: SettingsPatch): Promise<void> {
  await settingsStore.patchSettings(patch);
}
</script>

<template>
  <SettingsShell
    :section-labels="sectionLabels"
    :sections="sections"
    :initial-section="settingsStore.settingsSection ?? undefined"
    :defaults="{
      appearance: defaultSettings.appearance,
      advanced: defaultSettings.advanced,
      git: defaultSettings.git,
      claudeCode: defaultSettings.claudeCode,
      ade: {
        headlessSettingSources: defaultSettings.ade.headlessSettingSources,
        sandboxKeychain: defaultSettings.ade.sandboxKeychain,
      },
    }"
    :current="{
      appearance: settingsStore.appearance,
      advanced: settingsStore.advanced,
      git: settingsStore.git,
      claudeCode: settingsStore.claudeCode,
      ade: {
        headlessSettingSources: settingsStore.ade.headlessSettingSources,
        sandboxKeychain: settingsStore.ade.sandboxKeychain,
      },
    }"
    :save="save"
    :extra="promptsExtra"
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
      <GitPane
        :active="s.activeSection === 'Git'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <MobileAccessPane
        :active="s.activeSection === 'Mobile access'"
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
      <MemoryPane
        :active="s.activeSection === 'Memory'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <PromptsPane :active="s.activeSection === 'Prompts'" />
      <AdvancedPane
        :active="s.activeSection === 'Advanced'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
    </template>

    <template #footer="f">
      <div class="mr-auto min-w-0">
        <FieldError v-if="f.saveError" data-testid="settings-save-error">{{
          f.saveError
        }}</FieldError>
        <span
          v-else
          class="text-subtle text-kira-sm leading-normal"
          data-testid="settings-footer-status"
          >{{
            f.isDirty ? t('common.state.unsavedChanges.status') : ''
          }}</span
        >
      </div>
      <Button variant="dialog" size="kira-lg" data-testid="settings-cancel" @click="f.onDismiss">{{
        t('common.action.cancel.label')
      }}</Button>
      <Button
        variant="dialog-primary"
        size="kira-lg"
        :disabled="!f.isValid"
        data-testid="settings-save"
        @click="f.onSave"
      >
        {{ t('common.action.save.label') }}
      </Button>
    </template>
  </SettingsShell>
</template>
