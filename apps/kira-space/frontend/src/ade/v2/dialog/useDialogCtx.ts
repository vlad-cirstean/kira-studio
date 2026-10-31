import { computed } from 'vue';
import { useRepos } from '../../../repo/state/reposQueries';
import { useCodeReposStore } from '../../../state/coderepos';
import { previewPlain } from '../board/runMessage';
import { usePlanModel } from '../plan/usePlanModel';
import { useAdePromptPreview } from '../queries';
import type { RepoState } from '../wire';
import type { DialogCtx } from './compose';

/** The facts the dialog templates read, off the cached board, repos and sessions. */
export function useDialogCtx() {
  const { model, sessions, repoLabel } = usePlanModel();
  const repos = useRepos();
  const codeRepos = useCodeReposStore();
  const line = useAdePromptPreview('ade.handoverLine', () => ({}));
  const note = useAdePromptPreview('headless.space.suffix', () => ({}));

  return computed((): DialogCtx | null => {
    const m = model.value;
    if (!m) return null;
    const states = new Map<string, RepoState>(m.board.repos.map((r) => [r.codeRepoId, r]));
    return {
      spaceNote: previewPlain(note.data.value?.parts ?? []),
      handoverLine: previewPlain(line.data.value?.parts ?? []),
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
        const s = m.cardFor(id)?.progress.step;
        return s && s.kind !== 'manual' && s.state !== 'done' ? s.name : '';
      },
      currentStep: (id) => {
        const card = m.cardFor(id);
        const cur = card?.progress.step;
        if (!card || !cur) return null;
        return {
          name: cur.name,
          prompt: card.workflow?.steps.find((x) => x.id === cur.id)?.prompt ?? '',
        };
      },
      handoverInto: (id) => {
        const card = m.cardFor(id);
        const h = card?.task.handoverIn;
        if (!card || !h?.body) return null;
        const stepId = card.progress.finished ? 'done' : (card.progress.step?.id ?? '');
        return h.toStepId === stepId ? { from: h.fromStepName, body: h.body } : null;
      },
    };
  });
}
