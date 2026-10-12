<script setup lang="ts">
import type { WorktreeEntry } from '@kira/git-ipc';
import { PALETTE_COLOR_CHOICES } from '@shared/domain/color';
import type { RepoSummary } from '@shared/domain/repo';
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import InlineState from '@theme/components/InlineState.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { colorMarkClass, colourLabel } from '@theme/connColor';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { copyAndAnnounce } from '@workbench/behaviour/clipboard';
import { useListNavigation } from '@workbench/behaviour/listNavigation';
import { matchesQuery } from '@workbench/behaviour/match';
import { usePanelHeaderSearch } from '@workbench/behaviour/panelSearch';
import InlineEditInput from '@workbench/components/InlineEditInput.vue';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import TextPromptDialog from '@workbench/prompt/TextPromptDialog.vue';
import { useTextPrompt } from '@workbench/prompt/useTextPrompt';
import { registerCommand } from '@workbench/shortcuts/commands';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, onMounted, onUnmounted, reactive, ref, useTemplateRef, watch } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useLayoutStore } from '../state/layout';
import { openRepoTerminalTab } from '../state/repoTabs';
import { useTerminalsStore } from '../state/terminals';
import { repoIdOfWorkspace, repoWorkspaceKey, useWorkspaceStore } from '../state/workspace';
import RepoFileTree from './RepoFileTree.vue';
import RepoReviewView from './RepoReviewView.vue';
import RepoSearchView from './RepoSearchView.vue';
import ReposDialog from './ReposDialog.vue';
import { useFileTreeStore } from './state/fileTree';
import { useRepoHeadsStore } from './state/repoHeads';
import { useRepoLinksStore } from './state/repoLinks';
import { useReposDialogStore } from './state/reposDialog';
import { useRepoVisibilityStore } from './state/repoVisibility';
import { useRepoPanelTabStore, useRepoSearchStore } from './state/search';
import { useWorktreesStore, worktreeLabel } from './state/worktrees';

type ColourName = Parameters<typeof colourLabel>[0];

const contextMenuStore = useContextMenuStore();

const codeReposStore = useCodeReposStore();
const workspaceStore = useWorkspaceStore();
const layoutStore = useLayoutStore();
const repoHeadsStore = useRepoHeadsStore();
const worktreesStore = useWorktreesStore();
const fileTreeStore = useFileTreeStore();
const repoLinksStore = useRepoLinksStore();
const visibility = useRepoVisibilityStore();
const repoPanelTabStore = useRepoPanelTabStore();
const repoSearchStore = useRepoSearchStore();
const terminalsStore = useTerminalsStore();
const reposDialog = useReposDialogStore();

// P67b §4.4: the Git module's own panel — one PanelShell, not a shell inside a shell. Absorbs the
// repository list that used to live in ProjectPanel.vue's "Connections" section (§0's own
// complaint: "so there are no repos alingside connections") — it is now the title bar's former
// repo switcher, relocated and widened, sitting directly above whichever repo workspace's own
// Files/Search/Review body is active. `repoId` is still derived from the active workspace (never a
// prop) — '' when the bare 'git' key is active, which is exactly the "list only" state.
const repoId = computed(() => repoIdOfWorkspace(workspaceStore.active) ?? '');

// P84 §8.4: two independent queries — one string would mean a filter typed on one tab silently
// hides rows on the other. Each keeps its own text across tab switches.
const local = reactive({ repoSearch: '', fileSearch: '' });

// P220: tab persists (state/search.ts, `kira.git.panelTab`, default Repos); no auto-switch on repo
// open or mount. With no repo workspace active, Files/Review have nothing to show: display Repos
// without writing it, so the stored choice returns once a repo is active.
// P92 item 6: backed by useRepoPanelTabStore — hostHandlers.ts's review.open flips it from outside.
const tab = computed({
  get: () => (repoId.value ? repoPanelTabStore.repoPanelTab() : 'repos'),
  set: (v: 'repos' | 'files' | 'review') => repoPanelTabStore.setRepoPanelTab(v),
});

