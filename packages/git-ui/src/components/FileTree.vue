<script setup lang="ts">
import type { CommitStore } from '@kira/git-core';
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
 * geometry `ReviewView.vue` used to restyle from outside under `skin-kira`, and the
 * dimmed-directory-suffix/context-menu-copy behaviour) is now this component's *only* appearance,
 * everywhere it mounts — `DetailPane.vue`, `StashDetailPane.vue`, `ReviewFilesPane.vue`,
 * `ReviewCommitRow.vue` alike.
 */
import { shortSha } from '@kira/git-core';
import type { FileChange, ReviewFileStatus } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import AttributeTooltip from '@theme/components/AttributeTooltip.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import StatusDot from '@theme/components/StatusDot.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { useListNavigation } from '@workbench/behaviour/listNavigation';
import { usePanelHeaderSearch } from '@workbench/behaviour/panelSearch';
import { errorText } from '@workbench/bridge/codedError';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, ref, useId, watch } from 'vue';
import { ACTION_ICONS } from '../icons/index.ts';
import { setiIconFor } from '../icons/setiFileIcon.ts';
import { sectionsToMenuItems } from '../lib/menuModel.ts';
import type { FileListMode } from '../state/detail.ts';
import type { DetailActions } from '../state/detailActions.ts';
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
   *  the preview-tab convention governs, the next such open replaces it) or a double
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

// P131 Part 2 §5.6: KuiSegmentedOption goes with KuiSegmented -- this is the same shape, inlined
// as a local type instead of importing one.
interface ListModeOption {
  readonly id: FileListMode;
  readonly icon: string;
  readonly label: string;
}

const listModeOptions = computed<readonly ListModeOption[]>(() => [
  { id: 'tree', icon: ACTION_ICONS.listTree, label: t('git.fileTree.listTree.tooltip') },
  { id: 'flat', icon: ACTION_ICONS.listFlat, label: t('git.fileTree.listFlat.tooltip') },
]);
const listModeItems = computed(() =>
  listModeOptions.value.map((option) => ({
    value: option.id,
    label: option.label,
    icon: option.icon,
    tooltip: option.label,
  })),
);

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
const rootEl = ref<HTMLElement | null>(null);
const activeKey = ref<string | null>(null);

// Type to search: a printable key on the tree redirects into the filter field.
usePanelHeaderSearch(rootEl, {
  searchable: () => props.showToolbar !== false,
  getSearch: () => filterInput.value,
  setSearch: onFilterInput,
  searchTestid: 'file-filter',
});

/** Keeps the keyboard cursor in step with `selectedFile` however it changed — a mouse click on a
 *  row (handled locally, below), or `selectedFile` being driven from outside this component
 *  entirely (a parent-commit pick, a repo refresh re-resolving a selection). A `selectedFile` the
 *  current filter/list-mode has hidden leaves the cursor where it was. */
watch(
  [() => props.selectedFile, capped],
  ([selectedFile]) => {
    const rowsNow = capped.value.visible;
    const selected = rowsNow.find(
      (row) => row.kind === 'file' && row.node.fileIndex === selectedFile,
    );
    if (selected) activeKey.value = rowKey(selected);
    else if (!rowsNow.some((row) => rowKey(row) === activeKey.value)) {
      activeKey.value = rowsNow[0] ? rowKey(rowsNow[0]) : null;
    }
  },
  { immediate: true },
);

/** P5 W14: announces §8's render cap once per boundary crossing (a fresh commit whose file count
 *  is over the cap, or the filter narrowing back above it after being below) — not on every
 *  keystroke that leaves the cap in the same state, which `capped` itself recomputes on. */
let lastHiddenCount: number | undefined;
watch(
  capped,
  (value) => {
    if (value.hiddenCount > 0 && value.hiddenCount !== lastHiddenCount) {
      props.actions.announce(
        t('git.fileTree.capped.announce', {
          shown: value.visible.length,
          total: rows.value.length,
        }),
      );
    }
    lastHiddenCount = value.hiddenCount;
  },
  { immediate: true },
);

function rowKey(row: FileTreeRow): string {
  return row.kind === 'directory' ? `dir:${row.node.path}` : `file:${row.node.path}`;
}

/** Theme `rowVariants` tree layout (`data` keeps the Git graph font reaching rows); indent comes
 *  from `rowIndent`. The focus ring is `group-focus-within` (the container carries `group`) on the
 *  roving-stop row. `data-testid="file-tree-row"` is selected by several
 *  Playwright specs. */
