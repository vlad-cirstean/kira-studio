<script setup lang="ts">
/**
 * `docs/plans/P5.md` W8: §6.4 item 2 — the file tree, its tree/flat toggle, its filter box, and
 * (in this component's own header, per the plan's own placement decision) the merge parent
 * selector. Rendering itself is the only thing this file adds on top of `fileTreeModel.ts`'s pure
 * fold; every piece of "what row goes where" is that module's job, not this one's.
 *
 * G21 D11 (item 11): one component, one anatomy. The review-only-styling prop G14 D8 added so this
 * file could render *two different anatomies* (a dimmed flat-mode directory suffix, an inline
 * copy button vs. a right-click "Copy path" menu) depending on caller, in service of a
 * byte-identity guarantee the graph panel's tree needed while it still embedded a diff — is gone.
 * Items 9/10/12/13 already changed the graph tree's icons, status glyph, and click/double-click
 * behaviour; there is no byte-identity guarantee left to protect, so the review anatomy (the row
 * geometry `ReviewView.vue` used to restyle from outside under `.kv-skin-kira`, and the
 * dimmed-directory-suffix/context-menu-copy behaviour) is now this component's *only* appearance,
 * everywhere it mounts — `DetailPane.vue`, `StashDetailPane.vue`, `ReviewFilesPane.vue`,
 * `ReviewCommitRow.vue` alike.
 */
import type { CommitStore } from '@kira/git-core';
import type { FileChange, ReviewFileStatus } from '@kira/git-ipc';
import type { KuiSegmentedOption } from '@kira/kira-ui';
import { KuiButton, KuiContextMenu, KuiSearchInput, KuiSegmented, KuiSelect } from '@kira/kira-ui';
import { computed, nextTick, ref, watch } from 'vue';
import { ACTION_ICONS } from '../icons/index.ts';
import { setiIconFor } from '../icons/setiFileIcon.ts';
import type { FileListMode } from '../state/detail.ts';
import type { DetailActions } from '../state/detailActions.ts';
import { exactCount, formatChangeCount } from './countFormat.ts';
import {
  buildFileTree,
  buildFlatList,
  capRows,
  FILE_TREE_ROW_CAP,
  type FileTreeRow,
  filterFiles,
  flattenTreeRows,
  renameDisplay,
  STATUS_COLOR_CLASS,
  STATUS_LETTERS,
} from './fileTreeModel.ts';
import { buildFileRowMenu } from './rowMenuModel.ts';

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
   *  which mounts exactly one tree, leaves this unset and gets today's behaviour byte for byte.
   *  A real layout fact, not an anatomy fork (G21 D11's own reasoning): the review panel owns one
   *  toolbar for two panes, the graph and stash panels each own exactly one tree, so the toolbar
   *  belongs to whichever owns it — unlike the review-styling prop this file used to also carry,
   *  this one is not something D11 removes. */
  showToolbar?: boolean; // default true
}>();

const emit = defineEmits<{
  /** The file cursor moved (a click, arrow-key nav, or a directory toggle's own side effect) —
   *  purely a cursor/selection signal now (G21 D13): no caller may infer that anything opened
   *  from this alone. `DetailPane.vue`/`StashDetailPane.vue` forward it straight into
   *  `DetailState`/`StashState`'s own `selectFile`, which only moves the highlight. */
  (e: 'selectFile', fileIndex: number): void;
  /** G21 D13: a file row was opened — a click or arrow-key move (`pinned: false`, navigational:
   *  VS Code's own preview-tab convention governs, the next such open replaces it) or a double
   *  click/`Enter` (`pinned: true`, an explicit "keep this" that pins a real, permanent tab).
   *  Always paired with a `selectFile` for the same `fileIndex` when it originates from
   *  `selectRow` (a click or arrow-key move); a double click/`Enter` fires this alone, since the
   *  row is already the selection by the time either can happen. */
  (e: 'openFile', fileIndex: number, pinned: boolean): void;
  (e: 'update:listMode', mode: FileListMode): void;
  (e: 'update:filter', text: string): void;
  (e: 'update:parentIndex', index: number): void;
  /** G11 D16: the reviewed checkbox's own click — toggles path between fully reviewed and
   *  unreviewed (the file-level toggle; per-range toggling lives in the native diff editor now,
   *  G21 D12 — it used to live in DiffView.vue's own review adornment, already unreachable dead
   *  code by the time this phase deleted the file). Never emitted when reviewStates is absent. */
  (e: 'toggleReviewed', path: string): void;
}>();

