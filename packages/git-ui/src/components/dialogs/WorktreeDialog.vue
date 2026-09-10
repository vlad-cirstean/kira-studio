<script setup lang="ts">
/**
 * G25 D2-D4/D9-D14: "Create Worktree…" (`AppToolbar.vue`'s own button, and the palette's
 * `createWorktree` action) plus the prepare-script run that can immediately follow it.
 *
 * Two phases, at most one active at a time (`phase` below):
 * - **create** — the three explicit modes (D3): `existingBranch` (pick a branch already in
 *   `refs`), `newBranch` (name + start point), `detach` (a bare commit-ish). `preflight.
 *   worktreeAdd`'s own live pre-flight (D4) re-runs on every keystroke, exactly like
 *   `RevertDialog.vue`'s mainline picker re-runs `previewRevertMainline` — this dialog never lets
 *   `runWorktreeAdd` spawn against a blocked combination the user can already see is blocked.
 * - **prepare** — shown automatically right after a successful create, IFF `prepareScript` (this
 *   repository's own stored `kiraVersion.worktree.prepareScript`) is non-empty. The full script
 *   text is always shown here before it can run (D11's own "never runs anything the user has not
 *   seen"). The server's own approval record is a security-critical implementation detail this
 *   dialog structurally cannot read (D11/F15: the sha is server-only, absent from every wire
 *   shape) — so `sessionApprovedHash` tracks, PURELY CLIENT-SIDE and only for THIS webview's own
 *   lifetime, which exact script text this session has already run successfully at least once;
 *   the "Run" checkbox defaults on only when the CURRENT script's own hash matches that value,
 *   otherwise it defaults off and the user must tick it explicitly — never assuming a state this
 *   dialog cannot actually observe. Once running, output streams live (`ops.
 *   worktreePrepareOutput`) with a Cancel button; dismissing the dialog while it runs does not
 *   cancel it — `AppToolbar.vue`'s own strip takes over as the visible indicator (D13).
 */
import { validateRefName } from '@kira/git-core';
import type { WorktreeAddPreflight } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import type { RefsState } from '../../state/refs.ts';
import type { WorktreeState } from '../../state/worktrees.ts';

const props = defineProps<{
  worktrees: WorktreeState;
  ops: OpsState;
  refs: RefsState;
  /** Toggled by `AppToolbar.vue`'s "Create Worktree…" button and the `createWorktree` palette
   *  action, via `App.vue`. */
  createOpen: boolean;
  /** `kiraVersion.worktree.basePath`'s current value — pre-fills the path field's own directory
   *  (D10); pure UX, never validated as an existing directory. */
  basePathDefault: string;
  /** This repository's own stored `kiraVersion.worktree.prepareScript` — "" means the feature is
   *  off, and the prepare phase is skipped entirely after a successful create. */
  prepareScript: string;
  /** `capabilities.runPrepareScript` (D14) — VS Code's own workspace-trust gate, defence in depth.
   *  When false, the prepare phase still shows the script (transparency costs nothing) but offers
   *  no way to run it. */
  runPrepareScriptCapability: boolean;
}>();

const emit = defineEmits<(e: 'close-create') => void>();

type Phase = 'create' | 'prepare' | undefined;

const worktreeCreated = ref<string | undefined>(undefined);
const phase = computed<Phase>(() => {
  if (worktreeCreated.value !== undefined) return 'prepare';
  if (props.createOpen) return 'create';
  return undefined;
});
const active = computed(() => phase.value !== undefined);

// ---------------------------------------------------------------------------------------
// create phase
// ---------------------------------------------------------------------------------------

type Mode = 'existingBranch' | 'newBranch' | 'detach';

const path = ref('');
const mode = ref<Mode>('newBranch');
const branch = ref('');
const startPoint = ref('');
const preflight = ref<WorktreeAddPreflight | undefined>(undefined);
let previewToken = 0;

