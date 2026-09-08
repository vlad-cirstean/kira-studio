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
import type { HostKind, Transport, UiActionKind } from '@kira/git-ipc';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { BridgeClient } from '../../bridge/client.ts';
import { ACTION_ICONS } from '../../icons/index.ts';
import { copyToClipboard } from '../../state/clipboardActions.ts';
import type { FileListMode } from '../../state/detail.ts';
import type { Capabilities, DetailActions } from '../../state/detailActions.ts';
import { RefsState } from '../../state/refs.ts';
import { ReviewSessionState, type ReviewTarget } from '../../state/review.ts';
import { ReviewCommentsState } from '../../state/reviewComments.ts';
import { ReviewFilesState } from '../../state/reviewFiles.ts';
import { SettingsState } from '../../state/settings.ts';
import type { ViewStateStore } from '../../state/viewState.ts';
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
}>();

const bridge = new BridgeClient(props.transport);
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
  } else {
    noActiveRepo.value = true;
  }
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
    async openInEditor({ sha, path, originalPath, parentIndex }) {
      const repo = repoId.value;
      if (!repo) return;
      await bridge.request('editor.openDiff', {
        repoId: repo,
        sha,
        path,
        ...(originalPath !== undefined ? { originalPath } : {}),
        parentIndex,
      });
    },
    async goToFile({ rev, path, line }) {
      const repo = repoId.value;
      if (!repo) throw new Error('ReviewView: goToFile called with no active repo');
      return bridge.request('editor.goToFile', { repoId: repo, rev, path, line });
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
});

// G12 D13: one panel-level filter/list-mode toolbar, replacing what used to be a separate
// FileTree toolbar per expanded row (and a third copy in ReviewFilesPane, G11). Owns the state;
// ReviewCommitRow/ReviewFilesPane's own FileTree instances render no toolbar of their own
// (show-toolbar="false") and receive these as plain props.
const listMode = ref<FileListMode>('tree');
const filter = ref('');

