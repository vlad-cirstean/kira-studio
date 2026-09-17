<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { isRepoWorkspace, repoIdOfWorkspace } from '@shared/domain/workspace';
import { computed, nextTick, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { fileIconStyle } from '../../repo/fileIcon';
import { agentActivityFor } from '../../state/agentSessions';
import { codeRepoRecord, codeReposState } from '../../state/coderepos';
import { type MenuItem, openContextMenu, openContextMenuAt } from '../../state/contextMenu';
import { customScriptsState } from '../../state/customScripts';
import { tabsForWorkspace } from '../../state/mode';
import { openRepoTerminalTab } from '../../state/repoTabs';
import { openSettingsAt } from '../../state/settings';
import { isIncognito } from '../../state/tabIncognito';
import { TAB_KINDS } from '../../state/tabKinds';
import {
  activateTab,
  closeAll,
  closeOthers,
  closeTab,
  closeToTheRight,
  duplicateTab,
  isPreview,
  moveTab,
  promoteTab,
  tabsState,
} from '../../state/tabs';
import { terminalDefaults } from '../../state/terminals';
import { openTerminalTab, type TerminalLaunch } from '../../state/terminalTabs';
import { workspaceState } from '../../state/workspace';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';
import { wheelToHorizontal } from '../../wheelScroll';

function isPinned(tab: TabRecord): boolean {
  return TAB_KINDS[tab.kind].pinned === true;
}

// P86 §14.2: a Claude Code tab whose activity is 'attention' and which is not the active tab
// renders a dot — cleared by activating it (onClick is already where a tab becomes active, so
// nothing extra is wired for that half).
function isAttention(tab: TabRecord): boolean {
  return (
    !tab.active &&
    tab.kind === 'terminal' &&
    tab.state.launchKind === 'claude-code' &&
    agentActivityFor(tab.id)?.phase === 'attention'
  );
}

// P1 D4/C4: title/icon/rail all read the tab-kind registry now — TabStrip.vue no longer knows
// what a 'data' tab's icon is, or that a tab's colour comes from its connection.
function colorFor(tab: TabRecord): string | undefined {
  return TAB_KINDS[tab.kind].railColor(tab);
}

function titleFor(tab: TabRecord): string {
  return TAB_KINDS[tab.kind].title(tab);
}

// P15 D8: undefined for a kind with no badge() member at all (most kinds); null for a kind that
// has one but has nothing to flag on this particular tab.
function badgeFor(tab: TabRecord): { icon: string; tooltip: string } | null | undefined {
  return TAB_KINDS[tab.kind].badge?.(tab);
}

function onClick(tab: TabRecord): void {
  activateTab(tab.id);
}

// §6.1: a pinned tab has no middle-click close.
function onMiddleClick(tab: TabRecord): void {
  if (isPinned(tab)) return;
  closeTab(tab.id);
}

function onClose(e: MouseEvent, tab: TabRecord): void {
  e.stopPropagation();
  closeTab(tab.id);
}

// §8.10's Tab row: Close · Close others · Close to the right · Close all · — · Duplicate tab ·
// Copy name · plus whatever the tab's own kind appends (D22) — Studio's kinds all append
// "Reveal in project panel" (F11); an Api tab kind supplies its own menuExtras, or none.
// §6.1: a pinned tab's own menu is reduced to just "Copy name" — every other action either
// no-ops on it (Close, Duplicate tab) or doesn't apply to it (Close others/to the right/all never
// touch a pinned tab either way, but offering them here would read as an empty promise).
function onContextMenu(e: MouseEvent, tab: TabRecord): void {
  if (isPinned(tab)) {
    openContextMenu(e, [
      {
        type: 'item',
        id: 'copy-name',
        label: 'Copy name',
        icon: 'copy',
        run: () => copyText(titleFor(tab)),
      },
    ]);
    return;
  }
  openContextMenu(e, [
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'close',
      // P21 D13: `tab.close` always closes the *active* tab, not the clicked one — printed anyway
      // (VS Code does the same on this exact row) since it's the keyboard route to this command.
      shortcut: 'tab.close',
      run: () => closeTab(tab.id),
    },
    {
      type: 'item',
      id: 'close-others',
      label: 'Close others',
      run: () => closeOthers(tab.id),
    },
    {
      type: 'item',
      id: 'close-to-the-right',
      label: 'Close to the right',
      run: () => closeToTheRight(tab.id),
    },
    { type: 'item', id: 'close-all', label: 'Close all', run: () => closeAll() },
    { type: 'separator' },
    {
      type: 'item',
      id: 'duplicate-tab',
      label: 'Duplicate tab',
      icon: 'copy',
      run: () => void duplicateTab(tab.id),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(titleFor(tab)),
    },
    ...TAB_KINDS[tab.kind].menuExtras(tab),
  ]);
}