function rowClass(row: FileTreeRow): string {
  const selected = row.kind === 'file' && row.node.fileIndex === props.selectedFile;
  return cn(
    rowVariants({ layout: 'tree', selected, data: true }),
    nav.tabindexFor(rowKey(row)) === 0 ? 'group-focus-within:focus-ring' : '',
  );
}

/** G21 D13: every selection change — a click or an arrow-key move alike — also opens the file,
 *  never pinned (the preview-tab convention governs). This is not new behaviour, only
 *  its mechanism: before D12, moving the cursor here already flipped `DetailState.mode` to
 *  `'diff'` immediately, showing the (then in-webview) diff — this is that same "select = open a
 *  preview" behaviour, now expressed as a second emit rather than a mode flip, and now something
 *  a double click/`Enter` can additionally *pin*. */
function selectRow(index: number, options: { follow?: boolean } = {}): void {
  const row = capped.value.visible[index];
  if (!row) return;
  activeKey.value = rowKey(row);
  if (row.kind === 'directory') return;
  if (options.follow === false) return;
  emit('selectFile', row.node.fileIndex);
  emit('openFile', row.node.fileIndex, false);
}

function onRowClick(index: number): void {
  const row = capped.value.visible[index];
  if (!row) return;
  if (row.kind === 'directory') {
    activeKey.value = rowKey(row);
    toggleDir(row.node.path);
    return;
  }
  selectRow(index);
}

/** G21 D13: the explicit "keep this" gesture — pins a real, permanent tab. Deliberately relies on
 *  the browser firing `click` first (`selectRow` above, via `onRowClick`): a double click opens
 *  the preview and then immediately re-opens the same diff pinned, and the host converts the
 *  existing preview tab into a permanent one rather than opening a second, which is why no click-delay debounce is introduced here (a debounce would add a
 *  visible lag to every single click to serve the rarer gesture). */
function onRowDblClick(index: number): void {
  const row = capped.value.visible[index];
  if (!row || row.kind === 'directory') return;
  emit('openFile', row.node.fileIndex, true);
}

function indexOfKey(key: string): number {
  return capped.value.visible.findIndex((row) => rowKey(row) === key);
}

const nav = useListNavigation<FileTreeRow>({
  container: treeEl,
  items: () => capped.value.visible,
  key: rowKey,
  activeKey,
  selectOnMove: true,
  // Arrow moves preview the file; Space acts as a click (toggle a directory, select a file).
  onSelect: (row, { reason }) => {
    const index = indexOfKey(rowKey(row));
    if (reason === 'key') onRowClick(index);
    else selectRow(index);
  },
  // G21 D13: the keyboard equivalent of a double click — pins, rather than re-emitting the same
  // navigational open `selectRow` (arrow-key nav) already fired for this row.
  onOpen: (row) => {
    if (row.kind === 'directory') toggleDir(row.node.path);
    else emit('openFile', row.node.fileIndex, true);
  },
  onMenu: (row, rect) => {
    if (row.kind === 'file') openFileMenu(rect.left, rect.bottom, row.node.change.path);
  },
  tree: {
    depth: (row) => row.depth,
    isExpanded: (row) => row.kind === 'directory' && row.expanded,
    hasChildren: (row) => row.kind === 'directory',
    expand: (row) => expandDir(row.node.path),
    collapse: (row) => collapseDir(row.node.path),
  },
});

interface ParentOption {
  readonly sha: string;
  readonly label: string;
}

