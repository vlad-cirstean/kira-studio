import type { HeadState, Transport } from '@kira/git-ipc';
import { reactive, watch } from 'vue';
import { control } from '../../bridge/control';
import { useCodeReposStore } from '../../state/coderepos';
import { pinia } from '../../state/pinia';
import { workspaceState } from '../../state/workspace';
import { gitTransportFor } from '../git/transport';

// Module-level `watch()` below runs at import time, before `app.use(pinia)` — the explicit
// instance is required here (state/pinia.ts's own header comment).
const codeReposStore = useCodeReposStore(pinia);

// P83 plan §12.3: every repo row's checked-out branch, session-scoped and module-level — same
// shape as worktrees.ts's byRepo/search.ts's repoSearchView. `null` means "known, and there is
// none" (a bare repository, or a row RepoHeads could not read); an absent key means "not fetched
// yet", so a collapsed row renders no label rather than a stale one.
const byRepoId = reactive(new Map<string, HeadState | null>());

/** git-ui's `pickerModel.ts` own helper, mirrored rather than imported — worktreeLabel's own
 *  comment (worktrees.ts:133) names the same reason: not on `@kira/git-ui`'s exports map. Kept in
 *  step with worktreeLabel by hand so a collapsed row's branch and its expanded children's read
 *  the same way. '' when unknown, so the template's `v-if` renders nothing rather than an empty
 *  pill. */
export function repoHeadLabel(codeRepoId: string): string {
  const head = byRepoId.get(codeRepoId);
  if (!head) return '';
  switch (head.kind) {
    case 'branch':
      return head.name;
    case 'detached':
      return `detached @ ${head.sha.slice(0, 7)}`;
    case 'unborn':
      return head.name; // the branch HEAD points at, not yet committed to
  }
}

/** One batched `RepoHeads` call — every row when `ids` is omitted (mount, a records change), one
 *  row for a `refsChanged` event (§12.3 trigger 3, a one-row `RepoHeads` call over the same
 *  batched method). No coalescing: each trigger fires at most once per its own event, nothing
 *  bursts this. */
export async function refreshRepoHeads(ids?: string[]): Promise<void> {
  const rows = await control.codeWorkspaceRepoHeads(ids);
  for (const row of rows) byRepoId.set(row.id, row.head);
}

// §12.3 trigger 2: an import, a remove, or a P82 worktree switch changes the row set — a new row
// must not render headless, and a removed one must not linger in the map.
watch(
  () => codeReposStore.records,
  (records) => {
    const live = new Set(records.map((r) => r.id));
    for (const id of [...byRepoId.keys()]) if (!live.has(id)) byRepoId.delete(id);
    void refreshRepoHeads();
  },
);

// §12.3 trigger 3: one lease per open repo workspace, created and released by the same eviction
// pattern worktrees.ts:149-155 established. `gitTransportFor` returns a lease over the existing
// shared client an open workspace's own graph tab already created — nothing new opened here.
// `immediate: true` so a repo workspace already open when this module first loads is covered too,
// not only one opened afterward.
const leases = new Map<string, { transport: Transport; off: () => void }>();

watch(
  () => workspaceState.openRepos,
  (openRepos, previous) => {
    for (const id of openRepos) {
      if (leases.has(id)) continue;
      const transport = gitTransportFor(id);
      // A checkout is what actually changes a HEAD, and it happens in the workspace's own graph.
      const off = transport.on('repo.changed', (event) => {
        const record = codeReposStore.codeRepoRecord(id);
        if (!record || event.repoId !== record.repoId || event.kind !== 'refsChanged') return;
        void refreshRepoHeads([id]);
      });
      leases.set(id, { transport, off });
    }
    if (!previous) return;
    for (const id of previous) {
      if (openRepos.includes(id)) continue;
      const held = leases.get(id);
      if (!held) continue;
      leases.delete(id);
      held.off();
      held.transport.dispose();
    }
  },
  { immediate: true },
);