// P67b §4.4: a single click opens (if not yet open) or activates (if open) — OQ-2's adopted
// recommendation. This panel's entire subject is repositories, so a click that only paints a
// highlight is a dead control; double-click still works, since it is a click first.
//
// P84 §6.3: an anchor row whose *worktree* is the open workspace must not read as closed — "open"
// now also means "some row parented to me is open". Guarded on `id` since worktreeRecordId can
// return '' for a worktree never opened in this app, and '' would otherwise match every open
// top-level repo (every anchor's own parentId is '' too).
function isOpen(id: string): boolean {
  if (!id) return false;
  return (
    workspaceStore.openRepos.includes(id) ||
    workspaceStore.openRepos.some((o) => repoLinksStore.worktreeParentId(o) === id)
  );
}
function isActive(id: string): boolean {
  return workspaceStore.active === repoWorkspaceKey(id);
}
function onRowClick(id: string): void {
  if (isOpen(id)) workspaceStore.activateWorkspace(repoWorkspaceKey(id));
  else workspaceStore.openRepoWorkspace(id);
}

/** P84 §6.1: the code_repos id backing a worktree path, once it has been opened in this app —
 *  '' before that (no row to mark open/active, no row to attach Rename/Close/Remove to yet). */
function worktreeRecordId(path: string): string {
  return codeReposStore.codeRepoRecordForPath(path)?.id ?? '';
}

// P84 §3: a row with a non-empty parentId never renders at the top level — only nested under its
// anchor's twisty (`worktreeEntries` below). §4.4: reads this panel's own PanelShell search box
// (`local.repoSearch`), not the Studio tree's own `treeState.search`.
const filteredRepos = computed<RepoSummary[]>(() => {
  const topLevel = visibility.listed;
  return topLevel.filter((r) => matchesQuery(r.name, local.repoSearch));
});

// P107 T2-19: shared in-app substitute for window.prompt() (Electron's renderer doesn't implement
// it) — see packages/workbench/src/prompt/useTextPrompt.ts.
const {
  prompt: textPrompt,
  open: promptText,
  submit: submitPrompt,
  cancel: cancelPrompt,
} = useTextPrompt();

// A repo row renames inline; a worktree's record name is not shown in its row, so that rename keeps
// the prompt.
const renamingRepoId = ref<string | null>(null);

function startRepoRename(id: string): void {
  contextMenuStore.afterClose(() => {
    renamingRepoId.value = id;
  });
}

async function onRenameWorktreeRecord(id: string, currentName: string): Promise<void> {
  const name = await promptText(t('space.repo.panel.rename.title'), currentName);
  if (!name || name.trim() === '') return;
  await codeReposStore.renameCodeRepo(id, name.trim());
}

async function commitRepoRename(id: string, name: string): Promise<void> {
  renamingRepoId.value = null;
  await codeReposStore.renameCodeRepo(id, name);
}

async function onRemoveRepo(id: string, name: string): Promise<void> {
  await codeReposStore.confirmRemoveCodeRepo(id, name);
}

// Same calls as the row's Close; collapse first so the lease release is synchronous.
function closeRepo(id: string): void {
  worktreesStore.collapseRepoWorktrees(id);
  workspaceStore.closeRepoWorkspace(id);
}

async function onHideRepo(id: string): Promise<void> {
  await codeReposStore.setCodeRepoHidden(id, true);
  closeRepo(id);
}

// P107 I2-20: the Rename…/Close/Remove triple onRepoContextMenu and onWorktreeContextMenu below
// both build — same three items, same handlers, only "which record" differs. Close only renders
// while `id` isOpen (both callers'); Rename/Remove always render (both callers already gate
// whether to offer this triple at all before calling — onWorktreeContextMenu only for a worktree
// that has its own code_repos record).
function recordMenuItems(
  record: { id: string; name: string },
  handlers: { rename: () => void; close: () => void; remove: () => void },
): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'item' as const,
      id: 'rename',
      label: t('common.action.rename.label'),
      icon: 'edit',
      run: handlers.rename,
    },
  ];
  if (isOpen(record.id)) {
    items.push({
      type: 'item' as const,
      id: 'close',
      label: t('common.action.close.label'),
      icon: 'close',
      run: handlers.close,
    });
  }
  items.push({
    type: 'item' as const,
    id: 'remove',
    label: t('common.action.remove.label'),
    icon: 'trash',
    danger: true,
    run: handlers.remove,
  });
  return items;
}