// ---------------------------------------------------------------------------------------
// The "no branch" state's own branch picker (§6.8 state 1) — `refListModel.ts`'s fold over
// `refs.list`, tags excluded (a tag is a point, not a line of development — matches W14's own
// rule on the row menu's "Review branch changes" entry).
// ---------------------------------------------------------------------------------------
const branchFilter = ref('');
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
    class="kv-review-view kv-skin-kira"
    :data-connection-state="connectionState"
    :style="{ '--kv-tree-indent': treeIndent }"
  >
    <span class="kv-visually-hidden" data-testid="connection-state">{{ connectionState }}</span>
    <div class="kv-visually-hidden" role="status" aria-live="polite" data-testid="live-announcements">
      {{ liveAnnouncement }}
    </div>

    <template v-if="bootError">
      <div class="kv-review-boot-error" data-testid="boot-error">
        <p>Kira Studio isn't reachable — {{ bootError }}</p>
        <button type="button" data-testid="boot-retry" @click="retryBootstrap">Retry</button>
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
        <input
          type="text"
          class="kv-review-picker-filter"
          placeholder="Filter branches"
          aria-label="Filter branches"
          v-model="branchFilter"
          autofocus
        />
        <div class="kv-review-picker-scroll">
          <div class="kv-review-picker-section">
            <div class="kv-review-picker-section-title">Branches</div>
            <button
              v-for="row in branchSections.branches.visible"
              :key="row.refname"
              type="button"
              class="kv-review-picker-row"
              @click="pickBranch(row.shortName)"
            >
              {{ row.shortName }}
            </button>
            <div v-if="branchSections.branches.visible.length === 0" class="kv-review-picker-empty">
              No matching branches
            </div>
          </div>
          <div class="kv-review-picker-section">
            <div class="kv-review-picker-section-title">Remote branches</div>
            <button
              v-for="row in branchSections.remoteBranches.visible"
              :key="row.refname"
              type="button"
              class="kv-review-picker-row"
              @click="pickBranch(row.shortName)"
            >
              {{ row.shortName }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- G14 D8 row 3: a comparison summary node, replacing the old header's single-line
           branch/base/count strip — GitLens's own "Comparing X with Y" node. First line names
           both sides (`--kv-font-data`, the base still the interactive BaseSelector trigger);
           second line, muted, states the comparison as a fact rather than leaving it implicit. -->
      <header class="kv-review-header">
        <div class="kv-review-summary-line">
          <span class="codicon codicon-git-branch" aria-hidden="true"></span>
          <span class="kv-review-branch-name" data-testid="review-branch-name">{{
            review.branch.value
          }}</span>
          <span class="kv-review-summary-arrow" aria-hidden="true">↔</span>
          <BaseSelector
            :resolution="review.resolution.value"
            :refs-state="refsState"
            @select-base="review.setBase($event)"
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
        <!-- G14 D8 row 4: each pane button carries a count badge — GitLens's own count-badged
             section nodes. -->
        <div class="kv-review-pane-toggle" role="group" aria-label="Review pane">
          <button
            type="button"
            :aria-pressed="review.pane.value === 'commits'"
            :class="{ 'kv-mode-active': review.pane.value === 'commits' }"
            title="Commits"
            :aria-label="`Commits (${commitsCount})`"
            @click="review.setPane('commits')"
          >
            <span class="codicon" :class="ACTION_ICONS.commits" aria-hidden="true"></span>
            <span class="kv-review-pane-badge">{{ commitsCount }}</span>
          </button>
          <button
            type="button"
            :aria-pressed="review.pane.value === 'files'"
            :class="{ 'kv-mode-active': review.pane.value === 'files' }"
            title="Files"
            :aria-label="`Files (${filesChangedCount})`"
            @click="review.setPane('files')"
          >
            <span class="codicon" :class="ACTION_ICONS.files" aria-hidden="true"></span>
            <span class="kv-review-pane-badge">{{ filesChangedCount }}</span>
          </button>
          <button
            type="button"
            :aria-pressed="review.pane.value === 'comments'"
            :class="{ 'kv-mode-active': review.pane.value === 'comments' }"
            title="Comments"
            :aria-label="`Comments (${commentsCount})`"
            @click="review.setPane('comments')"
          >
            <span class="codicon" :class="ACTION_ICONS.comments" aria-hidden="true"></span>
            <span class="kv-review-pane-badge">{{ commentsCount }}</span>
          </button>
        </div>
        <input
          type="text"
          class="kv-review-toolbar-filter"
          placeholder="Filter files"
          aria-label="Filter files"
          :value="filter"
          @input="filter = ($event.target as HTMLInputElement).value"
        />
        <div class="kv-review-toolbar-mode" role="group" aria-label="File list display">
          <button
            type="button"
            :aria-pressed="listMode === 'tree'"
            :class="{ 'kv-mode-active': listMode === 'tree' }"
            title="Tree view"
            aria-label="Tree view"
            @click="listMode = 'tree'"
          >
            <span class="codicon" :class="ACTION_ICONS.listTree" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            :aria-pressed="listMode === 'flat'"
            :class="{ 'kv-mode-active': listMode === 'flat' }"
            title="Flat view"
            aria-label="Flat view"
            @click="listMode = 'flat'"
          >
            <span class="codicon" :class="ACTION_ICONS.listFlat" aria-hidden="true"></span>
          </button>
        </div>
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
            <button
              type="button"
              title="Refresh"
              aria-label="Refresh"
              @click="review.acknowledgeStaleReview()"
            >
              <span class="codicon" :class="ACTION_ICONS.refresh" aria-hidden="true"></span>
            </button>
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

          <div v-if="!review.exhausted.value" class="kv-review-load-more">
            <button
              type="button"
              class="kv-review-load-more-button"
              :disabled="review.isLoadingMore.value"
              @click="handleLoadMore"
            >
              {{ loadMoreLabel() }}
            </button>
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
  padding: var(--kv-space-4);
  color: var(--kv-description-fg);
}

.kv-review-boot-error {
  display: flex;
  flex-direction: column;
  gap: var(--kv-space-3);
  padding: var(--kv-space-4);
}

.kv-review-boot-error p {
  margin: 0;
  color: var(--kv-description-fg);
}

.kv-review-boot-error button {
  align-self: flex-start;
  padding: var(--kv-space-2) var(--kv-space-4);
  border: 1px solid var(--kv-panel-border);
  border-radius: var(--kv-radius);
  background-color: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  cursor: pointer;
}

