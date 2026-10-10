<script setup lang="ts">
/**
 * §6.2's toolbar: `[repo ▾] [branch ▾] │ ⟳ │ Fetch Pull Push │ Stash ▾ │ ⚙`. P4 built only the
 * first and third groups; P6 (W13/W17) adds the second — the branch/tag picker — and the undo
 * affordance, since both need P6's ref list and op executor. `docs/plans/P8.md` W17 adds the
 * fetch/pull/push group itself; the trailing `⚙` is a settings gear (G18 D13): the gear opens
 * `App.vue`'s own `RepoSettingsDialog.vue`, this toolbar owning no dialog state of its own
 * (`open-repo-settings` emit), the same shape `stash-changes` already follows.
 *
 * `docs/plans/P11.md` W14 originally added a fifth slot here, `SearchBox.vue`, crammed into this
 * same row. G-UX D9 (item 9) moves it out entirely — a row of its own, below the toolbar,
 * toggled rather than always rendered (`App.vue` owns it now, alongside `AppToolbar`, not this
 * component).
 *
 * Chrome: `ViewToolbar` (the app's bar height, border and padding), Kira's radius and shadow tiers.
 *
 * There is no `remotes.list` endpoint (P6/P8 both skip it, per `rowMenuModel.ts`'s own
 * `remoteNamesFrom` doc comment) and remote *management* is out of scope entirely (§10's scope
 * table), so this toolbar reads remote names from whatever remote-tracking branches already
 * loaded and targets the current branch's upstream remote, else `origin`, else the first name —
 * `defaultRemote` below. Fetch/Pull/Push are simply absent (not disabled) when no remote is
 * known at all: there is nothing to name in the tooltip and no useful default to pick.
 */
import type { StashEntry } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, ref } from 'vue';
import type { MenuSection } from '../lib/menuModel.ts';
import type { DetailActions } from '../state/detailActions.ts';
import type { GraphViewState } from '../state/graphView.ts';
import { composeAutoFetchStoppedText } from '../state/liveAnnouncements.ts';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import type { RefsState } from '../state/refs.ts';
import type { RepoState } from '../state/repo.ts';
import type { StackState } from '../state/stack.ts';
import type { StashState } from '../state/stash.ts';
import type { WorktreeCreateSeed, WorktreeState } from '../state/worktrees.ts';
// Plain (not `import type`) imports, for two different reasons. BranchPicker: vue-tsc needs the
// real import to infer the template's inline @branch-from-stash handler's parameter type from
// BranchPicker's own emits declaration — a type-only import here breaks that inference (TS7006).
// PullStrategyPicker and RefreshButton: a .vue default export is a *value* — the component object
// the template instantiates. `import type` erases it, and Vue then renders the tag as an unknown
// element with nothing inside it (G14 F1/F3). The script's only reference to RefreshButton is
// `InstanceType<typeof …>`, so biome's useImportType cannot tell (it is off for `**/*.vue` in
// `biome.json` for exactly this class of false positive, P96 §5.2); the template is the real
// caller.
import BranchPicker from './BranchPicker.vue';
import MenuSections from './MenuSections.vue';
import PullStrategyPicker from './PullStrategyPicker.vue';
import type { PickerTab } from './pickerModel.ts';
import RefreshButton from './RefreshButton.vue';
import { defaultRemoteFor, remoteNamesFrom } from './rowMenuModel.ts';
import UndoButton from './UndoButton.vue';

