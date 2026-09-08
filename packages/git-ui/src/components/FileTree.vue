<script setup lang="ts">
/**
 * `docs/plans/P5.md` W8: §6.4 item 2 — the file tree, its tree/flat toggle, its filter box, and
 * (in this component's own header, per the plan's own placement decision) the merge parent
 * selector. Rendering itself is the only thing this file adds on top of `fileTreeModel.ts`'s pure
 * fold; every piece of "what row goes where" is that module's job, not this one's.
 */
import type { CommitStore } from '@kira/git-core';
import type { FileChange, ReviewFileStatus } from '@kira/git-ipc';
import { computed, nextTick, ref, watch } from 'vue';
import { ACTION_ICONS } from '../icons/index.ts';
import type { FileListMode } from '../state/detail.ts';
import type { DetailActions } from '../state/detailActions.ts';
import { exactCount, formatChangeCount } from './countFormat.ts';
import {
  buildFileTree,
  buildFlatList,
  capRows,
  FILE_TREE_ROW_CAP,
  type FileTreeRow,
  fileIconFor,
  filterFiles,
  flattenTreeRows,
  renameDisplay,
  STATUS_COLOR_CLASS,
  STATUS_LETTERS,
} from './fileTreeModel.ts';

const props = defineProps<{
  files: readonly FileChange[];
  selectedFile: number;
  listMode: FileListMode;
  filter: string;
  parents: readonly string[];
  parentIndex: number;
  store: CommitStore;
  actions: DetailActions;
  /** G11 D16: the review sidebar's Files pane only — a per-path reviewed status, keyed by
   *  `FileChange.path`. Absent (the default, every other caller of this component) renders
   *  byte-identically to before this prop existed: no checkbox, no badge, nothing — `DetailPane.vue`
   *  and `StashDetailPane.vue` are provably unaffected. */
  reviewStates?: ReadonlyMap<string, ReviewFileStatus>;
  /** G12 D13: whether this instance renders its own filter/list-mode toolbar. `false` when a
   *  panel above it owns one for several trees at once (the review sidebar) — `DetailPane.vue`,
   *  which mounts exactly one tree, leaves this unset and gets today's behaviour byte for byte. */
  showToolbar?: boolean; // default true
  /** G14 D8: the review sidebar's own GitLens-shaped file-row anatomy — a fixed `--kv-icon-box`
   *  status cell (rather than an `em`-relative one) and, in flat-list mode, the file's directory
   *  dimmed after its name. Scoped to the review sidebar's own instances (`ReviewCommitRow.vue`,
   *  `ReviewFilesPane.vue`) rather than this component globally — `DetailPane.vue`'s tree (which
   *  G14 D1 restored) leaves this unset and keeps today's appearance byte for byte (§0.3: no graph
   *  restyle). */
  reviewStyled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'selectFile', fileIndex: number): void;
  (e: 'update:listMode', mode: FileListMode): void;
  (e: 'update:filter', text: string): void;
  (e: 'update:parentIndex', index: number): void;
  /** G11 D16: the reviewed checkbox's own click — toggles path between fully reviewed and
   *  unreviewed (the file-level toggle; per-range toggling lives in DiffView.vue's own review
   *  adornment). Never emitted when reviewStates is absent. */
  (e: 'toggleReviewed', path: string): void;
}>();

const filterInput = ref(props.filter);
watch(
  () => props.filter,
  (value) => {
    filterInput.value = value;
  },
);
function onFilterInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  filterInput.value = value;
  emit('update:filter', value);
}

