<script setup lang="ts">
/**
 * §6.2's toolbar: `[repo ▾] [branch ▾] │ ⟳ │ Fetch Pull Push │ Stash ▾ │ Search […] ⚙`. P4 built
 * only the first and third groups; P6 (W13/W17) adds the second — the branch/tag picker — and the
 * undo affordance, since both need P6's ref list and op executor. `docs/plans/P8.md` W17 adds the
 * fetch/pull/push group itself; `docs/plans/P11.md` W14 adds the fifth, `SearchBox.vue`, after the
 * spacer alongside the remote-progress/undo group — the ascii layout's own right-hand cluster —
 * rather than before it with Stash, reserving the trailing `⚙` slot for a settings gear no phase
 * implemented until now. G18 D13 is that phase: the gear opens `App.vue`'s own
 * `RepoSettingsDialog.vue`, this toolbar owning no dialog state of its own (`open-repo-settings`
 * emit), the same shape `stash-changes` already follows.
 *
 * Metrics match the panel title bar's, not an invented toolbar height (§6.1): 35px
 * (`--kv-toolbar-height`), square corners (`--kv-radius: 0`), no shadow.
 *
 * There is no `remotes.list` endpoint (P6/P8 both skip it, per `rowMenuModel.ts`'s own
 * `remoteNamesFrom` doc comment) and remote *management* is out of scope entirely (§10's scope
 * table), so this toolbar assumes the single-remote-per-repo shape every other P8 affordance
 * assumes and reads the remote's name from whatever remote-tracking branches already loaded —
 * `defaultRemote` below. Fetch/Pull/Push are simply absent (not disabled) when no remote is
 * known at all: there is nothing to name in the tooltip and no useful default to pick.
 */
import type { StashEntry } from '@kira/git-ipc';
import { KuiButton, KuiPopoverPanel } from '@kira/kira-ui';
import { computed, ref } from 'vue';
import type { DetailActions } from '../state/detailActions.ts';
import type { GraphViewState } from '../state/graphView.ts';
import type { OpsState } from '../state/ops.ts';
import type { RefsState } from '../state/refs.ts';
import type { RepoState } from '../state/repo.ts';
import type { SearchState } from '../state/search.ts';
import type { StashState } from '../state/stash.ts';
// Plain (not `import type`) imports, for two different reasons. BranchPicker: vue-tsc needs the
// real import to infer the template's inline @branch-from-stash handler's parameter type from
// BranchPicker's own emits declaration — a type-only import here breaks that inference (TS7006).
// PullStrategyPicker and RefreshButton: a .vue default export is a *value* — the component object
// the template instantiates. `import type` erases it, and Vue then renders the tag as an unknown
// element with nothing inside it (G14 F1/F3). The script's only reference to RefreshButton is
// `InstanceType<typeof …>`, so biome's useImportType cannot tell; the template is the real caller.
// biome-ignore lint/style/useImportType: see above
import BranchPicker from './BranchPicker.vue';
// biome-ignore lint/style/useImportType: see above
import PullStrategyPicker from './PullStrategyPicker.vue';
// biome-ignore lint/style/useImportType: the template instantiates this — see above
import RefreshButton from './RefreshButton.vue';
import RepoPicker from './RepoPicker.vue';
import { remoteNamesFrom } from './rowMenuModel.ts';
import SearchBox from './SearchBox.vue';
import type { SearchOption } from './searchResultsModel.ts';
import UndoButton from './UndoButton.vue';

