import { computed } from 'vue';
import { usePlanModel } from '../plan/usePlanModel';
import { type SessionLookup, type SessionView, sessionView } from './sessionView';

/** `view(session)` for any session, resolved against the live board, workflows and repo names. */
export function useSessionViews() {
  const { model, sessions, repoLabel } = usePlanModel();

  const lookup = computed<SessionLookup>(() => {
    const m = model.value;
    const tasks = new Map(m?.board.tasks.map((t) => [t.id, t]));
    const branches = m?.view.graph.byBranch;
    return {
      task: (id) => tasks.get(id),
      branch: (id) => branches?.get(id),
      repoLabel,
      workflow: (id) => m?.workflows.get(id),
    };
  });

  const view = (s: Parameters<typeof sessionView>[0]): SessionView => sessionView(s, lookup.value);
  return { sessions, view };
}
