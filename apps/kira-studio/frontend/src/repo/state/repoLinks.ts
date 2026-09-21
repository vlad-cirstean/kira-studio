import { defineStore } from 'pinia';
import { reactive, watch } from 'vue';
import { control } from '../../bridge/control';
import { useCodeReposStore } from '../../state/coderepos';

export const useRepoLinksStore = defineStore('repoLinks', () => {
  const codeReposStore = useCodeReposStore();

  // P84 plan §4.4: every imported repository's worktree anchor, session-scoped and module-level —
  // the same shape repoHeads.ts's byRepoId already establishes for this panel. '' (the default
  // for an unknown id, via Map.get's own undefined) means top-level; a non-empty value names the
  // code_repos id of the row it nests under.
  const byRepoId = reactive(new Map<string, string>());

  function worktreeParentId(codeRepoId: string): string {
    return byRepoId.get(codeRepoId) ?? '';
  }

  /** One batched `RepoWorktreeLinks` call — every row, no `ids` scoping (§4.2: both callers
   *  refresh the whole list). A row RepoWorktreeLinks could not read comes back with
   *  `parentId: ''` already (the Go side's own safe default, §4.2) — nothing extra to
   *  special-case here. */
  async function refreshRepoWorktreeLinks(): Promise<void> {
    const rows = await control.codeWorkspaceRepoWorktreeLinks();
    for (const row of rows) byRepoId.set(row.id, row.parentId);
  }

  /** P84 §4.5: the click-time hint. Between openRepoAtPath's import resolving and the next
   *  refreshRepoWorktreeLinks answering, a freshly-imported worktree has no parentId yet — this
   *  writes the answer switchToWorktree already knows, so the duplicate top-level row never
   *  flashes. The next batched call overwrites it either way; this is never the sole source of
   *  truth. */
  function noteWorktreeLink(childId: string, parentId: string): void {
    byRepoId.set(childId, parentId);
  }

  // §4.4 trigger 2: an import, a remove, or a P82 worktree switch changes the row set — a new row
  // must not render as a flash-then-vanish duplicate, and a removed one must not linger in the
  // map.
  watch(
    () => codeReposStore.records,
    (records) => {
      const live = new Set(records.map((r) => r.id));
      for (const id of [...byRepoId.keys()]) if (!live.has(id)) byRepoId.delete(id);
      void refreshRepoWorktreeLinks();
    },
  );

  return { worktreeParentId, refreshRepoWorktreeLinks, noteWorktreeLink };
});
