<script setup lang="ts">
/**
 * `docs/plans/P7.md` W11 — the sidebar view's whole root, mounted by `main.ts` in place of
 * `App.vue` when `view === "review"` (§6.8/D41: same bundle, a different root, selected from the
 * host's own injected initial state). Five real states, never a blank panel: no branch, ask for a
 * base, unrelated histories, nothing to review, and the list — plus two states the plan's own text
 * does not name but a real host can reach: `"resolving"` (a brief request in flight) and
 * `"error"` (`review.resolveBase` itself failed — a genuine transport/host error, not one of
 * §6.8's four *answers*, still needs a real rendering rather than nothing at all).
 *
 * `NullViewStateStore` (W9) is what the mount call site hands this component's `viewState` prop —
 * accepted here only because `AppRoot` and `ReviewView` share one `MountOptions` shape; this
 * component never reads or writes it (§6.8: "the view persists nothing at all").
 *
 * How the view learns which branch to review (D40's three arms, all handled here):
 * 1. `props.target` — the cold-bootstrap arm, read once at mount from `html.ts`'s bootstrap
 *    island (a `review.open`/the palette command revealed a *new* webview with a target already
 *    pending).
 * 2. The `review.target` event — pushed to an *already-open* view by the same `review.open` call,
 *    or by the palette command's own `reviewBranch(repoId, undefined)` — handled for the whole
 *    life of this component, not just at mount.
 * 3. The "no branch" state's own branch picker — the user picks one directly, no host round trip.
 */
import { SETTINGS } from '@kira/git-core';
import type { ReviewSessionSnapshot, Transport, UiActionKind } from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { cn } from '@theme/lib/utils';
import { useEventListener } from '@vueuse/core';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/util/virtualRows';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { BridgeClient } from '../../bridge/client.ts';
import { ACTION_ICONS, codiconName } from '../../icons/index.ts';
import { retryBootstrap as sharedRetryBootstrap } from '../../state/bootstrap.ts';
import { copyToClipboard } from '../../state/clipboardActions.ts';
import type { FileListMode } from '../../state/detail.ts';
import type { DetailActions } from '../../state/detailActions.ts';
import { RefsState } from '../../state/refs.ts';
import { type ReviewPane, ReviewSessionState, type ReviewTarget } from '../../state/review.ts';
import { ReviewCommentsState } from '../../state/reviewComments.ts';
import { ReviewFilesState } from '../../state/reviewFiles.ts';
import type { ViewStateStore } from '../../state/viewState.ts';
import GitViewHead, { type RepoHead } from '../GitViewHead.vue';
import { buildRefListSections } from '../refListModel.ts';
import { useLiveRegion } from '../useLiveRegion.ts';
import BaseSelector from './BaseSelector.vue';
import ReviewCommentsPane from './ReviewCommentsPane.vue';
import ReviewCommitRow from './ReviewCommitRow.vue';
import ReviewFilesPane from './ReviewFilesPane.vue';

const props = defineProps<{
  transport: Transport;
  viewState: ViewStateStore;
  target?: ReviewTarget | null;
  reviewFilter?: 'all' | 'needsReview';
  onReviewMarked?: (path: string) => void;
  repoHead?: RepoHead;
}>();

const bridge = new BridgeClient(props.transport);
const connectionState = bridge.connectionState;
const refsState = new RefsState(bridge);
const review = shallowRef<ReviewSessionState | undefined>(undefined);
const reviewFiles = shallowRef<ReviewFilesState | undefined>(undefined);
const reviewComments = shallowRef<ReviewCommentsState | undefined>(undefined);
// P108 F12: this instance's own root, so a document-level handler below can tell a key/click that
// landed inside it from one that landed in a sibling mount (a graph tab, another review sidebar).
const rootEl = useTemplateRef<HTMLElement>('rootEl');
const repoId = ref<string | undefined>(undefined);
const noActiveRepo = ref(false);
// G12 D6: same treatment as App.vue's own bootError — "Loading…" forever is not an acceptable
// rendering of a failed bootstrap() (F7).
const bootError = ref<string | undefined>(undefined);

watch(repoId, (id) => refsState.setRepoId(id));

let unsubscribeTarget: (() => void) | undefined;
let unsubscribeUiAction: (() => void) | undefined;

// P108 F6: one target-sequence token, bumped by every `applyTarget` call — the one place every
// "which repoId/branch is this view now reviewing" transition funnels through (a `review.target`
// push, a user's own branch/base pick, `recompare`, `resumeSession`, cold bootstrap). Each
// caller that applies further state after its own additional awaits (`setBase`, `setPane`,
// `listMode`/`filter`/`diffMode` restores) captures the token `applyTarget` returns and re-checks
// it before every one of those later writes, skipping any whose token has gone stale — a newer
// target already superseded it, so an older override base/pane/filter must not land on top of
// the newer target's own state. Mirrors `GraphViewState`'s own `#loadGeneration` (Part 18 F1) /
// `RepoState`'s own open-sequence token (P108 F4) for the identical shape.
let targetSequence = 0;

/** P108 F10: `main.ts` sets no `app.config.errorHandler`, so a `void`-called (or unawaited) async
 *  operation that rejects becomes a silent, unhandled rejection. Every fire-and-forget call in
 *  this file routes its own rejection through this, into the same live region this file's other
 *  `announce(...)` calls already drive. `transport-closed` (the one code
 *  `bridge.dispose()` itself produces, this file's own `onBeforeUnmount`) is ignored outright —
 *  this view is already gone by the time it lands, so there is nothing left to announce it to. */