const props = defineProps<{
  graphView: GraphViewState;
  repoState: RepoState;
  refsState: RefsState;
  opsState: OpsState;
  stashState: StashState;
  worktreeState: WorktreeState;
  /** G26 D3 — see `StackList.vue`'s own doc comment. */
  stackState: StackState;
  actions: DetailActions | undefined;
  /** G24 D9: `BranchPicker.vue`'s own `#123` branch-tip badge source — optional, mirrors every
   *  other G24 prop threaded through this toolbar's own children. */
  prState?: PrState;
  /** Whether `App.vue`'s own search row is currently open — drives the toggle button's `active`
   *  state, the same `active` = "revealed" convention `ReviewView.vue`'s own filter toggle uses. */
  searchOpen: boolean;
  /** P93 §4.4/§7: whether every non-checked-out branch group collapses by default — drives the
   *  collapse-toggle button's own `active` state, same convention as `searchOpen` above. */
  collapseBranches: boolean;
  /** Routes a rejected refresh to the shared live region (`App.vue`'s `reportAsyncError`). */
  reportError: (err: unknown, prefix: string) => void;
}>();
const emit = defineEmits<{
  /** `docs/plans/P9.md` W14: opens `StashDialog.vue`'s create mode — owned by `App.vue`, exactly
   *  like `createBranchHere`/`createTagHere`'s own dialog state, since this button has no
   *  pre-flight endpoint of its own to preview first (the dialog IS the confirm step). */
  (event: 'stash-changes'): void;
  /** Forwarded straight from `BranchPicker.vue`'s own emit — see `StashList.vue`'s doc comment. */
  (event: 'branch-from-stash', entry: StashEntry): void;
  /** G28 D13: forwarded straight from `BranchPicker.vue`'s own emits — see
   *  `GlobalStashList.vue`'s/`StashList.vue`'s own doc comments. */
  (event: 'save-global-stash'): void;
  (event: 'save-entry-to-global-stash', entry: StashEntry): void;
  /** G25: forwarded straight from `BranchPicker.vue` -> `WorktreeList.vue`'s own emits — see
   *  `WorktreeList.vue`'s own doc comment on why this toolbar does not act on them itself. */
  (event: 'switch-worktree', path: string): void;
  (event: 'create-worktree', seed?: WorktreeCreateSeed): void;
  /** G26: forwarded straight from `BranchPicker.vue` -> `StackList.vue`'s own emits — `App.vue`
   *  owns `StackDialog.vue`'s actual open state, the same "toolbar owns no dialog state itself"
   *  shape every other dialog-opening emit above already follows. */
  (event: 'open-restack-dialog', branch: string): void;
  (event: 'open-set-stack-parent-dialog', branch: string): void;
  /** G18 D13: the settings gear (`⚙`) this toolbar's own ascii layout has named since §6.2 but no
   *  phase implemented until now — opens `App.vue`'s own `RepoSettingsDialog.vue`, the same
   *  "toolbar owns no dialog state itself" shape `stash-changes` above already follows. */
  (event: 'open-repo-settings'): void;
  /** Toggles `App.vue`'s own search row (`toggleSearchRow`) — the toolbar owns no search state of
   *  its own, the same "emit, don't own" shape every other dialog/panel-toggling emit above
   *  already follows. */
  (event: 'toggle-search'): void;
  /** P93 §4.4/§7: toggles `App.vue`'s own `collapseBranches` preference — the toolbar owns no
   *  collapse state of its own, same "emit, don't own" shape as `toggle-search` above. */
  (event: 'toggle-collapse-branches'): void;
}>();

function copy(text: string, whatCopied: string): void {
  props.actions?.copy(text, whatCopied);
}

// P74 §3.3: BranchPicker.vue's own branch-row badge and StackList.vue's own row badge each open
// a PR the same way CommitMeta.vue's facts-row icon/"Pull request" row do — one action, threaded
// down rather than reimplemented at either call site.
function openPullRequest(number: number): void {
  void props.actions?.openPullRequest({ number });
}

const refreshButtonRef = ref<InstanceType<typeof RefreshButton> | null>(null);
const branchPickerRef = ref<InstanceType<typeof BranchPicker> | null>(null);
const pullStrategyPickerRef = ref<InstanceType<typeof PullStrategyPicker> | null>(null);

// ---------------------------------------------------------------------------------------
// P8 W17: fetch/pull/push
// ---------------------------------------------------------------------------------------

