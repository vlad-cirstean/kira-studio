import type { PaletteColor } from '@shared/domain/color';
import {
  asRepoFileTab,
  defaultRepoDiffTabState,
  defaultRepoFileTabState,
  defaultRepoGraphTabState,
  defaultRepoMultiDiffTabState,
  type RepoDiffTabRecord,
  type RepoDiffTabState,
  type RepoFileTabRecord,
  type RepoFileTabState,
  type RepoGraphTabRecord,
  type RepoGraphTabState,
  type RepoMultiDiffTabRecord,
  type RepoMultiDiffTabState,
  repoDiffTabStateSchema,
  repoFileTabStateSchema,
  repoGraphTabStateSchema,
  repoMultiDiffTabStateSchema,
  TAB_KIND_MODE,
  type TabRecord,
  type TerminalTabRecord,
  type TerminalTabState,
  terminalTabStateSchema,
} from '@shared/domain/tabs';
import { dropRepoDiffTab, dropRepoFileTab, dropRepoMultiDiffTab } from '../views/repo/editors';
import { useCodeReposStore } from './coderepos';
import type { MenuItem } from './contextMenu';
import { useTerminalsStore } from './terminals';

// P100 Part 2: kira-space's own tab-kind registry — the same split-from-workbench/tabViews.ts
// shape Kira Studio's state/tabKinds.ts uses (F19, that file's own header comment), trimmed to
// this app's own five kinds only (repo-graph/repo-file/repo-diff/repo-multi-diff/terminal). Every
// entry below is Kira Studio's own behaviour verbatim; only the workspace-key lookups changed,
// since this app's TabRecord.workspaceId IS the bare repoId (no `repo:` prefix, no
// repoIdOfWorkspace indirection — state/workspace.ts's own header comment), and railColor uses
// PaletteColor directly (there is no Connections concept here to own a ConnectionColor alias).
type SpaceTabKind = 'repo-graph' | 'repo-file' | 'repo-diff' | 'repo-multi-diff' | 'terminal';

/** A codicon name, or a file path whose icon comes from the shared seti set
 *  (`repo/fileIcon.ts`) — the same rule the repo file tree and the diff tree already use. */
type TabIcon = string | { readonly filePath: string };

export interface TabKindDef<K extends SpaceTabKind = SpaceTabKind> {
  mode: (typeof TAB_KIND_MODE)[K];
  title(tab: TabRecord): string;
  icon(tab: TabRecord): TabIcon;
  railColor(tab: TabRecord): PaletteColor | undefined;
  /** A brand-new tab of this kind, opened with nothing to inherit. */
  defaultState(): Extract<TabRecord, { kind: K }>['state'];
  /** A restored record's raw `state`, normalized through this kind's own schema. `null` means
   *  "not parseable", and the caller (hydrateTabs) keeps what was stored, merge-only. */
  parseState(raw: unknown): Extract<TabRecord, { kind: K }>['state'] | null;
  /** Some kinds keep one field from the source; repo-file/repo-diff/repo-multi-diff/terminal all
   *  copy their whole state, repo-graph starts fully blank (never actually reached — see below). */
  duplicateState(tab: Extract<TabRecord, { kind: K }>): Extract<TabRecord, { kind: K }>['state'];
  /** Frees whichever page store this kind populated (a no-op miss for a kind with none). */
  dropResources(tabId: string): void;
  /** Appended to the tab strip's own generic context-menu items. */
  menuExtras(tab: TabRecord): MenuItem[];
  /** True for exactly one kind (`repo-graph`) — tabsForWorkspace's own stable partition
   *  (state/workspace.ts) puts every pinned tab of a workspace first, and closeTab/closeOthers/
   *  closeToTheRight/closeAll/duplicateTab/moveTab all guard against it (state/tabs.ts). Absent
   *  (not `false`) for every other kind, so this costs those kinds no line. */
  pinned?: true;
}