function repoIconClass(repo: RepoSummary): string {
  return isOpen(repo.id) ? 'text-fg' : 'text-muted-foreground';
}

function repoMenuItems(repo: RepoSummary): MenuItem[] {
  return [
    {
      type: 'item' as const,
      id: 'open',
      label: t('common.action.open.label'),
      icon: 'folder-opened',
      run: () => onRowClick(repo.id),
    },
    {
      type: 'item' as const,
      id: 'copy-path',
      label: t('common.action.copyPath.label'),
      icon: 'copy',
      run: () => void copyAndAnnounce(repo.root, t('common.copy.copiedPath.announce')),
    },
    {
      type: 'item' as const,
      id: 'open-terminal',
      label: t('common.action.openTerminal.label'),
      icon: 'terminal-bash',
      run: () => void openRepoTerminalTab(repo.id, repo.root),
    },
    {
      type: 'item' as const,
      id: 'configure',
      label: t('space.repo.panel.configure.label'),
      icon: 'settings-gear',
      run: () => reposDialog.show({ repoId: repo.id }),
    },
    {
      type: 'submenu' as const,
      id: 'color',
      label: t('common.field.colour.label'),
      icon: 'symbol-color',
      items: PALETTE_COLOR_CHOICES.map((color) => ({
        type: 'item' as const,
        id: `color-${color}`,
        label: colourLabel(color as ColourName),
        swatch: color,
        checked: repo.color === color,
        run: () => codeReposStore.setCodeRepoColor(repo.id, color),
      })),
    },
    repo.hidden
      ? {
          type: 'item' as const,
          id: 'show',
          label: t('common.action.show.label'),
          icon: 'eye',
          run: () => codeReposStore.setCodeRepoHidden(repo.id, false),
        }
      : {
          type: 'item' as const,
          id: 'hide',
          label: t('common.action.hide.label'),
          icon: 'eye-closed',
          run: () => onHideRepo(repo.id),
        },
    { type: 'separator' as const },
    ...recordMenuItems(repo, {
      rename: () => startRepoRename(repo.id),
      // P82 §8.3: collapse first, so the lease release is synchronous with the close instead of a
      // watch flush later — the same reason quickOpen.ts:178 exposes dropQuickOpen alongside its
      // own watch. The §6.6 watch would collapse it anyway.
      close: () => closeRepo(repo.id),
      remove: () => onRemoveRepo(repo.id, repo.name),
    }),
  ];
}

// P83 §11.2: the indicator's own tooltip text — terminalCountAtPath is §11's whole signal (the
// terminal registry, already keyed by canonical cwd), so opening or exiting a terminal repaints
// the row with no event plumbing of this panel's own.
function terminalTooltip(n: number): string {
  return t('space.repo.panel.terminalOpen.tooltip', { count: n });
}

// P83 §10.2: a worktree row's own context menu — out of scope for P82 (nothing needed one yet),
// needed now since without it a terminal could never be opened at a worktree that isn't the active
// workspace. "Copy path" rides along since the menu must exist anyway and a one-item menu reads
// like an accident — the same item the repo row already offers above.
function worktreeMenuItems(repo: RepoSummary, wt: WorktreeEntry): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'item' as const,
      id: 'open-terminal',
      label: t('common.action.openTerminal.label'),
      icon: 'terminal-bash',
      run: () => void openRepoTerminalTab(repo.id, wt.path),
    },
    {
      type: 'item' as const,
      id: 'copy-path',
      label: t('common.action.copyPath.label'),
      icon: 'copy',
      run: () => void copyAndAnnounce(wt.path, t('common.copy.copiedPath.announce')),
    },
  ];
  // P84 §6.2: once the flat top-level row is gone, Rename/Close/Remove for this record are
  // reachable from nowhere else — the same three items onRepoContextMenu builds, same handlers, no
  // second code path. Only offered once the worktree has its own code_repos row (it has been
  // opened in this app at least once); a worktree never opened here has nothing to rename or remove.
  const record = codeReposStore.codeRepoRecordForPath(wt.path);
  if (record) {
    items.push({ type: 'separator' as const });
    items.push(
      ...recordMenuItems(record, {
        rename: () => onRenameWorktreeRecord(record.id, record.name),
        close: () => closeRepo(record.id),
        // Removes the code_repos record, never the worktree on disk — the nested row survives it,
        // since it comes from `git worktree list`, not from codeReposState.
        remove: () => onRemoveRepo(record.id, record.name),
      }),
    );
  }
  return items;
}

