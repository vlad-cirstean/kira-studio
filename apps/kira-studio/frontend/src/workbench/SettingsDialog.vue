<script setup lang="ts">
import AppButton from '@theme/primitives/AppButton.vue';
import SettingsShell from '@workbench/components/SettingsShell.vue';
import { onBeforeUnmount } from 'vue';
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
onBeforeUnmount(() => {
  settingsStore.settingsSection = null;
});

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
      <span class="footer-status">
        <span v-if="f.saveError" class="field-error" data-testid="settings-save-error">{{ f.saveError }}</span>
        <span v-else class="helper-text" data-testid="settings-footer-status"
          >Stored in <span class="mono">~/.kira-studio/kira.sqlite</span><template v-if="f.isDirty">
          · Unsaved changes</template></span
        >
      </span>
      <span class="p-dialog-actions">
        <AppButton kind="dialog" data-testid="settings-cancel" @click="f.onDismiss">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="settings-save"
          :disabled="!f.isValid"
          @click="f.onSave"
        >
          Save
        </AppButton>
      </span>
    </template>
  </SettingsShell>
</template>

<style>
@reference "@theme/base.css";

/* P103 Part 2 (§5.5): every class below is used by more than one of this app's own settings panes
 * (workbench/settings/*.vue) or by this file's own footer slot — plain global CSS, not `scoped`,
 * since a `scoped` block only reaches markup this file's own template renders, and most of this
 * markup lives in sibling pane components instead (SettingsShell.vue's own file-level comment on
 * why every pane stays mounted explains the shape; the same "shared across siblings needs global
 * CSS" reasoning applies to their styles, not just their scripts). Moved verbatim from the former
 * single-file SettingsDialog.vue's own `<style scoped>` block, `@apply` kept as-is since this file
 * (unlike packages/workbench/src/workbench.css) is a real component file with its own
 * `@reference` chain. */
.footer-status {
  @apply flex-1 min-w-0 flex items-center;
}

.size-input {
  @apply w-24;
}

.size-input .p-input {
  @apply w-full;
}

.segmented {
  @apply inline-flex overflow-hidden self-start rounded-[var(--kira-radius-sm)];
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

.font-preview {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg);
}

.mono {
  font-family: var(--kira-font-data);
}

/* Command-before-button transparency (C3 §7.2/§7.5): a copyable, wrapped command string, shown
   ahead of every Install button that follows one. */
.command-text {
  @apply m-0 leading-normal whitespace-pre-wrap break-all select-all rounded-[var(--kira-radius-sm)];
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

/* M2 §7.3: the "Exposed connections" list's own per-row glance. P100 Part 2: originally patterned
   after .git-clients-list/.git-client-row (the 'Connected editors' section's own rules) — both
   moved to apps/kira-space along with that section, so this now stands alone. */
.db-mcp-connections-list {
  @apply flex flex-col m-0 p-0 list-none;
  gap: var(--kira-s-1);
}

.db-mcp-connection-row {
  @apply flex items-center justify-between rounded-[var(--kira-radius-sm)];
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-3);
  border: var(--kira-border-width) solid var(--kira-border);
}

.db-mcp-connection-info {
  @apply flex flex-col min-w-0;
  gap: var(--kira-s-1);
}

.db-mcp-connection-name {
  @apply break-words;
  color: var(--kira-fg);
  font-size: var(--kira-t-sm);
}

/* SettingsDialog.html's row-density preview strip */
.row-preview {
  @apply overflow-hidden rounded-[var(--kira-radius-sm)];
  border: var(--kira-border-width) solid var(--kira-border);
}

.row-preview-row {
  @apply flex;
}

.row-preview-row + .row-preview-row {
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.row-preview-head {
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
}

.row-preview-cell {
  @apply flex items-center overflow-hidden whitespace-nowrap text-ellipsis;
  flex: 0 0 150px;
  padding: 0 var(--kira-s-4);
  font-family: var(--kira-font-data);
  font-size: var(--kira-t-md);
  color: var(--kira-fg);
  border-right: var(--kira-border-width) solid var(--kira-border);
}

.row-preview-head .row-preview-cell {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  font-family: inherit;
}

.row-preview-gutter {
  @apply justify-end;
  flex: 0 0 36px;
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
  background: var(--kira-bg-elevated);
}

.row-preview-grow {
  @apply flex-1;
}

/* P85 §10.2: the Scripts section's list/add row — ConnectionDialog.vue's own
   .mask-rule-list/.mask-rule-row/.mask-rule-add, restated here since that file's scoped styles
   don't reach this one. */
.custom-script-list {
  @apply flex flex-col max-h-80 overflow-y-auto;
  gap: var(--kira-s-3);
}

/* Bug fix (manual testing, "there's no space to see and edit anything"): a script's own Name
   (paired with its colour picker and remove/add button), Command, and Working directory each get
   a full-width line, stacked, instead of cramming three text fields into one row alongside the
   colour picker and a button. */
.custom-script-row {
  @apply flex flex-col;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3) 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.custom-script-add {
  @apply flex flex-col;
  gap: var(--kira-s-2);
}

.script-row-top {
  @apply flex items-center;
  gap: var(--kira-s-3);
}

.script-name {
  @apply flex flex-col flex-1 min-w-0;
}

/* .field's own column-flex pattern (packages/workbench/src/workbench.css): a TextField's own root
   is inline-flex, so it only stretches to fill its wrapper's width when the wrapper is itself a
   column-flex container (width is the cross axis there, and align-items defaults to stretch). */
.script-command,
.script-workingdir {
  @apply flex flex-col w-full;
}
</style>