const listModeOptions: readonly KuiSegmentedOption[] = [
  { id: 'tree', icon: ACTION_ICONS.listTree, label: 'Tree view' },
  { id: 'flat', icon: ACTION_ICONS.listFlat, label: 'Flat view' },
];

const filterInput = ref(props.filter);
watch(
  () => props.filter,
  (value) => {
    filterInput.value = value;
  },
);
function onFilterInput(value: string): void {
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
 *  row (handled locally, below), or `selectedFile` being driven from outside this component
 *  entirely (a parent-commit pick, a repo refresh re-resolving a selection). A `selectedFile` the
 *  current filter/list-mode has hidden leaves the cursor where it was. */
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
  // `selectedFile` sync driven from outside (the `watch` just above, on a fresh mount or a
  // parent-commit pick) would steal focus into the tree uninvited.
  if (treeEl.value?.contains(document.activeElement)) focusRowEl(index);
});

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

/** G21 D13: every selection change — a click or an arrow-key move alike — also opens the file,
 *  never pinned (VS Code's own preview-tab convention governs). This is not new behaviour, only
 *  its mechanism: before D12, moving the cursor here already flipped `DetailState.mode` to
 *  `'diff'` immediately, showing the (then in-webview) diff — this is that same "select = open a
 *  preview" behaviour, now expressed as a second emit rather than a mode flip, and now something
 *  a double click/`Enter` can additionally *pin*. */