const { text: liveAnnouncement, announce } = useLiveRegion();

function reportAsyncError(err: unknown, prefix: string): void {
  if (err instanceof TransportError && err.code === 'transport-closed') return;
  announce(`${prefix} — ${err instanceof Error ? err.message : String(err)}`);
}

async function applyTarget(
  nextRepoId: string,
  branch: string,
  open?: { readonly base?: string; readonly pane?: ReviewPane },
): Promise<number> {
  const token = ++targetSequence;
  repoId.value = nextRepoId;
  await review.value?.setTarget(nextRepoId, branch, open);
  return token;
}

/** Re-runs `setTarget` against the same branch: re-resolves the base and re-streams the range from
 *  scratch. A manually-chosen base (an `'override'` resolution) is re-applied after, mirroring
 *  `resumeSession`'s own `baseOverride` restore. `repoId` itself is unchanged, so `refsState`'s own
 *  `watch(repoId, ...)` above never re-fires on its own — re-seeded explicitly here, same as
 *  `App.vue`'s `applyRepoIdToStates`. A no-op with no review target open yet. */
async function recompare(): Promise<void> {
  const id = repoId.value;
  const branch = review.value?.branch.value;
  if (!id || !branch) return;
  const overrideBase =
    review.value?.resolution.value?.reason === 'override'
      ? review.value.resolution.value.base
      : undefined;
  const token = await applyTarget(id, branch);
  // P108 F6: a `review.target` push (or another recompare) landed during `applyTarget`'s own
  // await — that newer target already owns `review`/`repoId` now; applying this stale override
  // base or re-seeding `refsState` with this call's own (now old) `id` would stomp on it.
  if (token !== targetSequence) return;
  if (overrideBase) await review.value?.setBase(overrideBase);
  if (token !== targetSequence) return;
  refsState.setRepoId(id);
}

function retryCompare(): void {
  recompare().catch((err: unknown) => reportAsyncError(err, "Couldn't compare"));
}

async function bootstrap(): Promise<void> {
  // P108 F7: a retry re-enters here after an earlier run already subscribed and constructed
  // states — unsubscribe and dispose that run's own before replacing them, so a failed run never
  // leaves a `review.target`/`ui.action` handler firing twice, or a state object leaking
  // its own subscription forever.
  unsubscribeTarget?.();
  unsubscribeUiAction?.();
  review.value?.dispose();
  reviewFiles.value?.dispose();
  reviewComments.value?.dispose();

  await bridge.init();
  review.value = new ReviewSessionState(bridge);
  reviewFiles.value = new ReviewFilesState(bridge);
  reviewFiles.value.onMarked = (path) => props.onReviewMarked?.(path);
  reviewComments.value = new ReviewCommentsState(bridge);

  unsubscribeTarget = bridge.on('review.target', (event) => {
    applyTarget(event.repoId, event.branch).catch((err: unknown) =>
      reportAsyncError(err, "Couldn't switch to the pushed target"),
    );
  });
  // G11 D17: the palette's own route into this already-mounted webview — toggles the file
  // currently open in the Files pane, or announces there is none to toggle.
  unsubscribeUiAction = bridge.on('ui.action', (event) => {
    onUiAction(event.action);
  });

  if (props.target) {
    const { repoId: targetRepo, branch, base, pane } = props.target;
    await applyTarget(targetRepo, branch, { base, pane });
    return;
  }
  const list = await bridge.request('repo.list', {});
  // P108 F6: a `review.target` push can land during this await (the `bridge.on('review.target',
  // ...)` listener just above is already live) and already call `applyTarget`, setting `repoId`
  // itself — must not then clobber it with the workspace's own default active repo while
  // `review` still holds the pushed repo/branch.
  if (repoId.value !== undefined) return;
  if (list.activeRepoId) {
    repoId.value = list.activeRepoId;
    await resumeSession(list.activeRepoId);
  } else {
    noActiveRepo.value = true;
  }
}

/**
 * G19 D11b: the read half of durable persistence — its own round trip, made once `bootstrap()`
 * has a real `repoId` in hand (right here, alongside `props.target`/`review.target`'s own
 * priority, both of which still win unchanged: `props.target` already returned above, and a
 * `review.target` push that races ahead of this call already set `review.branch.value`, checked
 * again just before applying so it is never clobbered). No commit/diff data is ever restored —
 * only identifiers `setTarget`/`setBase` already re-ask fresh; a snapshot the extension host
 * judges too old (14 days) comes back as `{session: null}`, the same as never having saved one.
 */
async function resumeSession(id: string): Promise<void> {
  if (review.value?.branch.value) return;
  let loaded: { session: ReviewSessionSnapshot | null };
  try {
    loaded = await bridge.request('review.session.load', { repoId: id });
  } catch {
    return; // best-effort: a failed resume falls back to the ordinary "no branch" picker
  }
  const session = loaded.session;
  if (!session || review.value?.branch.value) return;
  const token = await applyTarget(id, session.branch);
  // P108 F6: `session.branch` was checked above the *previous* await (`review.session.load`), not
  // this one — a `review.target` push or a user's own pick during `applyTarget` itself must still
  // win over this resume's own base/pane/filter restore.
  if (token !== targetSequence) return;
  if (session.baseOverride !== null) await review.value?.setBase(session.baseOverride);
  if (token !== targetSequence) return;
  review.value?.setPane(session.pane);
  listMode.value = session.listMode;
  filter.value = session.filter;
  reviewFiles.value?.setDiffMode(session.diffMode);
}

