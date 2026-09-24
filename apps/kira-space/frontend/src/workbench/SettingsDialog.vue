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
      <span class="footer-status">
        <!-- P110 B12: .footer-status has no `flex` of its own (unlike Kira Studio's own copy) --
             its children are plain inline spans today, so kept as spans with .field-error's/
             .helper-text's own utility-class equivalent, not FieldError/FieldDescription (a
             <div>/<p>), which would introduce blockification that isn't there now. -->
        <span v-if="f.saveError" class="leading-normal text-error text-kira-xs" data-testid="settings-save-error">{{
          f.saveError
        }}</span>
        <span v-else class="leading-normal text-subtle text-kira-xs" data-testid="settings-footer-status">{{
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

<style>
@reference "@theme/base.css";

/* P103 Part 2 (§5.5): every class below is used by more than one of this app's own settings panes
 * (workbench/settings/*.vue) or by this file's own footer slot — plain global CSS, not `scoped`,
 * for the same reason as Kira Studio's own copy of this comment: a `scoped` block only reaches
 * markup this file's own template renders, and most of this markup lives in sibling pane
 * components instead. Moved verbatim from the former single-file SettingsDialog.vue's own
 * `<style scoped>` block.
 *
 * `.git-vsix-install`/`.git-clients-list`/`.git-client-row`/`.git-client-info`/`.git-client-label`
 * are NOT here: grepping the whole repo for a rule defining any of them (not their use) turns up
 * nothing, in this file's own former style block or anywhere else — they are unstyled today, the
 * same gap `.section-subhead` (SettingsShell.vue's own workbench.css addition) documents. Left
 * unstyled, exactly as they are today; inventing a rule for them now would be new styling, outside
 * this phase's own "move code, don't add it" rule. */
.footer-status {
  @apply flex-1 min-w-0;
}

.segmented {
  @apply inline-flex overflow-hidden self-start rounded-kira-sm;
  height: var(--kira-h-md);
  border: var(--kira-border-width) solid var(--kira-border-strong);
}

.segmented button {
  @apply cursor-pointer border-none bg-none;
  padding: 0 var(--kira-s-3);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
}

.segmented button + button {
  border-left: var(--kira-border-width) solid var(--kira-border-strong);
}

.segmented button.active {
  background: var(--kira-bg-input);
  color: var(--kira-fg);
}

/* Command-before-button transparency (C3 §7.2/§7.5): a copyable, wrapped command string, shown
   ahead of every Install button that follows one. */
.command-text {
  @apply m-0 leading-normal whitespace-pre-wrap break-all select-all rounded-kira-sm;
  padding: var(--kira-s-2);
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  font-size: var(--kira-t-xs);
}

.muted-note {
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
}

.action-button {
  @apply self-start;
}
</style>
