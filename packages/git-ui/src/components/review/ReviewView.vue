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
import type {
  EventPayload,
  HostKind,
  ReviewSessionSnapshot,
  Transport,
  UiActionKind,
} from '@kira/git-ipc';
import type { KuiSegmentedOption } from '@kira/kira-ui';
// `KuiSearchInput` is a plain (not `import type`) import even though this file's own script only
// ever reads it through `InstanceType<typeof KuiSearchInput>` — that is still a genuine *value*
// read (`typeof` on an identifier requires the runtime binding in scope), and the template's own
// `<KuiSearchInput>` tag instantiates it as a component; biome's own static analysis sees neither
// use and would otherwise "fix" this to `import type`, silently erasing the import (AppToolbar.vue's
// own `useImportType` biome-ignore precedent, for the same reason).
// biome-ignore lint/style/useImportType: see above
import {
  initTooltips,
  KuiButton,
  KuiSearchInput,
  KuiSegmented,
  KuiTextInput,
  KuiTooltip,
} from '@kira/kira-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { BridgeClient } from '../../bridge/client.ts';
import { ACTION_ICONS } from '../../icons/index.ts';
import { copyToClipboard } from '../../state/clipboardActions.ts';
import type { FileListMode } from '../../state/detail.ts';
import type { Capabilities, DetailActions } from '../../state/detailActions.ts';
import { RefsState } from '../../state/refs.ts';
import { type ReviewPane, ReviewSessionState, type ReviewTarget } from '../../state/review.ts';
import { ReviewCommentsState } from '../../state/reviewComments.ts';
import { ReviewFilesState } from '../../state/reviewFiles.ts';
import { SettingsState } from '../../state/settings.ts';
import type { ViewStateStore } from '../../state/viewState.ts';
import ConnectionBanner from '../ConnectionBanner.vue';
import { buildRefListSections } from '../refListModel.ts';
import BaseSelector from './BaseSelector.vue';
import ReviewCommentsPane from './ReviewCommentsPane.vue';
import ReviewCommitRow from './ReviewCommitRow.vue';
import ReviewFilesPane from './ReviewFilesPane.vue';

const props = defineProps<{
  transport: Transport;
  viewState: ViewStateStore;
  host: HostKind;
  target?: ReviewTarget | null;
  /** G-UX (item 13): the host's own connection state as of this webview's cold resolve — see
   *  `App.vue`'s own copy of this doc comment (`main.ts`'s `MountOptions.hostConnectionState`,
   *  including why this is named `hostConnectionState`, not `connectionState` — the latter
   *  collides with the differently-scoped local const of that name just below). */
  hostConnectionState: EventPayload<'connection.changed'>['state'];
}>();

const bridge = new BridgeClient(props.transport, props.hostConnectionState);
const connectionState = bridge.connectionState;
const refsState = new RefsState(bridge);
const review = shallowRef<ReviewSessionState | undefined>(undefined);
const reviewFiles = shallowRef<ReviewFilesState | undefined>(undefined);
const reviewComments = shallowRef<ReviewCommentsState | undefined>(undefined);
const capabilities = shallowRef<Capabilities | undefined>(undefined);
// G14 D6: this view has no SettingsState today (unlike App.vue, which already needs one for
// pageSize/stash defaults) — constructed here from `init.settings` (bootstrap() already awaits
// it) purely so the sidebar's file trees can honour a *live* workbench.tree.indent change, not
// only the value at boot.
const settingsState = shallowRef<SettingsState | undefined>(undefined);
const FALLBACK_TREE_INDENT = SETTINGS['workbench.tree.indent'].default;
const treeIndent = computed(
  () => `${settingsState.value?.settings.value['workbench.tree.indent'] ?? FALLBACK_TREE_INDENT}px`,
);

const repoId = ref<string | undefined>(undefined);
const noActiveRepo = ref(false);
// G12 D6: same treatment as App.vue's own bootError — "Loading…" forever is not an acceptable
// rendering of a failed bootstrap() (F7).
const bootError = ref<string | undefined>(undefined);

watch(repoId, (id) => refsState.setRepoId(id));

let unsubscribeTarget: (() => void) | undefined;
let unsubscribeUiAction: (() => void) | undefined;

async function applyTarget(nextRepoId: string, branch: string): Promise<void> {
  repoId.value = nextRepoId;
  await review.value?.setTarget(nextRepoId, branch);
}