// C5 §4.3: the active workspace's own tabs (pinned first, §6.1) — studio/api behave exactly as
// tabsForMode(modeState.active) always did (no pinned kind exists in either), a repo workspace
// additionally always shows its pinned graph tab first.
const tabs = computed(() => tabsForWorkspace(workspaceState.active));

// P72 §7: split out of `tabs` so the template can render the pinned tab in a fixed leading slot,
// outside `.tab-strip`'s own `overflow-x: auto` — previously it scrolled away with everything
// else. `tabsForWorkspace`'s own pinned-first partition is unchanged; this only stops flattening
// it back into one list. In practice at most one tab is ever pinned (the repo-graph tab,
// `tabKinds.ts`), but this reads off `isPinned` generically rather than assuming that.
// P73 §2.2: each entry carries its own resolved icon so the template narrows the TabIcon union
// once per render instead of calling TAB_KINDS[tab.kind].icon(tab) twice per branch.
const pinnedTabs = computed(() =>
  tabs.value
    .filter((tab) => isPinned(tab))
    .map((tab) => ({ tab, icon: TAB_KINDS[tab.kind].icon(tab) })),
);
const scrollingTabs = computed(() =>
  tabs.value
    .filter((tab) => !isPinned(tab))
    .map((tab) => ({ tab, icon: TAB_KINDS[tab.kind].icon(tab) })),
);

// Selecting a tab from anywhere other than this strip itself (a tree double-click, Cmd/Ctrl+click
// nav, session restore) previously left the strip's own scroll position untouched — the newly
// active tab could be selected yet scrolled out of view, with nothing on screen indicating a
// selection had even happened until the user scrolled the strip by hand to go find it.
const activeTabId = computed(() => tabsState.activeIdByWorkspace[workspaceState.active]);
const stripRef = ref<HTMLElement | null>(null);

