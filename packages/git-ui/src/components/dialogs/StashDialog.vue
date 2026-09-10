<script setup lang="ts">
/**
 * `docs/plans/P9.md` W14 (§3.1's normative tree names exactly one `StashDialog.vue`, unlike
 * `BranchDialog.vue`/`TagDialog.vue`/`RevertDialog.vue`'s one-dialog-per-file precedent — see this
 * plan's own Findings for why all three of its "collect input" moments live in this one file
 * rather than being split further to match that precedent):
 *
 * - **create** — `runStashPush`'s own confirm step (no pre-flight endpoint exists for it).
 * - **branch** — name entry plus `previewStashBranch`'s live pre-flight, re-run on every keystroke
 *   exactly like `RevertDialog.vue`'s own mainline picker re-runs `previewRevertMainline`.
 * - **popConfirm** — the shared apply/pop confirmation (OQ7), driven directly by
 *   `ops.pendingStashPop` with no props of its own, exactly like `RevertDialog.vue`/
 *   `CheckoutDialog.vue` are driven by their own `ops.pending*` fields.
 *
 * At most one mode is ever active — `mode` below picks in that order (create/branch never overlap
 * `popConfirm` in practice, since `previewStashBranch` never opens `ops.pendingStashPop`, but the
 * order still matters if a caller opened `createOpen`/`branchTarget` while a pop confirmation from
 * an unrelated row happened to already be pending).
 *
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content, per mode. `KuiDialog`'s single `open`/`title` pair is driven by `mode`
 * itself (one title/close-handler/actions-set per mode, chosen the same way the body already was).
 */
import { validateRefName } from '@kira/git-core';
import type { StashBranchPreflight, StashEntry } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import { stashLabel } from '../stashListModel.ts';

const props = defineProps<{
  ops: OpsState;
  /** Toggled by `AppToolbar.vue`'s "Stash" button, via `App.vue`. */
  createOpen: boolean;
  /** `kiraVersion.stash.includeUntracked`'s current value — the create form's own default,
   *  re-read fresh every time the dialog opens (a setting change mid-session should be seen the
   *  next time this opens, not only after a reload). */
  includeUntrackedDefault: boolean;
  /** Set by `StashList.vue`'s "Create branch from stash…" row action, via `BranchPicker.vue` →
   *  `App.vue`; `undefined` when branch mode is not open. */
  branchTarget: StashEntry | undefined;
  /** G28 D13: toggled by the global-stash section's own header button and the palette's
   *  `saveGlobalStash` action, via `App.vue` — opens save mode with NO pre-selected source
   *  (defaults to "this working tree"). */
  saveOpen: boolean;
  /** G28 D13: set by a STACK row's own "Save to global stash…" action — opens save mode
   *  pre-selected to promote THIS entry (D10 step 3); `undefined` when that row action was not
   *  the trigger (the header button/palette route sets `saveOpen` instead, leaving this
   *  `undefined`, and the source radio then defaults to "this working tree"). */
  saveSourceEntry: StashEntry | undefined;
}>();

const emit = defineEmits<{
  (e: 'close-create'): void;
  (e: 'close-branch'): void;
  (e: 'close-save'): void;
}>();

type Mode = 'create' | 'branch' | 'save' | 'popConfirm' | undefined;

const mode = computed<Mode>(() => {
  if (props.ops.pendingStashPop.value) return 'popConfirm';
  if (props.branchTarget !== undefined) return 'branch';
  if (props.saveOpen || props.saveSourceEntry !== undefined) return 'save';
  if (props.createOpen) return 'create';
  return undefined;
});

const active = computed(() => mode.value !== undefined);

// ---------------------------------------------------------------------------------------
// create mode
// ---------------------------------------------------------------------------------------

const message = ref('');
const includeUntracked = ref(props.includeUntrackedDefault);
const keepIndex = ref(false);
/** OQ9: wired from the caller's current changed-files selection when non-empty (`App.vue` passes
 *  it through `createOpen`'s own open call — see that wiring's own comment); empty means "whole
 *  worktree", never a half-wired guess. Shown here as a read-only summary, not an editable field —
 *  there is no staging UI in this app to pick a *different* subset from. */
const pathspec = ref<readonly string[]>([]);

watch(
  () => props.createOpen,
  (isOpen) => {
    if (!isOpen) return;
    message.value = '';
    includeUntracked.value = props.includeUntrackedDefault;
    keepIndex.value = false;
  },
);