const defaultRemote = computed(() =>
  defaultRemoteFor(
    remoteNamesFrom(props.refsState.remoteBranches.value.map((row) => row.shortName)),
    props.refsState.branches.value.find((row) => row.isHead)?.upstream,
  ),
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

const autoFetchStopped = computed(() => props.opsState.autoFetch.value);
const autoFetchTooltip = computed(() => {
  const stopped = autoFetchStopped.value;
  if (stopped === null) return '';
  return `${composeAutoFetchStoppedText(stopped.kind)} — Fetch to resume.`;
});

async function onAutoFetchMarkerClick(): Promise<void> {
  if (hasRemote.value && !fetchDisabled.value) await doFetch();
}

const isForcePushMenuOpen = ref(false);

// G34 D8: driving `MenuSections` — today, one item. `danger: true` is the same visual treatment
// `variant="destructive"` gives the DropdownMenuItem row it replaces.
const pushMenuSections: readonly MenuSection[] = [
  {
    items: [
      {
        id: 'force-push-trigger',
        label: 'Force push…',
        disabled: false,
        disabledReason: undefined,
        danger: true,
      },
    ],
  },
];

function onPushMenuSelect(id: string): void {
  if (id === 'force-push-trigger') void doForcePush();
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
  openBranchPicker: (tab?: PickerTab) => branchPickerRef.value?.open(tab),
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
  <ViewToolbar role="toolbar" aria-label="Kira Space toolbar">
    <BranchPicker
      ref="branchPickerRef"
      :refs="refsState"
      :ops="opsState"
      :stash="stashState"
      :worktrees="worktreeState"
      :stack="stackState"
      :pr="prState"
      :open-pull-request="openPullRequest"
      @branch-from-stash="(entry) => emit('branch-from-stash', entry)"
      @save-global-stash="emit('save-global-stash')"
      @save-entry-to-global-stash="(entry) => emit('save-entry-to-global-stash', entry)"
      @switch-worktree="(path) => emit('switch-worktree', path)"
      @create-worktree="(seed) => emit('create-worktree', seed)"
      @open-restack-dialog="(branch) => emit('open-restack-dialog', branch)"
      @open-set-stack-parent-dialog="(branch) => emit('open-set-stack-parent-dialog', branch)"
    />
    <span
      v-if="stackState.restacking.value"
      class="inline-flex items-center h-control-sm px-1.5 rounded-kira-sm gap-1 text-muted-foreground text-kira-sm whitespace-nowrap"
      role="status"
      aria-live="polite"
    >
      <!-- Pre-approved spinner change (P110 I2-35, §1.4/§3.11.1): codicon's own stepped 1.5s
           spin -> Tailwind's smooth 1s `animate-spin`, the same change already made just below. -->
      <CodiconIcon name="sync" :size="13" class="animate-spin" />
      Restacking…
    </span>
    <span
      class="w-px h-3.5 self-center mx-0.5 bg-border shrink-0"
      aria-hidden="true"
    ></span>
    <RefreshButton
      ref="refreshButtonRef"
      :graph-view="graphView"
      :repo-state="repoState"
      :report-error="reportError"
    />

    <template v-if="hasRemote">
      <span
        class="w-px h-3.5 self-center mx-0.5 bg-border shrink-0"
        aria-hidden="true"
      ></span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira"
            :disabled="fetchDisabled"
            data-testid="fetch-button"
            @click="doFetch"
          >
            <CodiconIcon name="cloud-download" :size="13" />
            Fetch
          </Button>
        </TooltipTrigger>
        <TooltipContent>Fetch {{ defaultRemote }}</TooltipContent>
      </Tooltip>

      <PullStrategyPicker
        v-if="currentBranch !== undefined"
        ref="pullStrategyPickerRef"
        :ops="opsState"
        :remote="defaultRemote as string"
        :branch="currentBranch"
        :disabled="pushPullDisabled"
      />

      <div class="relative inline-flex">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira"
              class="rounded-r-none"
              :disabled="pushPullDisabled"
              data-testid="push-button"
              @click="doPush"
            >
              <CodiconIcon name="repo-push" :size="13" />
              Push
            </Button>
          </TooltipTrigger>
          <TooltipContent>Push to {{ defaultRemote }}</TooltipContent>
        </Tooltip>
        <DropdownMenu v-model:open="isForcePushMenuOpen">
          <DropdownMenuTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              class="rounded-l-none border-l-0 px-0.5"
              :disabled="pushPullDisabled"
              aria-label="Push options"
              data-testid="push-overflow-trigger"
            >
              <CodiconIcon name="chevron-down" :size="13" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-40" aria-label="Push options">
            <MenuSections :sections="pushMenuSections" @select="onPushMenuSelect" />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </template>

    <Tooltip v-if="autoFetchStopped !== null">
      <TooltipTrigger as-child>
        <Button
          variant="toolbar"
          size="kira"
          data-testid="autofetch-stopped"
          @click="onAutoFetchMarkerClick"
        >
          <CodiconIcon name="warning" :size="13" />
          Auto-fetch stopped
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ autoFetchTooltip }}</TooltipContent>
    </Tooltip>

    <span
      class="w-px h-3.5 self-center mx-0.5 bg-border shrink-0"
      aria-hidden="true"
    ></span>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="toolbar"
          size="kira"
          :disabled="stashDisabled"
          data-testid="stash-changes-button"
          @click="emit('stash-changes')"
        >
          <CodiconIcon name="inbox" :size="13" />
          Stash
        </Button>
      </TooltipTrigger>
      <TooltipContent>Stash changes</TooltipContent>
    </Tooltip>

    <span class="flex-1" aria-hidden="true"></span>

    <TooltipIconButton
      icon="list-tree"
      label="Collapse other branches"
      :aria-pressed="collapseBranches"
      class="aria-pressed:bg-field aria-pressed:text-fg"
      data-testid="graph-collapse-toggle"
      @click="emit('toggle-collapse-branches')"
    />

    <TooltipIconButton
      icon="search"
      label="Search"
      :aria-pressed="searchOpen"
      class="aria-pressed:bg-field aria-pressed:text-fg"
      data-testid="search-toggle-button"
      @click="emit('toggle-search')"
    />

    <TooltipIconButton
      icon="gear"
      label="Repository settings"
      data-testid="repo-settings-button"
      @click="emit('open-repo-settings')"
    />

    <div
      v-if="remoteBusy"
      class="inline-flex items-center h-control-sm px-1.5 rounded-kira-sm gap-1 text-muted-foreground text-kira-sm"
      data-testid="remote-progress"
    >
      <!-- Pre-approved spinner change (§1.4/§6.4): stepped 1.5s rotation -> Tailwind's smooth 1s
           `animate-spin`. -->
      <CodiconIcon name="loading" :size="13" class="animate-spin" />
      <span class="whitespace-nowrap overflow-hidden text-ellipsis max-w-65">{{ progressText }}</span>
      <TooltipIconButton
        icon="close"
        :label="cancellable ? 'Cancel' : (cancelDisabledReason ?? '')"
        :disabled="!cancellable"
        disabled-trigger
        data-testid="remote-cancel"
        @click="doCancel"
      />
    </div>

    <UndoButton
      :ops="opsState"
      :copy="copy"
    />
  </ViewToolbar>
</template>