watch(
  activeTabId,
  (id) => {
    if (!id) return;
    void nextTick(() => {
      stripRef.value
        ?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
  { immediate: true },
);

// P31 D7/F9, hoisted to wheelScroll.ts P42 D7 (views/console/'s own result strip needs the same
// eight lines and may not import workbench/): this strip's own horizontal scrollbar is
// deliberately thin/subtle — without this, the strip is reachable only by trackpad.
function onWheel(e: WheelEvent): void {
  if (wheelToHorizontal(stripRef.value, e)) e.preventDefault();
}

// Drag-reorder (same shape as ColumnsMenu.vue's column drag): moveTab splices tabsState.tabs
// live as the dragged tab crosses another one's midpoint, so the strip itself needs no local
// copy. Tracks the dragged tab's id (P1 F15), not its index — this strip renders a filtered,
// per-mode view of tabsState.tabs, so an index into it no longer addresses the same element in
// the underlying array moveTab splices.
const dragId = ref<string | null>(null);

// §6.1: a pinned tab is `draggable="false"` in the template, so it never starts a drag itself —
// this guard also covers moveTab's own early-return for a pinned *drop target*.
function onDragStart(id: string): void {
  dragId.value = id;
}
function onDragOver(id: string): void {
  const from = dragId.value;
  if (from === null || from === id) return;
  moveTab(from, id);
  dragId.value = id;
}
function onDragEnd(): void {
  dragId.value = null;
}

// P83 §9: the tab strip's own "+" — a dropdown anchored under the button, not the click point
// (openContextMenuAt, state/contextMenu.ts), so it hangs from the button's own bottom-left
// regardless of where inside its 22px box the click landed.
const newTabBtn = ref<HTMLButtonElement | null>(null);

// P91 §8: the "+" now also shows with zero tabs in the Terminal module — a repo workspace always
// has its pinned graph tab, so this gap never showed before a module whose normal initial state
// is zero tabs existed.
const showNewTab = computed(
  () => isRepoWorkspace(workspaceState.active) || workspaceState.active === 'terminal',
);

function onNewTab(): void {
  const btn = newTabBtn.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const items =
    workspaceState.active === 'terminal' ? terminalModuleMenuItems() : newTabMenuItems();
  openContextMenuAt(rect.left, rect.bottom + 2, items);
}

// P85 §6.4: every dropdown entry funnels through this — the active workspace's own repo, or the
// script's own workingDir override (cwdOverride) when it has one (P85 §7).
function launchInActiveWorkspace(launch?: TerminalLaunch, cwdOverride?: string): void {
  const repoId = repoIdOfWorkspace(workspaceState.active);
  const repo = repoId ? codeRepoRecord(repoId) : undefined;
  if (!repoId || !repo) return;
  openRepoTerminalTab(repoId, cwdOverride || repo.root, launch);
}

// P85 §6.1: Terminal and Claude Code (this app's own launch targets) sit together with no rule
// between them; one item per configured script follows, separated, then "Manage scripts…"
// (§6.4: settings/customScripts.ts's own reactive list, no separate load here).
function newTabMenuItems(): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'new-terminal',
      label: 'Terminal',
      icon: 'terminal-bash',
      run: () => launchInActiveWorkspace(),
    },
    {
      type: 'item',
      id: 'new-claude-code',
      label: 'Claude Code',
      icon: 'sparkle',
      run: () =>
        launchInActiveWorkspace({
          command: 'claude',
          label: 'Claude Code',
          color: 'none',
          kind: 'claude-code',
        }),
    },
  ];
  if (customScriptsState.records.length > 0) {
    items.push({ type: 'separator' });
    for (const script of customScriptsState.records) {
      items.push({
        type: 'item',
        id: `script-${script.id}`,
        label: script.name,
        hint: script.command,
        ...(script.color === 'none' ? { icon: 'play' } : { swatch: script.color }),
        run: () =>
          launchInActiveWorkspace(
            { command: script.command, label: script.name, color: script.color, kind: 'script' },
            script.workingDir || undefined,
          ),
      });
    }
  }
  items.push(
    { type: 'separator' },
    {
      type: 'item',
      id: 'manage-scripts',
      label: 'Manage scripts…',
      icon: 'settings-gear',
      run: () => openSettingsAt('Scripts'),
    },
  );
  return items;
}

// P91 §8: the Terminal module's own "+" menu — deliberately not newTabMenuItems above (§8.3): no
// Claude Code entry (P85/P86's own surface, not asked for here) and no per-script entries (the
// left panel is the quick-command surface, one click away and always visible while the module is
// open — two identical launchers side by side is the outcome to avoid). `Terminal` opens an
// unscoped session at the resolved home directory; one entry per known repository/worktree row
// (§8.1) opens one scoped at its own root — both stay in the Terminal module's own workspace,
// never opening a Git workspace as a side effect (§6's whole point).
function terminalModuleMenuItems(): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'new-terminal',
      label: 'Terminal',
      icon: 'terminal-bash',
      disabled: terminalDefaults.cwd === '',
      run: () => {
        openTerminalTab({ workspaceId: 'terminal', cwd: terminalDefaults.cwd });
      },
    },
  ];
  if (codeReposState.records.length > 0) {
    items.push({ type: 'separator' });
    for (const repo of codeReposState.records) {
      items.push({
        type: 'item',
        id: `repo-${repo.id}`,
        label: repo.name,
        hint: repo.root,
        icon: 'repo',
        run: () => {
          openTerminalTab({ workspaceId: 'terminal', cwd: repo.root, codeRepoId: repo.id });
        },
      });
    }
  }
  return items;
}
</script>