async function bootstrap(): Promise<void> {
  const init = await bridge.init();
  capabilities.value = init.capabilities;
  settingsState.value = new SettingsState(bridge, init.settings);
  review.value = new ReviewSessionState(bridge, init.capabilities);
  reviewFiles.value = new ReviewFilesState(bridge);
  reviewComments.value = new ReviewCommentsState(bridge);

  unsubscribeTarget = bridge.on('review.target', (event) => {
    void applyTarget(event.repoId, event.branch);
  });
  // G11 D17: the palette's own route into this already-mounted webview — toggles the file
  // currently open in the Files pane, or announces there is none to toggle.
  unsubscribeUiAction = bridge.on('ui.action', (event) => {
    onUiAction(event.action);
  });

  if (props.target) {
    await applyTarget(props.target.repoId, props.target.branch);
    return;
  }
  const list = await bridge.request('repo.list', {});
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
  await applyTarget(id, session.branch);
  if (session.baseOverride !== null) await review.value?.setBase(session.baseOverride);
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
    void persistSession();
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
function toggleFilterVisible(): void {
  filterVisible.value = !filterVisible.value;
}

function onUiAction(action: UiActionKind): void {
  switch (action) {
    case 'toggleFileReviewed': {
      const rf = reviewFiles.value;
      const path = rf?.selectedPath.value;
      if (!rf || path === null || path === undefined) {
        liveAnnouncement.value = 'Open a file in the Files tab first.';
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

// The Files pane's own actions bundle — "Open in editor"/"Go to file" are wired for real (the
// same bridge calls createDetailActions makes) but ReviewFilesPane.vue always disables both
// capabilities for its own DiffView, since neither has an honest meaning against a branch-review
// delta with no single commit sha; FileTree's own copy-path button is the one thing this bundle
// really serves here.
const filesActions = computed<DetailActions | undefined>(() => {
  const caps = capabilities.value;
  if (!caps) return undefined;
  return {
    capabilities: caps,
    copy(text, whatCopied) {
      void copyToClipboard(bridge, text, whatCopied).then((outcome) => {
        liveAnnouncement.value = outcome.message;
      });
    },
    announce(text) {
      liveAnnouncement.value = text;
    },
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
  };
});

// G20 D2: this root's own KuiTooltip instance and listener set, independent of App.vue's own
// (two separate webview documents cannot share one singleton, G19 F3).
let stopTooltips: (() => void) | null = null;

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
  stopTooltips = initTooltips();
});

/** Retries a failed bootstrap() (G12 D6) — clears the error panel first so a second failure
 *  replaces the first rather than appearing to do nothing. */
function retryBootstrap(): void {
  bootError.value = undefined;
  void bootstrap().catch((err: unknown) => {
    bootError.value = err instanceof Error ? err.message : String(err);
  });
}

onBeforeUnmount(() => {
  unsubscribeTarget?.();
  unsubscribeUiAction?.();
  review.value?.dispose();
  reviewFiles.value?.dispose();
  reviewComments.value?.dispose();
  settingsState.value?.dispose();
  refsState.dispose();
  bridge.dispose();
  document.removeEventListener('keydown', onDocumentKeydown);
  stopTooltips?.();
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
const branchFilterInputRef = ref<InstanceType<typeof KuiSearchInput> | null>(null);
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

// G21 D2: `KuiSearchInput`'s root element is a `<div>`, not the `<input>` a plain `autofocus`
// attribute used to land on directly — its own `defineExpose`'d `focus()` is the replacement,
// called once this "no branch" state actually renders (not merely once at this component's own
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

// G14 D8 row 4: each pane button carries a count badge — GitLens's own count-badged section nodes.
const panelOptions = computed<readonly KuiSegmentedOption[]>(() => [
  { id: 'commits', icon: ACTION_ICONS.commits, label: 'Commits', badge: commitsCount.value },
  { id: 'files', icon: ACTION_ICONS.files, label: 'Files', badge: filesChangedCount.value },
  { id: 'comments', icon: ACTION_ICONS.comments, label: 'Comments', badge: commentsCount.value },
]);

const listModeOptions: readonly KuiSegmentedOption[] = [
  { id: 'tree', icon: ACTION_ICONS.listTree, label: 'Tree view' },
  { id: 'flat', icon: ACTION_ICONS.listFlat, label: 'Flat view' },
];

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

const FALLBACK_PAGE_SIZE = SETTINGS['kiraVersion.graph.pageSize'].default;

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

watch(shas, (list) => {
  if (focusedRow.value >= list.length) focusedRow.value = Math.max(0, list.length - 1);
});

function rowElId(sha: string): string {
  return `kv-review-row-${sha}`;
}

function focusRow(index: number): void {
  focusedRow.value = index;
  const sha = shas.value[index];
  if (!sha) return;
  void nextTick(() => {
    rowsEl.value?.querySelector<HTMLElement>(`#${rowElId(sha)}`)?.focus({ preventScroll: true });
  });
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
// VS Code now, so there is nothing left in the webview for Escape's first stage to close. Only
// the second stage (collapse the focused row) remains.
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const sha = shas.value[focusedRow.value];
  if (sha && review.value?.expandedShas.value.has(sha)) review.value.collapse(sha);
}

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown);
});

// ---------------------------------------------------------------------------------------
// The one polite live region — the shared per-row announcement (copy/open-in-editor/go-to-file
// outcomes, `ReviewSessionState.announcement`) and, additionally, an announcement each time the
// four non-list states are *entered* (W17: "a screen-reader user learns 'nothing to review'
// rather than meeting silence").
// ---------------------------------------------------------------------------------------
const liveAnnouncement = ref('');

watch(
  () => review.value?.announcement.value,
  (text) => {
    if (text !== undefined) liveAnnouncement.value = text;
  },
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
        liveAnnouncement.value = `No base detected for ${branch}. Choose one to compare against.`;
        break;
      case 'unrelated':
        liveAnnouncement.value = `${branch} and ${base} share no common history.`;
        break;
      case 'empty':
        liveAnnouncement.value = `${branch} adds no commits to ${base}.`;
        break;
      case 'listing':
        liveAnnouncement.value = `Comparing ${branch} to ${base}: ${commitCountLabel.value}.`;
        break;
      case 'error':
        liveAnnouncement.value = `Couldn't compare ${branch} — ${r.resolveError.value ?? ''}`;
        break;
      default:
        break;
    }
  },
);
</script>

