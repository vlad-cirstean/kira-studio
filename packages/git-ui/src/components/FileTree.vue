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
 * `ReviewCommitRow.vue` alike. G34 D1: `kira-structure.css` moved to `:root`, so the class this
 * paragraph refers to (`.kv-skin-kira`) no longer exists — the tokens it used to scope now apply
 * globally, unconditionally, everywhere in the package.
 */
import type { CommitStore } from '@kira/git-core';
import type { FileChange, ReviewFileStatus } from '@kira/git-ipc';
import type { KuiSegmentedOption } from '@kira/kira-ui';
import {
  cn,
  KuiButton,
  KuiContextMenu,
  KuiSearchInput,
  KuiSegmented,
  KuiSelect,
  kuiRowVariants,
} from '@kira/kira-ui';
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
  /** P74 §7.4: the commit these files belong to — enables the row menu's "Go to file"
   *  (`actions.goToFile({ rev: sha, path, line: 1 })`). Absent (every caller before this phase)
   *  renders byte-identically: the item simply does not appear, the same "absent, not disabled"
   *  convention `reviewStates` above already uses. */
  sha?: string;
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

// G30 round-1 performance review, finding #6: `tree` depends only on `indexed` (the files/filter),
// never on `collapsedDirs` — split out from `rows` so toggling a single twisty re-runs only the
// cheap flatten below, not buildFileTree's own full O(n log n) fold (a fresh DirBuilder Map per
// directory, a sort at every level, a fresh node object per file) over every file in the commit.
const tree = computed(() => buildFileTree(indexed.value));