// Flat row list for keyboard navigation: each repo followed by its worktrees while expanded.
type NavRow =
  | { key: string; kind: 'repo'; repo: RepoSummary }
  | { key: string; kind: 'worktree'; repo: RepoSummary; wt: WorktreeEntry };
const wtKey = (wt: WorktreeEntry): string => `wt:${wt.path}`;
const navRows = computed<NavRow[]>(() =>
  filteredRepos.value.flatMap((repo): NavRow[] => [
    { key: repo.id, kind: 'repo', repo },
    ...(worktreesStore.isWorktreesExpanded(repo.id)
      ? worktreesStore
          .worktreeEntries(repo.id)
          .map((wt): NavRow => ({ key: wtKey(wt), kind: 'worktree', repo, wt }))
      : []),
  ]),
);
const listEl = useTemplateRef<HTMLElement>('listEl');
const activeNavKey = ref<string | null>(null);
// The roving stop follows the active workspace when it changes from elsewhere.
watch(
  () => workspaceStore.active,
  () => {
    const row = navRows.value.find((r) => r.kind === 'repo' && isActive(r.repo.id));
    if (row) activeNavKey.value = row.key;
  },
  { immediate: true },
);

function menuFor(row: NavRow): MenuItem[] {
  return row.kind === 'repo' ? repoMenuItems(row.repo) : worktreeMenuItems(row.repo, row.wt);
}
function activateRow(row: NavRow): void {
  if (row.kind === 'repo') onRowClick(row.repo.id);
  else void worktreesStore.switchToWorktree(row.repo.id, row.wt);
}
function onRowContextMenu(e: MouseEvent, row: NavRow): void {
  // Right-click focuses the row without opening anything.
  activeNavKey.value = row.key;
  contextMenuStore.openContextMenu(e, menuFor(row), {
    onRestoreFocus: () => void nav.focusKey(row.key),
  });
}

// Arrows, Home/End, Right/Left (worktrees), Enter and Space (open or switch), Shift+F10 come from
// the shared list navigation. No type-ahead: the panel's own type-to-search redirect owns printable keys.
const nav = useListNavigation<NavRow>({
  container: listEl,
  items: () => navRows.value,
  key: (row) => row.key,
  activeKey: activeNavKey,
  tree: {
    depth: (row) => (row.kind === 'repo' ? 0 : 1),
    isExpanded: (row) => row.kind === 'repo' && worktreesStore.isWorktreesExpanded(row.repo.id),
    hasChildren: (row) => row.kind === 'repo',
    expand: (row) => worktreesStore.toggleRepoWorktrees(row.repo.id),
    collapse: (row) => worktreesStore.toggleRepoWorktrees(row.repo.id),
  },
  onOpen: activateRow,
  onSelect: activateRow,
  onMenu: (row, rect) =>
    contextMenuStore.openContextMenuAt(rect.left, rect.bottom, menuFor(row), {
      onRestoreFocus: () => void nav.focusKey(row.key),
    }),
});

// C7 D9: lives in repo/state/search.ts, not component state, so switching workspaces and back
// does not reset it. P92 item 6: 'review' moved out to its own top-level `tab`, so this segment is
// back to Files/Search only.
const view = computed({
  get: () => repoSearchStore.repoSearchView(repoId.value),
  set: (v: 'files' | 'search') => repoSearchStore.setRepoSearchView(repoId.value, v),
});
const panelTabItems = computed(() => [
  { value: 'repos', label: t('common.module.repositories.label'), testid: 'git-panel-tab-repos' },
  { value: 'files', label: t('common.module.files.label'), testid: 'git-panel-tab-files' },
  {
    value: 'review',
    label: t('space.ade.board.branchTag.review.label'),
    testid: 'git-panel-tab-review',
  },
]);
const viewOptions = computed(() => [
  { value: 'files' as const, label: t('common.module.files.label'), testid: 'repo-view-files' },
  { value: 'search' as const, label: t('common.action.search.label'), testid: 'repo-view-search' },
]);