/** G19 D11b: the write half — one `watch()` over the same fields the snapshot lists, coalesced
 *  with a trivial `queueMicrotask` (this is not a hot path). `persistSession` reads the *current*
 *  values itself rather than the watcher's own old/new arguments, so several fields changing in
 *  the same tick (e.g. `setTarget` resetting `pane` while also changing `branch`) still produce
 *  exactly one save with everything already settled. */
let sessionSaveScheduled = false;
function scheduleSessionSave(): void {
  if (sessionSaveScheduled) return;
  sessionSaveScheduled = true;
  queueMicrotask(() => {
    sessionSaveScheduled = false;
    persistSession().catch((err: unknown) => reportAsyncError(err, "Couldn't save this session"));
  });
}

async function persistSession(): Promise<void> {
  const id = repoId.value;
  const r = review.value;
  if (!id || !r?.branch.value) return;
  const session: ReviewSessionSnapshot = {
    branch: r.branch.value,
    baseOverride:
      r.resolution.value?.reason === 'override' ? (r.resolution.value.base ?? null) : null,
    pane: r.pane.value,
    listMode: listMode.value,
    filter: filter.value,
    diffMode: reviewFiles.value?.diffMode.value ?? 'sinceReview',
  };
  await bridge.request('review.session.save', { repoId: id, session });
}

/** G19 D11a (item 11): "back to branch selection" — clears the in-memory target and, since this
 *  is an explicit "go back", also clears the durable resume point (D11b), so the next cold boot
 *  never silently jumps back into a comparison the user deliberately left. */
async function goBackToSelection(): Promise<void> {
  const id = repoId.value;
  review.value?.clearTarget();
  if (id) await bridge.request('review.session.save', { repoId: id, session: null });
}

/** G19 D5 (item 5): the header's swap button. */
function onSwapBaseAndBranch(): void {
  void review.value?.swapBaseAndBranch();
}

// G19 D6 (item 6): the always-rendered filter input is now revealed by a search-icon button —
// `filterVisible` gates rendering; the button itself carries an "active" state whenever a filter
// is applied *or* revealed, so an applied-but-collapsed filter still visibly signals itself.
const filterVisible = ref(false);
// Focus is explicit: `autofocus` is a11y-linted outside modals and fires only on first render.
const toolbarFilter = useTemplateRef<{ focus: () => void }>('toolbarFilter');
watch(filterVisible, (visible) => {
  if (!visible) return;
  void nextTick(() => {
    toolbarFilter.value?.focus();
  });
});
function toggleFilterVisible(): void {
  filterVisible.value = !filterVisible.value;
}