const collapsedDirs = ref<Set<string>>(new Set());
function isExpanded(path: string): boolean {
  return !collapsedDirs.value.has(path);
}
function toggleDir(path: string): void {
  const next = new Set(collapsedDirs.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsedDirs.value = next;
}
function expandDir(path: string): void {
  if (!collapsedDirs.value.has(path)) return;
  const next = new Set(collapsedDirs.value);
  next.delete(path);
  collapsedDirs.value = next;
}
function collapseDir(path: string): void {
  if (collapsedDirs.value.has(path)) return;
  const next = new Set(collapsedDirs.value);
  next.add(path);
  collapsedDirs.value = next;
}

const indexed = computed(() => filterFiles(props.files, props.filter));

const rows = computed<FileTreeRow[]>(() => {
  if (props.listMode === 'flat') {
    return buildFlatList(indexed.value).map((node) => ({
      kind: 'file' as const,
      node,
      depth: 0,
    }));
  }
  return flattenTreeRows(buildFileTree(indexed.value), isExpanded);
});

/** §8's cap, lifted for the current commit once "Show all N files" is clicked — not persisted
 *  (a fresh commit selection gets the cap again; §8 is about one pathological commit, not a
 *  standing preference). */
const capLifted = ref(false);
watch(
  () => props.files,
  () => {
    capLifted.value = false;
  },
);
const capped = computed(() =>
  capRows(rows.value, capLifted.value ? Number.POSITIVE_INFINITY : FILE_TREE_ROW_CAP),
);

const treeEl = ref<HTMLDivElement | null>(null);
const focusedRow = ref(0);

/** Keeps the keyboard cursor in step with `selectedFile` however it changed — a mouse click on a
 *  row (handled locally, below), or `DetailState.selectFile` being driven from outside this
 *  component entirely (W9's `Alt+↑`/`Alt+↓` file-to-file navigation while focus is in the diff).
 *  A `selectedFile` the current filter/list-mode has hidden leaves the cursor where it was. */
watch(
  [() => props.selectedFile, capped],
  ([selectedFile]) => {
    const rowsNow = capped.value.visible;
    const index = rowsNow.findIndex(
      (row) => row.kind === 'file' && row.node.fileIndex === selectedFile,
    );
    if (index !== -1) focusedRow.value = index;
    else if (focusedRow.value >= rowsNow.length) focusedRow.value = Math.max(0, rowsNow.length - 1);
  },
  { immediate: true },
);

/** P5 W14: a single roving `tabindex` on the file cursor (`focusedRow`'s own row) rather than the
 *  container — the same real-DOM-focus roving pattern `CommitGrid.vue`'s own rows use, not
 *  `aria-activedescendant` (a screen reader tracks whichever DOM node actually has focus, and this
 *  keeps every row a genuinely reachable `Tab` stop). */
function rowId(index: number): string {
  return `kv-file-tree-row-${index}`;
}
function focusRowEl(index: number): void {
  void nextTick(() => {
    treeEl.value?.querySelector<HTMLElement>(`#${rowId(index)}`)?.focus({ preventScroll: true });
  });
}
watch(focusedRow, (index) => {
  // Only follow the cursor with *real* focus when the tree already holds it — otherwise a
  // `selectedFile` sync driven from outside (the `watch` just above, on a fresh mount or an
  // Alt+←/→ file-to-file move made while focus is in the diff) would steal focus into the tree
  // uninvited. `focusTree()` below is the one explicit, intentional exception.
  if (treeEl.value?.contains(document.activeElement)) focusRowEl(index);
});

/** Exposed for `DetailPane.vue` to call after `Esc`/the back affordance returns from the diff to
 *  the tree (P5 W14's own "leaving the diff returns focus to the file it was showing, not to the
 *  top of the tree") — the one case where focus must move into a component that, an instant ago,
 *  did not even exist in the DOM, so the reactive `watch` above (which requires the tree to
 *  already contain focus) cannot fire on its own. */
function focusTree(): void {
  focusRowEl(focusedRow.value);
}
defineExpose({ focusTree });

/** P5 W14: announces §8's render cap once per boundary crossing (a fresh commit whose file count
 *  is over the cap, or the filter narrowing back above it after being below) — not on every
 *  keystroke that leaves the cap in the same state, which `capped` itself recomputes on. */
let lastHiddenCount: number | undefined;
watch(
  capped,
  (value) => {
    if (value.hiddenCount > 0 && value.hiddenCount !== lastHiddenCount) {
      props.actions.announce(`Showing ${value.visible.length} of ${rows.value.length} files`);
    }
    lastHiddenCount = value.hiddenCount;
  },
  { immediate: true },
);

function rowKey(row: FileTreeRow): string {
  return row.kind === 'directory' ? `dir:${row.node.path}` : `file:${row.node.path}`;
}

function selectRow(index: number, options: { follow?: boolean } = {}): void {
  const row = capped.value.visible[index];
  if (!row) return;
  focusedRow.value = index;
  if (row.kind === 'directory') return;
  if (options.follow !== false) emit('selectFile', row.node.fileIndex);
}

function onRowClick(index: number): void {
  const row = capped.value.visible[index];
  if (!row) return;
  if (row.kind === 'directory') {
    focusedRow.value = index;
    toggleDir(row.node.path);
    return;
  }
  selectRow(index);
}

function onKeydown(event: KeyboardEvent): void {
  const visible = capped.value.visible;
  if (visible.length === 0) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      selectRow(Math.min(focusedRow.value + 1, visible.length - 1));
      break;
    case 'ArrowUp':
      event.preventDefault();
      selectRow(Math.max(focusedRow.value - 1, 0));
      break;
    case 'Home':
      event.preventDefault();
      selectRow(0);
      break;
    case 'End':
      event.preventDefault();
      selectRow(visible.length - 1);
      break;
    case 'ArrowRight': {
      const row = visible[focusedRow.value];
      if (row?.kind === 'directory') {
        event.preventDefault();
        expandDir(row.node.path);
      }
      break;
    }
    case 'ArrowLeft': {
      const row = visible[focusedRow.value];
      if (row?.kind === 'directory') {
        event.preventDefault();
        collapseDir(row.node.path);
      }
      break;
    }
    case 'Enter': {
      const row = visible[focusedRow.value];
      if (!row) break;
      event.preventDefault();
      if (row.kind === 'directory') toggleDir(row.node.path);
      else emit('selectFile', row.node.fileIndex);
      break;
    }
    default:
      break;
  }
}

