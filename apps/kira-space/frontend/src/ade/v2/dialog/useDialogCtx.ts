import { computed } from 'vue';
import { useRepos } from '../../../repo/state/reposQueries';
import { useCodeReposStore } from '../../../state/coderepos';
import { usePlanModel } from '../plan/usePlanModel';
import type { RepoState } from '../wire';
import type { DialogCtx } from './compose';

/** The facts the dialog templates read, off the cached board, repos and sessions. */
export function useDialogCtx() {
  const { model, sessions, repoLabel } = usePlanModel();
  const repos = useRepos();
  const codeRepos = useCodeReposStore();

  return computed((): DialogCtx | null => {
    const m = model.value;
    if (!m) return null;
    const states = new Map<string, RepoState>(m.board.repos.map((r) => [r.codeRepoId, r]));
    return {
      graph: m.view.graph,
      sessions: sessions.value,
      worktreeBasePath: m.board.worktreeBasePath,
      repoState: (id) => ({
        mainName: states.get(id)?.mainName ?? '',
        remote: states.get(id)?.remote ?? '',
      }),
      repo: (id) => {
        const cfg = repos.data.value?.repos.find((r) => r.codeRepoId === id);
        const rec = codeRepos.codeRepoRecord(id);
        return {
          nick: repoLabel(id),
          name: cfg?.name ?? rec?.name ?? id,
          root: cfg?.path ?? rec?.root ?? '',
        };
      },
      taskTitle: (id) => m.cardFor(id)?.title ?? '',
      openStep: (id) => {
        const p = m.cardFor(id)?.progress;
        if (p?.stage?.kind !== 'agent') return '';
        return p.steps.find((s) => s.state !== 'done')?.name ?? '';
      },
    };
  });
}