// C11 §8.4/§5.3: this panel is one persistent component instance across every repo workspace
// (WorkbenchShell.vue's `<component :is="activeModePanel" />` carries no per-repo key, unlike a
// tab), so "kept alive with v-show while the workspace is open" (§8.4) is tracked per repoId here
// rather than with a single boolean — switching to a DIFFERENT repo's workspace and back remounts
// (review.session.save/load, S6, is exactly the resume path that makes that safe) while switching
// between this SAME repo's Files/Search/Review segments never does, since the set entry it added
// on first activation never goes away.
const reviewActivatedRepoIds = reactive(new Set<string>());
// A watcher, not the computed setter above, because setRepoPanelTab also has a second caller
// (hostHandlers.ts's review.open, via "Review branch changes") this component's own setter is
// never in the call path for.
watch(
  tab,
  (v) => {
    if (v !== 'review') return;
    reviewActivatedRepoIds.add(repoId.value);
    // §14 OQ2: widen once, only if the user has never manually resized the panel — checked inside
    // ensureReviewPanelWidth itself (state/layout.ts's own widthUserSet). 320px: VS Code's ~300px
    // sidebar default, raised a little for the review panes' own extra density.
    layoutStore.ensureReviewPanelWidth(320);
  },
  { immediate: true },
);

function onRefresh(): void {
  void fileTreeStore.refreshRepoTree(repoId.value);
}

// P104 §3: PanelShell's own search/empty props, inlined -- the panel routes to one of two search
// strings depending on which top-level tab is active (Repos vs. Files), same as before.
const panelSearch = computed<string>({
  get: () => (tab.value === 'repos' ? local.repoSearch : local.fileSearch),
  set: (v: string) => {
    if (tab.value === 'repos') local.repoSearch = v;
    else local.fileSearch = v;
  },
});
const panelEmpty = computed(() => codeReposStore.records.length === 0);
// Every top-level repo hidden and Show hidden off: the list is empty by choice, not for lack of imports.
const allHidden = computed(() => visibility.listed.length === 0 && visibility.hasHidden);
const panelSearchable = computed(() => tab.value !== 'review');
const rootEl = useTemplateRef<HTMLElement>('rootEl');
const { showSearch, toggleSearch } = usePanelHeaderSearch(rootEl, {
  searchable: () => panelSearchable.value,
  getSearch: () => panelSearch.value,
  setSearch: (v) => {
    panelSearch.value = v;
  },
});

// C7 S10: `repo.search`'s own palette entry (shortcuts/state.ts) — this panel is the whole of a
// repo workspace's own left panel, mounted for as long as that workspace is open, so there is no
// tab-scoping question the way view.find's per-view registration has.
let unregisterSearchCommand: (() => void) | null = null;
onMounted(() => {
  unregisterSearchCommand = registerCommand('repo.search', () => {
    view.value = 'search';
  });
  // P83 plan §12.3 trigger 1: the panel is mounted for as long as the Git module is, so this is
  // once per session, not once per render.
  void repoHeadsStore.refreshRepoHeads();
  // P84 §4.4 trigger 1: same reasoning — one batched worktree-parent read per session, not once
  // per row.
  void repoLinksStore.refreshRepoWorktreeLinks();
});
onUnmounted(() => {
  unregisterSearchCommand?.();
  unregisterSearchCommand = null;
});
</script>

