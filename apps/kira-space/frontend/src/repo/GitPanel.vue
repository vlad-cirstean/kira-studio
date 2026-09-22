<script setup lang="ts">
import type { WorktreeEntry } from '@kira/git-ipc';
import type { RepoSummary } from '@shared/domain/repo';
import { repoIdOfWorkspace, repoWorkspaceKey } from '@shared/domain/workspace';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { copyText } from '../clipboard';
import { registerCommand } from '../shortcuts/commands';
import { useCodeReposStore } from '../state/coderepos';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';
import { useLayoutStore } from '../state/layout';
import { openRepoTerminalTab } from '../state/repoTabs';
import { useTerminalsStore } from '../state/terminals';
import { useWorkspaceStore } from '../state/workspace';
import CodiconIcon from '../theme/CodiconIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import PanelShell from '../theme/primitives/PanelShell.vue';
import SegmentedControl from '../theme/primitives/SegmentedControl.vue';
import TextField from '../theme/primitives/TextField.vue';
import RepoFileTree from './RepoFileTree.vue';
import RepoReviewView from './RepoReviewView.vue';
import RepoSearchView from './RepoSearchView.vue';
import { useFileTreeStore } from './state/fileTree';
import { useRepoHeadsStore } from './state/repoHeads';
import { useRepoLinksStore } from './state/repoLinks';
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
const repoPanelTabStore = useRepoPanelTabStore();
const repoSearchStore = useRepoSearchStore();
const terminalsStore = useTerminalsStore();

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

// P84 §8.1/§8.3: which of the two top-level tabs is showing. Not persisted, not module-level
// (§8.3): `{ immediate: true }` on the watcher below recomputes the right tab from repoId on every
// remount, so a manual override would only ever survive within one mount anyway.
//
// Bug fix (manual testing): only auto-switch to Files on a genuine no-repo -> repo transition
// (oldId === ''). Switching between two already-open repos must leave the user's chosen tab alone.
//
// P92 item 6: backed by state/search.ts's useRepoPanelTabStore, not a local ref — hostHandlers.ts's
// review.open needs to flip it from outside this component (§5.2's own external-caller note).
const tab = computed({
  get: () => repoPanelTabStore.repoPanelTab(),
  set: (v: 'repos' | 'files' | 'review') => repoPanelTabStore.setRepoPanelTab(v),
});
watch(
  repoId,
  (id, oldId) => {
    if (!oldId && id) tab.value = 'files';
    else if (!id) tab.value = 'repos';
  },
  { immediate: true },
);

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
  const topLevel = codeReposStore.records.filter((r) => !repoLinksStore.worktreeParentId(r.id));
  const query = local.repoSearch.trim().toLowerCase();
  if (!query) return topLevel;
  return topLevel.filter((r) => r.name.toLowerCase().includes(query));
});

async function onImport(): Promise<void> {
  await codeReposStore.importRepoViaDialog();
}

// Electron's renderer has no window.prompt() — the same in-app substitute
// ConsoleSavedMenu.vue/FilterHistoryMenu.vue already use.
const textPrompt = ref<{
  title: string;
  value: string;
  resolve: (v: string | null) => void;
} | null>(null);
const promptInput = ref<{ $el: HTMLElement } | null>(null);
function promptText(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    textPrompt.value = { title, value: initial, resolve };
    void nextTick(() => promptInput.value?.$el.querySelector('input')?.focus());
  });
}
function submitPrompt(): void {
  if (!textPrompt.value) return;
  const { value, resolve } = textPrompt.value;
  textPrompt.value = null;
  resolve(value);
}
function cancelPrompt(): void {
  if (!textPrompt.value) return;
  const { resolve } = textPrompt.value;
  textPrompt.value = null;
  resolve(null);
}

async function onRenameRepo(id: string, currentName: string): Promise<void> {
  const name = await promptText('Rename repository', currentName);
  if (!name || name.trim() === '') return;
  await codeReposStore.renameCodeRepo(id, name.trim());
}

