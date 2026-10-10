<script setup lang="ts">
import type { WorktreeEntry } from '@kira/git-ipc';
import { PALETTE_COLOR_CHOICES } from '@shared/domain/color';
import type { RepoSummary } from '@shared/domain/repo';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { colorMarkClass } from '@theme/connColor';
import { cn } from '@theme/lib/utils';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import TextPromptDialog from '@workbench/prompt/TextPromptDialog.vue';
import { useTextPrompt } from '@workbench/prompt/useTextPrompt';
import { registerCommand } from '@workbench/shortcuts/commands';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { copyText } from '@workbench/util/clipboard';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, onMounted, onUnmounted, reactive, useTemplateRef, watch } from 'vue';
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
  const query = local.repoSearch.trim().toLowerCase();
  if (!query) return topLevel;
  return topLevel.filter((r) => r.name.toLowerCase().includes(query));
});

// P107 T2-19: shared in-app substitute for window.prompt() (Electron's renderer doesn't implement
// it) — see packages/workbench/src/prompt/useTextPrompt.ts.
const { prompt: textPrompt, open: promptText, submit: submitPrompt, cancel: cancelPrompt } = useTextPrompt();

async function onRenameRepo(id: string, currentName: string): Promise<void> {
  const name = await promptText('Rename repository', currentName);
  if (!name || name.trim() === '') return;
  await codeReposStore.renameCodeRepo(id, name.trim());
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
    { type: 'item' as const, id: 'rename', label: 'Rename…', icon: 'edit', run: handlers.rename },
  ];
  if (isOpen(record.id)) {
    items.push({ type: 'item' as const, id: 'close', label: 'Close', icon: 'close', run: handlers.close });
  }
  items.push({
    type: 'item' as const,
    id: 'remove',
    label: 'Remove',
    icon: 'trash',
    danger: true,
    run: handlers.remove,
  });
  return items;
}

function repoIconClass(repo: RepoSummary): string {
  return isOpen(repo.id) ? 'text-fg' : 'text-muted-foreground';
}

function onRepoContextMenu(e: MouseEvent, repo: RepoSummary): void {
  const items: MenuItem[] = [
    {
      type: 'item' as const,
      id: 'open',
      label: 'Open',
      icon: 'folder-opened',
      run: () => onRowClick(repo.id),
    },
    {
      type: 'item' as const,
      id: 'copy-path',
      label: 'Copy path',
      icon: 'copy',
      run: () => void copyText(repo.root),
    },
    {
      type: 'item' as const,
      id: 'open-terminal',
      label: 'Open terminal',
      icon: 'terminal-bash',
      run: () => void openRepoTerminalTab(repo.id, repo.root),
    },
    {
      type: 'item' as const,
      id: 'configure',
      label: 'Configure repository…',
      icon: 'settings-gear',
      run: () => reposDialog.show({ repoId: repo.id }),
    },
    {
      type: 'submenu' as const,
      id: 'color',
      label: 'Colour',
      icon: 'symbol-color',
      items: PALETTE_COLOR_CHOICES.map((color) => ({
        type: 'item' as const,
        id: `color-${color}`,
        label: color,
        swatch: color,
        checked: repo.color === color,
        run: () => codeReposStore.setCodeRepoColor(repo.id, color),
      })),
    },
    repo.hidden
      ? {
          type: 'item' as const,
          id: 'show',
          label: 'Show',
          icon: 'eye',
          run: () => codeReposStore.setCodeRepoHidden(repo.id, false),
        }
      : {
          type: 'item' as const,
          id: 'hide',
          label: 'Hide',
          icon: 'eye-closed',
          run: () => onHideRepo(repo.id),
        },
    { type: 'separator' as const },
    ...recordMenuItems(repo, {
      rename: () => onRenameRepo(repo.id, repo.name),
      // P82 §8.3: collapse first, so the lease release is synchronous with the close instead of a
      // watch flush later — the same reason quickOpen.ts:178 exposes dropQuickOpen alongside its
      // own watch. The §6.6 watch would collapse it anyway.
      close: () => closeRepo(repo.id),
      remove: () => onRemoveRepo(repo.id, repo.name),
    }),
  ];
  contextMenuStore.openContextMenu(e, items);
}

// P83 §11.2: the indicator's own tooltip text — terminalCountAtPath is §11's whole signal (the
// terminal registry, already keyed by canonical cwd), so opening or exiting a terminal repaints
// the row with no event plumbing of this panel's own.
function terminalTooltip(n: number): string {
  return n === 1 ? 'A terminal is open here' : `${n} terminals are open here`;
}