const rows = computed<FileTreeRow[]>(() => {
  if (props.listMode === 'flat') {
    return buildFlatList(indexed.value).map((node) => ({
      kind: 'file' as const,
      node,
      depth: 0,
    }));
  }
  return flattenTreeRows(tree.value, isExpanded);
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

/** P110 A15: replaces the old `[kuiRowVariants(), 'kv-file-tree-row', {...}]` array binding.
 *  `kuiRowVariants({ selected })` already renders byte-identically to the file's own retired
 *  `.kv-row-selected`/hover rules (`kui-bridge.css`'s `--kui-selected-*`/`--kui-hover-bg` map to
 *  the exact same `--kv-row-selected-*`/`--kv-row-hover-bg` tokens) — no separate selected class
 *  needed. `cn()` cancels the variant's own `px-kui-3` (6px) with this row's real 2px/8px padding
 *  (`.kv-file-tree-row`'s own padding shorthand always fully overrode it, unlayered). The focus
 *  ring is `group-focus-within` (the container below carries `kv:group`) applied only to the one
 *  row `index === focusedRow` names — reproducing the old
 *  `.kv-file-tree-rows:focus-within .kv-file-tree-row.kv-row-focused` compound selector.
 *
 *  P110 A-fix: `.kv-file-tree-row` itself is kept, as a bare literal (no CSS of its own —
 *  tailwind-merge passes an unrecognized class straight through) — several Playwright specs
 *  outside this package's own tests (file-tree-open/review-interaction/kui-floating-geometry)
 *  select rows by this class name; dropping it broke them. */
function rowClass(row: FileTreeRow, index: number): string {
  const selected = row.kind === 'file' && row.node.fileIndex === props.selectedFile;
  return cn(
    'kv-file-tree-row',
    kuiRowVariants({ selected }),
    'kv:py-0.5 kv:px-2',
    index === focusedRow.value
      ? 'kv:group-focus-within:outline kv:group-focus-within:outline-1 kv:group-focus-within:outline-focus kv:group-focus-within:-outline-offset-1'
      : '',
  );
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
  // G34 D17: without this, the same `contextmenu` event also reaches `ReviewCommitRow.vue`'s own
  // handler (a file row here can sit inside an expanded review row) and a second menu — that
  // row's "Commit actions" menu — opens underneath this one from a single right-click.
  event.stopPropagation();
  fileMenuState.value = { x: event.clientX, y: event.clientY, path: row.node.change.path };
}

const fileMenuSections = computed(() =>
  buildFileRowMenu(
    props.actions.capabilities.clipboard,
    props.actions.capabilities.goToFile && props.sha !== undefined,
  ),
);

// P74 §7.4: line 1 — a tree row has no cursor, so "go to file" is the row's own job; "go to
// line" is the editor's (RepoDiffView.vue's own `repo.goToFileFromDiff` command). Announces
// either way, matching openAllChanges's own no-silent-failure posture.
async function goToFile(path: string): Promise<void> {
  const sha = props.sha;
  if (sha === undefined) return;
  try {
    const outcome = await props.actions.goToFile({ rev: sha, path, line: 1 });
    switch (outcome.kind) {
      case 'liveFile':
      case 'virtualBlob':
        props.actions.announce(`Opened ${outcome.path}`);
        break;
      case 'unavailable':
        props.actions.announce(`Couldn't open ${path} — ${outcome.reason}`);
        break;
    }
  } catch (err) {
    props.actions.announce(
      `Couldn't open ${path} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function onFileMenuSelect(id: string): void {
  const path = fileMenuState.value?.path;
  fileMenuState.value = undefined;
  if (path === undefined) return;
  if (id === 'copyPath') copyPath(path);
  else if (id === 'goToFile') void goToFile(path);
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
function reviewToggleTitle(path: string): string {
  const kind = reviewStatusFor(path)?.kind ?? 'none';
  return kind === 'none' ? 'Mark reviewed' : 'Mark unreviewed';
}
</script>

<template>
  <div class="kv:flex kv:flex-col kv:min-h-0 kv:flex-1" data-testid="file-tree">
    <!-- G21 D11 (superseded by G34 D1): this root used to carry `.kv-skin-kira` to scope
         kira-structure.css's colour-free, structural-only tokens (spacing/control-height/
         font-role) to this one component while density.css's own scale governed everywhere else.
         G34 hoisted kira-structure.css to `:root` and retired density.css's competing scale, so
         those tokens now apply globally and the class is gone — nothing left to scope here.

         G-UX D7 (item 7): this comment moved from *before* the root `<div>` to *inside* it (same
         text, new position) — a comment sitting as the root `<div>`'s own template-level sibling
         defeats Vue's single-root detection for THIS toolchain (Vue 3.5.42 /
         @vitejs/plugin-vue 6.0.8: confirmed empirically, not merely suspected), which silently
         drops every attrs-fallthrough class a caller passes — `DetailPane.vue`'s own `class` prop
         on its `<FileTree>` usage (P110 A15: now `kv:flex-auto kv:min-h-0 kv:border-y
         kv:border-panel-border`) never reached this component's root at all before this move. -->
    <div v-if="parentOptions.length > 1" class="kv:flex kv:flex-col kv:gap-1 kv:px-5 kv:pb-4 kv:text-sm">
      <span>Diffing against</span>
      <KuiSelect
        :model-value="String(parentIndex)"
        :options="parentSelectOptions"
        ariaLabel="Diffing against"
        @update:model-value="onParentChange"
      />
    </div>

    <div v-if="showToolbar !== false" class="kv:flex kv:gap-2 kv:px-4 kv:pb-2">
      <KuiSearchInput
        class="kv:flex-1 kv:min-w-0"
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
      v-if="listMode === 'tree'"
      ref="treeEl"
      class="kv:flex-1 kv:min-h-0 kv:overflow-auto kv:outline-none kv:group"
      aria-label="File tree"
      role="tree"
      @keydown="onKeydown"
    >
      <div
        v-for="(row, index) in capped.visible"
        :id="rowId(index)"
        :key="rowKey(row)"
        :class="rowClass(row, index)"
        role="treeitem"
        :aria-level="row.depth + 1"
        :aria-expanded="row.kind === 'directory' ? row.expanded : undefined"
        :aria-selected="row.kind === 'file' ? row.node.fileIndex === selectedFile : undefined"
        :tabindex="index === focusedRow ? 0 : -1"
        :style="{ paddingLeft: `calc(var(--kv-tree-indent) * ${row.depth})` }"
        @click="onRowClick(index)"
        @dblclick="onRowDblClick(index)"
        @contextmenu="onRowContextMenu($event, row)"
        @keydown.space.prevent="onRowClick(index)"
      >
        <template v-if="row.kind === 'directory'">
          <!-- P75 §4.3: no mark on a directory row, but a same-width empty slot keeps the file
               rows' checkbox column aligned underneath it. -->
          <span v-if="reviewStates" class="kv:w-3.5 kv:shrink-0" aria-hidden="true"></span>
          <span
            class="codicon kv:text-codicon kv:w-3"
            :class="row.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
            aria-hidden="true"
          ></span>
          <span class="kv:font-ui kv:font-semibold kv:truncate">{{ row.node.name }}</span>
          <span class="kv:ml-auto kv:text-muted kv:font-ui kv:text-xs kv:flex kv:gap-1">
            {{ row.node.fileCount }} {{ row.node.fileCount === 1 ? "file" : "files" }}
            <span class="kv:text-diff-added" v-kui-tooltip="`${exactCount(row.node.additions)} additions`"
              >+{{ formatChangeCount(row.node.additions) }}</span
            >
            <span class="kv:text-diff-deleted" v-kui-tooltip="`${exactCount(row.node.deletions)} deletions`"
              >-{{ formatChangeCount(row.node.deletions) }}</span
            >
          </span>
        </template>
        <template v-else>
          <!-- P75 §4: leading edge, not trailing — a trailing position shifted row to row with the
               +N/-N counts' own width and crowded the pane's scrollbar. A real checkbox (not a
               toggle button) so the partial state gets a correct native `aria-checked="mixed"` for
               free, and `.prevent` because the server's answer is this control's only state
               (`ReviewFilesState.mark` applies `result.review`, not an optimistic local toggle). -->
          <input
            v-if="reviewStates"
            type="checkbox"
            class="kv:shrink-0"
            :checked="reviewStatusFor(row.node.change.path)?.kind === 'full'"
            :indeterminate="reviewStatusFor(row.node.change.path)?.kind === 'partial'"
            v-kui-tooltip="reviewToggleTitle(row.node.change.path)"
            :aria-label="reviewToggleTitle(row.node.change.path)"
            @click.prevent.stop="emit('toggleReviewed', row.node.change.path)"
          />
          <span
            class="kv-file-tree-icon kv:shrink-0 kv:size-4 kv:mask-contain kv:mask-no-repeat kv:mask-center"
            :style="fileIconStyle(row.node.path)"
            aria-hidden="true"
          ></span>
          <span class="kv:overflow-hidden kv:text-ellipsis" v-kui-tooltip="fileTitle(row.node.change)">
            <template v-if="renameDisplay(row.node.change)">
              {{ renameDisplay(row.node.change)?.from }}
              <span class="codicon codicon-arrow-small-right" aria-hidden="true"></span>
              {{ renameDisplay(row.node.change)?.to }}
            </template>
            <template v-else>{{ row.node.name }}</template>
          </span>
          <!-- P105: the flat-mode-only directory hint never applies in tree mode (a real
               directory row already carries this path via its own ancestor rows). -->
          <span class="kv:ml-auto kv:flex kv:items-center kv:gap-1 kv:shrink-0">
            <span
              v-if="!row.node.change.isBinary"
              class="kv:font-ui kv:text-xs kv:flex kv:gap-1 kv:shrink-0"
            >
              <span
                class="kv:text-diff-added"
                v-kui-tooltip="`${exactCount(row.node.change.additions ?? 0)} additions`"
                >+{{ formatChangeCount(row.node.change.additions ?? 0) }}</span
              >
              <span
                class="kv:text-diff-deleted"
                v-kui-tooltip="`${exactCount(row.node.change.deletions ?? 0)} deletions`"
                >-{{ formatChangeCount(row.node.change.deletions ?? 0) }}</span
              >
            </span>
            <span
              class="kv-file-tree-status kv:min-w-[1ch] kv:font-data kv:text-xs kv:font-semibold kv:leading-none kv:shrink-0 kv:saturate-160 kv:contrast-115"
              :class="statusClass(row.node.change)"
              v-kui-tooltip="fileTitle(row.node.change)"
              >{{ statusLetter(row.node.change) }}</span
            >
          </span>
          <span
            v-if="reviewStates && reviewStatusFor(row.node.change.path)?.changedSinceReview"
            class="kv:shrink-0 kv:text-[0.5em] kv:text-diff-modified"
            v-kui-tooltip="'Changed since you reviewed it'"
            aria-hidden="true"
            >●</span
          >
        </template>
      </div>

      <KuiButton
        v-if="capped.hiddenCount > 0"
        class="kv:w-full kv:bg-transparent kv:enabled:hover:bg-transparent kv:text-focus kv:enabled:hover:text-focus kv:border-0 kv:border-t kv:border-panel-border kv:p-1 kv:cursor-pointer"
        @click="capLifted = true"
      >
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
    <div
      v-else
      ref="treeEl"
      class="kv:flex-1 kv:min-h-0 kv:overflow-auto kv:outline-none kv:group"
      aria-label="File list"
      role="listbox"
      @keydown="onKeydown"
    >
      <div
        v-for="(row, index) in capped.visible"
        :id="rowId(index)"
        :key="rowKey(row)"
        :class="rowClass(row, index)"
        role="option"
        :aria-selected="row.kind === 'file' ? row.node.fileIndex === selectedFile : undefined"
        :tabindex="index === focusedRow ? 0 : -1"
        :style="{ paddingLeft: `calc(var(--kv-tree-indent) * ${row.depth})` }"
        @click="onRowClick(index)"
        @dblclick="onRowDblClick(index)"
        @contextmenu="onRowContextMenu($event, row)"
        @keydown.space.prevent="onRowClick(index)"
      >
        <template v-if="row.kind === 'directory'">
          <!-- P75 §4.3: no mark on a directory row, but a same-width empty slot keeps the file
               rows' checkbox column aligned underneath it. -->
          <span v-if="reviewStates" class="kv:w-3.5 kv:shrink-0" aria-hidden="true"></span>
          <span
            class="codicon kv:text-codicon kv:w-3"
            :class="row.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
            aria-hidden="true"
          ></span>
          <span class="kv:font-ui kv:font-semibold kv:truncate">{{ row.node.name }}</span>
          <span class="kv:ml-auto kv:text-muted kv:font-ui kv:text-xs kv:flex kv:gap-1">
            {{ row.node.fileCount }} {{ row.node.fileCount === 1 ? "file" : "files" }}
            <span class="kv:text-diff-added" v-kui-tooltip="`${exactCount(row.node.additions)} additions`"
              >+{{ formatChangeCount(row.node.additions) }}</span
            >
            <span class="kv:text-diff-deleted" v-kui-tooltip="`${exactCount(row.node.deletions)} deletions`"
              >-{{ formatChangeCount(row.node.deletions) }}</span
            >
          </span>
        </template>
        <template v-else>
          <!-- P75 §4: leading edge, not trailing — a trailing position shifted row to row with the
               +N/-N counts' own width and crowded the pane's scrollbar. A real checkbox (not a
               toggle button) so the partial state gets a correct native `aria-checked="mixed"` for
               free, and `.prevent` because the server's answer is this control's only state
               (`ReviewFilesState.mark` applies `result.review`, not an optimistic local toggle). -->
          <input
            v-if="reviewStates"
            type="checkbox"
            class="kv:shrink-0"
            :checked="reviewStatusFor(row.node.change.path)?.kind === 'full'"
            :indeterminate="reviewStatusFor(row.node.change.path)?.kind === 'partial'"
            v-kui-tooltip="reviewToggleTitle(row.node.change.path)"
            :aria-label="reviewToggleTitle(row.node.change.path)"
            @click.prevent.stop="emit('toggleReviewed', row.node.change.path)"
          />
          <span
            class="kv-file-tree-icon kv:shrink-0 kv:size-4 kv:mask-contain kv:mask-no-repeat kv:mask-center"
            :style="fileIconStyle(row.node.path)"
            aria-hidden="true"
          ></span>
          <span class="kv:overflow-hidden kv:text-ellipsis" v-kui-tooltip="fileTitle(row.node.change)">
            <template v-if="renameDisplay(row.node.change)">
              {{ renameDisplay(row.node.change)?.from }}
              <span class="codicon codicon-arrow-small-right" aria-hidden="true"></span>
              {{ renameDisplay(row.node.change)?.to }}
            </template>
            <template v-else>{{ row.node.name }}</template>
          </span>
          <span
            v-if="dirOf(row.node.path)"
            class="kv:overflow-hidden kv:text-ellipsis kv:text-muted kv:text-xs"
            >{{ dirOf(row.node.path) }}</span
          >
          <span class="kv:ml-auto kv:flex kv:items-center kv:gap-1 kv:shrink-0">
            <span
              v-if="!row.node.change.isBinary"
              class="kv:font-ui kv:text-xs kv:flex kv:gap-1 kv:shrink-0"
            >
              <span
                class="kv:text-diff-added"
                v-kui-tooltip="`${exactCount(row.node.change.additions ?? 0)} additions`"
                >+{{ formatChangeCount(row.node.change.additions ?? 0) }}</span
              >
              <span
                class="kv:text-diff-deleted"
                v-kui-tooltip="`${exactCount(row.node.change.deletions ?? 0)} deletions`"
                >-{{ formatChangeCount(row.node.change.deletions ?? 0) }}</span
              >
            </span>
            <span
              class="kv-file-tree-status kv:min-w-[1ch] kv:font-data kv:text-xs kv:font-semibold kv:leading-none kv:shrink-0 kv:saturate-160 kv:contrast-115"
              :class="statusClass(row.node.change)"
              v-kui-tooltip="fileTitle(row.node.change)"
              >{{ statusLetter(row.node.change) }}</span
            >
          </span>
          <span
            v-if="reviewStates && reviewStatusFor(row.node.change.path)?.changedSinceReview"
            class="kv:shrink-0 kv:text-[0.5em] kv:text-diff-modified"
            v-kui-tooltip="'Changed since you reviewed it'"
            aria-hidden="true"
            >●</span
          >
        </template>
      </div>

      <KuiButton
        v-if="capped.hiddenCount > 0"
        class="kv:w-full kv:bg-transparent kv:enabled:hover:bg-transparent kv:text-focus kv:enabled:hover:text-focus kv:border-0 kv:border-t kv:border-panel-border kv:p-1 kv:cursor-pointer"
        @click="capLifted = true"
      >
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

