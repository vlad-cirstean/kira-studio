import type { Board, LogPage, RunsChangedEvent } from './wire';

/** Merges pushed runs into the cached board by id (unknown ones append to their task); the board
 *  push that follows reconciles. */
export function mergeRuns(board: Board, event: RunsChangedEvent): Board {
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
export function appendChunks(page: LogPage, chunks: LogPage['chunks']): LogPage {
  const last = page.chunks.at(-1)?.seq ?? page.nextSeq - 1;
  const fresh = chunks.filter((c) => c.seq > last);
  if (!fresh.length) return page;
  return { ...page, chunks: [...page.chunks, ...fresh], nextSeq: (fresh.at(-1)?.seq ?? last) + 1 };
}