const props = defineProps<{
  graphView: GraphViewState;
  repoState: RepoState;
  refsState: RefsState;
  opsState: OpsState;
  stashState: StashState;
  searchState: SearchState;
  actions: DetailActions | undefined;
}>();
const emit = defineEmits<{
  (event: 'repo-opened', repoId: string): void;
  /** `docs/plans/P9.md` W14: opens `StashDialog.vue`'s create mode — owned by `App.vue`, exactly
   *  like `createBranchHere`/`createTagHere`'s own dialog state, since this button has no
   *  pre-flight endpoint of its own to preview first (the dialog IS the confirm step). */
  (event: 'stash-changes'): void;
  /** Forwarded straight from `BranchPicker.vue`'s own emit — see `StashList.vue`'s doc comment. */
  (event: 'branch-from-stash', entry: StashEntry): void;
  /** Forwarded straight from `SearchBox.vue`'s own `select` emit — `App.vue` is where both halves
   *  of §7.8's "selecting a hit reveals and selects it" actually live (`GraphViewState.store`,
   *  `SelectionState`), neither of which this toolbar holds. */
  (event: 'search-select', option: SearchOption): void;
  /** Forwarded straight from `SearchBox.vue`'s own `focusGrid` emit (§6.6's two-stage `Escape`,
   *  second stage) — moving real DOM focus onto the grid is `App.vue`'s own `commitGridRef`. */
  (event: 'search-focus-grid'): void;
  /** G18 D13: the settings gear (`⚙`) this toolbar's own ascii layout has named since §6.2 but no
   *  phase implemented until now — opens `App.vue`'s own `RepoSettingsDialog.vue`, the same
   *  "toolbar owns no dialog state itself" shape `stash-changes` above already follows. */
  (event: 'open-repo-settings'): void;
}>();

function copy(text: string, whatCopied: string): void {
  props.actions?.copy(text, whatCopied);
}

const refreshButtonRef = ref<InstanceType<typeof RefreshButton> | null>(null);
const branchPickerRef = ref<InstanceType<typeof BranchPicker> | null>(null);
const pullStrategyPickerRef = ref<InstanceType<typeof PullStrategyPicker> | null>(null);

// ---------------------------------------------------------------------------------------
// P8 W17: fetch/pull/push
// ---------------------------------------------------------------------------------------

const defaultRemote = computed(
  () => remoteNamesFrom(props.refsState.remoteBranches.value.map((row) => row.shortName))[0],
);
const currentBranch = computed(() => props.refsState.currentBranchName.value);
const hasRemote = computed(() => defaultRemote.value !== undefined);
/** A conflicting merge/rebase (or anything else in P6's in-progress banner) blocks Pull/Push —
 *  both would touch a worktree or history that is mid-operation — but never blocks Fetch, which
 *  touches neither (§4.3/D50's own distinction, read forward into the toolbar's own gate). */
const inConflict = computed(() => props.opsState.statusSummary.value?.inProgress !== null);
const remoteBusy = computed(() => props.opsState.activeRemoteOp.value !== undefined);

const fetchDisabled = computed(() => !hasRemote.value || props.opsState.busy.value);
const pushPullDisabled = computed(
  () =>
    !hasRemote.value ||
    currentBranch.value === undefined ||
    props.opsState.busy.value ||
    inConflict.value,
);

const isForcePushMenuOpen = ref(false);

function toggleForcePushMenu(): void {
  isForcePushMenuOpen.value = !isForcePushMenuOpen.value;
}

async function doFetch(): Promise<void> {
  const remote = defaultRemote.value;
  if (remote === undefined) return;
  await props.opsState.runFetch(remote);
}

async function doPush(): Promise<void> {
  const remote = defaultRemote.value;
  const branch = currentBranch.value;
  if (remote === undefined || branch === undefined) return;
  await props.opsState.runPush(remote, branch);
}

async function doForcePush(): Promise<void> {
  isForcePushMenuOpen.value = false;
  const remote = defaultRemote.value;
  const branch = currentBranch.value;
  if (remote === undefined || branch === undefined) return;
  await props.opsState.runForcePush(remote, branch);
}

const remoteOpLabel: Record<string, string> = {
  fetch: 'Fetching',
  pull: 'Pulling',
  push: 'Pushing',
  forcePush: 'Force pushing',
  deleteRemoteBranch: 'Deleting remote branch',
};

const progressText = computed(() => {
  const kind = props.opsState.activeRemoteOp.value;
  if (kind === undefined) return '';
  const progress = props.opsState.remoteProgress.value;
  if (!progress) return `${remoteOpLabel[kind]}…`;
  const prefix = progress.remote ? 'Remote: ' : '';
  const pct = progress.percent === undefined ? '' : ` ${progress.percent}%`;
  return `${prefix}${progress.phase}${pct}`;
});

/** D50's cancellability table, read into the toolbar's own affordance: only fetch and pull's own
 *  fetch phase are killable, so the button is disabled-with-reason for the other three kinds
 *  rather than hidden — clicking it while, say, a push is in flight is a legitimate thing to try,
 *  and `remote.cancel` answers honestly (`cancelled: false`) either way (W19's own "cancel is
 *  refused mid-push" criterion). */