interface ParentOption {
  readonly sha: string;
  readonly label: string;
}

const parentOptions = computed<ParentOption[]>(() =>
  props.parents.map((sha, index) => {
    const row = props.store.rowOfSha(sha);
    const subject = row !== -1 ? props.store.subjectAt(row) : undefined;
    const shortSha = sha.slice(0, 7);
    const label = subject
      ? `Parent ${index + 1} · ${shortSha} · ${subject}`
      : `Parent ${index + 1} · ${shortSha}`;
    return { sha, label };
  }),
);

function onParentChange(event: Event): void {
  emit('update:parentIndex', Number((event.target as HTMLSelectElement).value));
}

function statusLetter(change: FileChange): string {
  return STATUS_LETTERS[change.kind];
}

function statusClass(change: FileChange): string {
  return STATUS_COLOR_CLASS[change.kind];
}

/** G19 D14: the row's primary leading glyph — a coarse extension-based codicon, replacing the
 *  status letter in that role; the letter itself is kept, demoted to a small secondary chip
 *  (SPEC's own wording: kept, not removed). */
function fileIcon(path: string): string {
  return fileIconFor(path);
}

function fileTitle(change: FileChange): string {
  const rename = renameDisplay(change);
  if (rename && change.similarity !== undefined) {
    return `${change.similarity}% similar — ${rename.from} → ${rename.to}`;
  }
  return change.path;
}

function copyPath(path: string): void {
  props.actions.copy(path, 'file path');
}

