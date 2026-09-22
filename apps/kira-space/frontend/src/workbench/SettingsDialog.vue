<script setup lang="ts">
import {
  defaultSettings,
  FETCH_AUTO_INTERVAL_MINUTES_RANGE,
  FONT_SIZE_RANGE,
  type RowDensity,
  type Settings,
  type SettingsPatch,
} from '@shared/domain/settings';
import CodiconIcon from '@theme/CodiconIcon.vue';
import AppButton from '@theme/primitives/AppButton.vue';
import Checkbox from '@theme/primitives/Checkbox.vue';
import DialogFrame from '@theme/primitives/DialogFrame.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { formatRelative } from '../format';
import { useConfirmDialogStore } from '../state/confirmDialog';
import { useGitClientsStore } from '../state/gitClients';
import { type Section, sections, useSettingsStore } from '../state/settings';

// P100 Part 2: Kira Studio's own workbench/SettingsDialog.vue, the plan's own "small rewrite" —
// only the sections still relevant to a repo-only workbench (state/settings.ts's own `sections`):
// Appearance (trimmed to typography + repo-file-viewer leaves — no row density preview, no
// data-grid page size, no cache/API sections, no Scripts/Claude Code/Database MCP sections, none
// of which this app has a feature for), Git (server-owned remote-op settings, moved here wholesale
// from Studio along with the repo workspace it configures), Connected editors (state/gitClients.ts,
// also moved here wholesale) and Advanced (trimmed to the one leaf this app still owns,
// advanced.gitLogLevel — kira-version's own diagnostic log verbosity).

const emit = defineEmits<{ close: [] }>();

const confirmDialogStore = useConfirmDialogStore();
const gitClientsStore = useGitClientsStore();
const settingsStore = useSettingsStore();

// P17 D1: everything the user touches lives in this draft until Save — settingsStore (and
// therefore every other window and the app's own rendering) sees nothing until then. The
// component is created on open and destroyed on close (TitleBar.vue's own
// v-if="settingsStore.settingsOpen"), which is the draft's whole lifetime — no reset logic needed.
// JSON round-trip rather than structuredClone(): settingsStore's leaves are Vue reactive proxies,
// and structuredClone's algorithm throws on a Proxy rather than cloning the plain data underneath it.
const cloneSections = (s: Settings): Settings =>
  JSON.parse(JSON.stringify({ appearance: s.appearance, advanced: s.advanced, git: s.git }));

// Frozen at runtime (mutation would be a bug); typed as plain Settings so diffSection below can
// compare it against the mutable draft without a readonly/mutable type mismatch. data/cache/api/
// dbMcp/claudeCode are still part of the one shared Settings type (round-tripped by
// state/settings.ts's own applySettings) but never enter this dialog's own draft — this app has no
// section that edits them.
const baseline = Object.freeze(cloneSections(settingsStore)) as Pick<
  Settings,
  'appearance' | 'advanced' | 'git'
>;
const draft = reactive(cloneSections(settingsStore)) as Pick<
  Settings,
  'appearance' | 'advanced' | 'git'
>;

// G7 D16: git.protectedBranches is this dialog's first array-valued leaf — cloneSections gives
// draft/baseline each their own array object even when unedited, so a bare `!==`/`===` (every
// other leaf here is a primitive) would report it changed/non-default on every open. Compared by
// value instead; every other leaf still takes the cheap `===` path.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

// P17 D2: the generic per-leaf diff Save sends. Walking Object.keys(base) rather than a
// hand-maintained leaf list means a future leaf needs no edit here either.
function diffSection<T extends object>(base: T, current: T): Partial<T> | undefined {
  const changed: Partial<T> = {};
  let anyChanged = false;
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (!valuesEqual(current[key], base[key])) {
      changed[key] = current[key];
      anyChanged = true;
    }
  }
  return anyChanged ? changed : undefined;
}