async function onRemoveRepo(id: string): Promise<void> {
  await codeReposStore.removeCodeRepo(id);
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
      id: 'rename',
      label: 'Rename…',
      icon: 'edit',
      run: () => onRenameRepo(repo.id, repo.name),
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
    { type: 'separator' as const },
  ];
  if (isOpen(repo.id)) {
    items.push({
      type: 'item' as const,
      id: 'close',
      label: 'Close',
      icon: 'close',
      // P82 §8.3: collapse first, so the lease release is synchronous with the close instead of a
      // watch flush later — the same reason quickOpen.ts:178 exposes dropQuickOpen alongside its
      // own watch. The §6.6 watch would collapse it anyway.
      run: () => {
        worktreesStore.collapseRepoWorktrees(repo.id);
        workspaceStore.closeRepoWorkspace(repo.id);
      },
    });
  }
  items.push({
    type: 'item' as const,
    id: 'remove',
    label: 'Remove',
    icon: 'trash',
    danger: true,
    run: () => onRemoveRepo(repo.id),
  });
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
    items.push({
      type: 'item' as const,
      id: 'rename',
      label: 'Rename…',
      icon: 'edit',
      run: () => onRenameRepo(record.id, record.name),
    });
    if (isOpen(record.id)) {
      items.push({
        type: 'item' as const,
        id: 'close',
        label: 'Close',
        icon: 'close',
        run: () => {
          worktreesStore.collapseRepoWorktrees(record.id);
          workspaceStore.closeRepoWorkspace(record.id);
        },
      });
    }
    items.push({
      type: 'item' as const,
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      danger: true,
      // Removes the code_repos record, never the worktree on disk — the nested row survives it,
      // since it comes from `git worktree list`, not from codeReposState.
      run: () => onRemoveRepo(record.id),
    });
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
  <PanelShell
    :search="tab === 'repos' ? local.repoSearch : local.fileSearch"
    :empty="codeReposStore.records.length === 0"
    :searchable="tab !== 'review'"
    @update:search="tab === 'repos' ? (local.repoSearch = $event) : (local.fileSearch = $event)"
  >
    <template #title>
      <!-- P84 §8.1/§9: replaces the old repo-name title — the tabs already say what's open.
           P92 item 6: Review joins Repos/Files as a third tab, off the Files body's own segment. -->
      <SegmentedControl
        v-model="tab"
        :options="[
          { value: 'repos', label: 'Repos', testid: 'git-panel-tab-repos' },
          { value: 'files', label: 'Files', testid: 'git-panel-tab-files' },
          { value: 'review', label: 'Review', testid: 'git-panel-tab-review' },
        ]"
      />
    </template>
    <template #actions>
      <!-- C5 §3.3/§3.4: no new dialog, no new native picker — reuses FilesService.ChooseFolder. -->
      <IconButton
        v-if="tab === 'repos'"
        icon="repo"
        aria-label="Import repository"
        v-tooltip="'Import repository…'"
        data-testid="import-repo"
        @click="onImport"
      />
      <!-- Files mode only: in Search mode the panel's own tree filter is meaningless, and a tree
           refresh has nothing to do with a search result list. -->
      <IconButton
        v-if="tab === 'files' && view === 'files'"
        icon="refresh"
        aria-label="Refresh"
        v-tooltip="'Refresh file tree'"
        data-testid="repo-refresh"
        @click="onRefresh"
      />
    </template>
    <template #body>
      <div class="git-panel-body">
        <section v-if="tab === 'repos'" class="repo-section" data-testid="repo-section">
          <div class="repo-list">
            <div v-for="repo in filteredRepos" :key="repo.id" class="repo-entry">
              <div
                class="repo-row"
                :class="{ open: isOpen(repo.id), active: isActive(repo.id) }"
                data-testid="repo-row"
                :data-repo-id="repo.id"
                @click="onRowClick(repo.id)"
                @contextmenu.prevent="onRepoContextMenu($event, repo)"
              >
                <button
                  type="button"
                  class="repo-twisty"
                  tabindex="-1"
                  :aria-label="worktreesStore.isWorktreesExpanded(repo.id) ? 'Collapse worktrees' : 'Expand worktrees'"
                  :aria-expanded="worktreesStore.isWorktreesExpanded(repo.id)"
                  data-testid="repo-row-expand"
                  @click.stop="worktreesStore.toggleRepoWorktrees(repo.id)"
                >
                  <CodiconIcon
                    :name="worktreesStore.isWorktreesExpanded(repo.id) ? 'chevron-down' : 'chevron-right'"
                    :size="13"
                  />
                </button>
                <CodiconIcon name="source-control" :size="16" class="repo-icon" />
                <span class="repo-name" v-tooltip="repo.root">{{ repo.name }}</span>
                <span
                  v-if="repoHeadsStore.repoHeadLabel(repo.id)"
                  class="repo-head"
                  v-tooltip="repoHeadsStore.repoHeadLabel(repo.id)"
                >
                  {{ repoHeadsStore.repoHeadLabel(repo.id) }}
                </span>
                <CodiconIcon
                  v-if="terminalsStore.terminalCountAtPath(repo.root) > 0"
                  name="terminal-bash"
                  :size="12"
                  class="worktree-badge-icon"
                  data-testid="repo-terminal-indicator"
                  v-tooltip="terminalTooltip(terminalsStore.terminalCountAtPath(repo.root))"
                />
              </div>
              <div
                v-if="worktreesStore.isWorktreesExpanded(repo.id)"
                class="worktree-list"
                data-testid="repo-worktrees"
              >
                <div
                  v-for="wt in worktreesStore.worktreeEntries(repo.id)"
                  :key="wt.path"
                  class="worktree-row"
                  :class="{
                    current: wt.isCurrent,
                    open: isOpen(worktreeRecordId(wt.path)),
                    active: isActive(worktreeRecordId(wt.path)),
                  }"
                  data-testid="repo-worktree-row"
                  :data-worktree-path="wt.path"
                  @click.stop="worktreesStore.switchToWorktree(repo.id, wt)"
                  @contextmenu.prevent.stop="onWorktreeContextMenu($event, repo, wt)"
                >
                  <CodiconIcon name="git-branch" :size="14" class="worktree-icon" />
                  <span class="worktree-label" v-tooltip="wt.path">{{ worktreeLabel(wt) }}</span>
                  <span v-if="wt.isMain" class="worktree-badge" v-tooltip="'Main worktree'">main</span>
                  <CodiconIcon
                    v-if="terminalsStore.terminalCountAtPath(wt.path) > 0"
                    name="terminal-bash"
                    :size="12"
                    class="worktree-badge-icon"
                    data-testid="repo-terminal-indicator"
                    v-tooltip="terminalTooltip(terminalsStore.terminalCountAtPath(wt.path))"
                  />
                  <CodiconIcon
                    v-if="wt.locked"
                    name="lock"
                    :size="12"
                    class="worktree-badge-icon"
                    v-tooltip="wt.locked.reason"
                  />
                </div>
                <div
                  v-if="worktreesStore.worktreesError(repo.id)"
                  class="worktree-note error"
                  data-testid="repo-worktree-error"
                >
                  {{ worktreesStore.worktreesError(repo.id) }}
                </div>
                <div
                  v-else-if="worktreesStore.worktreesLoading(repo.id) && worktreesStore.worktreeEntries(repo.id).length === 0"
                  class="worktree-note"
                >
                  Loading…
                </div>
                <div v-else-if="worktreesStore.worktreeEntries(repo.id).length === 0" class="worktree-note">
                  No worktrees
                </div>
              </div>
            </div>
          </div>
        </section>
        <template v-else>
          <template v-if="repoId">
            <template v-if="tab === 'files'">
              <div class="view-strip">
                <SegmentedControl v-model="view" :options="viewOptions" />
              </div>
              <template v-if="view === 'files'">
                <div
                  v-if="fileTreeStore.repoTreeError(repoId)"
                  class="p-strip note error-note"
                  data-testid="repo-tree-error"
                >
                  {{ fileTreeStore.repoTreeError(repoId) }}
                </div>
                <div
                  v-if="fileTreeStore.repoTreeTruncated(repoId)"
                  class="p-strip note"
                  data-testid="repo-tree-truncated"
                >
                  Showing the first 200,000 files.
                </div>
                <!-- Always mounted, never gated on isRepoTreeLoaded — RepoFileTree's own onMounted
                     is what calls ensureRepoTreeLoaded in the first place; gating on the state it
                     sets would mean it never gets the chance to. Its own `rows` computed is empty
                     until the load resolves, then updates reactively — no separate loading
                     placeholder needed for a first open this fast. -->
                <RepoFileTree class="repo-tree" :repo-id="repoId" :search="local.fileSearch" />
              </template>
              <RepoSearchView v-else-if="view === 'search'" class="repo-tree" :repo-id="repoId" />
            </template>
            <!-- C11 §8.4: mounted once (reviewActivatedRepoIds), then only ever hidden/shown,
                 never destroyed, by a Files<->Review or Search<->Review switch within this same
                 repo. P92 item 6: gated on `tab`, Review's own top-level tab, not `view`. -->
            <RepoReviewView
              v-if="reviewActivatedRepoIds.has(repoId)"
              v-show="tab === 'review'"
              :key="repoId"
              class="repo-tree"
              :repo-id="repoId"
            />
          </template>
          <EmptyState v-else icon="source-control" label="No repository open" />
        </template>
      </div>
    </template>
    <template #empty>
      <EmptyState icon="source-control" label="Import a repository to get started." />
    </template>
  </PanelShell>

  <div v-if="textPrompt" class="prompt-scrim" data-testid="text-prompt" @click.stop>
    <div class="prompt-box p-float">
      <div class="prompt-title p-sm muted">{{ textPrompt.title }}</div>
      <TextField
        ref="promptInput"
        v-model="textPrompt.value"
        size="md"
        data-testid="text-prompt-input"
        @enter="submitPrompt"
        @keydown.escape="cancelPrompt"
      />
      <div class="prompt-actions">
        <AppButton kind="dialog" data-testid="text-prompt-cancel" @click="cancelPrompt">Cancel</AppButton>
        <AppButton kind="dialog" variant="primary" data-testid="text-prompt-ok" @click="submitPrompt">
          OK
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/theme/base.css";