<template>
  <!-- P91 §8: always one wrapper now (was `v-if="tabs.length > 0"` / `v-else` — two separate
       elements) — the Terminal module's own normal initial state is zero tabs, which needs the
       "+" (below) just as much as a populated strip does. `.tab-strip-pinned` already carries its
       own `v-if`; `.tab-strip`'s scroller with no children is an inert flex child either way. -->
  <div
    class="tab-strip-wrapper"
    :class="{ 'is-empty': tabs.length === 0 }"
    :data-testid="tabs.length > 0 ? 'tab-strip-wrapper' : 'tab-strip-empty'"
  >
    <!-- P72 §7: the pinned tab's own fixed leading slot — a sibling of `.tab-strip`, outside its
         `overflow-x: auto`, so it never scrolls away. Icon-only: the repo name moves to the
         tooltip/`aria-label` (`titleFor`), the chrome is one glyph. Never draggable (§6.1) and
         never has a close button (`tabKinds.ts`'s `pinned: true` already refuses both), so
         neither is wired here at all rather than guarded per-tab. -->
    <div v-if="pinnedTabs.length > 0" class="tab-strip-pinned" data-testid="tab-strip-pinned">
      <button
        v-for="{ tab, icon } in pinnedTabs"
        :key="tab.id"
        type="button"
        class="p-tab is-pinned"
        :class="{ 'is-active': tab.active }"
        data-testid="tab"
        :data-tab-id="tab.id"
        :data-tab-kind="tab.kind"
        :data-active="tab.active"
        data-pinned="true"
        :draggable="false"
        :aria-label="titleFor(tab)"
        v-tooltip="titleFor(tab)"
        @click="onClick(tab)"
        @contextmenu.prevent="onContextMenu($event, tab)"
      >
        <span
          v-if="typeof icon !== 'string'"
          class="tab-icon tab-file-icon"
          :style="fileIconStyle(icon.filePath)"
          aria-hidden="true"
        />
        <CodiconIcon v-else :name="icon" :size="13" class="tab-icon" />
      </button>
      <span class="tab-strip-separator" aria-hidden="true"></span>
    </div>
    <div ref="stripRef" class="tab-strip" data-testid="tab-strip-row" @wheel="onWheel">
      <button
        v-for="{ tab, icon } in scrollingTabs"
        :key="tab.id"
        type="button"
        class="p-tab"
        :class="{
          'is-active': tab.active,
          'is-dragging': dragId === tab.id,
          'is-preview': isPreview(tab.id),
          'is-incognito': isIncognito(tab.id),
          'is-attention': isAttention(tab),
        }"
        data-testid="tab"
        :data-tab-id="tab.id"
        :data-tab-kind="tab.kind"
        :data-active="tab.active"
        :data-preview="isPreview(tab.id)"
        data-pinned="false"
        :data-incognito="isIncognito(tab.id)"
        :data-attention="isAttention(tab)"
        :data-color="colorFor(tab)"
        :style="{ '--kira-rail': connColorVar(colorFor(tab)) }"
        draggable="true"
        @click="onClick(tab)"
        @dblclick="promoteTab(tab.id)"
        @auxclick.middle="onMiddleClick(tab)"
        @contextmenu.prevent="onContextMenu($event, tab)"
        @dragstart="onDragStart(tab.id)"
        @dragover.prevent="onDragOver(tab.id)"
        @dragend="onDragEnd"
      >
        <span class="p-tab-rail" />
        <span
          v-if="typeof icon !== 'string'"
          class="tab-icon tab-file-icon"
          :style="fileIconStyle(icon.filePath)"
          aria-hidden="true"
        />
        <CodiconIcon v-else :name="icon" :size="13" class="tab-icon" />
        <CodiconIcon
          v-if="isIncognito(tab.id)"
          name="eye-closed"
          :size="12"
          class="tab-incognito"
          v-tooltip="'Incognito — nothing from this tab is saved'"
        />
        <span class="tab-title">{{ titleFor(tab) }}</span>
        <CodiconIcon
          v-if="badgeFor(tab)"
          :name="badgeFor(tab)!.icon"
          :size="12"
          class="tab-badge"
          v-tooltip="badgeFor(tab)!.tooltip"
          data-testid="tab-badge"
        />
        <span
          class="tab-close"
          role="button"
          aria-label="Close tab"
          data-testid="tab-close"
          @click="onClose($event, tab)"
        >
          <CodiconIcon name="close" :size="13" />
        </span>
      </button>
    </div>
    <!-- P83 §9.1/P91 §8: a third fixed child, after `.tab-strip`, mirroring `.tab-strip-pinned`'s
         own leading-edge fix at the other end — flex-shrink: 0, outside the scroller's overflow-x,
         so it never scrolls away. Repo-workspace or the Terminal module: every other workspace's
         dropdown would have nowhere to launch a terminal at all. -->
    <div v-if="showNewTab" class="tab-strip-actions" data-testid="tab-strip-actions">
      <button
        ref="newTabBtn"
        type="button"
        class="tab-new"
        aria-label="New tab"
        aria-haspopup="menu"
        data-testid="tab-strip-new"
        v-tooltip="'New tab'"
        @click="onNewTab"
      >
        <CodiconIcon name="add" :size="13" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* P72 §7: the actual flex row — `.tab-strip-pinned` (fixed) and `.tab-strip` (scrolling) are its
   two children, so the pinned tab sits outside the latter's own `overflow-x` entirely instead of
   scrolling away with it. */