function cancelCreate(): void {
  emit('close-create');
}

async function submitCreate(): Promise<void> {
  await props.ops.runStashPush({
    message: message.value.trim() === '' ? undefined : message.value.trim(),
    includeUntracked: includeUntracked.value,
    keepIndex: keepIndex.value,
    // `[...pathspec.value]` (not `pathspec.value` itself): `ref<readonly string[]>`'s own value is
    // a reactive `Proxy`-wrapped array (Vue's `toReactive`), and `mockBridge.ts`'s in-memory pipe
    // genuinely `structuredClone`s every request to mimic real `postMessage` — Chromium's
    // structured-clone algorithm rejects a `Proxy` outright ("[object Object] could not be
    // cloned"), even an empty one, regardless of what it wraps. A plain array copy is the one this
    // request needs; nothing here relies on the reactive wrapper past this call.
    paths: [...pathspec.value],
  });
  emit('close-create');
}

// ---------------------------------------------------------------------------------------
// branch mode
// ---------------------------------------------------------------------------------------

const branchName = ref('');
const branchPreflight = ref<StashBranchPreflight | undefined>(undefined);
let previewToken = 0;

watch(
  () => props.branchTarget,
  (entry) => {
    if (entry === undefined) return;
    branchName.value = '';
    branchPreflight.value = undefined;
  },
);

watch(branchName, async (name) => {
  const entry = props.branchTarget;
  const trimmed = name.trim();
  if (entry === undefined || trimmed === '') {
    branchPreflight.value = undefined;
    return;
  }
  const token = ++previewToken;
  const result = await props.ops.previewStashBranch(entry, trimmed);
  // A later keystroke's own preview may have already resolved and been rendered by the time this
  // one comes back — `previewRevertMainline`'s call sites have no comparable race (a mainline
  // pick fires once, not once per keystroke), so this dialog needs its own guard against a slow,
  // stale response clobbering a newer one.
  if (token === previewToken) branchPreflight.value = result;
});

const branchNameLocalError = computed(() => {
  if (branchName.value.trim() === '') return undefined;
  const { valid, error } = validateRefName(branchName.value.trim());
  return valid ? undefined : error;
});

/** Only a genuinely invalid/taken name (or nothing typed yet) blocks the button — a `blocked`
 *  checkout half (OQ6) still lets the user create the branch; §7.6/probe 11's own point is that
 *  the branch creation always succeeds, only the pop half can fail, and OQ6's recommendation is to
 *  say so plainly afterward rather than refuse the attempt up front. */
const canSubmitBranch = computed(
  () =>
    branchName.value.trim() !== '' &&
    branchNameLocalError.value === undefined &&
    branchPreflight.value !== undefined &&
    branchPreflight.value.verdict !== 'invalidName',
);

function cancelBranch(): void {
  emit('close-branch');
}

async function submitBranch(): Promise<void> {
  const entry = props.branchTarget;
  if (entry === undefined || !canSubmitBranch.value) return;
  await props.ops.runStashBranch(entry, branchName.value.trim());
  emit('close-branch');
}

// ---------------------------------------------------------------------------------------
// save mode (G28 D13/D10): two sources, the dialog is the confirm step (no pre-flight endpoint
// exists for globalStashSave, same reason create mode has none), and the one thing worth showing
// up front is F14's own limitation — `git stash create` cannot include untracked files, so the
// working-tree source is spelled out as tracked-only rather than hiding the gap.
// ---------------------------------------------------------------------------------------

type SaveSource = 'workingTree' | 'entry';

const saveLabel = ref('');
const saveSource = ref<SaveSource>('workingTree');

watch(
  () => [props.saveOpen, props.saveSourceEntry] as const,
  ([isOpen, entry]) => {
    if (!isOpen && entry === undefined) return;
    saveLabel.value = '';
    // Pre-selected to "this stash entry" when opened from a stack row (D13); otherwise "this
    // working tree" — the radio itself stays changeable either way, this only sets the default.
    saveSource.value = entry !== undefined ? 'entry' : 'workingTree';
  },
);

/** F14: the working-tree source's own tracked-only limitation is spelled out whenever there is
 *  something it would actually miss, rather than unconditionally — a warning that is always true
 *  reads as noise. */
const saveHasUntracked = computed(() => (props.ops.statusSummary.value?.counts.untracked ?? 0) > 0);