// A filesystem basename (state.cwd is an absolute path, not an encoded NodePath).
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function noDrop(): void {
  // repo-graph has no page store of its own — nothing to free.
}

// A repo-file tab's `path` is a plain repository-relative path ('src/main.go'), not an encoded
// NodePath, so this kind gets its own basename-only title rather than pathTail's "kind:name"
// parsing. Also used for a repo-diff tab's own title (repoDiffTitle below), which has no `rev`
// field — asRepoFileTab returns null there, so the suffix only appears for an actual repo-file tab
// pinned to a revision.
function repoFileTitle(tab: TabRecord): string {
  const idx = tab.path.lastIndexOf('/');
  const base = idx < 0 ? tab.path : tab.path.slice(idx + 1);
  const rev = asRepoFileTab(tab)?.state.rev;
  return rev == null ? base : `${base} (${rev.slice(0, 7)})`;
}

// Same basename-only reasoning as repoFileTitle, plus a suffix distinguishing a diff tab from a
// file tab open on the identical path. A commit diff (revision pair present) is titled with both
// short shas instead, so two commits' diffs of the same file read as genuinely different tabs.
function repoDiffTitle(tab: TabRecord): string {
  const diff = tab as RepoDiffTabRecord;
  if (diff.state.left !== null && diff.state.right !== null) {
    const left = diff.state.leftLabel ?? diff.state.left.slice(0, 7);
    const right = diff.state.rightLabel ?? diff.state.right.slice(0, 7);
    return `${repoFileTitle(tab)} (${left} ↔ ${right})`;
  }
  return `${repoFileTitle(tab)} (Working Tree)`;
}

// No `repoFileTitle`-style basename — `path` doesn't exist on this kind (it covers a whole
// commit's file set, not one file), so the title is the revision pair plus a file count.
function repoMultiDiffTitle(tab: TabRecord): string {
  const diff = tab as RepoMultiDiffTabRecord;
  const count = diff.state.files.length;
  return `${diff.state.leftLabel} ↔ ${diff.state.rightLabel} (${count} file${count === 1 ? '' : 's'})`;
}

// Every parseState below is a one-liner over the schema its own kind already imports — this is
// the shared shape (safeParse, `.data` on success, `null` on failure) so each entry states only
// which schema, not the pattern.
function parseStateWith<S>(schema: {
  safeParse(raw: unknown): { success: true; data: S } | { success: false };
}): (raw: unknown) => S | null {
  return (raw) => {
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
  };
}

