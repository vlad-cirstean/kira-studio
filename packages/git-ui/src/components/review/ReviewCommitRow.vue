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

function onRowClick(): void {
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

function copySha(event: MouseEvent): void {
  event.stopPropagation();
  const c = commit.value;
  if (c) props.expansion?.actions.copy(c.sha, 'full SHA');
}

// G12 D12: opens VS Code's native diff directly — no in-webview diff mode to flip into. `sha`'s
// own parentIndex is this row's current merge-parent selection, exactly what commit.detail was
// fetched against.
function onSelectFile(index: number): void {
  const exp = props.expansion;
  const file = exp?.detail.detail.value?.files[index];
  if (!exp || !file) return;
  void exp.actions.openInEditor({
    sha: props.sha,
    path: file.path,
    originalPath: file.originalPath,
    parentIndex: exp.detail.parentIndex.value,
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
    @click="onRowClick"
    @keydown="onKeydown"
    @contextmenu="onContextMenu"
  >
    <div class="kv-review-row-header">
      <span
        class="codicon kv-review-row-chevron"
        :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        aria-hidden="true"
      ></span>
      <span class="kv-review-row-subject">{{ commit.subject }}</span>
      <button
        v-if="expansion?.actions.capabilities.clipboard"
        type="button"
        class="kv-review-row-sha"
        :title="`Copy full SHA (${sha})`"
        @click="copySha"
      >
        {{ shortSha }}
      </button>
      <span v-else class="kv-review-row-sha">{{ shortSha }}</span>
      <span class="kv-review-row-author">{{ commit.author.name }}</span>
      <span class="kv-review-row-date">{{ dateText }}</span>
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
        @select-file="onSelectFile"
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
  min-height: var(--kv-control-h);
  padding: var(--kv-s-2) var(--kv-s-3);
  min-width: 0;
  font-family: var(--kv-font-ui);
}

.kv-review-row-chevron {
  font-size: 12px;
  width: 12px;
  flex-shrink: 0;
}

.kv-review-row-subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-review-row-sha {
  font-family: var(--kv-mono-font-family);
  color: var(--kv-description-fg);
  flex-shrink: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

.kv-review-row-author,
.kv-review-row-date {
  color: var(--kv-description-fg);
  font-size: 0.9em;
  flex-shrink: 0;
  white-space: nowrap;
}

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
  padding: var(--kv-space-3);
  color: var(--kv-description-fg);
}

.kv-review-row-error {
  color: var(--kv-error-fg);
}
</style>