<template>
  <div
    class="kv-review-view"
    :data-connection-state="connectionState"
    :style="{ '--kv-tree-indent': treeIndent }"
  >
    <!-- G20 D2: this root's own tooltip surface — independent of App.vue's (two separate webview
         documents). -->
    <KuiTooltip />
    <span class="kv-visually-hidden" data-testid="connection-state">{{ connectionState }}</span>
    <div class="kv-visually-hidden" role="status" aria-live="polite" data-testid="live-announcements">
      {{ liveAnnouncement }}
    </div>

    <!-- G-UX (item 13): unconditional, outside the v-if/v-else-if chain below (`App.vue`'s own
         copy of this reasoning) — each of those branches fully replaces the panel's own content,
         which would otherwise hide a live disconnect exactly when it matters most. -->
    <ConnectionBanner :state="bridge.hostConnection.value" />

    <template v-if="bootError">
      <div class="kv-review-boot-error" data-testid="boot-error">
        <p>Kira Studio isn't reachable — {{ bootError }}</p>
        <KuiButton data-testid="boot-retry" @click="retryBootstrap">Retry</KuiButton>
      </div>
    </template>

    <template v-else-if="!review">
      <p class="kv-review-loading">Loading…</p>
    </template>

    <template v-else-if="noActiveRepo">
      <div class="kv-review-empty-state">
        <h2>Review branch changes</h2>
        <p>Open a repository first, then pick a branch to review.</p>
      </div>
    </template>

    <template v-else-if="!review.branch.value">
      <div class="kv-review-picker" data-testid="review-no-branch">
        <h2>Review branch changes</h2>
        <p class="kv-review-picker-copy">
          Pick a branch to compare its commits against a base you choose or one we detect.
        </p>
        <KuiSearchInput
          ref="branchFilterInputRef"
          v-model="branchFilter"
          placeholder="Filter branches"
          ariaLabel="Filter branches"
        />
        <div class="kv-review-picker-scroll">
          <div class="kv-review-picker-section">
            <div class="kv-review-picker-section-title">Branches</div>
            <KuiButton
              v-for="row in branchSections.branches.visible"
              :key="row.refname"
              class="kui-row kv-review-picker-row"
              @click="pickBranch(row.shortName)"
            >
              {{ row.shortName }}
            </KuiButton>
            <div v-if="branchSections.branches.visible.length === 0" class="kv-review-picker-empty">
              No matching branches
            </div>
          </div>
          <div class="kv-review-picker-section">
            <div class="kv-review-picker-section-title">Remote branches</div>
            <KuiButton
              v-for="row in branchSections.remoteBranches.visible"
              :key="row.refname"
              class="kui-row kv-review-picker-row"
              @click="pickBranch(row.shortName)"
            >
              {{ row.shortName }}
            </KuiButton>
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
      <header class="kv-review-header">
        <div class="kv-review-header-row">
          <KuiButton
            :icon="ACTION_ICONS.back"
            v-kui-tooltip="'Back to branch selection'"
            aria-label="Back to branch selection"
            data-testid="review-back-button"
            @click="goBackToSelection"
          />
          <div class="kv-review-compare">
            <div class="kv-review-compare-side">
              <span class="codicon codicon-git-branch" aria-hidden="true"></span>
              <span class="kv-review-branch-name" data-testid="review-branch-name">{{
                review.branch.value
              }}</span>
            </div>
            <div class="kv-review-compare-side">
              <span class="kv-review-summary-arrow" aria-hidden="true">↔</span>
              <BaseSelector
                :resolution="review.resolution.value"
                :refs-state="refsState"
                @select-base="review.setBase($event)"
              />
            </div>
          </div>
          <KuiButton
            :icon="ACTION_ICONS.swap"
            v-kui-tooltip="'Swap branch and base'"
            aria-label="Swap branch and base"
            data-testid="review-swap-button"
            @click="onSwapBaseAndBranch"
          />
        </div>
        <div v-if="review.phase.value === 'listing'" class="kv-review-summary-meta">
          {{ comparisonSummaryLabel }}
        </div>
      </header>

      <!-- G12 D13/D14: one panel-level toolbar, holding the Commits/Files pane toggle, the
           filter, and the Tree/Flat toggle — replacing what used to be one FileTree toolbar per
           expanded row plus a third, separately-stateful copy in the Files pane. -->
      <div v-if="review.phase.value === 'listing'" class="kv-review-toolbar">
        <KuiSegmented
          :options="panelOptions"
          :model-value="review.pane.value"
          ariaLabel="Review pane"
          @update:model-value="onPaneChange"
        />
        <!-- G19 D6 (item 6): the always-rendered filter input is now gated behind a search-icon
             button — F6 found this the one filter in the app that did not already gate behind
             opening something (BaseSelector.vue's own filter already does). `active` whenever the
             input is revealed *or* a filter is already applied-but-collapsed, so an applied filter
             still visibly signals itself even while hidden. -->
        <KuiButton
          :icon="ACTION_ICONS.search"
          :active="filterVisible || filter.length > 0"
          v-kui-tooltip="'Filter files'"
          aria-label="Filter files"
          data-testid="review-filter-toggle"
          @click="toggleFilterVisible"
        />
        <KuiTextInput
          v-if="filterVisible"
          class="kv-review-toolbar-filter"
          placeholder="Filter files"
          aria-label="Filter files"
          autofocus
          :model-value="filter"
          @update:model-value="filter = $event"
        />
        <KuiSegmented
          :options="listModeOptions"
          :model-value="listMode"
          ariaLabel="File list display"
          @update:model-value="(value) => (listMode = value as FileListMode)"
        />
      </div>

      <div class="kv-review-body">
        <p v-if="review.phase.value === 'resolving'" class="kv-review-status">
          Resolving comparison…
        </p>

        <p v-else-if="review.phase.value === 'error'" class="kv-review-status kv-review-error">
          Couldn't compare — {{ review.resolveError.value }}
        </p>

        <div v-else-if="review.phase.value === 'ask'" class="kv-review-status" data-testid="review-ask">
          <p>Nothing was detected for <strong>{{ review.branch.value }}</strong> — pick a base above. We won't guess.</p>
        </div>

        <p
          v-else-if="review.phase.value === 'unrelated'"
          class="kv-review-status"
          data-testid="review-unrelated"
        >
          “{{ review.branch.value }}” and “{{ review.resolution.value?.base }}” share no common
          history.
        </p>

        <p
          v-else-if="review.phase.value === 'empty'"
          class="kv-review-status"
          data-testid="review-empty"
        >
          “{{ review.branch.value }}” adds no commits to “{{ review.resolution.value?.base }}”.
        </p>

        <template v-else-if="review.phase.value === 'listing' && review.pane.value === 'commits'">
          <div
            v-if="review.staleReview.value"
            class="kv-review-stale-banner"
            role="status"
            data-testid="review-stale-banner"
          >
            <span>This comparison has changed.</span>
            <KuiButton
              :icon="ACTION_ICONS.refresh"
              v-kui-tooltip="'Refresh'"
              aria-label="Refresh"
              @click="review.acknowledgeStaleReview()"
            />
          </div>

          <div
            ref="rowsEl"
            class="kv-review-rows"
            role="tree"
            aria-label="Commits"
            @keydown="onRowsKeydown"
          >
            <ReviewCommitRow
              v-for="(sha, index) in shas"
              :id="rowElId(sha)"
              :key="sha"
              :sha="sha"
              :store="review.store"
              :expanded="review.expandedShas.value.has(sha)"
              :expansion="review.expansionFor(sha)"
              :focused="index === focusedRow"
              :list-mode="listMode"
              :filter="filter"
              :repo-id="repoId"
              @toggle="toggleRow(sha)"
              @focus-row="focusRow(index)"
            />
          </div>

          <!-- G16 D9: `remaining > 0` guards against F7's empty-range hole — an empty branch
               comparison never emits a chunk, so there is no server-side signal to correct here.
               Kept visible while loading so the affordance does not vanish mid-load. -->
          <div
            v-if="!review.exhausted.value && (review.isLoadingMore.value || review.remaining.value > 0)"
            class="kv-review-load-more"
          >
            <KuiButton
              class="kv-review-load-more-button"
              :disabled="review.isLoadingMore.value"
              @click="handleLoadMore"
            >
              {{ loadMoreLabel() }}
            </KuiButton>
          </div>
        </template>

        <ReviewFilesPane
          v-else-if="
            review.phase.value === 'listing' &&
            review.pane.value === 'files' &&
            reviewFiles &&
            filesActions
          "
          class="kv-review-files-mount"
          :review-files="reviewFiles"
          :store="review.store"
          :actions="filesActions"
          :list-mode="listMode"
          :filter="filter"
        />

        <ReviewCommentsPane
          v-else-if="
            review.phase.value === 'listing' && review.pane.value === 'comments' && reviewComments && capabilities
          "
          class="kv-review-comments-mount"
          :review-comments="reviewComments"
          :capabilities="capabilities"
          @select-comment="onSelectComment"
        />
      </div>
    </template>
  </div>
</template>

<style>
.kv-review-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  position: relative;
  background-color: var(--kv-app-bg);
  color: var(--kv-app-fg);
  /* LAW 08 (G12 D14): UI chrome is --kv-font-ui; a sha/branch/path overrides back to
     --kv-font-data at its own rule, below. */
  font-family: var(--kv-font-ui);
  font-size: var(--kv-font-size);
  overflow: hidden;
}