const cancelDisabledReason = computed(() => {
  switch (props.opsState.activeRemoteOp.value) {
    case 'fetch':
    case 'pull':
      return undefined;
    case 'push':
      return 'A push in flight cannot be cancelled — its outcome on the remote would be unknown.';
    case 'forcePush':
      return 'A force push in flight cannot be cancelled.';
    case 'deleteRemoteBranch':
      return 'This cannot be cancelled once it has started.';
    default:
      return 'Nothing is running.';
  }
});
const cancellable = computed(() => cancelDisabledReason.value === undefined);

async function doCancel(): Promise<void> {
  await props.opsState.cancelRemote();
}

// G10 D17/F15: forwarded so App.vue's palette dispatcher can drive the same affordances a click
// already does — one implementation, reached from two inputs, exactly like `refresh` above. Each
// is a one-line delegation to a handler this file already has, or to a nested component's own
// `defineExpose`.
defineExpose({
  refresh: () => refreshButtonRef.value?.refresh(),
  openBranchPicker: () => branchPickerRef.value?.open(),
  fetch: doFetch,
  pull: () => pullStrategyPickerRef.value?.run(),
  push: doPush,
  forcePush: doForcePush,
  cancelRemote: doCancel,
});

/** §7.6/W14: "enabled from `StatusSummary`'s dirty flag" — `isClean` rather than a `dirtyPaths`
 *  length check, since the summary is the same object every other toolbar gate already reads. */
const stashDisabled = computed(
  () => (props.opsState.statusSummary.value?.isClean ?? true) || props.opsState.busy.value,
);
</script>