const pendingPatch = computed<SettingsPatch>(() => {
  const patch: SettingsPatch = {};
  const appearance = diffSection(baseline.appearance, draft.appearance);
  if (appearance) patch.appearance = appearance;
  const advanced = diffSection(baseline.advanced, draft.advanced);
  if (advanced) patch.advanced = advanced;
  const git = diffSection(baseline.git, draft.git);
  if (git) patch.git = git;
  return patch;
});

const isDirty = computed(() => Object.keys(pendingPatch.value).length > 0);

// P85 §10.1: activeSection seeds from settingsStore.settingsSection (a deep link) — null (a plain
// open) falls back to 'Appearance', G12 D9's own default.
const activeSection = ref<Section>(settingsStore.settingsSection ?? 'Appearance');

onBeforeUnmount(() => {
  // §10.1: a later plain open (TitleBar.vue's gear icon) must not inherit a deep link this
  // instance was opened with.
  settingsStore.settingsSection = null;
});

// D16: this section bypasses draft/pendingPatch entirely — a revoke must take effect immediately,
// not wait for Save, and gitClientsStore is a module-level store, not a settings leaf.
async function onRevokeGitClient(id: string, label: string): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Revoke access for "${label || id}"? It will need to be re-approved.`,
    { danger: true },
  );
  if (ok) await gitClientsStore.revokeGitClient(id);
}

// G10 D12/D14: same bypass-draft-entirely posture as onRevokeGitClient above — an install is an
// action, not a setting. installing starts true only while the click is in flight.
const vsixInstalling = ref(false);
async function onInstallVsCodeIntegration(): Promise<void> {
  vsixInstalling.value = true;
  try {
    await gitClientsStore.installVsCodeIntegration();
  } finally {
    vsixInstalling.value = false;
  }
}

// D12's own outcome copy, verbatim where it's a fixed string; installFailed/revealFailed weave in
// the server's own bounded detail/vsixPath.
const vsixOutcomeMessage = computed(() => {
  const result = gitClientsStore.vsixInstallResult;
  if (!result) return null;
  switch (result.outcome) {
    case 'installed':
      return 'Installed into VS Code. Reload the window to activate it.';
    case 'revealed':
      return "VS Code's code command isn't available. Revealed the file in Finder — drag it onto VS Code, or run Shell Command: Install 'code' command in PATH.";
    case 'notBundled':
      return 'The extension ships inside the packaged app. This build has none.';
    case 'installFailed':
      return `VS Code refused the install: ${result.detail}. Reveal the file in Finder and drag it onto VS Code instead.`;
    case 'revealFailed':
      return `Couldn't reveal the file automatically. Find it at ${result.vsixPath}.`;
    default:
      return null;
  }
});

function onFontSizeInput(e: Event): void {
  draft.appearance.fontSize = Number((e.target as HTMLInputElement).value);
}

function setRowDensity(density: RowDensity): void {
  draft.appearance.rowDensity = density;
}

function onWordWrapChange(checked: boolean): void {
  draft.appearance.wordWrap = checked;
}

function onInlineBlameChange(checked: boolean): void {
  draft.appearance.inlineBlame = checked;
}

// P72 §9.1: relative-vs-absolute commit timestamps in the git graph.
function onDateFormatChange(e: Event): void {
  draft.appearance.dateFormat = (e.target as HTMLSelectElement)
    .value as Settings['appearance']['dateFormat'];
}

function onFetchAutoIntervalInput(e: Event): void {
  draft.git.fetchAutoIntervalMinutes = Number((e.target as HTMLInputElement).value);
}

// P92 item 9: an emptied field writes 0 (the "follow appearance.fontSize" sentinel), same rule
// applyAppearance() reads — not NaN, which a plain Number(...) would let through unnoticed for a
// genuinely blank input.
function onGraphFontSizeInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  draft.git.graphFontSize = raw === '' ? 0 : Number(raw);
}

// P72 §9.2: kira-version's own diagnostic log verbosity — genuinely installation-wide.
function onGitLogLevelChange(e: Event): void {
  draft.advanced.gitLogLevel = (e.target as HTMLSelectElement)
    .value as Settings['advanced']['gitLogLevel'];
}