.git-panel-body {
  @apply h-full flex flex-col min-h-0;
}

/* P84 §8.6: the Repositories tab owns the whole panel height now — nothing stacks below the list
   any more, so P82 §9's has-workspace 50% cap and this section's own border are both gone. */
.repo-section {
  @apply flex-1 min-h-0 overflow-y-auto;
}

/* P84 §8.2: the Files/Search/Review picker, moved out of the header into a strip above the Files
   tab's own body. */
.view-strip {
  @apply shrink-0 px-[var(--kira-s-3)] border-b border-border flex items-center h-[var(--kira-row-height)];
}

.repo-list {
  @apply flex flex-col;
}

.repo-row {
  @apply h-[var(--kira-row-height)] flex items-center gap-[var(--kira-s-2)] px-[var(--kira-s-3)] cursor-default select-none;
}

.repo-row:hover {
  @apply bg-hover;
}

.repo-row.active {
  @apply bg-select;
}

/* Imported, not open: muted icon. Open (active or not): full-brightness, the same distinction the
   title bar's own repo tabs used to carry (§4.4's row-state table). */
.repo-icon {
  @apply shrink-0 text-muted;
}
.repo-row.open .repo-icon {
  @apply text-fg;
}

.repo-name {
  @apply flex-1 overflow-hidden text-ellipsis whitespace-nowrap;
}

