import type { QueryClient } from '@tanstack/vue-query';
import { watch } from 'vue';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
import type { useAgentSessionsStore } from './state/agentSessions';
import { adeTurns } from './v2/dialog/turnWatch';
import {
  backlogKey,
  boardKey,
  logKey,
  prsKey,
  reposKey,
  sessionsKey,
  workflowsKey,
  workflowYamlKey,
} from './v2/queries';
import { useAdeBoardUiStore } from './v2/state/adeBoardUi';
import type { Board, LogPage, RunsChangedEvent } from './v2/wire';

const reviewAgentPrefix = ['adetask', 'reviewAgent'] as const;

/** Merges pushed runs into the cached board by id (unknown ones append to their task); the board
 *  push that follows reconciles. */
function mergeRuns(board: Board, event: RunsChangedEvent): Board {
  const tasks = board.tasks.map((t) => {
    const incoming = event.runs.filter((r) => r.taskId === t.id);
    if (!incoming.length) return t;
    const byId = new Map(incoming.map((r) => [r.id, r]));
    const runs = t.runs.map((r) => byId.get(r.id) ?? r);
    const known = new Set(t.runs.map((r) => r.id));
    for (const r of incoming) if (!known.has(r.id)) runs.push(r);
    return { ...t, runs };
  });
  return { ...board, tasks };
}

/** Appends pushed chunks to a cached log page, skipping sequence numbers it already holds. */
function appendChunks(page: LogPage, chunks: LogPage['chunks']): LogPage {
  const last = page.chunks.at(-1)?.seq ?? page.nextSeq - 1;
  const fresh = chunks.filter((c) => c.seq > last);
  if (!fresh.length) return page;
  return { ...page, chunks: [...page.chunks, ...fresh], nextSeq: (fresh.at(-1)?.seq ?? last) + 1 };
}

/** Called once from `main.ts`, app lifetime, no teardown. Every board push re-reads the board and
 *  PR facts; a sessions push re-reads the sessions; an open-session push selects that session; an
 *  agent hook event feeds the dialog turn watchers; a backlog push re-reads the backlog; a repos push re-reads the repo settings and the
 *  shared code repo list; a workflows push re-reads the list and any open YAML; a runs push merges
 *  into the cached board; a log push appends to the cached log; a credential prompt joins the
 *  shared queue and is answered through the v2 broker. */
export function installAdeSignals(
  queryClient: QueryClient,
  agent: Pick<ReturnType<typeof useAgentSessionsStore>, 'sessions'>,
): void {
  // A launch not yet listed among live terminals is not `ended`; once per window, so a watch in
  // the review window resolves when its terminal dies too.
  watch(
    () => agent.sessions.map((s) => s.terminalId),
    (ids) => adeTurns.onLive(ids),
    { immediate: true },
  );
  control.onAdeTaskBoard(() => {
    void queryClient.invalidateQueries({ queryKey: boardKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: prsKey, exact: true });
  });
  control.onAdeTaskBacklog(() => {
    void queryClient.invalidateQueries({ queryKey: backlogKey, exact: true });
  });
  control.onAdeTaskRepos(() => {
    void queryClient.invalidateQueries({ queryKey: reposKey, exact: true });
    void useCodeReposStore().hydrateCodeRepos();
  });
  control.onAdeTaskWorkflows(() => {
    void queryClient.invalidateQueries({ queryKey: workflowsKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: workflowYamlKey });
  });
  control.onAdeTaskSessions(() => {
    void queryClient.invalidateQueries({ queryKey: sessionsKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: reviewAgentPrefix });
  });
  control.onAdeTaskOpenSession((event) => {
    useAdeBoardUiStore().openSession(event);
  });
  control.onAgentEvent((event) => adeTurns.onEvent(event));
  control.onAdeTaskRuns((event) => {
    queryClient.setQueryData<Board>(boardKey, (board) => (board ? mergeRuns(board, event) : board));
  });
  control.onAdeTaskLog((event) => {
    queryClient.setQueryData<LogPage>(logKey(event.kind, event.id), (page) =>
      page ? appendChunks(page, event.chunks) : page,
    );
  });
}