/** G14 D8: the directory portion of a flat-mode row's path, for the review sidebar's dimmed-
 *  directory-after-filename anatomy — `''` for a root-level file (nothing to show). Tree mode
 *  never calls this: the nesting itself already says which directory a row is in. */
function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

// G11 D16: the reviewed checkbox/badge — every accessor is a no-op-shaped lookup when
// reviewStates is absent, but the template only ever calls these behind `v-if="reviewStates"`.
function reviewStatusFor(path: string): ReviewFileStatus | undefined {
  return props.reviewStates?.get(path);
}
function reviewToggleIcon(path: string): string {
  switch (reviewStatusFor(path)?.kind) {
    case 'full':
      return 'codicon-pass-filled';
    case 'partial':
      return 'codicon-circle-large-filled';
    default:
      return 'codicon-circle-large-outline';
  }
}
function reviewToggleTitle(path: string): string {
  const kind = reviewStatusFor(path)?.kind ?? 'none';
  return kind === 'none' ? 'Mark reviewed' : 'Mark unreviewed';
}
</script>

<template>
  <div class="kv-file-tree" data-testid="file-tree">
    <div v-if="parentOptions.length > 1" class="kv-file-tree-parent">
      <label for="kv-parent-select">Diffing against</label>
      <select id="kv-parent-select" :value="parentIndex" @change="onParentChange">
        <option v-for="(option, index) in parentOptions" :key="option.sha" :value="index">
          {{ option.label }}
        </option>
      </select>
    </div>

    <div v-if="showToolbar !== false" class="kv-file-tree-toolbar">
      <input
        type="text"
        class="kv-file-tree-filter"
        placeholder="Filter files"
        aria-label="Filter files"
        :value="filterInput"
        @input="onFilterInput"
      />
      <div class="kv-file-tree-mode" role="group" aria-label="File list display">
        <button
          type="button"
          :aria-pressed="listMode === 'tree'"
          :class="{ 'kv-mode-active': listMode === 'tree' }"
          title="Tree view"
          aria-label="Tree view"
          @click="emit('update:listMode', 'tree')"
        >
          <span class="codicon" :class="ACTION_ICONS.listTree" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          :aria-pressed="listMode === 'flat'"
          :class="{ 'kv-mode-active': listMode === 'flat' }"
          title="Flat view"
          aria-label="Flat view"
          @click="emit('update:listMode', 'flat')"
        >
          <span class="codicon" :class="ACTION_ICONS.listFlat" aria-hidden="true"></span>
        </button>
      </div>
    </div>

    <div
      ref="treeEl"
      class="kv-file-tree-rows"
      :aria-label="listMode === 'tree' ? 'File tree' : 'File list'"
      :role="listMode === 'tree' ? 'tree' : 'listbox'"
      @keydown="onKeydown"
    >
      <div
        v-for="(row, index) in capped.visible"
        :id="rowId(index)"
        :key="rowKey(row)"
        class="kv-file-tree-row"
        :class="{ 'kv-row-focused': index === focusedRow, 'kv-row-selected': row.kind === 'file' && row.node.fileIndex === selectedFile }"
        :role="listMode === 'tree' ? 'treeitem' : 'option'"
        :aria-level="listMode === 'tree' ? row.depth + 1 : undefined"
        :aria-expanded="listMode === 'tree' && row.kind === 'directory' ? row.expanded : undefined"
        :aria-selected="row.kind === 'file' ? row.node.fileIndex === selectedFile : undefined"
        :tabindex="index === focusedRow ? 0 : -1"
        :style="{ paddingLeft: `calc(var(--kv-tree-indent) * ${row.depth})` }"
        @click="onRowClick(index)"
      >
        <template v-if="row.kind === 'directory'">
          <span
            class="codicon kv-file-tree-chevron"
            :class="row.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
            aria-hidden="true"
          ></span>
          <span class="kv-file-tree-dir-name">{{ row.node.name }}</span>
          <span class="kv-file-tree-dir-stats">
            {{ row.node.fileCount }} {{ row.node.fileCount === 1 ? "file" : "files" }}
            <span class="kv-diff-added-fg" :title="`${exactCount(row.node.additions)} additions`"
              >+{{ formatChangeCount(row.node.additions) }}</span
            >
            <span class="kv-diff-deleted-fg" :title="`${exactCount(row.node.deletions)} deletions`"
              >-{{ formatChangeCount(row.node.deletions) }}</span
            >
          </span>
        </template>
        <template v-else>
          <span class="kv-file-tree-icon codicon" :class="fileIcon(row.node.path)" aria-hidden="true"></span>
          <span
            class="kv-file-tree-status kv-file-tree-status-chip"
            :class="statusClass(row.node.change)"
            :title="fileTitle(row.node.change)"
            >{{ statusLetter(row.node.change) }}</span
          >
          <span class="kv-file-tree-name" :title="fileTitle(row.node.change)">
            <template v-if="renameDisplay(row.node.change)">
              {{ renameDisplay(row.node.change)?.from }}
              <span class="codicon codicon-arrow-small-right" aria-hidden="true"></span>
              {{ renameDisplay(row.node.change)?.to }}
            </template>
            <template v-else>{{ row.node.name }}</template>
          </span>
          <span
            v-if="reviewStyled && listMode === 'flat' && dirOf(row.node.path)"
            class="kv-file-tree-file-dir"
            >{{ dirOf(row.node.path) }}</span
          >
          <span v-if="!row.node.change.isBinary" class="kv-file-tree-counts">
            <span
              class="kv-diff-added-fg"
              :title="`${exactCount(row.node.change.additions ?? 0)} additions`"
              >+{{ formatChangeCount(row.node.change.additions ?? 0) }}</span
            >
            <span
              class="kv-diff-deleted-fg"
              :title="`${exactCount(row.node.change.deletions ?? 0)} deletions`"
              >-{{ formatChangeCount(row.node.change.deletions ?? 0) }}</span
            >
          </span>
          <span
            v-if="reviewStates && reviewStatusFor(row.node.change.path)?.changedSinceReview"
            class="kv-file-tree-changed-badge"
            title="Changed since you reviewed it"
            aria-hidden="true"
            >●</span
          >
          <button
            v-if="reviewStates"
            type="button"
            class="kv-copy-button kv-file-tree-review-toggle"
            :title="reviewToggleTitle(row.node.change.path)"
            :aria-pressed="reviewStatusFor(row.node.change.path)?.kind === 'full'"
            @click.stop="emit('toggleReviewed', row.node.change.path)"
          >
            <span class="codicon" :class="reviewToggleIcon(row.node.change.path)" aria-hidden="true"></span>
          </button>
          <button
            v-if="actions.capabilities.clipboard"
            type="button"
            class="kv-copy-button kv-file-tree-copy"
            title="Copy file path"
            @click.stop="copyPath(row.node.change.path)"
          >
            <span class="codicon codicon-copy" aria-hidden="true"></span>
          </button>
        </template>
      </div>

      <button
        v-if="capped.hiddenCount > 0"
        type="button"
        class="kv-file-tree-show-all"
        @click="capLifted = true"
      >
        Show all {{ rows.length }} files
      </button>
    </div>
  </div>