const canSubmitSave = computed(
  () => saveLabel.value.trim() !== '' && !/[\r\n]/.test(saveLabel.value),
);

function cancelSave(): void {
  emit('close-save');
}

async function submitSave(): Promise<void> {
  if (!canSubmitSave.value) return;
  const sha = saveSource.value === 'entry' ? props.saveSourceEntry?.sha : undefined;
  await props.ops.runGlobalStashSave(saveLabel.value.trim(), sha);
  emit('close-save');
}

// ---------------------------------------------------------------------------------------
// popConfirm mode (OQ7: one dialog, verb and one sentence differ)
// ---------------------------------------------------------------------------------------

const pending = computed(() => props.ops.pendingStashPop.value);

function cancelPop(): void {
  props.ops.resolveStashPopDialog(false);
}

function confirmPop(): void {
  props.ops.resolveStashPopDialog(true);
}

// ---------------------------------------------------------------------------------------
// mode-dispatched title / close, for the one shared `KuiDialog`
// ---------------------------------------------------------------------------------------

const title = computed(() => {
  if (mode.value === 'create') return 'Stash changes';
  if (mode.value === 'branch') return 'Create branch from stash';
  if (mode.value === 'save') return 'Save to global stash';
  if (mode.value === 'popConfirm' && pending.value) {
    return `${pending.value.verb === 'pop' ? 'Pop' : 'Apply'} stash@{${pending.value.preflight.stashIndex}}`;
  }
  return '';
});

function onClose(): void {
  if (mode.value === 'create') cancelCreate();
  else if (mode.value === 'branch') cancelBranch();
  else if (mode.value === 'save') cancelSave();
  else if (mode.value === 'popConfirm') cancelPop();
}
</script>