// G7 D17: `*` matches any run of characters except `/` — the same rule server-side git preflight
// enforces; this dialog only edits the pattern list, never evaluates it. A plain ref, not a
// computed bound straight to draft.git.protectedBranches: parsing on every keystroke and feeding
// the result back into the textarea's own value would snap away a blank line the instant it's
// created, fighting the user mid-edit — parsed into the draft by the watcher below instead,
// one-directionally.
const protectedBranchesText = ref(draft.git.protectedBranches.join('\n'));
watch(protectedBranchesText, (v) => {
  draft.git.protectedBranches = v
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
});
function resetProtectedBranches(): void {
  draft.git.protectedBranches = [...defaultSettings.git.protectedBranches];
  protectedBranchesText.value = draft.git.protectedBranches.join('\n');
}

// P17 D6: the draft accepts whatever is typed (@input, so the field never fights the user
// mid-keystroke) — validity is derived here, not enforced at write time, and gates Save below.
const fontSizeError = computed<string | null>(() => {
  const v = draft.appearance.fontSize;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < FONT_SIZE_RANGE.min || v > FONT_SIZE_RANGE.max) {
    return `${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max} px`;
  }
  return null;
});

const fetchAutoIntervalError = computed<string | null>(() => {
  const v = draft.git.fetchAutoIntervalMinutes;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < FETCH_AUTO_INTERVAL_MINUTES_RANGE.min || v > FETCH_AUTO_INTERVAL_MINUTES_RANGE.max) {
    return `${FETCH_AUTO_INTERVAL_MINUTES_RANGE.min}–${FETCH_AUTO_INTERVAL_MINUTES_RANGE.max} minutes`;
  }
  return null;
});

// P92 item 9: 0 is the valid "follow appearance.fontSize" sentinel, but 1..8 is below
// FONT_SIZE_RANGE.min and unreadable — reject that gap here, in the control, since the schema
// itself accepts the full 0..max range (a stored out-of-range value must still hydrate).
const graphFontSizeError = computed<string | null>(() => {
  const v = draft.git.graphFontSize;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v === 0) return null;
  if (v < FONT_SIZE_RANGE.min || v > FONT_SIZE_RANGE.max) {
    return `0, or ${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max} px`;
  }
  return null;
});

const isValid = computed(
  () => !fontSizeError.value && !fetchAutoIntervalError.value && !graphFontSizeError.value,
);

// P28 §2.2: two generic helpers replace an all-or-nothing Revert to Defaults, so a future leaf
// needs no edit here either.
function isAtDefault<S extends 'appearance' | 'advanced' | 'git', K extends keyof Settings[S]>(
  s: S,
  k: K,
): boolean {
  return valuesEqual(draft[s][k], defaultSettings[s][k]);
}
function resetLeaf<S extends 'appearance' | 'advanced' | 'git', K extends keyof Settings[S]>(
  s: S,
  k: K,
): void {
  draft[s][k] = defaultSettings[s][k];
}

// P17 D5: Cancel, Escape, the close button and the backdrop all route here — the draft dies with
// the component, no IPC call, no confirmation.
function onDismiss(): void {
  emit('close');
}

const saveError = ref<string | null>(null);