function onUiAction(action: UiActionKind): void {
  switch (action) {
    case 'toggleFileReviewed': {
      const rf = reviewFiles.value;
      const path = rf?.selectedPath.value;
      if (!rf || path === null || path === undefined) {
        announce('Open a file in the Files tab first.');
        return;
      }
      const entry = rf.files.value.find((e) => e.change.path === path);
      const isReviewed = entry ? entry.review.kind !== 'none' : false;
      void rf.mark(path, !isReviewed);
      return;
    }
    // G13 D19: the palette's own route to the Comments pane's copy-for-AI action.
    case 'copyReviewComments':
      void reviewComments.value?.copyForAi();
      return;
    // G13 D19: pushed by the extension after an editor-side comment add/delete, so the pane
    // updates without the user switching away from it.
    case 'refreshReviewComments':
      void reviewComments.value?.reload();
      return;
    // G15 D9: pushed by the extension after an editor-side range mark, so the Files pane's
    // reviewed state doesn't sit stale until an unrelated repo.changed comes along — reuses the
    // existing 'refresh' UiActionKind rather than adding a new contract member (§11.2).
    case 'refresh':
      reviewFiles.value?.reload();
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------------------
// The Files pane's own target: kept in step with the review session's resolved (branch, base)
// rather than owned by ReviewSessionState itself (D16's "state/review.ts — one field: the pane
// the view is showing" — the file list's own request lifecycle stays here).
// ---------------------------------------------------------------------------------------
watch(
  () => {
    const r = review.value;
    if (r?.phase.value !== 'listing') return undefined;
    const base = r.resolution.value?.base;
    const branch = r.branch.value;
    const id = repoId.value;
    return id && branch && base ? { repoId: id, branch, base } : undefined;
  },
  (target) => {
    reviewFiles.value?.setTarget(target);
  },
);

// ---------------------------------------------------------------------------------------
// The Comments pane's own target (G13 D10) — repoId + branch only, no base: the session key
// review.comment.* is keyed on has none. setPane/setBase already reset the pane to 'commits', so
// this never needs its own reset logic beyond ReviewCommentsState.setTarget's own.
// ---------------------------------------------------------------------------------------
watch(
  () => {
    const r = review.value;
    if (r?.phase.value !== 'listing') return undefined;
    const branch = r.branch.value;
    const id = repoId.value;
    return id && branch ? { repoId: id, branch } : undefined;
  },
  (target) => {
    reviewComments.value?.setTarget(target);
  },
);

// D10's own "on becoming the active pane" — a plain reload against whatever target is already
// current; setTarget's own initial load (above) already covers the first activation.
watch(
  () => review.value?.pane.value,
  (pane) => {
    if (pane === 'comments') void reviewComments.value?.reload();
  },
);

function onSelectComment(path: string): void {
  reviewFiles.value?.selectFile(path);
}

// P75 §1.2: the Commits pane's own row-action bundle — a plain computed (not the raw
// `review.rowActions` ref) so the template can narrow it once, the same seam `filesActions`
// below already uses for its own `DetailActions | undefined`.
const rowActions = computed<DetailActions | undefined>(() => review.value?.rowActions.value);

// The Files pane's own actions bundle — "Open in editor"/"Go to file" are wired for real (the
// same bridge calls createDetailActions makes) but ReviewFilesPane.vue always disables both
// capabilities for its own DiffView, since neither has an honest meaning against a branch-review
// delta with no single commit sha; FileTree's own copy-path button is the one thing this bundle
// really serves here.
const filesActions = computed<DetailActions>(() => {
  return {
    copy(text, whatCopied) {
      void copyToClipboard(bridge, text, whatCopied).then((outcome) => {
        announce(outcome.message);
      });
    },
    announce,
    async openInEditor({ sha, path, originalPath, parentIndex, pinned }) {
      const repo = repoId.value;
      if (!repo) return;
      await bridge.request('editor.openDiff', {
        repoId: repo,
        sha,
        path,
        ...(originalPath !== undefined ? { originalPath } : {}),
        parentIndex,
        pinned,
      });
    },
    async openAllChanges({ sha, parentIndex }) {
      const repo = repoId.value;
      if (!repo) throw new Error('ReviewView: openAllChanges called with no active repo');
      return bridge.request('editor.openAllChanges', { repoId: repo, sha, parentIndex });
    },
    async goToFile({ rev, path, line }) {
      const repo = repoId.value;
      if (!repo) throw new Error('ReviewView: goToFile called with no active repo');
      return bridge.request('editor.goToFile', { repoId: repo, rev, path, line });
    },
    async openPullRequest({ number }) {
      const repo = repoId.value;
      if (!repo) throw new Error('ReviewView: openPullRequest called with no active repo');
      await bridge.request('pr.openExternal', { repoId: repo, number });
    },
    async openExternalLink(url) {
      await bridge.request('link.openExternal', { url });
    },
    async revealInGraph({ sha }) {
      const repo = repoId.value;
      if (!repo) return { revealed: false };
      return bridge.request('graph.revealCommit', { repoId: repo, sha });
    },
  };
});

onMounted(() => {
  // Mirrors `App.vue`'s own first-paint mark (§5.1 — W18's review-view perf metric measures from
  // this, not merely from `kira:page-parsed`). Unlike the graph panel there is no lane-layout
  // worker to wait a frame for, so this can mark right after mount rather than waiting on a
  // `CommitGrid.vue`-equivalent chunk-applied event.
  requestAnimationFrame(() => {
    performance.mark('kira:first-paint');
    performance.measure('kira:first-paint', undefined, 'kira:first-paint');
  });
  void bootstrap().catch((err: unknown) => {
    bootError.value = err instanceof Error ? err.message : String(err);
  });
});

function retryBootstrap(): void {
  sharedRetryBootstrap(bootError, bootstrap);
}

onBeforeUnmount(() => {
  unsubscribeTarget?.();
  unsubscribeUiAction?.();
  review.value?.dispose();
  reviewFiles.value?.dispose();
  reviewComments.value?.dispose();
  refsState.dispose();
  bridge.dispose();
});

// G12 D13: one panel-level filter/list-mode toolbar, replacing what used to be a separate
// FileTree toolbar per expanded row (and a third copy in ReviewFilesPane, G11). Owns the state;
// ReviewCommitRow/ReviewFilesPane's own FileTree instances render no toolbar of their own
// (show-toolbar="false") and receive these as plain props.
const listMode = ref<FileListMode>('tree');
const filter = ref('');

// G19 D11b: the write half of durable persistence — one watch() over the same fields the
// snapshot lists (listMode/filter live here; branch/resolution/pane/diffMode are read fresh
// inside persistSession itself). A getter-source watch over an array literal fires on every
// tracked-dependency change regardless of the array's own contents, which is exactly right here:
// scheduleSessionSave's own debounce is what keeps several fields changing in the same tick
// (setTarget resetting pane while also changing branch) down to one save, not this watch's job.
watch(
  () => [
    review.value?.branch.value,
    review.value?.resolution.value,
    review.value?.pane.value,
    listMode.value,
    filter.value,
    reviewFiles.value?.diffMode.value,
  ],
  scheduleSessionSave,
);

// ---------------------------------------------------------------------------------------
// The "no branch" state's own branch picker (§6.8 state 1) — `refListModel.ts`'s fold over
// `refs.list`, tags excluded (a tag is a point, not a line of development — matches W14's own
// rule on the row menu's "Review branch changes" entry).
// ---------------------------------------------------------------------------------------
const branchFilter = ref('');
const branchFilterInputRef = useTemplateRef<{ focus: () => void }>('branchFilter');
const branchSections = computed(() =>
  buildRefListSections(
    {
      branches: refsState.branches.value,
      remoteBranches: refsState.remoteBranches.value,
      tags: [],
    },
    branchFilter.value,
  ),
);

// Focused once this "no branch" state actually renders (not merely once at this component's own
// mount, which would fire long before the picker is ever shown).
watch(
  () => !bootError.value && !!review.value && !noActiveRepo.value && !review.value.branch.value,
  (showingPicker) => {
    if (showingPicker) void nextTick(() => branchFilterInputRef.value?.focus());
  },
);

function pickBranch(name: string): void {
  const id = repoId.value;
  if (!id) return;
  void applyTarget(id, name);
}

// ---------------------------------------------------------------------------------------
// The commit list — `PackedStreamState`'s own `store`/`loadedRows`/`generation`: `generation` is
// read (not merely as a dependency of `loadedRows`) so a reset that happens to land on the same
// row count (a `setBase` override back to an equally-sized range) still recomputes this list
// rather than reusing stale row identities (`packedStream.ts`'s own doc comment on why
// `generation` exists at all).
// ---------------------------------------------------------------------------------------
const shas = computed<readonly string[]>(() => {
  const r = review.value;
  if (!r) return [];
  void r.generation.value;
  const out: string[] = [];
  for (let i = 0; i < r.loadedRows.value; i++) out.push(r.store.shaAt(i));
  return out;
});

// The list is virtualized (`useVirtualRows` below): only rows near the viewport mount, however many
// are loaded.
const commitCountFormatter = new Intl.NumberFormat();
const commitCountLabel = computed(() => {
  const resolution = review.value?.resolution.value;
  if (resolution?.range.kind !== 'ready') return '';
  const count = resolution.range.commitCount;
  return `${commitCountFormatter.format(count)} ${count === 1 ? 'commit' : 'commits'}`;
});

// G14 D8 row 3/4: bare counts for the comparison summary node and the pane-toggle badges — the
// same underlying numbers `commitCountLabel` above already formats into a sentence, plus the
// Files/Comments panes' own row counts. `0` (not `undefined`) whenever a count is not yet known,
// so a badge renders "0" rather than blinking in once data arrives — every source here is already
// on the wire (D8's own "no new data" fence).
const commitsCount = computed(() => {
  const resolution = review.value?.resolution.value;
  return resolution?.range.kind === 'ready' ? resolution.range.commitCount : 0;
});
const filesChangedCount = computed(() => reviewFiles.value?.files.value.length ?? 0);
const commentsCount = computed(() => reviewComments.value?.comments.value.length ?? 0);

// P131 Part 3 §5.1: a local option shape for the ToggleGroup rows below — matches
// BranchPicker.vue's own PickerTabOption precedent, not a shared package export.
interface ReviewToggleOption {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly badge?: number;
}

// G14 D8 row 4: each pane button carries a count badge — GitLens's own count-badged section nodes.
const panelOptions = computed<readonly ReviewToggleOption[]>(() => [
  { id: 'commits', icon: ACTION_ICONS.commits, label: 'Commits', badge: commitsCount.value },
  { id: 'files', icon: ACTION_ICONS.files, label: 'Files', badge: filesChangedCount.value },
  { id: 'comments', icon: ACTION_ICONS.comments, label: 'Comments', badge: commentsCount.value },
]);

const listModeOptions: readonly ReviewToggleOption[] = [
  { id: 'tree', icon: ACTION_ICONS.listTree, label: 'Tree view' },
  { id: 'flat', icon: ACTION_ICONS.listFlat, label: 'Flat view' },
];

const panelItems = computed(() =>
  panelOptions.value.map((o) => ({
    value: o.id,
    label: o.label,
    icon: codiconName(o.icon),
    count: o.badge,
    tooltip: o.label,
    testid: `review-pane-${o.id}`,
  })),
);
const listModeItems = listModeOptions.map((o) => ({
  value: o.id,
  label: o.label,
  icon: codiconName(o.icon),
  tooltip: o.label,
}));

function onPaneChange(pane: string): void {
  review.value?.setPane(pane as ReviewPane);
}

/** G14 D8 row 3: the comparison summary's own second line — "N commits · M files changed",
 *  always shown while the list itself is (never gated on which pane is active, unlike the old
 *  commit-count-only span this replaces). */
const comparisonSummaryLabel = computed(() => {
  const commits = commitCountLabel.value;
  if (!commits) return '';
  const files = filesChangedCount.value;
  return `${commits} · ${commitCountFormatter.format(files)} ${files === 1 ? 'file' : 'files'} changed`;
});

const FALLBACK_PAGE_SIZE = SETTINGS['kiraSpace.graph.pageSize'].default;

function loadMoreLabel(): string {
  const r = review.value;
  if (!r) return 'Load more';
  if (r.isLoadingMore.value) return 'Loading…';
  const remaining = r.remaining.value;
  return remaining < FALLBACK_PAGE_SIZE
    ? `Load the last ${commitCountFormatter.format(remaining)}`
    : `Load more (${commitCountFormatter.format(remaining)} remaining)`;
}

function handleLoadMore(): void {
  if (review.value?.isLoadingMore.value) return;
  void review.value?.loadMore();
}

// ---------------------------------------------------------------------------------------
// Row expansion, the roving-tabindex cursor, and the diff overlay — one keydown handler at the
// root (§6.8 step 3's Esc ordering: the diff first, then the row), rather than three components
// each guessing whether it is the innermost.
// ---------------------------------------------------------------------------------------
const rowsEl = ref<HTMLDivElement | null>(null);
const focusedRow = ref(0);

// Collapsed rows are two lines; an expanded row's real height is measured (`measureRow`). Rows
// position with `top`, not `transform`: a row's context menu is `position: fixed` and a transformed
// ancestor would re-anchor it.
const COLLAPSED_ROW_ESTIMATE = 44;
const { virtualizer, virtualItems, totalSize, onScroll } = useVirtualRows({
  count: () => shas.value.length,
  rowHeight: () => COLLAPSED_ROW_ESTIMATE,
  scrollElement: rowsEl,
  pinned: () => focusedRow.value,
});

function measureRow(el: unknown): void {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el);
}

watch(shas, (list) => {
  if (focusedRow.value >= list.length) focusedRow.value = Math.max(0, list.length - 1);
});

function rowElId(sha: string): string {
  return `git-review-row-${sha}`;
}

const focusedRowMounted = computed(() =>
  virtualItems.value.some((item) => item.index === focusedRow.value),
);

// Keyboard nav can target a row that is not mounted: scroll it in, then focus it once it renders.
const pendingFocus = ref<number | null>(null);
watch(
  [pendingFocus, virtualItems],
  () => {
    const index = pendingFocus.value;
    const sha = index === null ? undefined : shas.value[index];
    if (!sha) return;
    const el = rowsEl.value?.querySelector<HTMLElement>(`#${rowElId(sha)}`);
    if (!el) return;
    pendingFocus.value = null;
    el.focus({ preventScroll: true });
  },
  { flush: 'post' },
);

function focusRow(index: number): void {
  focusedRow.value = index;
  if (!shas.value[index]) return;
  pendingFocus.value = index;
  virtualizer.value.scrollToIndex(index);
}

function onRowsKeydown(event: KeyboardEvent): void {
  const list = shas.value;
  if (list.length === 0) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusRow(Math.min(focusedRow.value + 1, list.length - 1));
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusRow(Math.max(focusedRow.value - 1, 0));
      break;
    case 'Home':
      event.preventDefault();
      focusRow(0);
      break;
    case 'End':
      event.preventDefault();
      focusRow(list.length - 1);
      break;
    default:
      break;
  }
}