watch(
  () => props.createOpen,
  (isOpen) => {
    if (!isOpen) return;
    path.value = '';
    mode.value = 'newBranch';
    branch.value = '';
    startPoint.value = props.refs.head.value?.kind === 'branch' ? props.refs.head.value.name : '';
    preflight.value = undefined;
    worktreeCreated.value = undefined;
  },
);

/** D3's own "visible suggestion instead of relying on git's bare DWIM" — the basename of a
 *  branch/start-point name the user just typed, offered as a starting point for an EMPTY path
 *  field only, never overwriting one the user has already edited. */
watch([branch, startPoint], ([b, s]) => {
  if (path.value.trim() !== '') return;
  const suggestion = mode.value === 'existingBranch' ? b : mode.value === 'newBranch' ? b : s;
  if (suggestion.trim() === '') return;
  const base = props.basePathDefault.trim();
  path.value =
    base === '' ? suggestion.trim() : `${base.replace(/[/\\]+$/, '')}/${suggestion.trim()}`;
});

const newBranchNameError = computed(() => {
  if (mode.value !== 'newBranch' || branch.value.trim() === '') return undefined;
  const { valid, error } = validateRefName(branch.value.trim());
  return valid ? undefined : error;
});

watch([path, mode, branch, startPoint], async ([p, m, b, s]) => {
  if (p.trim() === '') {
    preflight.value = undefined;
    return;
  }
  const token = ++previewToken;
  const result = await props.worktrees.previewAdd({
    path: p.trim(),
    mode: m,
    branch: m === 'detach' ? undefined : b.trim() || undefined,
    startPoint: m === 'existingBranch' ? undefined : s.trim() || undefined,
  });
  if (token === previewToken) preflight.value = result;
});

const canSubmitCreate = computed(() => {
  if (path.value.trim() === '') return false;
  if (mode.value === 'newBranch' && (branch.value.trim() === '' || newBranchNameError.value)) {
    return false;
  }
  if (mode.value === 'existingBranch' && branch.value.trim() === '') return false;
  if (mode.value === 'detach' && startPoint.value.trim() === '') return false;
  return preflight.value !== undefined && preflight.value.verdict !== 'blocked';
});

function cancelCreate(): void {
  emit('close-create');
}

async function submitCreate(): Promise<void> {
  if (!canSubmitCreate.value) return;
  const trimmedPath = path.value.trim();
  const result = await props.ops.runWorktreeAdd({
    path: trimmedPath,
    mode: mode.value,
    branch: mode.value === 'detach' ? undefined : branch.value.trim() || undefined,
    startPoint: mode.value === 'existingBranch' ? undefined : startPoint.value.trim() || undefined,
  });
  if (!result.ok) return; // the failure is already announced (opsState.announcement) — stay open.
  if (props.prepareScript.trim() === '') {
    emit('close-create');
    return;
  }
  worktreeCreated.value = trimmedPath;
}

/** G28 D7: closes G25 §9's own named hand-forward — OFFERED, never taken automatically (unlike
 *  checkout's own D6 route): this dialog is already open, so there is a natural place to ask,
 *  and `worktree add` carries no "never blocks" promise to keep. Re-issues the SAME `worktreeAdd`
 *  op with `mode: 'detach'` and `startPoint: <that branch>` — no new op kind, no new argv. */
function detachHereBranch(): string | undefined {
  const blocker = preflight.value?.blockers.find((b) => b.kind === 'branchCheckedOutElsewhere');
  return blocker?.kind === 'branchCheckedOutElsewhere' ? blocker.branch : undefined;
}

const canOfferDetachHere = computed(
  () => (preflight.value?.routes.includes('detachHere') ?? false) && path.value.trim() !== '',
);

async function submitCreateDetached(): Promise<void> {
  const branchName = detachHereBranch();
  if (!canOfferDetachHere.value || branchName === undefined) return;
  const trimmedPath = path.value.trim();
  const result = await props.ops.runWorktreeAdd({
    path: trimmedPath,
    mode: 'detach',
    branch: undefined,
    startPoint: branchName,
  });
  if (!result.ok) return;
  if (props.prepareScript.trim() === '') {
    emit('close-create');
    return;
  }
  worktreeCreated.value = trimmedPath;
}

