<script setup lang="ts">
/**
 * `docs/plans/P7.md` W13 — one commit in the review list. Collapsed: a disclosure triangle,
 * subject, short sha (`§6.4`'s "clicking a sha copies it"), author, relative date. Expanded:
 * `FileTree.vue` over this row's own `DetailState` (`ReviewSessionState.expand` fetches
 * `commit.detail` on first expansion and keeps it for the session — this component never fetches
 * anything itself). `→`/`←`/`Enter` toggle expansion (§6.8 step 2); the row's own context menu is
 * copy-sha/copy-message only (`rowMenuModel.ts`'s `buildReviewRowMenu`, not `buildRowMenu` — this
 * row offers no checkout/branch/tag/revert).
 *
 * G12 D12: opening a file no longer renders an in-webview diff overlay at all — `FileTree`'s
 * selection calls `actions.openInEditor` directly (D11 fixed the URI it produces), the same
 * request `DetailPane.vue`'s own tree already uses. D13: `list-mode`/`filter` are props from
 * `ReviewView.vue`'s one panel-level toolbar, not this row's own `DetailState` fields — every
 * row's `FileTree` renders no toolbar of its own (`show-toolbar="false"`).
 */
import type { CommitStore } from '@kira/git-core';
import { KuiButton } from '@kira/kira-ui';
import { computed, ref } from 'vue';
import type { FileListMode } from '../../state/detail.ts';
import type { ReviewExpansion } from '../../state/review.ts';
import { formatRelativeDate } from '../dateFormat.ts';
import FileTree from '../FileTree.vue';
import RowContextMenu from '../RowContextMenu.vue';
import { buildReviewRowMenu } from '../rowMenuModel.ts';

const props = defineProps<{
  sha: string;
  store: CommitStore;
  expanded: boolean;
  expansion: ReviewExpansion | undefined;
  /** Roving-tabindex cursor (§6.8's tree/treeitem pattern, `FileTree.vue`'s own precedent) —
   *  `ReviewView.vue` owns which row is the cursor across the whole list. */
  focused: boolean;
  /** G12 D13: `ReviewView.vue`'s one panel-level toolbar state, forwarded to this row's own
   *  `FileTree` (which renders no toolbar of its own). */
  listMode: FileListMode;
  filter: string;
  /** G14 D10: the open repository — needed only for the row's "Open in graph" hover action below,
   *  which reaches `kiraVersion.openCommitInGraph` through a `command:` URI (VS Code's own webview
   *  escape hatch for invoking an already-contributed command, gated by `enableCommandUris` on
   *  this webview's own options) rather than a new bridge request — D8 makes no RPC/contract
   *  change, and a command URI is not one: it never touches the Contract type. */
  repoId: string | undefined;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'focus-row'): void;
}>();

const row = computed(() => props.store.rowOfSha(props.sha));
const commit = computed(() => (row.value === -1 ? undefined : props.store.commitAt(row.value)));
const shortSha = computed(() => props.sha.slice(0, 7));
const dateText = computed(() =>
  commit.value ? formatRelativeDate(commit.value.committer.timestamp) : '',
);

/** G-UX D5 (item 5): the row-action cluster (Open all changes, Open in graph) sits inside this
 *  header; a click on it is not a request to expand the row. Guarded here rather than stopped at
 *  each action, because one of those actions is a `command:` anchor VS Code's own bubble-phase
 *  link interceptor must be allowed to see — a `stopPropagation()` on the anchor itself (the old
 *  shape) prevents that interceptor from ever observing the click, so the command URI is never
 *  delivered to the host (F6). */
function onRowClick(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest('.kv-review-row-actions')) return;
  emit('focus-row');
  emit('toggle');
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowRight':
      if (!props.expanded) {
        event.preventDefault();
        emit('toggle');
      }
      break;
    case 'ArrowLeft':
      if (props.expanded) {
        event.preventDefault();
        emit('toggle');
      }
      break;
    case 'Enter':
      event.preventDefault();
      emit('toggle');
      break;
    default:
      break;
  }
}

const menuState = ref<{ x: number; y: number } | undefined>(undefined);

function onContextMenu(event: MouseEvent): void {
  emit('focus-row');
  event.preventDefault();
  menuState.value = { x: event.clientX, y: event.clientY };
}

const menuSections = computed(() =>
  buildReviewRowMenu(props.expansion?.actions.capabilities.clipboard ?? false),
);

function onMenuSelect(id: string): void {
  menuState.value = undefined;
  const c = commit.value;
  const actions = props.expansion?.actions;
  if (!c || !actions) return;
  if (id === 'copySha') actions.copy(c.sha, 'full SHA');
  else if (id === 'copyMessage') actions.copy(c.subject, 'commit message');
}

