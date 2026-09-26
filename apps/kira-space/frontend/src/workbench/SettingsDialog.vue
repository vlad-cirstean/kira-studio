<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import SettingsShell from '@workbench/components/SettingsShell.vue';
import { useSettingsDeepLinkReset } from '@workbench/settings/useSettingsDeepLinkReset';
import { sections, useSettingsStore } from '../state/settings';
import { defaultSettings, type SettingsPatch } from '../state/settingsDomain';
import AdvancedPane from './settings/AdvancedPane.vue';
import AppearancePane from './settings/AppearancePane.vue';
import ConnectedEditorsPane from './settings/ConnectedEditorsPane.vue';
import GitPane from './settings/GitPane.vue';

// P100 Part 2: Kira Studio's own workbench/SettingsDialog.vue, the plan's own "small rewrite" —
// only the sections still relevant to a repo-only workbench (state/settings.ts's own `sections`).
// P103 Part 2 (§5.5): now a thin composition over SettingsShell.vue plus this app's own four panes
// (workbench/settings/*.vue, extracted verbatim from this file's own former inline
// `<template v-if>` branches — see SettingsShell.vue's own file-level comment for what stays
// app-side and why). Everything genuinely app-specific stays here: which three of Settings'
// sections this dialog edits, the dialog's own width/height, the deep-link reset, and the footer
// markup (its one small, real difference from Kira Studio's own — see SettingsShell.vue's
// comment #2).
const emit = defineEmits<{ close: [] }>();

const settingsStore = useSettingsStore();

// §10.1: a later plain open (TitleBar.vue's gear icon) must not inherit a deep link this instance
// was opened with.
useSettingsDeepLinkReset(settingsStore);

async function save(patch: SettingsPatch): Promise<void> {
  await settingsStore.patchSettings(patch);
}
</script>

<template>
  <SettingsShell
    :sections="sections"
    :initial-section="settingsStore.settingsSection ?? undefined"
    :width="680"
    :height="520"
    :defaults="{
      appearance: defaultSettings.appearance,
      advanced: defaultSettings.advanced,
      git: defaultSettings.git,
    }"
    :current="{
      appearance: settingsStore.appearance,
      advanced: settingsStore.advanced,
      git: settingsStore.git,
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
      <GitPane
        :active="s.activeSection === 'Git'"
        :draft="s.draft"
        :is-at-default="s.isAtDefault"
        :reset-leaf="s.resetLeaf"
        :register-field-error="s.registerFieldError"
      />
      <ConnectedEditorsPane
        :active="s.activeSection === 'Connected editors'"
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
      <span class="flex-1 min-w-0">
        <!-- P110 B12/B36: no `flex` here (unlike Kira Studio's own copy) -- its children are
             plain inline spans today, so kept as spans with .field-error's/.helper-text's own
             utility-class equivalent, not FieldError/FieldDescription (a <div>/<p>), which would
             introduce blockification that isn't there now. -->
        <span v-if="f.saveError" class="text-error text-kira-sm leading-normal" data-testid="settings-save-error">{{
          f.saveError
        }}</span>
        <span v-else class="text-subtle text-kira-sm leading-normal" data-testid="settings-footer-status">{{
          f.isDirty ? 'Unsaved changes' : ''
        }}</span>
      </span>
      <span class="flex items-center gap-1">
        <Button variant="dialog" size="kira-lg" data-testid="settings-cancel" @click="f.onDismiss">Cancel</Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :disabled="!f.isValid"
          data-testid="settings-save"
          @click="f.onSave"
        >
          Save
        </Button>
      </span>
    </template>
  </SettingsShell>
</template>