<template>
  <div ref="rootEl" class="flex h-full min-h-0 flex-col">
    <PanelHeader>
      <!-- P84 §8.1/§9: replaces the old repo-name title — the tabs already say what's open.
           P92 item 6: Review joins Repos/Files as a third tab, off the Files body's own segment. -->
      <template #start>
        <SecondaryTabs
          :model-value="tab"
          :items="panelTabItems"
          @update:model-value="(v) => (tab = v as 'repos' | 'files' | 'review')"
        />
      </template>
      <template #actions>
        <TooltipIconButton
          icon="search"
          :label="showSearch ? t('common.action.hideSearch.label') : t('common.action.search.label')"
          :pressed="showSearch"
          data-testid="toggle-search"
          @click="toggleSearch"
        />
        <TooltipIconButton
          v-if="tab === 'repos' && (visibility.hasHidden || visibility.showHidden)"
          :icon="visibility.showHidden ? 'eye' : 'eye-closed'"
          :label="visibility.showHidden ? t('space.repo.panel.hideHidden.tooltip') : t('space.repo.panel.showHidden.tooltip')"
          :pressed="visibility.showHidden"
          data-testid="repos-show-hidden"
          @click="visibility.showHidden = !visibility.showHidden"
        />
        <TooltipIconButton
          v-if="tab === 'repos'"
          icon="repo"
          :label="t('space.repo.manage.label')"
          data-testid="manage-repos"
          @click="reposDialog.show()"
        />
        <!-- Files mode only: in Search mode the panel's own tree filter is meaningless, and a tree
             refresh has nothing to do with a search result list. -->
        <TooltipIconButton
          v-if="tab === 'files' && view === 'files'"
          icon="refresh"
          :label="t('space.repo.panel.refreshTree.tooltip')"
          :aria-label="t('common.action.refresh.label')"
          data-testid="repo-refresh"
          @click="onRefresh"
        />
      </template>
    </PanelHeader>
    <template v-if="!panelEmpty">
      <PanelBar v-if="panelSearchable && showSearch">
        <SearchField v-model="panelSearch" data-testid="tree-search" />
      </PanelBar>
      <div class="min-h-0 flex-1">
        <div class="h-full flex flex-col min-h-0">
          <section
            v-if="tab === 'repos'"
            class="flex-1 min-h-0 overflow-y-auto"
            data-testid="repo-section"
          >
            <EmptyState
              v-if="allHidden"
              class="h-full"
              icon="eye-closed"
              :title="t('space.repo.panel.allHidden.title')"
              :description="t('space.repo.panel.allHidden.description')"
              data-testid="repos-all-hidden"
            />
            <div
              v-else
              ref="listEl"
              class="flex flex-col"
              role="listbox"
              :aria-label="t('common.module.repositories.label')"
            >
              <div v-for="repo in filteredRepos" :key="repo.id" class="repo-entry">
                <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter, Space and the arrows come from useListNavigation on the list. -->
                <!-- biome-ignore lint/a11y/useFocusableInteractive: nav.rowProps sets the roving tabindex. -->
                <div
                  :class="[
                  cn(rowVariants({ layout: 'tree', selected: isActive(repo.id), muted: repo.hidden }), 'h-row'),
                  { active: isActive(repo.id) },
                ]"
                  :style="rowIndent(0)"
                  data-testid="repo-row"
                  :data-repo-id="repo.id"
                  role="option"
                  v-bind="nav.rowProps(repo.id)"
                  :aria-selected="isActive(repo.id)"
                  @click="onRowClick(repo.id)"
                  @contextmenu.prevent="onRowContextMenu($event, { key: repo.id, kind: 'repo', repo })"
                >
                  <span
                    :class="colorMarkClass('rail', repo.color)"
                    data-testid="repo-rail"
                    aria-hidden="true"
                  />
                  <!-- P110 I2-13: RepoTreeRow.vue's own twisty, shared via TreeTwisty. -->
                  <TreeTwisty
                    :expanded="worktreesStore.isWorktreesExpanded(repo.id)"
                    :has-children="true"
                    :aria-expanded="worktreesStore.isWorktreesExpanded(repo.id)"
                    testid="repo-row-expand"
                    @toggle="worktreesStore.toggleRepoWorktrees(repo.id)"
                  />
                  <CodiconIcon
                    name="source-control"
                    :size="13"
                    class="shrink-0"
                    :class="repoIconClass(repo)"
                  />
                  <InlineEditInput
                    v-if="renamingRepoId === repo.id"
                    :name="repo.name"
                    data-testid="repo-rename-input"
                    @commit="(name) => commitRepoRename(repo.id, name)"
                    @cancel="renamingRepoId = null"
                  />
                  <Tooltip v-else>
                    <TooltipTrigger as-child>
                      <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{
                        repo.name
                      }}</span>
                    </TooltipTrigger>
                    <TooltipContent>{{ repo.root }}</TooltipContent>
                  </Tooltip>
                  <!-- P83 plan §12.4: a repo row's checked-out branch. The name span's own flex-1
                     above keeps it yielding first, so this is what survives on a narrow panel. Same
                     size/colour
                     pair as `.worktree-badge` below, so a collapsed row's branch and its expanded
                     children's read as the same class of information. -->
                  <Tooltip v-if="repo.hidden">
                    <TooltipTrigger as-child>
                      <CodiconIcon
                        name="eye-closed"
                        :size="13"
                        class="shrink-0 text-subtle"
                        data-testid="repo-hidden-mark"
                      />
                    </TooltipTrigger>
                    <TooltipContent>{{ t('space.common.hidden.status') }}</TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="repoHeadsStore.repoHeadLabel(repo.id)">
                    <TooltipTrigger as-child>
                      <span
                        class="repo-head flex-none min-w-0 max-w-5/12 overflow-hidden text-ellipsis whitespace-nowrap text-kira-sm text-subtle"
                      >
                        {{ repoHeadsStore.repoHeadLabel(repo.id) }}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{{ repoHeadsStore.repoHeadLabel(repo.id) }}</TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="terminalsStore.terminalCountAtPath(repo.root) > 0">
                    <TooltipTrigger as-child>
                      <CodiconIcon
                        name="terminal-bash"
                        :size="12"
                        class="shrink-0 text-subtle"
                        data-testid="repo-terminal-indicator"
                      />
                    </TooltipTrigger>
                    <TooltipContent>{{
                      terminalTooltip(terminalsStore.terminalCountAtPath(repo.root))
                    }}</TooltipContent>
                  </Tooltip>
                </div>
                <section
                  v-if="worktreesStore.isWorktreesExpanded(repo.id)"
                  class="flex flex-col"
                  data-testid="repo-worktrees"
                  :aria-label="t('common.module.worktrees.label')"
                >
                  <!-- Children of a twisty row sit one indent level in (`rowIndent(1)`). -->
                  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter, Space and the arrows come from useListNavigation on the list. -->
                  <!-- biome-ignore lint/a11y/useFocusableInteractive: nav.rowProps sets the roving tabindex. -->
                  <div
                    v-for="wt in worktreesStore.worktreeEntries(repo.id)"
                    :key="wt.path"
                    :class="[
                    cn(
                      rowVariants({
                        layout: 'tree',
                        selected: isActive(worktreeRecordId(wt.path)),
                        muted: !(wt.isCurrent || isOpen(worktreeRecordId(wt.path))),
                      }),
                      'h-row',
                    ),
                    { active: isActive(worktreeRecordId(wt.path)) },
                  ]"
                    :style="rowIndent(1)"
                    data-testid="repo-worktree-row"
                    :data-worktree-path="wt.path"
                    role="option"
                    v-bind="nav.rowProps(wtKey(wt))"
                    :aria-selected="isActive(worktreeRecordId(wt.path))"
                    @click.stop="worktreesStore.switchToWorktree(repo.id, wt)"
                    @contextmenu.prevent.stop="onRowContextMenu($event, { key: wtKey(wt), kind: 'worktree', repo, wt })"
                  >
                    <span
                      :class="colorMarkClass('rail', repo.color)"
                      data-testid="repo-worktree-rail"
                      aria-hidden="true"
                    />
                    <CodiconIcon name="git-branch" :size="13" class="shrink-0" />
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{
                          worktreeLabel(wt)
                        }}</span>
                      </TooltipTrigger>
                      <TooltipContent>{{ wt.path }}</TooltipContent>
                    </Tooltip>
                    <Tooltip v-if="wt.isMain">
                      <TooltipTrigger as-child>
                        <span class="worktree-badge shrink-0 text-kira-sm text-subtle">{{
                          t('space.ade.basePicker.main.label')
                        }}</span>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('common.mainWorktree.tooltip') }}</TooltipContent>
                    </Tooltip>
                    <Tooltip v-if="terminalsStore.terminalCountAtPath(wt.path) > 0">
                      <TooltipTrigger as-child>
                        <CodiconIcon
                          name="terminal-bash"
                          :size="12"
                          class="shrink-0 text-subtle"
                          data-testid="repo-terminal-indicator"
                        />
                      </TooltipTrigger>
                      <TooltipContent>{{
                        terminalTooltip(terminalsStore.terminalCountAtPath(wt.path))
                      }}</TooltipContent>
                    </Tooltip>
                    <Tooltip v-if="wt.locked">
                      <TooltipTrigger as-child>
                        <CodiconIcon name="lock" :size="12" class="shrink-0 text-subtle" />
                      </TooltipTrigger>
                      <TooltipContent>{{ wt.locked?.reason }}</TooltipContent>
                    </Tooltip>
                  </div>
                  <!-- Same indent as the worktree row above. -->
                  <InlineState
                    v-if="worktreesStore.worktreesError(repo.id)"
                    kind="error"
                    :style="rowIndent(1)"
                    data-testid="repo-worktree-error"
                  >
                    {{ worktreesStore.worktreesError(repo.id) }}
                  </InlineState>
                  <InlineState
                    v-else-if="worktreesStore.worktreesLoading(repo.id) && worktreesStore.worktreeEntries(repo.id).length === 0"
                    kind="loading"
                    :style="rowIndent(1)"
                  >
                    {{ t('common.state.loading.loading') }}
                  </InlineState>
                  <InlineState
                    v-else-if="worktreesStore.worktreeEntries(repo.id).length === 0"
                    kind="empty"
                    :style="rowIndent(1)"
                  >
                    {{ t('space.repo.panel.noWorktrees.empty') }}
                  </InlineState>
                </section>
              </div>
            </div>
          </section>
          <template v-else>
            <template v-if="repoId">
              <template v-if="tab === 'files'">
                <PanelBar>
                  <SecondaryTabs
                    :model-value="view"
                    :items="viewOptions"
                    @update:model-value="(v) => (view = v as 'files' | 'search')"
                  />
                </PanelBar>
                <template v-if="view === 'files'">
                  <Alert
                    v-if="fileTreeStore.repoTreeError(repoId)"
                    variant="error"
                    data-testid="repo-tree-error"
                  >
                    <AlertDescription>{{ fileTreeStore.repoTreeError(repoId) }}</AlertDescription>
                  </Alert>
                  <Alert
                    v-if="fileTreeStore.repoTreeTruncated(repoId)"
                    variant="info"
                    data-testid="repo-tree-truncated"
                  >
                    <AlertDescription>{{
                      t('space.repo.panel.treeTruncated.hint')
                    }}</AlertDescription>
                  </Alert>
                  <!-- Always mounted, never gated on isRepoTreeLoaded — RepoFileTree's own onMounted
                     is what calls ensureRepoTreeLoaded in the first place; gating on the state it
                     sets would mean it never gets the chance to. Its own `rows` computed is empty
                     until the load resolves, then updates reactively — no separate loading
                     placeholder needed for a first open this fast. -->
                  <RepoFileTree
                    class="flex-1 min-h-0"
                    :repo-id="repoId"
                    :search="local.fileSearch"
                  />
                </template>
                <RepoSearchView
                  v-else-if="view === 'search'"
                  class="flex-1 min-h-0"
                  :repo-id="repoId"
                />
              </template>
              <!-- C11 §8.4: mounted once (reviewActivatedRepoIds), then only ever hidden/shown,
                 never destroyed, by a Files<->Review or Search<->Review switch within this same
                 repo. P92 item 6: gated on `tab`, Review's own top-level tab, not `view`. -->
              <RepoReviewView
                v-if="reviewActivatedRepoIds.has(repoId)"
                v-show="tab === 'review'"
                :key="repoId"
                class="flex-1 min-h-0"
                :repo-id="repoId"
              />
            </template>
            <EmptyState
              v-else
              class="h-full"
              icon="source-control"
              :title="t('space.repo.noRepoOpen.empty')"
            />
          </template>
        </div>
      </div>
    </template>
    <EmptyState
      v-else
      class="h-full"
      icon="source-control"
      :title="t('space.repo.panel.importPrompt.emptyHint')"
    />
  </div>

  <TextPromptDialog
    v-if="textPrompt"
    :title="textPrompt.title"
    :model-value="textPrompt.value"
    @update:model-value="(v) => textPrompt && (textPrompt.value = v)"
    @submit="submitPrompt"
    @cancel="cancelPrompt"
  />
  <ReposDialog />
  <!-- Row state comes from `rowVariants` (selected/muted). `active` stays a real class on both
       rows (repo-workspace.spec.ts asserts `toHaveClass(/active/)`); `.repo-head`/`.worktree-badge`
       stay real classes too (the same spec locates them by class). -->
</template>