.kv-review-empty-state,
.kv-review-picker {
  display: flex;
  flex-direction: column;
  gap: var(--kv-space-2);
  padding: var(--kv-space-4);
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

.kv-review-picker-filter {
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  padding: var(--kv-space-1) var(--kv-space-2);
}

.kv-review-picker-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.kv-review-picker-section-title {
  padding: var(--kv-space-2) 0 var(--kv-space-1);
  color: var(--kv-description-fg);
  font-size: 0.8em;
  text-transform: uppercase;
}

.kv-review-picker-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--kv-space-1) var(--kv-space-2);
  border: none;
  background: transparent;
  color: var(--kv-app-fg);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

.kv-review-picker-row:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-review-picker-empty {
  color: var(--kv-description-fg);
  padding: var(--kv-space-1) var(--kv-space-2);
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

.kv-review-summary-line {
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
  font-size: var(--kv-t-xs, 0.85em);
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

.kv-review-toolbar-filter {
  flex: 1;
  min-width: 0;
  height: var(--kv-control-h);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: var(--kv-border-width) solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
  padding: 0 var(--kv-s-3);
  font-family: var(--kv-font-ui);
  font-size: var(--kv-t-sm);
}

/* G12 D16: .p-seg's own shape — one bordered container, children with no border of their own
   except the separator between them. Shared by the Commits/Files toggle and the Tree/Flat
   toggle (and ReviewFilesPane.vue's own Since-review/Full-range toggle, styled the same way). */
.kv-review-pane-toggle,
.kv-review-toolbar-mode {
  display: inline-flex;
  height: var(--kv-control-h);
  border: var(--kv-border-width) solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.kv-review-pane-toggle button,
.kv-review-toolbar-mode button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--kv-s-1);
  width: var(--kv-control-h);
  background: transparent;
  color: var(--kv-row-fg);
  border: none;
  cursor: pointer;
}

/* G14 D8 row 4: the pane toggle's own buttons carry a count badge (Commits/Files/Comments), so
 * they grow to fit it instead of staying icon-only-width. `.kv-review-toolbar-mode` (Tree/Flat)
 * carries no badge and keeps the shared `width: var(--kv-control-h)` above. */
.kv-review-pane-toggle button {
  width: auto;
  padding: 0 var(--kv-s-2);
}

.kv-review-pane-badge {
  font-family: var(--kv-font-ui);
  font-size: var(--kv-t-xs, 0.85em);
  color: inherit;
}

.kv-review-pane-toggle button + button,
.kv-review-toolbar-mode button + button {
  border-left: var(--kv-border-width) solid var(--kv-panel-border);
}

.kv-review-pane-toggle button.kv-mode-active,
.kv-review-toolbar-mode button.kv-mode-active {
  background: var(--kv-row-selected-bg);
  color: var(--kv-row-selected-fg);
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
  padding: var(--kv-space-4);
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

/* G12 D16: Load more stays text (its label carries a count) — .p-btn's own geometry, per D14. */
.kv-review-load-more-button {
  height: var(--kv-control-h);
  padding: 0 var(--kv-s-3);
  border: var(--kv-border-width) solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
  background: transparent;
  color: var(--kv-app-fg);
  font-family: var(--kv-font-ui);
  font-size: var(--kv-t-sm);
  cursor: pointer;
}

.kv-review-load-more-button:hover:not(:disabled) {
  background-color: var(--kv-row-hover-bg);
}

.kv-review-load-more-button:disabled {
  cursor: default;
  opacity: 0.7;
}

/*
 * G12 D14: FileTree.vue is shared with the graph panel's DetailPane, which must stay byte-
 * identical (D14's own guarantee). So its row geometry is restyled here, from the review side,
 * under the .kv-skin-kira ancestor — never by editing FileTree.vue's own base rules, which would
 * apply the new scale to the graph panel too. Colour is untouched; only spacing/height/font-role.
 */
.kv-skin-kira .kv-file-tree-row {
  gap: var(--kv-s-2);
  min-height: var(--kv-control-h);
  padding: var(--kv-s-1) var(--kv-s-4);
}

.kv-skin-kira .kv-file-tree-status,
.kv-skin-kira .kv-file-tree-name {
  font-family: var(--kv-font-data); /* LAW 08: a file path is data. */
}

.kv-skin-kira .kv-file-tree-dir-name,
.kv-skin-kira .kv-file-tree-dir-stats,
.kv-skin-kira .kv-file-tree-counts {
  font-family: var(--kv-font-ui);
}
</style>