.kv-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.kv-review-loading {
  padding: var(--kv-s-5);
  color: var(--kv-description-fg);
}

.kv-review-boot-error {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-4);
  padding: var(--kv-s-5);
}

.kv-review-boot-error p {
  margin: 0;
  color: var(--kv-description-fg);
}

.kv-review-boot-error button {
  align-self: flex-start;
  padding: var(--kv-s-2) var(--kv-s-5);
  border: 1px solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
  background-color: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  cursor: pointer;
}

.kv-review-empty-state,
.kv-review-picker {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-2);
  padding: var(--kv-s-5);
  min-height: 0;
}

.kv-review-picker {
  height: 100%;
}

.kv-review-empty-state h2,
.kv-review-picker h2 {
  margin: 0;
  font-size: 1.1em;
}

.kv-review-picker-copy {
  margin: 0;
  color: var(--kv-description-fg);
}

/* G34 D14: gone — this class landed on `KuiSearchInput`'s own wrapper `<div>`, not its real
   `<input>` (attrs fallthrough targets the single root element), so its box-chrome properties
   never actually painted anything; `.kui-search-input-field`'s own chrome is what always rendered. */

.kv-review-picker-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.kv-review-picker-section-title {
  padding: var(--kv-s-2) 0 var(--kv-s-1);
  color: var(--kv-description-fg);
  font-size: 0.8em;
  text-transform: uppercase;
}