// G14 D8 row action 1 / G21 D8c: "Open all changes" — one awaited `openAllChanges` call rather
// than N unawaited `openInEditor` calls. Item 8's own remaining problem (i): the old loop fired
// every request in the same tick with a bare `void` and no `.catch`, so a run where 1 of 14 opens
// succeeded and 13 rejected looked, to the user, exactly like "it only shows one file's diff" —
// no announcement, no error surface, no partial-success reporting. This awaits the single host
// round trip and announces the real outcome either way. Needs the commit already expanded (its
// file list fetched); an unexpanded row announces why instead of silently doing nothing.
async function openAllChanges(): Promise<void> {
  // G-UX D5: stopPropagation() here is now redundant with (and removed in favour of) onRowClick's
  // own .kv-review-row-actions guard above -- one rule for the whole action cluster.
  const exp = props.expansion;
  const files = exp?.detail.detail.value?.files;
  if (!exp || !files) {
    exp?.actions.announce('Expand the commit first.');
    return;
  }
  const parentIndex = exp.detail.parentIndex.value;
  try {
    const { opened, failed, mode } = await exp.actions.openAllChanges({
      sha: props.sha,
      parentIndex,
    });
    exp.actions.announce(
      failed === 0
        ? mode === 'multiDiff'
          ? `Opened all ${opened} changed files`
          : `Opened ${opened} files`
        : `Opened ${opened} of ${opened + failed} files — ${failed} couldn't be opened`,
    );
  } catch (err) {
    exp.actions.announce(
      `Couldn't open the changes — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// G14 D8 row action 3 / D10: a `command:` URI (see the `repoId` prop's own doc comment above) —
// `undefined` only while no repo is open yet, in which case the anchor renders `href="#"` and the
// row's own `commit` guard means this template branch cannot actually be reached without a commit,
// which in turn cannot exist without a repository already open.
const openInGraphHref = computed(() => {
  if (!props.repoId) return '#';
  const args = [{ repoId: props.repoId, sha: props.sha }];
  return `command:kiraVersion.openCommitInGraph?${encodeURIComponent(JSON.stringify(args))}`;
});

// G12 D12: opens VS Code's native diff directly — no in-webview diff mode to flip into. `sha`'s
// own parentIndex is this row's current merge-parent selection, exactly what commit.detail was
// fetched against. G21 D13: `pinned` comes straight from FileTree's own `openFile` emit — a
// click (or arrow-key move) is `false`, a double click/`Enter` is `true`.
function onOpenFile(index: number, pinned: boolean): void {
  const exp = props.expansion;
  const file = exp?.detail.detail.value?.files[index];
  if (!exp || !file) return;
  void exp.actions.openInEditor({
    sha: props.sha,
    path: file.path,
    originalPath: file.originalPath,
    parentIndex: exp.detail.parentIndex.value,
    pinned,
  });
}
</script>

<template>
  <div
    v-if="commit"
    class="kv-review-row"
    role="treeitem"
    :aria-expanded="expanded"
    :tabindex="focused ? 0 : -1"
    :data-testid="`review-row-${sha}`"
    @keydown="onKeydown"
    @contextmenu="onContextMenu"
  >
    <!-- G19 D10: the click-to-toggle listener moved here, off the whole row (F10's root cause —
         a click on any file row inside .kv-review-row-body used to bubble straight up and
         collapse the very commit it was clicked inside, since nothing along the way ever called
         stopPropagation()). Only the header itself toggles the row now. -->
    <div
      class="kv-review-row-header"
      :class="{ 'kv-review-row-header-focused': focused }"
      @click="onRowClick"
    >
      <span
        class="codicon kv-review-row-chevron"
        :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        aria-hidden="true"
      ></span>
      <!-- G14 D8 row 1: two lines — subject on its own, full-width line; author/date/sha, muted,
           below it. GitLens's own commit-node anatomy. -->
      <span class="kv-review-row-lines">
        <span class="kv-review-row-subject">{{ commit.subject }}</span>
        <span class="kv-review-row-meta">
          <span class="kv-review-row-author">{{ commit.author.name }}</span>
          <span class="kv-review-row-meta-sep" aria-hidden="true">·</span>
          <span class="kv-review-row-date">{{ dateText }}</span>
          <span class="kv-review-row-meta-sep" aria-hidden="true">·</span>
          <!-- G19 D7: the clickable-sha button and its own "Copy SHA" affordance are gone — the
               sha renders as plain text; the existing copySha context-menu item (buildReviewRowMenu)
               already covers this, and F7 found these two affordances genuinely redundant with it. -->
          <span class="kv-review-row-sha">{{ shortSha }}</span>
        </span>
      </span>
      <!-- G14 D8 row 2: inline icon actions, right-aligned — revealed on hover/focus-within
           (below) and always present for the roving-tabindex-focused row. GitLens's own
           row-action pattern. -->
      <span class="kv-review-row-actions">
        <KuiButton
          variant="icon"
          icon="codicon-diff-multiple"
          v-kui-tooltip="'Open all changes'"
          aria-label="Open all changes"
          @click="openAllChanges"
        />
        <!-- G-UX D5 (item 5): no @click.stop -- a stopPropagation() on this anchor's own listener
             prevents VS Code's bubble-phase link interceptor (registered on the webview document)
             from ever observing the click, so the command: URI is never delivered to the host
             (F6). onRowClick's own .kv-review-row-actions guard above is what keeps this click
             from also toggling the row -- the correct fix reaches up the tree, not down.
             G34 D15: this must stay a real <a href="command:…"> (VS Code's own link interceptor is
             what delivers the command URI), so it wears the button classes directly rather than
             becoming a KuiButton — bespoke in *element* only, never in appearance. -->
        <a
          class="kui-button kui-button--icon"
          v-kui-tooltip="'Open in graph'"
          aria-label="Open in graph"
          :href="openInGraphHref"
        >
          <span class="codicon codicon-git-commit" aria-hidden="true"></span>
        </a>
      </span>
    </div>

    <div v-if="expanded" class="kv-review-row-body">
      <p v-if="expansion?.detail.error.value" class="kv-review-row-error">
        Couldn't load this commit — {{ expansion.detail.error.value }}
      </p>
      <FileTree
        v-else-if="expansion?.detail.detail.value"
        :files="expansion.detail.detail.value.files"
        :selected-file="expansion.detail.selectedFile.value"
        :list-mode="listMode"
        :filter="filter"
        :show-toolbar="false"
        :parents="expansion.detail.detail.value.parents"
        :parent-index="expansion.detail.parentIndex.value"
        :store="store"
        :actions="expansion.actions"
        @open-file="onOpenFile"
        @update:parent-index="expansion.detail.setParentIndex($event)"
      />
      <p v-else class="kv-review-row-loading">Loading…</p>
    </div>

    <RowContextMenu
      v-if="menuState"
      :sections="menuSections"
      :x="menuState.x"
      :y="menuState.y"
      label="Commit actions"
      @select="onMenuSelect"
      @close="menuState = undefined"
    />
  </div>
</template>

<style>
.kv-review-row {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--kv-panel-border);
  cursor: pointer;
}

/* W17: scoped to the header, not the whole row — `--kv-row-hover-bg` behind
 * `.kv-review-row-body`'s own `--kv-diff-deleted-fg` text (the FileTree's per-file/per-directory
 * deletion count) drops below 4.5:1 in `vscode-dark` (axe caught it: hovering an *expanded* row
 * left the lighter hover tint sitting behind that red text, something the panel's own detail pane
 * never risked, since a grid row's hover state lives in a wholly different region from the detail
 * pane it reveals). The row's own background — `--kv-app-bg`, via `.kv-review-view` — is what the
 * body already sits on while unhovered, and that combination already passes. */
.kv-review-row:hover .kv-review-row-header {
  background-color: var(--kv-row-hover-bg);
}

.kv-review-row:focus-visible {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -2px;
}

.kv-review-row-header {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  padding: var(--kv-s-2) var(--kv-s-3);
  min-width: 0;
  font-family: var(--kv-font-ui);
}

.kv-review-row-chevron {
  font-size: 12px;
  width: 12px;
  flex-shrink: 0;
}

/* G14 D8 row 1: the two-line stack — subject above, muted author/date/sha below. */
.kv-review-row-lines {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
  flex: 1;
  min-width: 0;
}

.kv-review-row-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-review-row-meta {
  display: flex;
  align-items: center;
  gap: var(--kv-s-1);
  color: var(--kv-description-fg);
  font-size: var(--kv-t-xs);
  white-space: nowrap;
  overflow: hidden;
}

.kv-review-row-meta-sep {
  flex-shrink: 0;
}

.kv-review-row-author,
.kv-review-row-date {
  overflow: hidden;
  text-overflow: ellipsis;
}

.kv-review-row-sha {
  font-family: var(--kv-mono-font-family);
  color: inherit;
  flex-shrink: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

/* G14 D8 row 2: hidden until the row is hovered/focus-within, or is the roving-tabindex cursor
 * (`.kv-review-row-header-focused`, set from the `focused` prop) — GitLens's own row-action
 * pattern, always visible for the keyboard-focused row so the actions are reachable without a
 * mouse. */
.kv-review-row-actions {
  display: flex;
  align-items: center;
  gap: var(--kv-s-1);
  flex-shrink: 0;
  opacity: 0;
}

.kv-review-row:hover .kv-review-row-actions,
.kv-review-row:focus-within .kv-review-row-actions,
.kv-review-row-header-focused .kv-review-row-actions {
  opacity: 1;
}

/* G34 D14: `.kv-review-row-action` is gone — its `:hover` painted the *selection* blue, not a
   hover tint (F9 in the G34 plan); `.kui-button`/`.kui-button--icon`'s own hover is correct and
   is what both the KuiButton above and the `<a class="kui-button kui-button--icon">` now get. */

.kv-review-row-body {
  border-top: 1px solid var(--kv-panel-border);
  min-height: 120px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
}

.kv-review-row-error,
.kv-review-row-loading {
  margin: 0;
  padding: var(--kv-s-4);
  color: var(--kv-description-fg);
}

.kv-review-row-error {
  color: var(--kv-error-fg);
}
</style>