// P83 §10.2: a worktree row's own context menu — out of scope for P82 (nothing needed one yet),
// needed now since without it a terminal could never be opened at a worktree that isn't the active
// workspace. "Copy path" rides along since the menu must exist anyway and a one-item menu reads
// like an accident — the same item the repo row already offers above.
function onWorktreeContextMenu(e: MouseEvent, repo: RepoSummary, wt: WorktreeEntry): void {
  const items: MenuItem[] = [
    {
      type: 'item' as const,
      id: 'open-terminal',
      label: 'Open terminal',
      icon: 'terminal-bash',
      run: () => void openRepoTerminalTab(repo.id, wt.path),
    },
    {
      type: 'item' as const,
      id: 'copy-path',
      label: 'Copy path',
      icon: 'copy',
      run: () => void copyText(wt.path),
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
        rename: () => onRenameRepo(record.id, record.name),
        close: () => closeRepo(record.id),
        // Removes the code_repos record, never the worktree on disk — the nested row survives it,
        // since it comes from `git worktree list`, not from codeReposState.
        remove: () => onRemoveRepo(record.id, record.name),
      }),
    );
  }
  contextMenuStore.openContextMenu(e, items);
}

// C7 D9: lives in repo/state/search.ts, not component state, so switching workspaces and back
// does not reset it. P92 item 6: 'review' moved out to its own top-level `tab`, so this segment is
// back to Files/Search only.
const view = computed({
  get: () => repoSearchStore.repoSearchView(repoId.value),
  set: (v: 'files' | 'search') => repoSearchStore.setRepoSearchView(repoId.value, v),
});
const panelTabItems = [
  { value: 'repos', label: 'Repos', testid: 'git-panel-tab-repos' },
  { value: 'files', label: 'Files', testid: 'git-panel-tab-files' },
  { value: 'review', label: 'Review', testid: 'git-panel-tab-review' },
];
const viewOptions = [
  { value: 'files' as const, label: 'Files', testid: 'repo-view-files' },
  { value: 'search' as const, label: 'Search', testid: 'repo-view-search' },
];

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
    // sidebar default, rounded up a little for the review panes' own extra density.
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
          :label="showSearch ? 'Hide search' : 'Search'"
          :pressed="showSearch"
          data-testid="toggle-search"
          @click="toggleSearch"
        />
        <TooltipIconButton
          v-if="tab === 'repos' && (visibility.hasHidden || visibility.showHidden)"
          :icon="visibility.showHidden ? 'eye' : 'eye-closed'"
          :label="visibility.showHidden ? 'Hide hidden repositories' : 'Show hidden repositories'"
          :pressed="visibility.showHidden"
          data-testid="repos-show-hidden"
          @click="visibility.showHidden = !visibility.showHidden"
        />
        <TooltipIconButton
          v-if="tab === 'repos'"
          icon="repo"
          label="Manage repositories…"
          data-testid="manage-repos"
          @click="reposDialog.show()"
        />
        <!-- Files mode only: in Search mode the panel's own tree filter is meaningless, and a tree
             refresh has nothing to do with a search result list. -->
        <TooltipIconButton
          v-if="tab === 'files' && view === 'files'"
          icon="refresh"
          label="Refresh file tree"
          aria-label="Refresh"
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
        <section v-if="tab === 'repos'" class="flex-1 min-h-0 overflow-y-auto" data-testid="repo-section">
          <Empty v-if="allHidden" class="h-full" data-testid="repos-all-hidden">
            <EmptyHeader>
              <EmptyMedia><CodiconIcon name="eye-closed" :size="24" /></EmptyMedia>
              <EmptyTitle>All repositories are hidden</EmptyTitle>
              <EmptyDescription>They stay imported and usable.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="dialog" size="kira-lg" data-testid="repos-show-hidden-empty" @click="visibility.showHidden = true">
                Show hidden
              </Button>
            </EmptyContent>
          </Empty>
          <div v-else class="flex flex-col" role="listbox" aria-label="Repositories">
            <div v-for="repo in filteredRepos" :key="repo.id" class="repo-entry">
              <div
                :class="[
                  cn(rowVariants({ layout: 'tree', selected: isActive(repo.id), muted: repo.hidden }), 'h-row'),
                  { active: isActive(repo.id) },
                ]"
                :style="rowIndent(0)"
                data-testid="repo-row"
                :data-repo-id="repo.id"
                role="option"
                tabindex="0"
                :aria-selected="isActive(repo.id)"
                @click="onRowClick(repo.id)"
                @keydown.enter.prevent="onRowClick(repo.id)"
                @keydown.space.prevent="onRowClick(repo.id)"
                @contextmenu.prevent="onRepoContextMenu($event, repo)"
              >
                <span :class="colorMarkClass('rail', repo.color)" data-testid="repo-rail" aria-hidden="true" />
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
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ repo.name }}</span>
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
                  <TooltipContent>Hidden</TooltipContent>
                </Tooltip>
                <Tooltip v-if="repoHeadsStore.repoHeadLabel(repo.id)">
                  <TooltipTrigger as-child>
                    <span class="repo-head flex-none min-w-0 max-w-5/12 overflow-hidden text-ellipsis whitespace-nowrap text-kira-sm text-subtle">
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
                aria-label="Worktrees"
              >
                <!-- Children of a twisty row sit one indent level in (`rowIndent(1)`). -->
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
                  tabindex="0"
                  :aria-selected="isActive(worktreeRecordId(wt.path))"
                  @click.stop="worktreesStore.switchToWorktree(repo.id, wt)"
                  @keydown.enter.prevent.stop="worktreesStore.switchToWorktree(repo.id, wt)"
                  @keydown.space.prevent.stop="worktreesStore.switchToWorktree(repo.id, wt)"
                  @contextmenu.prevent.stop="onWorktreeContextMenu($event, repo, wt)"
                >
                  <span :class="colorMarkClass('rail', repo.color)" data-testid="repo-worktree-rail" aria-hidden="true" />
                  <CodiconIcon name="git-branch" :size="13" class="shrink-0" />
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ worktreeLabel(wt) }}</span>
                    </TooltipTrigger>
                    <TooltipContent>{{ wt.path }}</TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="wt.isMain">
                    <TooltipTrigger as-child>
                      <span class="worktree-badge shrink-0 text-kira-sm text-subtle">main</span>
                    </TooltipTrigger>
                    <TooltipContent>Main worktree</TooltipContent>
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
                <div
                  v-if="worktreesStore.worktreesError(repo.id)"
                  class="py-1 pr-1.5 text-kira-sm text-error"
                  :style="rowIndent(1)"
                  data-testid="repo-worktree-error"
                >
                  {{ worktreesStore.worktreesError(repo.id) }}
                </div>
                <div
                  v-else-if="worktreesStore.worktreesLoading(repo.id) && worktreesStore.worktreeEntries(repo.id).length === 0"
                  class="py-1 pr-1.5 text-kira-sm text-subtle"
                  :style="rowIndent(1)"
                >
                  Loading…
                </div>
                <div v-else-if="worktreesStore.worktreeEntries(repo.id).length === 0" class="py-1 pr-1.5 text-kira-sm text-subtle" :style="rowIndent(1)">
                  No worktrees
                </div>
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
                <!-- Note-tinted background, error-tinted text -- the span carries text-error
                     directly rather than on AlertDescription itself: the note variant's own
                     `*:data-[slot=alert-description]:text-note-text` selector out-specifies a
                     bare class on that same [data-slot] element. -->
                <Alert
                  v-if="fileTreeStore.repoTreeError(repoId)"
                  variant="note"
                  data-testid="repo-tree-error"
                >
                  <AlertDescription><span class="text-error">{{ fileTreeStore.repoTreeError(repoId) }}</span></AlertDescription>
                </Alert>
                <Alert
                  v-if="fileTreeStore.repoTreeTruncated(repoId)"
                  variant="note"
                  data-testid="repo-tree-truncated"
                >
                  <AlertDescription>Showing the first 200,000 files.</AlertDescription>
                </Alert>
                <!-- Always mounted, never gated on isRepoTreeLoaded — RepoFileTree's own onMounted
                     is what calls ensureRepoTreeLoaded in the first place; gating on the state it
                     sets would mean it never gets the chance to. Its own `rows` computed is empty
                     until the load resolves, then updates reactively — no separate loading
                     placeholder needed for a first open this fast. -->
                <RepoFileTree class="flex-1 min-h-0" :repo-id="repoId" :search="local.fileSearch" />
              </template>
              <RepoSearchView v-else-if="view === 'search'" class="flex-1 min-h-0" :repo-id="repoId" />
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
          <Empty v-else class="h-full">
            <EmptyHeader>
              <EmptyMedia><CodiconIcon name="source-control" :size="24" /></EmptyMedia>
              <EmptyTitle>No repository open</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </template>
      </div>
      </div>
    </template>
    <Empty v-else class="h-full">
      <EmptyHeader>
        <EmptyMedia><CodiconIcon name="source-control" :size="24" /></EmptyMedia>
        <EmptyTitle>Import a repository to get started.</EmptyTitle>
      </EmptyHeader>
    </Empty>
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