/* G34 D7: geometry now comes from `.kui-row` (composed in the template) — this class keeps only
   the full-width stretch a vertical list of these needs. */
.kv-review-picker-row {
  width: 100%;
  text-align: left;
}

.kv-review-picker-empty {
  color: var(--kv-description-fg);
  padding: var(--kv-s-1) var(--kv-s-2);
}

/* G12 D14: .p-panel-head's geometry — height/gap/padding — for the view head carrying the branch
   name and base selector. Not its uppercase/letter-spacing treatment: that primitive styles a
   short section label, and this row's own content is live data (a real branch name), which must
   never be visually re-cased. */
/* G14 D8 row 3: the comparison summary node — two lines, replacing the old single-row header's
 * fixed `--kv-control-h-lg`. */
.kv-review-header {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
  padding: var(--kv-s-2) var(--kv-s-3);
  border-bottom: var(--kv-border-width) solid var(--kv-panel-border);
  flex-shrink: 0;
  min-width: 0;
}

/* G19 D5: the back button, the two stacked compare rows, and the swap button share one flex
   row — .kv-review-compare grows to fill the middle. */
.kv-review-header-row {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  min-width: 0;
}

.kv-review-compare {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
  flex: 1;
  min-width: 0;
}

.kv-review-compare-side {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  min-width: 0;
}