function selectRow(index: number, options: { follow?: boolean } = {}): void {
  const row = capped.value.visible[index];
  if (!row) return;
  focusedRow.value = index;
  if (row.kind === 'directory') return;
  if (options.follow === false) return;
  emit('selectFile', row.node.fileIndex);
  emit('openFile', row.node.fileIndex, false);
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

/** G21 D13: the explicit "keep this" gesture — pins a real, permanent tab. Deliberately relies on
 *  the browser firing `click` first (`selectRow` above, via `onRowClick`): a double click opens
 *  the preview and then immediately re-opens the same diff pinned, and VS Code converts the
 *  existing preview tab into a permanent one rather than opening a second — matching VS Code's
 *  own Explorer, and why no click-delay debounce is introduced here (a debounce would add a
 *  visible lag to every single click to serve the rarer gesture). */
function onRowDblClick(index: number): void {
  const row = capped.value.visible[index];
  if (!row || row.kind === 'directory') return;
  emit('openFile', row.node.fileIndex, true);
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
      // G21 D13: the keyboard equivalent of a double click — pins, rather than re-emitting the
      // same navigational open `selectRow` (arrow-key nav) already fired for this row.
      if (row.kind === 'directory') toggleDir(row.node.path);
      else emit('openFile', row.node.fileIndex, true);
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

const parentSelectOptions = computed(() =>
  parentOptions.value.map((option, index) => ({ value: String(index), label: option.label })),
);

function onParentChange(value: string): void {
  emit('update:parentIndex', Number(value));
}

function statusLetter(change: FileChange): string {
  return STATUS_LETTERS[change.kind];
}

function statusClass(change: FileChange): string {
  return STATUS_COLOR_CLASS[change.kind];
}

/** G19 D14: the row's primary leading glyph, replacing the status letter in that role; the letter
 *  itself is kept, demoted to a small secondary chip (SPEC's own wording: kept, not removed).
 *  G-UX D3 (item 3): a real per-language seti-ui icon now, not one shared codicon glyph, rendered
 *  as a CSS mask (`.kv-file-tree-icon`'s own `mask-image`) so `background-color` still drives the
 *  glyph's colour exactly as the codicon it replaces did — see `setiFileIcon.ts`'s own doc
 *  comment for why a mask rather than inline SVG/`v-html`. */
function fileIconStyle(path: string): Record<string, string> {
  const icon = setiIconFor(path);
  return { maskImage: icon.maskUrl, WebkitMaskImage: icon.maskUrl, backgroundColor: icon.color };
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

// G19 D7 / G21 D11: a right-click "Copy path" menu — the one copy-path affordance in every tree
// now (the inline button below it used to gate on is gone).
const fileMenuState = ref<{ x: number; y: number; path: string } | undefined>(undefined);

function onRowContextMenu(event: MouseEvent, row: FileTreeRow): void {
  if (row.kind !== 'file') return;
  event.preventDefault();
  fileMenuState.value = { x: event.clientX, y: event.clientY, path: row.node.change.path };
}

const fileMenuSections = computed(() => buildFileRowMenu(props.actions.capabilities.clipboard));

function onFileMenuSelect(id: string): void {
  const path = fileMenuState.value?.path;
  fileMenuState.value = undefined;
  if (id === 'copyPath' && path !== undefined) copyPath(path);
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
  <!-- G21 D11: `.kv-skin-kira` (kira-structure.css) — colour-free, structural-only tokens
       (spacing/control-height/font-role), scoped here rather than at :root so the graph panel's
       own density.css scale still governs everywhere outside this one component. Applying it
       right on this tree's own root, not up at App.vue/DetailPane.vue, is what makes "one
       anatomy, everywhere this component mounts" true without restyling anything else in the
       graph panel. -->
  <div class="kv-file-tree kv-skin-kira" data-testid="file-tree">
    <div v-if="parentOptions.length > 1" class="kv-file-tree-parent">
      <span class="kv-file-tree-parent-label">Diffing against</span>
      <KuiSelect
        :model-value="String(parentIndex)"
        :options="parentSelectOptions"
        ariaLabel="Diffing against"
        @update:model-value="onParentChange"
      />
    </div>

    <div v-if="showToolbar !== false" class="kv-file-tree-toolbar">
      <KuiSearchInput
        class="kv-file-tree-filter"
        :model-value="filterInput"
        placeholder="Filter files"
        ariaLabel="Filter files"
        @update:model-value="onFilterInput"
      />
      <KuiSegmented
        :options="listModeOptions"
        :model-value="listMode"
        ariaLabel="File list display"
        @update:model-value="(value) => emit('update:listMode', value as FileListMode)"
      />
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
        @dblclick="onRowDblClick(index)"
        @contextmenu="onRowContextMenu($event, row)"
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
            <span class="kv-diff-added-fg" v-kui-tooltip="`${exactCount(row.node.additions)} additions`"
              >+{{ formatChangeCount(row.node.additions) }}</span
            >
            <span class="kv-diff-deleted-fg" v-kui-tooltip="`${exactCount(row.node.deletions)} deletions`"
              >-{{ formatChangeCount(row.node.deletions) }}</span
            >
          </span>
        </template>
        <template v-else>
          <span
            class="kv-file-tree-icon"
            :style="fileIconStyle(row.node.path)"
            aria-hidden="true"
          ></span>
          <span
            class="kv-file-tree-status"
            :class="statusClass(row.node.change)"
            v-kui-tooltip="fileTitle(row.node.change)"
            >{{ statusLetter(row.node.change) }}</span
          >
          <span class="kv-file-tree-name" v-kui-tooltip="fileTitle(row.node.change)">
            <template v-if="renameDisplay(row.node.change)">
              {{ renameDisplay(row.node.change)?.from }}
              <span class="codicon codicon-arrow-small-right" aria-hidden="true"></span>
              {{ renameDisplay(row.node.change)?.to }}
            </template>
            <template v-else>{{ row.node.name }}</template>
          </span>
          <span
            v-if="listMode === 'flat' && dirOf(row.node.path)"
            class="kv-file-tree-file-dir"
            >{{ dirOf(row.node.path) }}</span
          >
          <span v-if="!row.node.change.isBinary" class="kv-file-tree-counts">
            <span
              class="kv-diff-added-fg"
              v-kui-tooltip="`${exactCount(row.node.change.additions ?? 0)} additions`"
              >+{{ formatChangeCount(row.node.change.additions ?? 0) }}</span
            >
            <span
              class="kv-diff-deleted-fg"
              v-kui-tooltip="`${exactCount(row.node.change.deletions ?? 0)} deletions`"
              >-{{ formatChangeCount(row.node.change.deletions ?? 0) }}</span
            >
          </span>
          <span
            v-if="reviewStates && reviewStatusFor(row.node.change.path)?.changedSinceReview"
            class="kv-file-tree-changed-badge"
            v-kui-tooltip="'Changed since you reviewed it'"
            aria-hidden="true"
            >●</span
          >
          <KuiButton
            v-if="reviewStates"
            variant="ghost"
            class="kv-file-tree-review-toggle"
            v-kui-tooltip="reviewToggleTitle(row.node.change.path)"
            :aria-pressed="reviewStatusFor(row.node.change.path)?.kind === 'full'"
            @click.stop="emit('toggleReviewed', row.node.change.path)"
          >
            <span class="codicon" :class="reviewToggleIcon(row.node.change.path)" aria-hidden="true"></span>
          </KuiButton>
        </template>
      </div>

      <KuiButton v-if="capped.hiddenCount > 0" class="kv-file-tree-show-all" @click="capLifted = true">
        Show all {{ rows.length }} files
      </KuiButton>

      <KuiContextMenu
        v-if="fileMenuState"
        :sections="fileMenuSections"
        :x="fileMenuState.x"
        :y="fileMenuState.y"
        label="File actions"
        @select="onFileMenuSelect"
        @close="fileMenuState = undefined"
      />
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
}

.kv-file-tree-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  outline: none;
}

/* G21 D11: this row geometry used to be `ReviewView.vue`'s own `.kv-skin-kira` restyle of a
 * plainer base rule here — the graph panel's tree had to stay byte-identical while it still
 * embedded a diff (G12 D14's own guarantee). Items 9/10/12/13 already changed that tree's icons,
 * status glyph, and click behaviour, so there is nothing left for that guarantee to protect: this
 * is now the one geometry every tree renders, the component's only appearance. */
.kv-file-tree-row {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  min-height: var(--kv-control-h);
  padding: var(--kv-s-1) var(--kv-s-4);
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
  font-family: var(--kv-font-ui);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kv-file-tree-dir-stats {
  margin-left: auto;
  color: var(--kv-description-fg);
  font-family: var(--kv-font-ui);
  font-size: 0.85em;
  display: flex;
  gap: var(--kv-space-2);
}

/* G19 D14: the row's primary leading glyph, taking over the leading-icon role the status letter
 * used to occupy. G-UX D3 (item 3): a real seti-ui icon now, rendered as a CSS mask (not inline
 * SVG/`v-html`) so `background-color` keeps driving its colour exactly as it did for the codicon
 * this replaces — `setiFileIcon.ts`'s own doc comment explains the mask choice. 16px matches VS
 * Code's own explorer icon box (G-UX item 6/F7 also flagged the old 14px-in-16px box as slightly
 * oversized; this box is unchanged, only what fills it). */
.kv-file-tree-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}

/* G21 D10: item 10's own wording, taken literally — "just a colored letter", not a chip. G19
 * D14's status-chip class (background/border-radius/fixed 1.3em square/0.75em shrink) is
 * deleted outright; `min-width: 1ch` is the one thing kept from it, so the letters still line up
 * into a column and the file names after them align, without reintroducing a box around the
 * letter. */
.kv-file-tree-status {
  min-width: 1ch;
  font-family: var(--kv-mono-font-family);
  font-weight: 700;
  flex-shrink: 0;
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
  font-family: var(--kv-font-ui);
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