.tab-strip-wrapper {
  height: 100%;
  display: flex;
  align-items: center;
  min-width: 0;
}

.tab-strip-wrapper.is-empty {
  padding: 0 var(--kira-s-2);
}

.tab-strip-pinned {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 0 0 4px;
  flex-shrink: 0;
}

.p-tab.is-pinned {
  padding: 0 var(--kira-s-2);
}

/* The visible "and after it the tab bar begins" boundary the request asked for. */
.tab-strip-separator {
  align-self: stretch;
  width: var(--kira-border-width);
  margin: 4px 2px 4px 0;
  background: var(--kira-border);
  flex-shrink: 0;
}

.tab-strip {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px 0;
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
  /* Scrolls with too many tabs open, but the track itself stays hidden — reachable by wheel
     (onWheel above), trackpad, or drag either way, with no visible scrollbar chrome. */
  scrollbar-width: none;
}

.tab-strip::-webkit-scrollbar {
  display: none;
}

/* P24 D32: .tab used to re-declare .p-tab's own rules (primitives.css) by hand, 1px and 10px off
   on type size and max-width respectively — the class is now .p-tab itself, and only what this
   strip genuinely adds (the icon/title/close layout, the close button's hover reveal) stays here. */
.p-tab:hover:not(.is-active) {
  background: var(--kira-hover);
}

.p-tab.is-dragging {
  opacity: 0.5;
}

.tab-icon {
  flex-shrink: 0;
}

/* P73 §2.3: a seti mask icon (repo-file tabs) rather than a codicon glyph — coloured per language,
   14px (--kira-control-inline-h) rather than the tree's 16px so it doesn't outweigh the 13px
   codicon beside it on other tabs. */
.tab-file-icon {
  width: var(--kira-control-inline-h);
  height: var(--kira-control-inline-h);
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* C5 §5.1: the preview-tab affordance — VS Code's own convention for "opened, not yet promoted". */
.p-tab.is-preview .tab-title {
  font-style: italic;
}

/* P86 §14.2: a Claude Code session waiting on you, in a tab that is not the active one —
   IconButton.vue's own .has-indicator::after dot, --kira-state-on's existing amber reused rather
   than a new token for a single small badge. */
.p-tab.is-attention {
  position: relative;
}
.p-tab.is-attention::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kira-state-on);
}

.tab-badge {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

/* P71 §5.1: mirrors .tab-badge's own colour — a small, unobtrusive mark, not a warning. */
.tab-incognito {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.tab-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--kira-radius-sm);
  opacity: 0;
}

.p-tab:hover .tab-close,
.p-tab.is-active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--kira-hover);
}

/* P83 §9.1/§14: the trailing fixed slot, `.tab-strip-pinned`'s own mirror at the other end. */
.tab-strip-actions {
  height: 100%;
  display: flex;
  align-items: center;
  padding: 2px 4px 0 2px;
  flex-shrink: 0;
}
.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  border-radius: var(--kira-radius-sm);
  cursor: pointer;
}
.tab-new:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}
</style>