.kv-review-branch-name {
  font-family: var(--kv-font-data); /* LAW 08: a branch name is data. */
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-review-summary-arrow {
  color: var(--kv-description-fg);
  flex-shrink: 0;
}

.kv-review-summary-meta {
  font-family: var(--kv-font-ui);
  color: var(--kv-description-fg);
  font-size: var(--kv-t-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* G12 D13/D14: the new panel toolbar — .p-toolbar's own geometry, holding the Commits/Files
   toggle, the filter, and the Tree/Flat toggle, all at --kv-control-h. */
.kv-review-toolbar {
  display: flex;
  align-items: center;
  gap: var(--kv-s-3);
  height: var(--kv-bar-h);
  padding: 0 var(--kv-s-4);
  border-bottom: var(--kv-border-width) solid var(--kv-panel-border);
  flex-shrink: 0;
}

/* G34 D14: everything but the growable width is gone — `.kui-text-input`'s own chrome (this is a
   real `KuiTextInput`, whose class lands on its actual `<input>` root) already matches it. */
.kv-review-toolbar-filter {
  flex: 1;
  min-width: 0;
}

.kv-review-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.kv-review-files-mount,
.kv-review-comments-mount {
  flex: 1;
  min-height: 0;
}

.kv-review-status {
  margin: 0;
  padding: var(--kv-s-5);
  color: var(--kv-description-fg);
}

.kv-review-error {
  color: var(--kv-error-fg);
}

.kv-review-stale-banner {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  padding: var(--kv-s-2) var(--kv-s-3);
  background: var(--kv-row-hover-bg);
  border-bottom: var(--kv-border-width) solid var(--kv-panel-border);
  flex-shrink: 0;
  font-family: var(--kv-font-ui);
}

/* G12 D16: the refresh affordance in the stale banner became an icon button — .p-iconbtn's shape. */
.kv-review-stale-banner button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--kv-control-h);
  width: var(--kv-control-h);
  margin-left: auto;
  border: none;
  border-radius: var(--kv-radius-sm);
  background: transparent;
  color: var(--kv-app-fg);
  cursor: pointer;
}

.kv-review-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  outline: none;
}

.kv-review-load-more {
  display: flex;
  justify-content: center;
  padding: var(--kv-s-2) var(--kv-s-3);
  flex-shrink: 0;
}

/* G12 D16: Load more stays text (its label carries a count) — .p-btn's own geometry, per D14.
   G34: the box this comment already claimed is now actually true — the local re-declaration
   (height/padding/border/border-radius, with a border `.kui-button` never draws at rest) is
   gone, found by the phase's own exit-criteria sweep for this class of leftover. */

/* G21 D11: FileTree.vue's row geometry, font roles and status-letter mono font used to be
 * restyled from here, under the .kv-skin-kira ancestor, because the graph panel's tree had to
 * stay byte-identical while it still embedded a diff (G12 D14's own guarantee). That guarantee no
 * longer has anything to protect (items 9/10/12/13 already changed the graph tree's own
 * appearance and behaviour), so this whole block moved into FileTree.vue's own <style> as its one
 * unconditional appearance instead — see that file's own doc comment. G34 D1: `.kv-skin-kira` no
 * longer exists at all — `kira-structure.css` is `:root`-scoped now, so there is nothing left to
 * apply here. */
</style>