function toggleRow(sha: string): void {
  review.value?.toggle(sha);
}

// G12 D12: the diff overlay (and W17's modal-focus wiring for it) is gone — every diff opens in
// the host editor now, so there is nothing left in the webview for Escape's first stage to close. Only
// the second stage (collapse the focused row) remains.
//
// P108 F12: Kira Space mounts this alongside one or more graph tabs in the same document (kept
// alive with `v-show` rather than unmounted) — this `document`-level listener otherwise fired for
// an Escape typed while focus was inside a graph tab's own DOM too, collapsing a review row the
// user was never even looking at. Scoped to this instance's own root.
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (!rootEl.value || !(event.target instanceof Node) || !rootEl.value.contains(event.target)) {
    return;
  }
  const sha = shas.value[focusedRow.value];
  if (sha && review.value?.expandedShas.value.has(sha)) review.value.collapse(sha);
}

useEventListener(document, 'keydown', onDocumentKeydown);

// ---------------------------------------------------------------------------------------
// The one polite live region — the shared per-row announcement (copy/open-in-editor/go-to-file
// outcomes, `ReviewSessionState.announcement`) and, additionally, an announcement each time the
// four non-list states are *entered* (W17: "a screen-reader user learns 'nothing to review'
// rather than meeting silence").
// ---------------------------------------------------------------------------------------
watch(
  () => review.value?.announcement.value,
  (text) => {
    if (text !== undefined) announce(text);
  },
  { deep: true },
);