/* P83 plan §12.4: a repo row's checked-out branch. `.repo-name` keeps `flex: 1`, so it yields
   first and this is what survives on a narrow panel. Same size/colour pair as `.worktree-badge`
   below, so a collapsed row's branch and its expanded children's read as the same class of
   information. */
.repo-head {
  @apply flex-none min-w-0 max-w-[45%] overflow-hidden text-ellipsis whitespace-nowrap text-[length:var(--kira-t-sm)] text-subtle;
}

.repo-twisty { /* RepoTreeRow.vue's .twisty, ported */
  @apply flex shrink-0 items-center justify-center bg-transparent border-0 text-muted p-0 cursor-pointer w-3.5 h-3.5;
}

.worktree-row {
  @apply h-[var(--kira-row-height)] flex items-center gap-[var(--kira-s-2)] cursor-default select-none text-[length:var(--kira-t-sm)] text-muted;
  /* Indent to the repo name's own left edge: the row's padding, plus the twisty and its gap. */
  padding: 0 var(--kira-s-3) 0 calc(var(--kira-s-3) + 14px + var(--kira-s-2));
}
.worktree-row:hover {
  @apply bg-hover;
}
.worktree-row.current {
  @apply text-fg;
}
/* P84 §6.1/§8.6: this app's own open/active workspace state, once the nested row is where a
   worktree's marking has to live — reusing --kira-fg/--kira-select exactly as .repo-row does.
   Distinct from .current (this git session's own worktree, a fact about the repository, not this
   app's workspaces). */
.worktree-row.open {
  @apply text-fg;
}
.worktree-row.active {
  @apply bg-select;
}

.worktree-icon {
  @apply shrink-0;
}

.worktree-label {
  @apply flex-1 overflow-hidden text-ellipsis whitespace-nowrap;
}

.worktree-badge {
  @apply shrink-0 text-[length:var(--kira-t-sm)] text-subtle;
}

.worktree-badge-icon {
  @apply shrink-0 text-subtle;
}

.worktree-note {
  @apply text-[length:var(--kira-t-sm)] text-subtle;
  padding: 0 var(--kira-s-3) 0 calc(var(--kira-s-3) + 14px + var(--kira-s-2));
}
.worktree-note.error {
  @apply text-error;
}

.repo-tree {
  @apply flex-1 min-h-0;
}

.error-note {
  @apply text-error;
}

.prompt-scrim {
  /* z-30, not var(--kira-z-dialog): unlike ConsoleSavedMenu.vue's own prompt-scrim (P28 D17(c)),
     this prompt is raised directly from the panel, never from inside a popover with its own
     full-viewport backdrop to clear — no cascade requirement to preserve here. */
  @apply fixed inset-0 flex items-center justify-center bg-black/50 z-30;
}

.prompt-box {
  @apply w-[280px] p-[var(--kira-s-4)] flex flex-col gap-[var(--kira-s-3)];
}

.prompt-actions {
  @apply flex justify-end gap-[var(--kira-s-3)];
}
</style>
