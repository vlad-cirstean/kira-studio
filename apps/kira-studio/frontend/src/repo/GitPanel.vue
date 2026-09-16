<script setup lang="ts">
import type { WorktreeEntry } from '@kira/git-ipc';
import type { RepoSummary } from '@shared/domain/repo';
import { repoIdOfWorkspace, repoWorkspaceKey } from '@shared/domain/workspace';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { registerCommand } from '../shortcuts/commands';
import {
  codeReposState,
  importRepoViaDialog,
  removeCodeRepo,
  renameCodeRepo,
} from '../state/coderepos';
import { type MenuItem, openContextMenu } from '../state/contextMenu';
import { ensureReviewPanelWidth } from '../state/layout';
import { openRepoTerminalTab } from '../state/repoTabs';
import { terminalCountAtPath } from '../state/terminals';
import {
  activateWorkspace,
  closeRepoWorkspace,
  openRepoWorkspace,
  workspaceState,
} from '../state/workspace';
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
import { refreshRepoTree, repoTreeError, repoTreeTruncated } from './state/fileTree';
import { refreshRepoHeads, repoHeadLabel } from './state/repoHeads';
import { repoSearchView, setRepoSearchView } from './state/search';
import {
  collapseRepoWorktrees,
  isWorktreesExpanded,
  switchToWorktree,
  toggleRepoWorktrees,
  worktreeEntries,
  worktreeLabel,
  worktreesError,
  worktreesLoading,
} from './state/worktrees';

// P67b §4.4: the Git module's own panel — one PanelShell, not a shell inside a shell. Absorbs the
// repository list that used to live in ProjectPanel.vue's "Connections" section (§0's own
// complaint: "so there are no repos alingside connections") — it is now the title bar's former
// repo switcher, relocated and widened, sitting directly above whichever repo workspace's own
// Files/Search/Review body is active. `repoId` is still derived from the active workspace (never a
// prop) — '' when the bare 'git' key is active, which is exactly the "list only" state.
const repoId = computed(() => repoIdOfWorkspace(workspaceState.active) ?? '');

const local = reactive({ search: '' });

// P67b §4.4: a single click opens (if not yet open) or activates (if open) — OQ-2's adopted
// recommendation. This panel's entire subject is repositories, so a click that only paints a
// highlight is a dead control; double-click still works, since it is a click first.
function isOpen(id: string): boolean {
  return workspaceState.openRepos.includes(id);
}
function isActive(id: string): boolean {
  return workspaceState.active === repoWorkspaceKey(id);
}
function onRowClick(id: string): void {
  if (isOpen(id)) activateWorkspace(repoWorkspaceKey(id));
  else openRepoWorkspace(id);
}

// §4.4: reads this panel's own PanelShell search box (`local.search`), not the Studio tree's own
// `treeState.search` — that filter has no business filtering this panel. The same box also filters
// the file tree below when Files is active (`:search="local.search"`, unchanged from before).
const filteredRepos = computed<RepoSummary[]>(() => {
  const query = local.search.trim().toLowerCase();
  if (!query) return codeReposState.records;
  return codeReposState.records.filter((r) => r.name.toLowerCase().includes(query));
});

async function onImport(): Promise<void> {
  await importRepoViaDialog();
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
  await renameCodeRepo(id, name.trim());
}

async function onRemoveRepo(id: string): Promise<void> {
  await removeCodeRepo(id);
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
      run: () => void navigator.clipboard.writeText(repo.root),
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
        collapseRepoWorktrees(repo.id);
        closeRepoWorkspace(repo.id);
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
  openContextMenu(e, items);
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
  openContextMenu(e, [
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
      run: () => void navigator.clipboard.writeText(wt.path),
    },
  ]);
}

const repoName = computed(
  () => codeReposState.records.find((r) => r.id === repoId.value)?.name ?? '',
);

// C7 D9: lives in repo/state/search.ts, not component state, so switching workspaces and back
// does not reset it. C11 §5.3: 'review' joins files/search as this segment's third value.
const view = computed({
  get: () => repoSearchView(repoId.value),
  set: (v: 'files' | 'search' | 'review') => setRepoSearchView(repoId.value, v),
});
const viewOptions = [
  { value: 'files' as const, label: 'Files', testid: 'repo-view-files' },
  { value: 'search' as const, label: 'Search', testid: 'repo-view-search' },
  { value: 'review' as const, label: 'Review', testid: 'repo-view-review' },
];