<template>
  <KuiDialog :open="active" :title="title" @close="onClose">
    <template v-if="mode === 'create'">
      <label class="kv-dialog-field">
        Message (optional)
        <input type="text" v-model="message" autofocus placeholder="git's own WIP message" />
      </label>
      <label class="kv-dialog-field kv-dialog-field--inline">
        <input type="checkbox" v-model="includeUntracked" />
        Include untracked files (<code>-u</code>)
      </label>
      <label class="kv-dialog-field kv-dialog-field--inline">
        <input type="checkbox" v-model="keepIndex" />
        Keep staged changes staged (<code>--keep-index</code>)
      </label>
      <p v-if="pathspec.length > 0" class="kv-dialog-note">
        Only {{ pathspec.length }} selected file{{ pathspec.length === 1 ? '' : 's' }} will be
        stashed, not the whole working tree.
      </p>
    </template>

    <template v-else-if="mode === 'branch'">
      <p class="kv-dialog-note">
        From <code>{{ 'stash@{' + (branchTarget?.index ?? '') + '}' }}</code>:
        {{ branchTarget?.message }}
      </p>
      <label class="kv-dialog-field">
        Branch name
        <input type="text" v-model="branchName" autofocus />
      </label>
      <p v-if="branchNameLocalError" class="kv-dialog-error">{{ branchNameLocalError }}</p>
      <p v-else-if="branchPreflight?.name.error" class="kv-dialog-error">
        {{ branchPreflight.name.error }}
      </p>
      <div v-if="branchPreflight?.verdict === 'blocked'" class="kv-stash-prediction">
        <p>
          The branch will be created, but switching to it will not be clean — your working tree
          has changes that would be overwritten. You will stay on your current branch until you
          resolve that yourself.
        </p>
      </div>
    </template>

    <template v-else-if="mode === 'save'">
      <label class="kv-dialog-field">
        Label
        <input type="text" v-model="saveLabel" autofocus />
      </label>
      <fieldset class="kv-dialog-field">
        <legend>Source</legend>
        <label class="kv-dialog-field--inline">
          <input type="radio" value="workingTree" v-model="saveSource" />
          This working tree
        </label>
        <p v-if="saveSource === 'workingTree' && saveHasUntracked" class="kv-dialog-note">
          Untracked files will not be included — <code>git stash create</code> cannot save them.
          Promote an existing stash entry that already includes them instead if you need to keep
          those too.
        </p>
        <label v-if="saveSourceEntry" class="kv-dialog-field--inline">
          <input type="radio" value="entry" v-model="saveSource" />
          This stash entry: {{ stashLabel(saveSourceEntry) }}
        </label>
      </fieldset>
      <p class="kv-dialog-note">The source is copied — it is never removed or dropped.</p>
    </template>

    <template v-else-if="mode === 'popConfirm' && pending">
      <template v-for="blocker in pending.preflight.blockers" :key="blocker.kind">
        <div
          v-if="blocker.kind === 'untrackedCollision'"
          class="kv-stash-prediction kv-stash-prediction--conflict"
        >
          <p>These untracked files already exist in your working tree and would be overwritten:</p>
          <ul class="kv-dialog-file-list">
            <li v-for="path in blocker.paths" :key="path"><code>{{ path }}</code></li>
          </ul>
          <p>Remedy: move or remove them yourself, or discard them and try again.</p>
        </div>
        <div
          v-else-if="blocker.kind === 'localChangesWouldBeOverwritten'"
          class="kv-stash-prediction kv-stash-prediction--conflict"
        >
          <p>Your uncommitted changes to these files would be overwritten:</p>
          <ul class="kv-dialog-file-list">
            <li v-for="path in blocker.paths" :key="path"><code>{{ path }}</code></li>
          </ul>
          <p>Remedy: commit or discard those changes first.</p>
        </div>
        <div v-else class="kv-stash-prediction kv-stash-prediction--conflict">
          <p>An operation is already in progress — finish or abort it first.</p>
        </div>
      </template>

      <template v-if="pending.preflight.blockers.length === 0">
        <div
          v-if="pending.preflight.prediction.kind === 'clean'"
          class="kv-stash-prediction kv-stash-prediction--clean"
        >
          No conflicts predicted.
        </div>
        <div
          v-else-if="pending.preflight.prediction.kind === 'conflicts'"
          class="kv-stash-prediction kv-stash-prediction--conflict"
        >
          <p>This will likely conflict in:</p>
          <ul class="kv-dialog-file-list">
            <li v-for="path in pending.preflight.prediction.paths" :key="path">
              <code>{{ path }}</code>
            </li>
          </ul>
          <p>
            Your stash stays in the list either way{{
              pending.verb === 'pop' ? ' if this conflicts' : ''
            }}
            — nothing is lost.
          </p>
        </div>
        <div v-else class="kv-stash-prediction">
          Couldn't predict the outcome: {{ pending.preflight.prediction.reason }}
        </div>
      </template>
    </template>

    <template #actions>
      <template v-if="mode === 'create'">
        <KuiButton variant="primary" @click="submitCreate">Stash</KuiButton>
        <KuiButton @click="cancelCreate">Cancel</KuiButton>
      </template>
      <template v-else-if="mode === 'branch'">
        <KuiButton variant="primary" :disabled="!canSubmitBranch" @click="submitBranch">
          Create branch
        </KuiButton>
        <KuiButton @click="cancelBranch">Cancel</KuiButton>
      </template>
      <template v-else-if="mode === 'save'">
        <KuiButton variant="primary" :disabled="!canSubmitSave" @click="submitSave">Save</KuiButton>
        <KuiButton @click="cancelSave">Cancel</KuiButton>
      </template>
      <template v-else-if="mode === 'popConfirm' && pending">
        <KuiButton variant="primary" @click="confirmPop">
          {{ pending.preflight.verdict === 'blocked' ? 'Force ' : '' }}{{
            pending.verb === 'pop' ? 'Pop' : 'Apply'
          }}
          anyway
        </KuiButton>
        <KuiButton @click="cancelPop">Cancel</KuiButton>
      </template>
    </template>
  </KuiDialog>
</template>

<style scoped>
.kv-dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
  margin: var(--kv-s-2) 0;
}

.kv-dialog-field--inline {
  flex-direction: row;
  align-items: center;
}

.kv-dialog-field input[type='text'] {
  padding: var(--kv-s-1) var(--kv-s-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
}

.kv-dialog-note {
  color: var(--kv-diff-deleted-fg);
}

.kv-dialog-error {
  color: var(--kv-diff-deleted-fg);
  margin: var(--kv-s-1) 0;
}

.kv-dialog-file-list {
  max-height: 160px;
  overflow-y: auto;
  margin: var(--kv-s-2) 0;
  padding-left: var(--kv-s-5);
  font-family: var(--kv-mono-font-family);
  font-size: 0.9em;
}

.kv-stash-prediction {
  margin: var(--kv-s-4) 0;
}

.kv-stash-prediction--clean {
  color: var(--kv-diff-added-fg);
}
</style>