// P17 D7: a failed Save keeps the dialog open and shows the error; only a successful Save closes
// it. Saving with nothing changed sends no patch at all (D2).
async function onSave(): Promise<void> {
  if (!isValid.value) return;
  saveError.value = null;
  const patch = pendingPatch.value;
  if (Object.keys(patch).length === 0) {
    emit('close');
    return;
  }
  try {
    await settingsStore.patchSettings(patch);
    emit('close');
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <DialogFrame
    title="Settings"
    :width="680"
    :height="520"
    test-id="settings-dialog"
    close-test-id="settings-dialog-close"
    @close="onDismiss"
  >
    <template #header>
      <span class="icon-box muted"><CodiconIcon name="gear" :size="13" /></span>
      <span>Settings</span>
    </template>

    <div class="dialog-body-inner">
      <nav class="section-list">
        <button
          v-for="section in sections"
          :key="section"
          type="button"
          class="section-item"
          :class="{ active: activeSection === section }"
          :data-testid="`settings-section-${section}`"
          @click="activeSection = section"
        >
          {{ section }}
        </button>
      </nav>

      <section class="section-pane">
        <template v-if="activeSection === 'Appearance'">
          <div class="sec-label first">Typography</div>
          <label class="field">
            <div class="field-head">
              <span>Data font size</span>
              <IconButton
                icon="discard"
                data-testid="settings-reset-appearance-fontSize"
                :disabled="isAtDefault('appearance', 'fontSize')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('appearance', 'fontSize')"
              />
            </div>
            <div class="size-input">
              <TextField
                type="number"
                :min="FONT_SIZE_RANGE.min"
                :max="FONT_SIZE_RANGE.max"
                size="md"
                :invalid="!!fontSizeError"
                data-testid="settings-font-size"
                :model-value="String(draft.appearance.fontSize)"
                @input="onFontSizeInput"
              />
            </div>
            <span v-if="fontSizeError" class="field-error" data-testid="settings-font-size-error">
              {{ fontSizeError }}
            </span>
            <span v-else class="helper-text"
              >{{ FONT_SIZE_RANGE.min }}–{{ FONT_SIZE_RANGE.max }} px</span
            >
          </label>

          <div class="field">
            <div class="field-head">
              <span>Row height</span>
              <IconButton
                icon="discard"
                data-testid="settings-reset-appearance-rowDensity"
                :disabled="isAtDefault('appearance', 'rowDensity')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('appearance', 'rowDensity')"
              />
            </div>
            <div class="segmented">
              <button
                type="button"
                :class="{ active: draft.appearance.rowDensity === 'compact' }"
                @click="setRowDensity('compact')"
              >
                Compact · 22 px
              </button>
              <button
                type="button"
                :class="{ active: draft.appearance.rowDensity === 'comfortable' }"
                @click="setRowDensity('comfortable')"
              >
                Comfortable · 28 px
              </button>
            </div>
            <span class="helper-text">Applies to the file tree and every list.</span>
          </div>

          <div class="field checkbox-row">
            <label class="field checkbox">
              <Checkbox
                :model-value="draft.appearance.wordWrap"
                data-testid="settings-word-wrap"
                @update:model-value="onWordWrapChange"
              />
              <span>Word wrap</span>
              <span class="helper-text">Long lines wrap instead of scrolling, in the file viewer.</span>
            </label>
            <IconButton
              icon="discard"
              class="p-push"
              data-testid="settings-reset-appearance-wordWrap"
              :disabled="isAtDefault('appearance', 'wordWrap')"
              v-tooltip="'Reset to default'"
              @click="resetLeaf('appearance', 'wordWrap')"
            />
          </div>

          <div class="field checkbox-row">
            <label class="field checkbox">
              <Checkbox
                :model-value="draft.appearance.inlineBlame"
                data-testid="settings-inline-blame"
                @update:model-value="onInlineBlameChange"
              />
              <span>Inline blame</span>
              <span class="helper-text"
                >Show who last changed the current line, at the end of that line, in the
                repository file viewer.</span
              >
            </label>
            <IconButton
              icon="discard"
              class="p-push"
              data-testid="settings-reset-appearance-inlineBlame"
              :disabled="isAtDefault('appearance', 'inlineBlame')"
              v-tooltip="'Reset to default'"
              @click="resetLeaf('appearance', 'inlineBlame')"
            />
          </div>

          <label class="field">
            <div class="field-head">
              <span>Commit date</span>
              <IconButton
                icon="discard"
                data-testid="settings-reset-appearance-dateFormat"
                :disabled="isAtDefault('appearance', 'dateFormat')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('appearance', 'dateFormat')"
              />
            </div>
            <select
              class="p-select bordered md"
              data-testid="settings-date-format"
              :value="draft.appearance.dateFormat"
              @change="onDateFormatChange"
            >
              <option value="relative">Relative (3 days ago)</option>
              <option value="absolute">Absolute (2024-12-30 22:48)</option>
            </select>
            <span class="helper-text">The git graph's own commit timestamps.</span>
          </label>
        </template>

        <template v-else-if="activeSection === 'Git'">
          <h3 class="section-subhead">Git remote operations</h3>
          <p class="muted-note">
            Server-owned: applies to every connected editor immediately, since two windows
            disagreeing about either is a safety issue, not a preference.
          </p>
          <label class="field">
            <div class="field-head">
              <span>Protected branch patterns (one per line)</span>
              <IconButton
                icon="discard"
                data-testid="settings-reset-git-protectedBranches"
                :disabled="isAtDefault('git', 'protectedBranches')"
                v-tooltip="'Reset to default'"
                @click="resetProtectedBranches"
              />
            </div>
            <textarea
              v-model="protectedBranchesText"
              class="p-textarea"
              rows="4"
              placeholder="main"
              data-testid="settings-git-protected-branches"
            />
            <span class="helper-text"
              >Force-pushing or deleting a matching remote branch requires typing its name to
              confirm. "*" matches any characters except "/". Ordinary pushes are never gated.</span
            >
          </label>
          <label class="field">
            <div class="field-head">
              <span>Auto-fetch interval (minutes)</span>
              <IconButton
                icon="discard"
                data-testid="settings-reset-git-fetchAutoIntervalMinutes"
                :disabled="isAtDefault('git', 'fetchAutoIntervalMinutes')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('git', 'fetchAutoIntervalMinutes')"
              />
            </div>
            <TextField
              type="number"
              :min="FETCH_AUTO_INTERVAL_MINUTES_RANGE.min"
              :max="FETCH_AUTO_INTERVAL_MINUTES_RANGE.max"
              size="md"
              :invalid="!!fetchAutoIntervalError"
              data-testid="settings-git-fetch-auto-interval"
              :model-value="String(draft.git.fetchAutoIntervalMinutes)"
              @input="onFetchAutoIntervalInput"
            />
            <span
              v-if="fetchAutoIntervalError"
              class="field-error"
              data-testid="settings-git-fetch-auto-interval-error"
            >
              {{ fetchAutoIntervalError }}
            </span>
            <span v-else class="helper-text"
              >0 disables background fetching. Never prompts for a credential — a remote that
              needs one simply fails silently and disables the timer until the next explicit
              fetch.</span
            >
          </label>
          <label class="field">
            <div class="field-head">
              <span>Git executable path</span>
              <IconButton
                icon="discard"
                data-testid="settings-reset-git-gitPath"
                :disabled="isAtDefault('git', 'gitPath')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('git', 'gitPath')"
              />
            </div>
            <TextField type="text" size="md" data-testid="settings-git-path" v-model="draft.git.gitPath" />
            <span class="helper-text"
              >Empty uses the host's own discovery (PATH). A remote op reads this fresh every
              time, never cached, so a change here takes effect on the next one.</span
            >
          </label>
          <h3 class="section-subhead">Graph</h3>
          <label class="field">
            <div class="field-head">
              <span>Font size</span>
              <IconButton
                icon="discard"
                data-testid="settings-reset-git-graphFontSize"
                :disabled="isAtDefault('git', 'graphFontSize')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('git', 'graphFontSize')"
              />
            </div>
            <TextField
              type="number"
              :min="FONT_SIZE_RANGE.min"
              :max="FONT_SIZE_RANGE.max"
              size="md"
              :invalid="!!graphFontSizeError"
              data-testid="settings-git-graphFontSize"
              :model-value="String(draft.git.graphFontSize)"
              @input="onGraphFontSizeInput"
            />
            <span v-if="graphFontSizeError" class="field-error" data-testid="settings-git-graphFontSize-error">
              {{ graphFontSizeError }}
            </span>
            <span v-else class="helper-text">0 = match the app font size.</span>
          </label>
        </template>

        <template v-else-if="activeSection === 'Connected editors'">
          <!-- G10 D14: the Install VS Code Integration entry point — advisory-rendered from
               VsixStatus, but the click itself always re-resolves through Install. -->
          <div class="git-vsix-install">
            <p v-if="!gitClientsStore.vsix.bundled" class="muted-note" data-testid="git-vsix-not-bundled">
              The extension ships inside the packaged app. This build has none.
            </p>
            <template v-else>
              <p class="mono command-text" data-testid="git-vsix-command">
                {{ gitClientsStore.vsix.command }}
              </p>
              <AppButton
                kind="dialog"
                class="action-button"
                :disabled="vsixInstalling"
                data-testid="git-vsix-install-button"
                @click="onInstallVsCodeIntegration"
              >
                {{
                  gitClientsStore.vsix.codeAvailable
                    ? 'Install VS Code Integration'
                    : 'Reveal Extension in Finder'
                }}
              </AppButton>
            </template>
            <p v-if="vsixOutcomeMessage" class="helper-text" data-testid="git-vsix-outcome">
              {{ vsixOutcomeMessage }}
            </p>
            <p
              v-if="gitClientsStore.vsix.bundled && !gitClientsStore.vsix.codeAvailable && gitClientsStore.vsix.probed.length > 0"
              class="muted-note"
              data-testid="git-vsix-probed"
            >
              Looked for VS Code's <span class="mono">code</span> command at:
              <span class="mono">{{ gitClientsStore.vsix.probed.join(', ') }}</span>
            </p>
          </div>

          <p v-if="gitClientsStore.clients.length === 0" class="muted-note" data-testid="git-clients-empty">
            No editors have been paired yet. A VS Code editor pairs by connecting to
            <span class="mono">~/.kira-space/git.sock</span>.
          </p>
          <ul v-else class="git-clients-list">
            <li
              v-for="client in gitClientsStore.clients"
              :key="client.id"
              class="git-client-row"
              :data-testid="`git-client-row-${client.id}`"
            >
              <div class="git-client-info">
                <span class="git-client-label">{{ client.label || client.id }}</span>
                <span class="helper-text">
                  <template v-if="client.revokedAt">Revoked</template>
                  <template v-else>Last seen {{ formatRelative(client.lastSeenAt) }}</template>
                </span>
              </div>
              <IconButton
                v-if="!client.revokedAt"
                icon="trash"
                tone="danger"
                :data-testid="`git-client-revoke-${client.id}`"
                v-tooltip="'Revoke'"
                @click="onRevokeGitClient(client.id, client.label)"
              />
            </li>
          </ul>
        </template>

        <template v-else-if="activeSection === 'Advanced'">
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
        </template>
      </section>
    </div>

    <template #footer>
      <span class="footer-status">
        <span v-if="saveError" class="field-error" data-testid="settings-save-error">{{
          saveError
        }}</span>
        <span v-else class="helper-text" data-testid="settings-footer-status">{{
          isDirty ? 'Unsaved changes' : ''
        }}</span>
      </span>
      <span class="p-dialog-actions end" style="gap: var(--kira-s-2)">
        <AppButton kind="dialog" data-testid="settings-cancel" @click="onDismiss">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          :disabled="!isValid"
          data-testid="settings-save"
          @click="onSave"
        >
          Save
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
@reference "@theme/base.css";

.dialog-body-inner {
  @apply h-full flex min-h-0;
}

.section-list {
  @apply w-[176px] shrink-0 flex flex-col gap-px;
  border-right: var(--kira-border-width) solid var(--kira-border);
  padding: var(--kira-s-3) var(--kira-s-2);
}

.section-item {
  @apply text-left rounded-[var(--kira-radius-sm)] bg-transparent border-none cursor-pointer;
  height: var(--kira-h-sm);
  padding: 0 var(--kira-s-3);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-md);
}

.section-item:hover {
  background: var(--kira-hover);
}

.section-item.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.footer-status {
  @apply flex-1 min-w-0;
}
</style>