// ---------------------------------------------------------------------------------------
// prepare phase (D9-D14)
// ---------------------------------------------------------------------------------------

/** Purely client-side, purely this session's own memory (this file's own doc comment above) —
 *  never persisted, never read from or written to any server-side state. */
const sessionApprovedHash = ref<string | undefined>(undefined);
const scriptHash = ref<string | undefined>(undefined);
const runChecked = ref(false);
const started = ref(false);

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

watch(worktreeCreated, async (createdPath) => {
  if (createdPath === undefined) {
    started.value = false;
    scriptHash.value = undefined;
    return;
  }
  const hash = await sha256Hex(props.prepareScript);
  scriptHash.value = hash;
  runChecked.value = props.runPrepareScriptCapability && sessionApprovedHash.value === hash;
});

const preparing = computed(
  () => props.ops.activeWorktreePreparePath.value === worktreeCreated.value,
);
const prepareResult = computed(() => props.ops.worktreePrepareResult.value);

async function startPrepare(): Promise<void> {
  const createdPath = worktreeCreated.value;
  const hash = scriptHash.value;
  if (createdPath === undefined || hash === undefined || !runChecked.value) return;
  started.value = true;
  const result = await props.ops.runWorktreePrepare(createdPath, hash);
  if (result?.ok) sessionApprovedHash.value = hash;
}

function cancelPrepare(): void {
  void props.ops.cancelWorktreePrepare();
}

function skipPrepare(): void {
  emit('close-create');
}

function finishPrepare(): void {
  emit('close-create');
}

const title = computed(() => {
  if (phase.value === 'create') return 'Create worktree';
  if (phase.value === 'prepare') return 'Run prepare script';
  return '';
});

function onClose(): void {
  if (phase.value === 'create') cancelCreate();
  // Dismissing during 'prepare' — running or not — never cancels the script (this file's own doc
  // comment above); it just closes the dialog, same as clicking through it normally.
  else emit('close-create');
}
</script>