export const TAB_KINDS: { [K in SpaceTabKind]: TabKindDef<K> } = {
  'repo-graph': {
    mode: TAB_KIND_MODE['repo-graph'],
    title: (tab) => useCodeReposStore().codeRepoRecord(tab.workspaceId ?? '')?.name ?? 'Graph',
    icon: () => 'source-control',
    railColor: () => undefined,
    defaultState: (): RepoGraphTabState => defaultRepoGraphTabState(),
    // Never actually reached (`pinned: true` refuses duplication, state/tabs.ts), but a real
    // default rather than `{}` keeps this consistent with every other kind's own duplicateState.
    duplicateState: (_tab: RepoGraphTabRecord): RepoGraphTabState => defaultRepoGraphTabState(),
    dropResources: noDrop,
    menuExtras: () => [],
    parseState: parseStateWith(repoGraphTabStateSchema),
    pinned: true,
  },
  // One opened repository file, rendered by Monaco (read-only). The same seti icon the file tree
  // already shows for this path (RepoTreeRow.vue's own fileIconStyle, repo/fileIcon.ts).
  'repo-file': {
    mode: TAB_KIND_MODE['repo-file'],
    title: repoFileTitle,
    icon: (tab) => ({ filePath: tab.path }),
    railColor: () => undefined,
    defaultState: (): RepoFileTabState => defaultRepoFileTabState(),
    duplicateState: (tab: RepoFileTabRecord): RepoFileTabState => ({ ...tab.state }),
    // Disposes the live editor widget (if any) and the cached model — RepoFileView.vue's own
    // unmount (a mere tab switch) never reaches this; only an actual close does.
    dropResources: (tabId) => dropRepoFileTab(tabId),
    menuExtras: () => [],
    parseState: parseStateWith(repoFileTabStateSchema),
  },
  // A HEAD-vs-worktree diff, opened from "Open changes" — read-only, mirroring 'repo-file''s
  // shape exactly. No badge, no pinned: a read-only tab.
  'repo-diff': {
    mode: TAB_KIND_MODE['repo-diff'],
    title: repoDiffTitle,
    icon: () => 'git-compare',
    railColor: () => undefined,
    defaultState: (): RepoDiffTabState => defaultRepoDiffTabState(),
    // A commit diff's revision pair must survive duplication — resetting to `{}` would silently
    // turn a duplicated commit-diff tab into a HEAD-vs-worktree one.
    duplicateState: (tab: RepoDiffTabRecord): RepoDiffTabState => ({ ...tab.state }),
    dropResources: (tabId) => dropRepoDiffTab(tabId),
    menuExtras: () => [],
    parseState: parseStateWith(repoDiffTabStateSchema),
  },
  // One commit's whole changed-file set, one tab (VS Code's multi-file diff) — read-only,
  // mirroring 'repo-diff''s own shape. No badge, no pinned, same reasoning.
  'repo-multi-diff': {
    mode: TAB_KIND_MODE['repo-multi-diff'],
    title: repoMultiDiffTitle,
    icon: () => 'diff-multiple',
    railColor: () => undefined,
    // Never reached through a generic "new tab of this kind" affordance — openRepoMultiDiffTab
    // always supplies a real files/revision pair. This placeholder only satisfies TabKindDef's own
    // required member.
    defaultState: (): RepoMultiDiffTabState =>
      defaultRepoMultiDiffTabState([], { left: '', right: '', leftLabel: '', rightLabel: '' }),
    // files/review are arrays/objects — copied fresh so editing the duplicate's own state (were it
    // ever mutated in place) can't reach back into the original's.
    duplicateState: (tab: RepoMultiDiffTabRecord): RepoMultiDiffTabState => ({
      ...tab.state,
      files: [...tab.state.files],
      review: tab.state.review ? { ...tab.state.review } : null,
    }),
    dropResources: (tabId) => dropRepoMultiDiffTab(tabId),
    menuExtras: () => [],
    parseState: parseStateWith(repoMultiDiffTabStateSchema),
  },
  // An embedded shell at one worktree's directory, rendered with @xterm/xterm. A launch's own
  // label (a script's name, or 'Claude Code') wins over the cwd's basename.
  terminal: {
    mode: TAB_KIND_MODE.terminal,
    title: (tab) => {
      const s = (tab as TerminalTabRecord).state;
      return s.label || basename(s.cwd) || 'Terminal';
    },
    // 'terminal-bash': the launch kind shows in the title and the rail colour, not a second icon
    // vocabulary.
    icon: () => 'terminal-bash',
    railColor: (tab) => (tab as TerminalTabRecord).state.color,
    defaultState: (): TerminalTabState => ({
      cwd: '',
      codeRepoId: '',
      command: '',
      label: '',
      color: 'none',
      launchKind: 'shell',
    }),
    // Copying the cwd (and command/label/color) means "Duplicate tab" on a terminal opens a second
    // session with the same launch — which needs no special case.
    duplicateState: (tab: TerminalTabRecord): TerminalTabState => ({ ...tab.state }),
    // The one place a PTY dies on close — blind-called for every kind (dropPageStoresForTab), so a
    // non-terminal tab id is a registry miss here, not a branch.
    dropResources: (tabId) => useTerminalsStore().closeTerminalSession(tabId),
    menuExtras: () => [],
    parseState: parseStateWith(terminalTabStateSchema),
  },
};