watch(
  () => review.value?.phase.value,
  (phase) => {
    const r = review.value;
    if (!r) return;
    const branch = r.branch.value ?? '';
    const base = r.resolution.value?.base ?? '';
    switch (phase) {
      case 'ask':
        announce(`No base detected for ${branch}. Choose one to compare against.`);
        break;
      case 'unrelated':
        announce(`${branch} and ${base} share no common history.`);
        break;
      case 'empty':
        announce(`${branch} adds no commits to ${base}.`);
        break;
      case 'listing':
        announce(`Comparing ${branch} to ${base}: ${commitCountLabel.value}.`);
        break;
      case 'error':
        announce(`Couldn't compare ${branch} — ${r.resolveError.value ?? ''}`);
        break;
      default:
        break;
    }
  },
);
</script>

<template>
  <div
    ref="rootEl"
    class="flex flex-col h-full w-full relative bg-bg text-fg font-ui text-graph-md overflow-hidden"
    :data-connection-state="connectionState"
  >
    <!-- P131 Part 3 §5.1: MountRoot.vue's own TooltipProvider (Part 2 §3.5) already wraps this
         root, so no tooltip surface of this component's own is needed. -->
    <span class="sr-only" data-testid="connection-state">{{ connectionState }}</span>
    <div class="sr-only" role="status" aria-live="polite" data-testid="live-announcements">
      {{ liveAnnouncement }}
    </div>
    <GitViewHead v-if="repoHead" :repo="repoHead" />

    <template v-if="bootError">
      <div class="flex flex-col gap-2 p-3" data-testid="boot-error">
        <p class=" text-muted-foreground">Couldn't load the repository — {{ bootError }}</p>
        <Button variant="dialog" size="kira" class="self-start" data-testid="boot-retry" @click="retryBootstrap">
          Retry
        </Button>
      </div>
    </template>

    <template v-else-if="!review">
      <p class="p-3 text-muted-foreground">Loading…</p>
    </template>

    <template v-else-if="noActiveRepo">
      <div class="flex flex-col gap-1 p-3 min-h-0">
        <h2 class="text-kira-md text-fg">Review branch changes</h2>
        <p>Open a repository first, then pick a branch to review.</p>
      </div>
    </template>

    <template v-else-if="!review.branch.value">
      <div
        class="flex flex-col gap-1 p-3 min-h-0 h-full"
        data-testid="review-no-branch"
      >
        <h2 class="text-kira-md text-fg">Review branch changes</h2>
        <p class=" text-muted-foreground">
          Pick a branch to compare its commits against a base you choose or one we detect.
        </p>
        <SearchField
          ref="branchFilter"
          v-model="branchFilter"
          placeholder="Filter branches"
          aria-label="Filter branches"
        />
        <div class="flex-1 min-h-0 overflow-auto">
          <div>
            <SectionHeading label="Branches" />
            <button
              v-for="row in branchSections.branches.visible"
              :key="row.refname"
              type="button"
              :class="cn(rowVariants({ layout: 'tree' }), 'w-full text-left')"
              :style="rowIndent(0)"
              @click="pickBranch(row.shortName)"
            >
              {{ row.shortName }}
            </button>
            <div
              v-if="branchSections.branches.visible.length === 0"
              class="px-1.5 py-1 text-kira-sm text-subtle"
            >
              No matching branches
            </div>
          </div>
          <div>
            <SectionHeading label="Remote branches" />
            <button
              v-for="row in branchSections.remoteBranches.visible"
              :key="row.refname"
              type="button"
              :class="cn(rowVariants({ layout: 'tree' }), 'w-full text-left')"
              :style="rowIndent(0)"
              @click="pickBranch(row.shortName)"
            >
              {{ row.shortName }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- G19 D5 (item 5): the two compared sides now stack, one per line, with a swap button
           between them — replacing the old single-row "branch ↔ base" strip (F5: no stacking, no
           invert control). G19 D11a (item 11): the back-to-selection button renders here too,
           whenever a branch is picked — including the error phase, which is exactly the state a
           resumed session pointing at a deleted branch/base lands in (D11b). -->
      <!-- P110 A16: this header used to restyle .p-panel-head's own geometry (height/gap/padding)
           but deliberately never its casing/letter-spacing — that primitive styles a short
           section label, and the branch name here is live data, which must never be re-cased. -->
      <ViewToolbar>
        <TooltipIconButton
          icon="chevron-left"
          label="Back to branch selection"
          data-testid="review-back-button"
          @click="goBackToSelection"
        />
        <CodiconIcon name="git-branch" :size="13" class="shrink-0 text-muted-foreground" />
        <span
          class="min-w-0 truncate font-data text-kira-md text-fg"
          data-testid="review-branch-name"
          >{{ review.branch.value }}</span
        >
        <span class="text-muted-foreground shrink-0" aria-hidden="true">↔</span>
        <BaseSelector
          :resolution="review.resolution.value"
          :refs-state="refsState"
          @select-base="review.setBase($event)"
        />
        <TooltipIconButton
          icon="arrow-swap"
          label="Swap branch and base"
          data-testid="review-swap-button"
          @click="onSwapBaseAndBranch"
        />
        <span
          v-if="review.phase.value === 'listing'"
          class="ml-auto min-w-0 truncate text-kira-sm text-subtle"
        >
          {{ comparisonSummaryLabel }}
        </span>
      </ViewToolbar>

      <!-- G12 D13/D14: one panel-level toolbar, holding the Commits/Files pane toggle, the
           filter, and the Tree/Flat toggle — replacing what used to be one FileTree toolbar per
           expanded row plus a third, separately-stateful copy in the Files pane. -->
      <ViewToolbar v-if="review.phase.value === 'listing'" data-testid="review-toolbar">
        <SecondaryTabs
          aria-label="Review pane"
          :model-value="review.pane.value"
          :items="panelItems"
          @update:model-value="onPaneChange"
        >
          <template #item="{ item }">
            <CodiconIcon :name="item.icon ?? ''" :size="13" />
            <span class="sr-only">{{ item.label }}</span>
            <Badge variant="count">{{ item.count }}</Badge>
          </template>
        </SecondaryTabs>
        <!-- G19 D6 (item 6): the always-rendered filter input is now gated behind a search-icon
             button — F6 found this the one filter in the app that did not already gate behind
             opening something (BaseSelector.vue's own filter already does). `aria-pressed`
             whenever the input is revealed *or* a filter is already applied-but-collapsed, so an
             applied filter still visibly signals itself even while hidden. -->
        <TooltipIconButton
          icon="search"
          label="Filter files"
          :pressed="filterVisible || filter.length > 0"
          data-testid="review-filter-toggle"
          @click="toggleFilterVisible"
        />
        <div v-if="filterVisible" class="min-w-0 flex-1">
          <SearchField
            ref="toolbarFilter"
            placeholder="Filter files"
            aria-label="Filter files"
            :model-value="filter"
            @update:model-value="filter = $event"
          />
        </div>
        <SecondaryTabs
          variant="segmented"
          aria-label="File list display"
          :model-value="listMode"
          :items="listModeItems"
          @update:model-value="(v) => (listMode = v as FileListMode)"
        >
          <template #item="{ item }">
            <CodiconIcon :name="item.icon ?? ''" :size="13" />
            <span class="sr-only">{{ item.label }}</span>
          </template>
        </SecondaryTabs>
      </ViewToolbar>

      <div class="flex-1 min-h-0 flex flex-col">
        <p v-if="review.phase.value === 'resolving'" class=" p-3 text-muted-foreground">
          Resolving comparison…
        </p>

        <div
          v-else-if="review.phase.value === 'error'"
          class="flex flex-col items-start gap-1 p-3"
        >
          <p class=" text-error">Couldn't compare — {{ review.resolveError.value }}</p>
          <Button variant="dialog" size="kira" data-testid="review-retry" @click="retryCompare">
            Retry
          </Button>
        </div>

        <div
          v-else-if="review.phase.value === 'ask'"
          class=" p-3 text-muted-foreground"
          data-testid="review-ask"
        >
          <p>Nothing was detected for <strong>{{ review.branch.value }}</strong> — pick a base above. We won't guess.</p>
        </div>

        <p
          v-else-if="review.phase.value === 'unrelated'"
          class=" p-3 text-muted-foreground"
          data-testid="review-unrelated"
        >
          “{{ review.branch.value }}” and “{{ review.resolution.value?.base }}” share no common
          history.
        </p>

        <p
          v-else-if="review.phase.value === 'empty'"
          class=" p-3 text-muted-foreground"
          data-testid="review-empty"
        >
          “{{ review.branch.value }}” adds no commits to “{{ review.resolution.value?.base }}”.
        </p>

        <template
          v-else-if="review.phase.value === 'listing' && review.pane.value === 'commits' && rowActions"
        >
          <ViewToolbar
            v-if="review.staleReview.value"
            class="font-ui"
            role="status"
            data-testid="review-stale-banner"
          >
            <span>This comparison has changed.</span>
            <TooltipIconButton
              icon="refresh"
              label="Refresh"
              class="ml-auto"
              @click="review.acknowledgeStaleReview()"
            />
          </ViewToolbar>

          <div
            ref="rowsEl"
            class="flex-1 min-h-0 overflow-auto outline-none"
            role="tree"
            aria-label="Commits"
            :tabindex="focusedRowMounted ? -1 : 0"
            @keydown="onRowsKeydown"
            @scroll="onScroll"
          >
            <div class="relative w-full" :style="{ height: `${totalSize}px` }">
              <div
                v-for="item in virtualItems"
                :key="shas[item.index]"
                :ref="measureRow"
                role="presentation"
                :data-index="item.index"
                :class="VIRTUAL_ROW_CLASS"
                :style="{ top: `${item.start}px` }"
              >
                <ReviewCommitRow
                  :id="rowElId(shas[item.index] as string)"
                  :sha="shas[item.index] as string"
                  :store="review.store"
                  :expanded="review.expandedShas.value.has(shas[item.index] as string)"
                  :expansion="review.expansionFor(shas[item.index] as string)"
                  :actions="rowActions"
                  :focused="item.index === focusedRow"
                  :aria-setsize="shas.length"
                  :aria-posinset="item.index + 1"
                  :list-mode="listMode"
                  :filter="filter"
                  @toggle="toggleRow(shas[item.index] as string)"
                  @focus-row="focusRow(item.index)"
                />
              </div>
            </div>
          </div>
          <!-- G16 D9: `remaining > 0` guards against F7's empty-range hole — an empty branch
               comparison never emits a chunk, so there is no server-side signal to correct here.
               Kept visible while loading so the affordance does not vanish mid-load.
               P110 A16: "Load more" stays plain text (its label carries a count), so this button
               takes no cancellation classes — Button's own toolbar variant already matches. -->
          <div
            v-if="!review.exhausted.value && (review.isLoadingMore.value || review.remaining.value > 0)"
            class="flex justify-center py-1 px-1.5 shrink-0"
          >
            <Button data-testid="review-load-more-button"
              variant="toolbar"
              size="kira"
             
              :disabled="review.isLoadingMore.value"
              @click="handleLoadMore"
            >
              {{ loadMoreLabel() }}
            </Button>
          </div>
        </template>

        <ReviewFilesPane
          v-else-if="
            review.phase.value === 'listing' &&
            review.pane.value === 'files' &&
            reviewFiles &&
            filesActions
          "
          class="flex-1 min-h-0"
          :review-files="reviewFiles"
          :store="review.store"
          :actions="filesActions"
          :list-mode="listMode"
          :filter="filter"
          :review-filter="reviewFilter"
        />

        <ReviewCommentsPane
          v-else-if="
            review.phase.value === 'listing' && review.pane.value === 'comments' && reviewComments
          "
          class="flex-1 min-h-0"
          :review-comments="reviewComments"
          @select-comment="onSelectComment"
        />
      </div>
    </template>
  </div>
</template>