// C11 §8.4/§5.3: this panel is one persistent component instance across every repo workspace
// (WorkbenchShell.vue's `<component :is="activeModePanel" />` carries no per-repo key, unlike a
// tab), so "kept alive with v-show while the workspace is open" (§8.4) is tracked per repoId here
// rather than with a single boolean — switching to a DIFFERENT repo's workspace and back remounts
// (review.session.save/load, S6, is exactly the resume path that makes that safe) while switching
// between this SAME repo's Files/Search/Review segments never does, since the set entry it added
// on first activation never goes away.
const reviewActivatedRepoIds = reactive(new Set<string>());
// A watcher, not the computed setter above, because setRepoSearchView also has a second caller
// (hostHandlers.ts's review.open, via "Review branch changes") this component's own setter is
// never in the call path for.
watch(
  view,
  (v) => {
    if (v !== 'review') return;
    reviewActivatedRepoIds.add(repoId.value);
    // §14 OQ2: widen once, only if the user has never manually resized the panel — checked inside
    // ensureReviewPanelWidth itself (state/layout.ts's own widthUserSet). 320px: VS Code's ~300px
    // sidebar default, rounded up a little for the review panes' own extra density.
    ensureReviewPanelWidth(320);
  },
  { immediate: true },
);

function onRefresh(): void {
  void refreshRepoTree(repoId.value);
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
  void refreshRepoHeads();
});
onUnmounted(() => {
  unregisterSearchCommand?.();
  unregisterSearchCommand = null;
});
</script>