<template>
  <KuiDialog :open="active" :title="title" @close="onClose">
    <template v-if="phase === 'create'">
      <label class="kv-dialog-field">
        Path
        <input type="text" v-model="path" autofocus placeholder="../my-repo-feature-x" />
      </label>
      <fieldset class="kv-dialog-field">
        <legend>Start from</legend>
        <label class="kv-dialog-field--inline">
          <input type="radio" value="existingBranch" v-model="mode" />
          An existing branch
        </label>
        <label class="kv-dialog-field--inline">
          <input type="radio" value="newBranch" v-model="mode" />
          A new branch
        </label>
        <label class="kv-dialog-field--inline">
          <input type="radio" value="detach" v-model="mode" />
          Detached (no branch)
        </label>
      </fieldset>

      <label v-if="mode === 'existingBranch'" class="kv-dialog-field">
        Branch
        <input type="text" v-model="branch" list="kv-worktree-branches" placeholder="branch name" />
        <datalist id="kv-worktree-branches">
          <option v-for="row in refs.branches.value" :key="row.refname" :value="row.shortName" />
        </datalist>
      </label>
      <template v-else-if="mode === 'newBranch'">
        <label class="kv-dialog-field">
          New branch name
          <input type="text" v-model="branch" placeholder="feature/x" />
        </label>
        <p v-if="newBranchNameError" class="kv-dialog-error">{{ newBranchNameError }}</p>
        <label class="kv-dialog-field">
          Start point
          <input type="text" v-model="startPoint" placeholder="main" />
        </label>
      </template>
      <label v-else class="kv-dialog-field">
        Commit-ish
        <input type="text" v-model="startPoint" placeholder="a branch, tag or sha" />
      </label>

      <template v-if="preflight">
        <p v-for="blocker in preflight.blockers" :key="blocker.kind" class="kv-dialog-error">
          <template v-if="blocker.kind === 'invalidPath'">The path is invalid.</template>
          <template v-else-if="blocker.kind === 'pathExists'">
            <code>{{ blocker.path }}</code> already exists.
          </template>
          <template v-else-if="blocker.kind === 'branchCheckedOutElsewhere'">
            <code>{{ blocker.branch }}</code> is already checked out at
            <code>{{ blocker.worktreePath }}</code>.
          </template>
          <template v-else-if="blocker.kind === 'branchExists'">
            A branch named <code>{{ blocker.branch }}</code> already exists.
          </template>
          <template v-else-if="blocker.kind === 'unknownStartPoint'">
            <code>{{ blocker.startPoint }}</code> does not resolve to a commit.
          </template>
        </p>
        <p v-if="canOfferDetachHere" class="kv-dialog-note">
          The new worktree will start with a detached HEAD.
          <KuiButton @click="submitCreateDetached">
            Create it detached at that branch's commit
          </KuiButton>
        </p>
        <p v-for="note in preflight.notes" :key="note.kind" class="kv-dialog-note">
          <template v-if="note.kind === 'pathInsideRepo'">
            This path is inside the current repository.
          </template>
          <template v-else-if="note.kind === 'parentDirectoryMissing'">
            The parent directory will be created.
          </template>
          <template v-else-if="note.kind === 'detachedHead'">
            The new worktree will start with a detached HEAD.
          </template>
        </p>
      </template>
    </template>

    <template v-else-if="phase === 'prepare'">
      <p class="kv-dialog-note">Worktree created at <code>{{ worktreeCreated }}</code>.</p>
      <template v-if="!started">
        <p>This repository has a prepare script:</p>
        <pre class="kv-worktree-script">{{ prepareScript }}</pre>
        <p v-if="!runPrepareScriptCapability" class="kv-dialog-error">
          Running scripts is disabled in this workspace (untrusted).
        </p>
        <label v-else class="kv-dialog-field--inline">
          <input type="checkbox" v-model="runChecked" />
          Run this script now, as your own shell, with your own permissions
        </label>
      </template>
      <template v-else>
        <pre class="kv-worktree-output"><span
          v-for="(line, i) in ops.worktreePrepareOutput.value"
          :key="i"
          :class="{ 'kv-worktree-output-stderr': line.stream === 'stderr' }"
        >{{ line.text }}
</span></pre>
        <p v-if="prepareResult && !preparing">
          <template v-if="prepareResult.ok">Finished successfully.</template>
          <template v-else-if="prepareResult.cancelled">Cancelled.</template>
          <template v-else-if="prepareResult.timedOut">Timed out.</template>
          <template v-else>Exited with status {{ prepareResult.exitCode }}.</template>
        </p>
      </template>
    </template>

    <template #actions>
      <template v-if="phase === 'create'">
        <KuiButton variant="primary" :disabled="!canSubmitCreate" @click="submitCreate">
          Create
        </KuiButton>
        <KuiButton @click="cancelCreate">Cancel</KuiButton>
      </template>
      <template v-else-if="phase === 'prepare' && !started">
        <KuiButton
          variant="primary"
          :disabled="!runChecked || !runPrepareScriptCapability"
          @click="startPrepare"
        >
          Run
        </KuiButton>
        <KuiButton @click="skipPrepare">Skip</KuiButton>
      </template>
      <template v-else-if="phase === 'prepare' && preparing">
        <KuiButton @click="cancelPrepare">Cancel</KuiButton>
      </template>
      <template v-else-if="phase === 'prepare'">
        <KuiButton variant="primary" @click="finishPrepare">Close</KuiButton>
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
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--kv-s-1);
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

.kv-worktree-script,
.kv-worktree-output {
  max-height: 240px;
  overflow-y: auto;
  padding: var(--kv-s-2);
  background: var(--kv-panel-bg);
  border: 1px solid var(--kv-panel-border);
  font-family: var(--kv-mono-font-family);
  font-size: 0.85em;
  white-space: pre-wrap;
  word-break: break-all;
}

.kv-worktree-output-stderr {
  color: var(--kv-diff-deleted-fg);
}
</style>