<template>
  <!-- W14 (axe `aria-allowed-role`): `role="toolbar"` is not among the roles the ARIA spec
       allows overriding a `<header>`'s own implicit "banner" role with — a plain `<div>` carries
       no implicit role of its own to conflict with the explicit one, which is all this element
       ever wanted (§6.2's own layout, not a page banner). -->
  <div class="kv-toolbar" role="toolbar" aria-label="Kira Version toolbar">
    <RepoPicker :repo-state="repoState" @repo-opened="(repoId) => emit('repo-opened', repoId)" />
    <BranchPicker
      ref="branchPickerRef"
      :refs="refsState"
      :ops="opsState"
      :stash="stashState"
      @branch-from-stash="(entry) => emit('branch-from-stash', entry)"
    />
    <span class="kv-toolbar-separator" aria-hidden="true"></span>
    <RefreshButton ref="refreshButtonRef" :graph-view="graphView" :repo-state="repoState" />

    <template v-if="hasRemote">
      <span class="kv-toolbar-separator" aria-hidden="true"></span>
      <KuiButton
        icon="codicon-cloud-download"
        :disabled="fetchDisabled"
        v-kui-tooltip="`Fetch ${defaultRemote}`"
        data-testid="fetch-button"
        @click="doFetch"
      >
        Fetch
      </KuiButton>

      <PullStrategyPicker
        v-if="currentBranch !== undefined"
        ref="pullStrategyPickerRef"
        :ops="opsState"
        :remote="defaultRemote as string"
        :branch="currentBranch"
        :disabled="pushPullDisabled"
      />

      <div class="kv-push-group">
        <KuiButton
          icon="codicon-repo-push"
          class="kv-push-main"
          :disabled="pushPullDisabled"
          v-kui-tooltip="`Push to ${defaultRemote}`"
          data-testid="push-button"
          @click="doPush"
        >
          Push
        </KuiButton>
        <KuiButton
          icon="codicon-chevron-down"
          class="kv-push-chevron"
          :disabled="pushPullDisabled"
          aria-label="Push options"
          :aria-expanded="isForcePushMenuOpen"
          data-testid="push-overflow-trigger"
          @click="toggleForcePushMenu"
        />
        <KuiPopoverPanel
          v-if="isForcePushMenuOpen"
          anchor="right"
          :width="160"
          @close="isForcePushMenuOpen = false"
        >
          <div class="kv-push-menu" role="menu" aria-label="Push options">
            <button
              type="button"
              class="kv-push-menu-item"
              role="menuitem"
              data-testid="force-push-trigger"
              @click="doForcePush"
            >
              Force push…
            </button>
          </div>
        </KuiPopoverPanel>
      </div>
    </template>

    <span class="kv-toolbar-separator" aria-hidden="true"></span>
    <KuiButton
      icon="codicon-inbox"
      :disabled="stashDisabled"
      v-kui-tooltip="'Stash changes'"
      data-testid="stash-changes-button"
      @click="emit('stash-changes')"
    >
      Stash changes…
    </KuiButton>

    <span class="kv-toolbar-spacer" aria-hidden="true"></span>

    <SearchBox
      :search="searchState"
      @select="(option) => emit('search-select', option)"
      @focus-grid="emit('search-focus-grid')"
    />

    <button
      type="button"
      class="kv-icon-button"
      v-kui-tooltip="'Repository settings'"
      aria-label="Repository settings"
      data-testid="repo-settings-button"
      @click="emit('open-repo-settings')"
    >
      <span class="codicon codicon-gear" aria-hidden="true"></span>
    </button>

    <div v-if="remoteBusy" class="kv-remote-progress" data-testid="remote-progress">
      <span class="codicon codicon-loading kv-remote-progress-spin" aria-hidden="true"></span>
      <span class="kv-remote-progress-label">{{ progressText }}</span>
      <button
        type="button"
        class="kv-icon-button"
        :disabled="!cancellable"
        v-kui-tooltip="cancellable ? 'Cancel' : cancelDisabledReason"
        data-testid="remote-cancel"
        @click="doCancel"
      >
        <span class="codicon codicon-close" aria-hidden="true"></span>
      </button>
    </div>

    <UndoButton :ops="opsState" :clipboard-enabled="actions?.capabilities.clipboard ?? false" :copy="copy" />
  </div>
</template>

<style>
.kv-toolbar {
  display: flex;
  align-items: center;
  gap: var(--kv-space-2);
  height: var(--kv-toolbar-height);
  padding: 0 var(--kv-space-3);
  background-color: var(--kv-toolbar-bg);
  border-bottom: 1px solid var(--kv-toolbar-border);
  flex-shrink: 0;
}

.kv-toolbar-separator {
  width: 1px;
  align-self: stretch;
  margin: var(--kv-space-2) 0;
  background-color: var(--kv-toolbar-border);
}

.kv-toolbar-spacer {
  flex: 1;
}

/* G19 D3a: the toolbar-button look now comes from @kira/kira-ui's own KuiButton (theme/
   controls.css's `.kui-button`, via this host's kui-bridge.css) — the duplicated
   `.kv-toolbar-button` rule that used to live here *and* in `PullStrategyPicker.vue` is closed at
   its source, not restyled around. `.kv-push-main`/`.kv-push-chevron` below only add the split-
   button corner radii KuiButton has no opinion about. */
.kv-push-group {
  position: relative;
  display: inline-flex;
}

.kv-push-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.kv-push-chevron {
  padding: 0 var(--kv-space-1);
  border-left: none;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

/* G20 D5: positioning/chrome move onto KuiPopoverPanel's own `.kui-popover`. */
.kv-push-menu {
  padding: var(--kv-space-1);
}

.kv-push-menu-item {
  display: block;
  width: 100%;
  padding: var(--kv-space-1) var(--kv-space-2);
  background: transparent;
  color: var(--kv-diff-deleted-fg);
  border: none;
  border-radius: var(--kv-radius);
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
}

.kv-push-menu-item:hover {
  background-color: var(--kv-row-hover-bg);
}

/* The one in-webview progress affordance for whichever `remote.run` is in flight (P6 judgment
   call 6's precedent — no `Notifications` port, D54) — a phase label, throttled to ~10/s
   host-side (OQ10), and the one cancel button every remote op shares, D50's table read forward
   into "enabled" vs "disabled-with-reason". */
.kv-remote-progress {
  display: inline-flex;
  align-items: center;
  gap: var(--kv-space-2);
  padding: 0 var(--kv-space-2);
  color: var(--kv-description-fg);
  font-size: 0.9em;
}

.kv-remote-progress-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.kv-remote-progress-spin {
  display: inline-block;
  animation: kv-remote-progress-spin 1.5s steps(30) infinite;
}

@keyframes kv-remote-progress-spin {
  100% {
    transform: rotate(360deg);
  }
}
</style>