<template>
  <PanelShell
    :search="local.search"
    :empty="codeReposState.records.length === 0"
    :searchable="true"
    @update:search="local.search = $event"
  >
    <template #title>
      <span>{{ repoId ? repoName : 'Repositories' }}</span>
    </template>
    <template #actions>
      <!-- C5 §3.3/§3.4: no new dialog, no new native picker — reuses FilesService.ChooseFolder. -->
      <IconButton
        icon="repo"
        aria-label="Import repository"
        v-tooltip="'Import repository…'"
        data-testid="import-repo"
        @click="onImport"
      />
      <template v-if="repoId">
        <SegmentedControl v-model="view" :options="viewOptions" />
        <!-- Files mode only: in Search mode the panel's own tree filter is meaningless, and a
             tree refresh has nothing to do with a search result list. -->
        <IconButton
          v-if="view === 'files'"
          icon="refresh"
          aria-label="Refresh"
          v-tooltip="'Refresh file tree'"
          data-testid="repo-refresh"
          @click="onRefresh"
        />
      </template>
    </template>
    <template #body>
      <div class="git-panel-body">
        <section
          v-if="codeReposState.records.length > 0"
          class="repo-section"
          :class="{ 'has-workspace': repoId }"
          data-testid="repo-section"
        >
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
                  :aria-label="isWorktreesExpanded(repo.id) ? 'Collapse worktrees' : 'Expand worktrees'"
                  :aria-expanded="isWorktreesExpanded(repo.id)"
                  data-testid="repo-row-expand"
                  @click.stop="toggleRepoWorktrees(repo.id)"
                >
                  <CodiconIcon
                    :name="isWorktreesExpanded(repo.id) ? 'chevron-down' : 'chevron-right'"
                    :size="13"
                  />
                </button>
                <CodiconIcon name="source-control" :size="16" class="repo-icon" />
                <span class="repo-name" v-tooltip="repo.root">{{ repo.name }}</span>
                <span
                  v-if="repoHeadLabel(repo.id)"
                  class="repo-head"
                  v-tooltip="repoHeadLabel(repo.id)"
                >
                  {{ repoHeadLabel(repo.id) }}
                </span>
                <CodiconIcon
                  v-if="terminalCountAtPath(repo.root) > 0"
                  name="terminal-bash"
                  :size="12"
                  class="worktree-badge-icon"
                  data-testid="repo-terminal-indicator"
                  v-tooltip="terminalTooltip(terminalCountAtPath(repo.root))"
                />
              </div>
              <div
                v-if="isWorktreesExpanded(repo.id)"
                class="worktree-list"
                data-testid="repo-worktrees"
              >
                <div
                  v-for="wt in worktreeEntries(repo.id)"
                  :key="wt.path"
                  class="worktree-row"
                  :class="{ current: wt.isCurrent }"
                  data-testid="repo-worktree-row"
                  :data-worktree-path="wt.path"
                  @click.stop="switchToWorktree(repo.id, wt.path)"
                  @contextmenu.prevent.stop="onWorktreeContextMenu($event, repo, wt)"
                >
                  <CodiconIcon name="git-branch" :size="14" class="worktree-icon" />
                  <span class="worktree-label" v-tooltip="wt.path">{{ worktreeLabel(wt) }}</span>
                  <span v-if="wt.isMain" class="worktree-badge" v-tooltip="'Main worktree'">main</span>
                  <CodiconIcon
                    v-if="terminalCountAtPath(wt.path) > 0"
                    name="terminal-bash"
                    :size="12"
                    class="worktree-badge-icon"
                    data-testid="repo-terminal-indicator"
                    v-tooltip="terminalTooltip(terminalCountAtPath(wt.path))"
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
                  v-if="worktreesError(repo.id)"
                  class="worktree-note error"
                  data-testid="repo-worktree-error"
                >
                  {{ worktreesError(repo.id) }}
                </div>
                <div
                  v-else-if="worktreesLoading(repo.id) && worktreeEntries(repo.id).length === 0"
                  class="worktree-note"
                >
                  Loading…
                </div>
                <div v-else-if="worktreeEntries(repo.id).length === 0" class="worktree-note">
                  No worktrees
                </div>
              </div>
            </div>
          </div>
        </section>
        <template v-if="repoId">
          <template v-if="view === 'files'">
            <div
              v-if="repoTreeError(repoId)"
              class="p-strip note error-note"
              data-testid="repo-tree-error"
            >
              {{ repoTreeError(repoId) }}
            </div>
            <div
              v-if="repoTreeTruncated(repoId)"
              class="p-strip note"
              data-testid="repo-tree-truncated"
            >
              Showing the first 200,000 files.
            </div>
            <!-- Always mounted, never gated on isRepoTreeLoaded — RepoFileTree's own onMounted is
                 what calls ensureRepoTreeLoaded in the first place; gating on the state it sets
                 would mean it never gets the chance to. Its own `rows` computed is empty until the
                 load resolves, then updates reactively — no separate loading placeholder needed for
                 a first open this fast. -->
            <RepoFileTree class="repo-tree" :repo-id="repoId" :search="local.search" />
          </template>
          <RepoSearchView v-else-if="view === 'search'" class="repo-tree" :repo-id="repoId" />
          <!-- C11 §8.4: mounted once (reviewActivatedRepoIds), then only ever hidden/shown, never
               destroyed, by a Files<->Review or Search<->Review switch within this same repo. -->
          <RepoReviewView
            v-if="reviewActivatedRepoIds.has(repoId)"
            v-show="view === 'review'"
            :key="repoId"
            class="repo-tree"
            :repo-id="repoId"
          />
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
.git-panel-body {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.repo-section {
  flex-shrink: 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* P82 §9: an expanded worktree list would otherwise push the file tree below the fold. Only
   capped when a repo workspace is showing below — the list-only state still uses the whole panel. */
.repo-section.has-workspace {
  max-height: 50%;
  overflow-y: auto;
}

.repo-list {
  display: flex;
  flex-direction: column;
}

.repo-row {
  height: var(--kira-row-height);
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: 0 var(--kira-s-3);
  cursor: default;
  user-select: none;
}

.repo-row:hover {
  background: var(--kira-hover);
}

.repo-row.active {
  background: var(--kira-select);
}

/* Imported, not open: muted icon. Open (active or not): full-brightness, the same distinction the
   title bar's own repo tabs used to carry (§4.4's row-state table). */
.repo-icon {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}
.repo-row.open .repo-icon {
  color: var(--kira-fg);
}

.repo-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* P83 plan §12.4: a repo row's checked-out branch. `.repo-name` keeps `flex: 1`, so it yields
   first and this is what survives on a narrow panel. Same size/colour pair as `.worktree-badge`
   below, so a collapsed row's branch and its expanded children's read as the same class of
   information. */
.repo-head {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-subtle);
}

.repo-twisty { /* RepoTreeRow.vue's .twisty, ported */
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  padding: 0;
  cursor: pointer;
}

.worktree-row {
  height: var(--kira-row-height);
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  /* Indent to the repo name's own left edge: the row's padding, plus the twisty and its gap. */
  padding: 0 var(--kira-s-3) 0 calc(var(--kira-s-3) + 14px + var(--kira-s-2));
  cursor: default;
  user-select: none;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}
.worktree-row:hover {
  background: var(--kira-hover);
}
.worktree-row.current {
  color: var(--kira-fg);
}

.worktree-icon {
  flex-shrink: 0;
}

.worktree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worktree-badge {
  flex-shrink: 0;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-subtle);
}

.worktree-badge-icon {
  flex-shrink: 0;
  color: var(--kira-fg-subtle);
}

.worktree-note {
  padding: 0 var(--kira-s-3) 0 calc(var(--kira-s-3) + 14px + var(--kira-s-2));
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-subtle);
}
.worktree-note.error {
  color: var(--kira-error);
}

.repo-tree {
  flex: 1;
  min-height: 0;
}

.error-note {
  color: var(--kira-error);
}

.prompt-scrim {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}

.prompt-box {
  width: 280px;
  padding: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--kira-s-3);
}
</style>