const parentOptions = computed<ParentOption[]>(() =>
  props.parents.map((sha, index) => {
    const row = props.store.rowOfSha(sha);
    const subject = row !== -1 ? props.store.subjectAt(row) : undefined;
    const sha7 = shortSha(sha);
    const label = subject
      ? t('git.fileTree.parent.label', { number: index + 1, sha: sha7, subject })
      : t('git.fileTree.parentNoSubject.label', { number: index + 1, sha: sha7 });
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
 *  as a CSS mask (`file-tree-icon`'s own `mask-image`) so `background-color` still drives the
 *  glyph's colour exactly as the codicon it replaces did — see `setiFileIcon.ts`'s own doc
 *  comment for why a mask rather than inline SVG/`v-html`. */
function fileIconStyle(path: string): Record<string, string> {
  const icon = setiIconFor(path);
  return { maskImage: icon.maskUrl, WebkitMaskImage: icon.maskUrl, backgroundColor: icon.color };
}

function fileTitle(change: FileChange): string {
  const rename = renameDisplay(change);
  if (rename && change.similarity !== undefined) {
    return t('git.fileTree.similar.tooltip', {
      percent: change.similarity,
      from: rename.from,
      to: rename.to,
    });
  }
  return change.path;
}

function copyPath(path: string): void {
  props.actions.copy(path, t('git.copy.filePath.announce'));
}

// G19 D7 / G21 D11: a right-click "Copy path" menu — the one copy-path affordance in every tree
// now (the inline button below it used to gate on is gone).
const contextMenu = useContextMenuStore();

function openFileMenu(x: number, y: number, path: string): void {
  contextMenu.openContextMenuAt(
    x,
    y,
    sectionsToMenuItems(buildFileRowMenu(props.sha !== undefined), (id) =>
      onFileMenuSelect(path, id),
    ),
  );
}

function onRowContextMenu(event: MouseEvent, row: FileTreeRow, index: number): void {
  if (row.kind !== 'file') return;
  event.preventDefault();
  // G34 D17: without this, the same `contextmenu` event also reaches `ReviewCommitRow.vue`'s own
  // handler (a file row here can sit inside an expanded review row) and a second menu — that
  // row's "Commit actions" menu — opens underneath this one from a single right-click.
  event.stopPropagation();
  selectRow(index, { follow: false });
  openFileMenu(event.clientX, event.clientY, row.node.change.path);
}

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
        props.actions.announce(t('git.fileTree.opened.announce', { path: outcome.path }));
        break;
      case 'unavailable':
        props.actions.announce(t('git.fileTree.openError.error', { path, error: outcome.reason }));
        break;
    }
  } catch (err) {
    props.actions.announce(t('git.fileTree.openError.error', { path, error: errorText(err) }));
  }
}

function onFileMenuSelect(path: string, id: string): void {
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
  return kind === 'none' ? t('common.markReviewed.tooltip') : t('common.markUnreviewed.tooltip');
}
function reviewCheckboxState(path: string): boolean | 'indeterminate' {
  const kind = reviewStatusFor(path)?.kind;
  if (kind === 'full') return true;
  if (kind === 'partial') return 'indeterminate';
  return false;
}

// P131 Part 2 §5.6: biome's noLabelWithoutControl can't see through NativeSelect's
// `inheritAttrs: false` to the native select element it renders -- an explicit for/id pair keeps the
// same association (same fix as StackDialog.vue's own parent picker).
const parentSelectId = useId();
</script>

<template>
  <div ref="rootEl" class="flex flex-col min-h-0 flex-1" data-testid="file-tree">
    <!-- G-UX D7 (item 7): this comment moved from *before* the root `<div>` to *inside* it (same
         text, new position) — a comment sitting as the root `<div>`'s own template-level sibling
         defeats Vue's single-root detection for THIS toolchain (Vue 3.5.42 /
         @vitejs/plugin-vue 6.0.8: confirmed empirically, not merely suspected), which silently
         drops every attrs-fallthrough class a caller passes — `DetailPane.vue`'s own `class` prop
         on its `<FileTree>` usage (P110 A15: now `flex-auto min-h-0 border-y
         border-border`) never reached this component's root at all before this move. -->
    <!-- P131 Part 2 §5.6: one hoisted AttributeTooltip for every row's data-kira-tip span --
         treeEl always names whichever of the two row containers below is currently mounted. -->
    <AttributeTooltip :container="treeEl" />
    <div v-if="parentOptions.length > 1" class="flex flex-col gap-0.5 px-3 pb-2 text-graph-md">
      <Label :for="parentSelectId">{{ t('git.fileTree.diffAgainst.label') }}</Label>
      <NativeSelect
        :id="parentSelectId"
        :model-value="String(parentIndex)"
        variant="bordered"
        size="kira"
        @update:model-value="(value) => onParentChange(String(value))"
      >
        <option v-for="option in parentSelectOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </NativeSelect>
    </div>

    <div v-if="showToolbar !== false" class="flex gap-1 px-2 pb-1">
      <div class="min-w-0 flex-1">
        <SearchField
          data-testid="file-filter"
          :model-value="filterInput"
          :placeholder="t('git.fileTree.filter.placeholder')"
          :aria-label="t('git.fileTree.filter.placeholder')"
          @update:model-value="onFilterInput"
        />
      </div>
      <SecondaryTabs
        variant="segmented"
        :aria-label="t('git.fileTree.display.aria')"
        :model-value="listMode"
        :items="listModeItems"
        @update:model-value="(v) => emit('update:listMode', v as FileListMode)"
      >
        <template #item="{ item }">
          <CodiconIcon :name="item.icon ?? ''" :size="13" />
          <span class="sr-only">{{ item.label }}</span>
        </template>
      </SecondaryTabs>
    </div>

    <div
      v-if="listMode === 'tree'"
      ref="treeEl"
      class="flex-1 min-h-0 overflow-auto group"
      :aria-label="t('git.fileTree.tree.aria')"
      role="tree"
    >
      <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter and Space come from useListNavigation on the container. -->
      <!-- biome-ignore lint/a11y/useFocusableInteractive: tabindex comes from nav.rowProps. -->
      <div
        v-for="(row, index) in capped.visible"
        :key="rowKey(row)"
        data-testid="file-tree-row"
        :class="rowClass(row)"
        role="treeitem"
        :aria-level="row.depth + 1"
        :aria-expanded="row.kind === 'directory' ? row.expanded : undefined"
        :aria-selected="row.kind === 'file' ? row.node.fileIndex === selectedFile : undefined"
        v-bind="nav.rowProps(rowKey(row))"
        :style="rowIndent(row.depth)"
        @click="onRowClick(index)"
        @dblclick="onRowDblClick(index)"
        @contextmenu="onRowContextMenu($event, row, index)"
      >
        <template v-if="row.kind === 'directory'">
          <!-- P75 §4.3: no mark on a directory row, but a same-width empty slot keeps the file
               rows' checkbox column aligned underneath it. -->
          <span v-if="reviewStates" class="w-3.5 shrink-0" aria-hidden="true"></span>
          <TreeTwisty
            :expanded="row.expanded"
            :has-children="true"
            @toggle="toggleDir(row.node.path)"
          />
          <CodiconIcon
            :name="row.expanded ? 'folder-opened' : 'folder'"
            :size="13"
            class="shrink-0 text-muted-foreground"
          />
          <span class="font-ui truncate">{{ row.node.name }}</span>
          <span class="ml-auto text-muted-foreground font-ui text-graph-sm flex gap-1">
            {{ t('common.fileCount.label', { count: row.node.fileCount }) }}
          </span>
        </template>
        <template v-else>
          <!-- P75 §4: leading edge, not trailing — a trailing position shifted row to row with the
               status column and crowded the pane's scrollbar. A real Checkbox (not a
               toggle button) so the partial state gets a correct `aria-checked="mixed"` for free,
               and `.stop` (not `.prevent` -- reka's own control has no native default to prevent)
               because the server's answer is this control's only state (`ReviewFilesState.mark`
               applies `result.review`, not an optimistic local toggle). -->
          <Checkbox
            v-if="reviewStates"
            class="shrink-0"
            :model-value="reviewCheckboxState(row.node.change.path)"
            :aria-label="reviewToggleTitle(row.node.change.path)"
            :data-kira-tip="reviewToggleTitle(row.node.change.path)"
            @click.stop
            @update:model-value="() => emit('toggleReviewed', row.node.change.path)"
          >
            <CodiconIcon
              :name="reviewCheckboxState(row.node.change.path) === 'indeterminate' ? 'dash' : 'check'"
              :size="13"
            />
          </Checkbox>
          <span class="size-4 shrink-0 flex items-center justify-center" aria-hidden="true">
            <span
              class="size-3.25 mask-contain mask-no-repeat mask-center"
              :style="fileIconStyle(row.node.path)"
            ></span>
          </span>
          <span class="overflow-hidden text-ellipsis" :data-kira-tip="fileTitle(row.node.change)">
            <template v-if="renameDisplay(row.node.change)">
              {{ renameDisplay(row.node.change)?.from }}
              <CodiconIcon name="arrow-small-right" :size="13" />
              {{ renameDisplay(row.node.change)?.to }}
            </template>
            <template v-else>{{ row.node.name }}</template>
          </span>
          <!-- P105: the flat-mode-only directory hint never applies in tree mode (a real
               directory row already carries this path via its own ancestor rows). -->
          <span class="ml-auto flex items-center gap-1 shrink-0">
            <span
              data-testid="file-tree-status"
              class="min-w-[1ch] font-data text-graph-sm leading-none shrink-0"
              :class="statusClass(row.node.change)"
              :data-kira-tip="fileTitle(row.node.change)"
              >{{
                statusLetter(row.node.change)
              }}</span
            >
          </span>
          <StatusDot
            v-if="reviewStates && reviewStatusFor(row.node.change.path)?.changedSinceReview"
            tone="warn"
            :data-kira-tip="t('git.review.changedSince.hint')"
            aria-hidden="true"
          />
        </template>
      </div>
    </div>
    <div
      v-else
      ref="treeEl"
      class="flex-1 min-h-0 overflow-auto group"
      :aria-label="t('git.fileTree.list.aria')"
      role="listbox"
    >
      <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter and Space come from useListNavigation on the container. -->
      <!-- biome-ignore lint/a11y/useFocusableInteractive: tabindex comes from nav.rowProps. -->
      <div
        v-for="(row, index) in capped.visible"
        :key="rowKey(row)"
        data-testid="file-tree-row"
        :class="rowClass(row)"
        role="option"
        :aria-selected="row.kind === 'file' ? row.node.fileIndex === selectedFile : undefined"
        v-bind="nav.rowProps(rowKey(row))"
        :style="rowIndent(row.depth)"
        @click="onRowClick(index)"
        @dblclick="onRowDblClick(index)"
        @contextmenu="onRowContextMenu($event, row, index)"
      >
        <template v-if="row.kind === 'directory'">
          <!-- P75 §4.3: no mark on a directory row, but a same-width empty slot keeps the file
               rows' checkbox column aligned underneath it. -->
          <span v-if="reviewStates" class="w-3.5 shrink-0" aria-hidden="true"></span>
          <TreeTwisty
            :expanded="row.expanded"
            :has-children="true"
            @toggle="toggleDir(row.node.path)"
          />
          <CodiconIcon
            :name="row.expanded ? 'folder-opened' : 'folder'"
            :size="13"
            class="shrink-0 text-muted-foreground"
          />
          <span class="font-ui truncate">{{ row.node.name }}</span>
          <span class="ml-auto text-muted-foreground font-ui text-graph-sm flex gap-1">
            {{ t('common.fileCount.label', { count: row.node.fileCount }) }}
          </span>
        </template>
        <template v-else>
          <!-- P75 §4: leading edge, not trailing — a trailing position shifted row to row with the
               status column and crowded the pane's scrollbar. A real Checkbox (not a
               toggle button) so the partial state gets a correct `aria-checked="mixed"` for free,
               and `.stop` (not `.prevent` -- reka's own control has no native default to prevent)
               because the server's answer is this control's only state (`ReviewFilesState.mark`
               applies `result.review`, not an optimistic local toggle). -->
          <Checkbox
            v-if="reviewStates"
            class="shrink-0"
            :model-value="reviewCheckboxState(row.node.change.path)"
            :aria-label="reviewToggleTitle(row.node.change.path)"
            :data-kira-tip="reviewToggleTitle(row.node.change.path)"
            @click.stop
            @update:model-value="() => emit('toggleReviewed', row.node.change.path)"
          >
            <CodiconIcon
              :name="reviewCheckboxState(row.node.change.path) === 'indeterminate' ? 'dash' : 'check'"
              :size="13"
            />
          </Checkbox>
          <span class="size-4 shrink-0 flex items-center justify-center" aria-hidden="true">
            <span
              class="size-3.25 mask-contain mask-no-repeat mask-center"
              :style="fileIconStyle(row.node.path)"
            ></span>
          </span>
          <span class="overflow-hidden text-ellipsis" :data-kira-tip="fileTitle(row.node.change)">
            <template v-if="renameDisplay(row.node.change)">
              {{ renameDisplay(row.node.change)?.from }}
              <CodiconIcon name="arrow-small-right" :size="13" />
              {{ renameDisplay(row.node.change)?.to }}
            </template>
            <template v-else>{{ row.node.name }}</template>
          </span>
          <span
            v-if="dirOf(row.node.path)"
            class="overflow-hidden text-ellipsis text-muted-foreground text-graph-sm"
            >{{
              dirOf(row.node.path)
            }}</span
          >
          <span class="ml-auto flex items-center gap-1 shrink-0">
            <span
              data-testid="file-tree-status"
              class="min-w-[1ch] font-data text-graph-sm leading-none shrink-0"
              :class="statusClass(row.node.change)"
              :data-kira-tip="fileTitle(row.node.change)"
              >{{
                statusLetter(row.node.change)
              }}</span
            >
          </span>
          <StatusDot
            v-if="reviewStates && reviewStatusFor(row.node.change.path)?.changedSinceReview"
            tone="warn"
            :data-kira-tip="t('git.review.changedSince.hint')"
            aria-hidden="true"
          />
        </template>
      </div>
    </div>

    <!-- Outside the tree/listbox: those roles may own only treeitems/options. -->
    <Button
      v-if="capped.hiddenCount > 0"
      variant="link"
      size="kira"
      class="text-focus w-full border-t border-border p-1 h-auto justify-start"
      @click="capLifted = true"
    >
      {{ t('git.fileTree.showAll.label', { count: rows.length }) }}
    </Button>
  </div>
</template>