</template>

<style>
.kv-file-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.kv-file-tree-parent {
  display: flex;
  flex-direction: column;
  gap: var(--kv-space-1);
  padding: 0 var(--kv-space-4) var(--kv-space-3);
  font-size: 0.9em;
}

.kv-file-tree-toolbar {
  display: flex;
  gap: var(--kv-space-2);
  padding: 0 var(--kv-space-4) var(--kv-space-2);
}

.kv-file-tree-filter {
  flex: 1;
  min-width: 0;
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  padding: var(--kv-space-1) var(--kv-space-2);
}

.kv-file-tree-mode {
  display: flex;
}

.kv-file-tree-mode button {
  background: transparent;
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  cursor: pointer;
  padding: 0 var(--kv-space-2);
}

.kv-file-tree-mode button.kv-mode-active {
  background: var(--kv-row-selected-bg);
  color: var(--kv-row-selected-fg);
}

.kv-file-tree-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  outline: none;
}

.kv-file-tree-row {
  display: flex;
  align-items: center;
  gap: var(--kv-space-2);
  padding: var(--kv-space-1) var(--kv-space-4);
  cursor: pointer;
  white-space: nowrap;
}

.kv-file-tree-row:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-file-tree-row.kv-row-selected {
  background-color: var(--kv-row-selected-bg);
  color: var(--kv-row-selected-fg);
}

.kv-file-tree-rows:focus-within .kv-file-tree-row.kv-row-focused {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -1px;
}

.kv-file-tree-chevron {
  font-size: 12px;
  width: 12px;
}

.kv-file-tree-dir-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kv-file-tree-dir-stats {
  margin-left: auto;
  color: var(--kv-description-fg);
  font-size: 0.85em;
  display: flex;
  gap: var(--kv-space-2);
}

/* G19 D14: the row's primary leading glyph — a coarse extension-based codicon (`fileIconFor`),
 * taking over the leading-icon role the status letter used to occupy. */
.kv-file-tree-icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  color: var(--kv-description-fg);
  font-size: 14px;
}

.kv-file-tree-status {
  font-family: var(--kv-mono-font-family);
  font-weight: 700;
  flex-shrink: 0;
}

/* G19 D14: the status letter, demoted from the row's primary glyph to a small secondary chip
 * (kept, per SPEC's own wording, not removed) now that the file-type icon above owns the
 * leading-glyph role. */
.kv-file-tree-status-chip {
  width: 1.3em;
  height: 1.3em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  font-size: 0.75em;
  background-color: var(--kv-badge-bg);
  color: var(--kv-badge-fg);
}

.kv-status-added {
  color: var(--kv-diff-added-fg);
}
.kv-status-modified {
  color: var(--kv-diff-modified-fg);
}
.kv-status-deleted {
  color: var(--kv-diff-deleted-fg);
}
.kv-status-renamed {
  color: var(--kv-diff-renamed-fg);
}
.kv-status-copied {
  color: var(--kv-diff-copied-fg);
}
.kv-status-typechanged {
  color: var(--kv-diff-typechanged-fg);
}
.kv-status-unmerged {
  color: var(--kv-diff-unmerged-fg);
}

.kv-file-tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* G14 D8: the review sidebar's own dimmed-directory-after-filename (row 5, flat-list mode only —
 * tree mode already nests by directory). GitLens's own file-node anatomy. */
.kv-file-tree-file-dir {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--kv-description-fg);
  font-size: var(--kv-t-xs, 0.85em);
}

.kv-file-tree-counts {
  margin-left: auto;
  font-size: 0.85em;
  display: flex;
  gap: var(--kv-space-2);
  flex-shrink: 0;
}

.kv-diff-added-fg {
  color: var(--kv-diff-added-fg);
}
.kv-diff-deleted-fg {
  color: var(--kv-diff-deleted-fg);
}

.kv-file-tree-copy {
  flex-shrink: 0;
}

.kv-file-tree-changed-badge {
  flex-shrink: 0;
  font-size: 0.5em;
  color: var(--kv-diff-modified-fg);
}

.kv-file-tree-review-toggle {
  flex-shrink: 0;
}

.kv-file-tree-review-toggle[aria-pressed='true'] {
  color: var(--kv-diff-added-fg);
}

.kv-file-tree-show-all {
  width: 100%;
  background: transparent;
  color: var(--kv-focus-border);
  border: none;
  border-top: 1px solid var(--kv-panel-border);
  padding: var(--kv-space-2);
  cursor: pointer;
}
</style>
