import { type ActivityKind, actRank, sessionLabel } from './activity';
import type { QueueView } from './useQueue';
import type { AdeSession } from './wire';

// `useQueue` runs without activity; this overlays the three fields a hook event can change
// (item `acts`/`agents`, panel `running[].kind`) so a tool event never rebuilds segments or bands.
export function applyActivity(
  view: QueueView,
  sessions: readonly AdeSession[],
  kinds: ReadonlyMap<string, ActivityKind>,
): QueueView {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const kindOf = (s: AdeSession): ActivityKind =>
    s.state === 'running' ? (kinds.get(s.terminalId) ?? 'idle') : 'stopped';

  const items = view.items.map((item) => {
    const own = item.sessionIds.flatMap((id) => byId.get(id) ?? []);
    return {
      ...item,
      acts: own.map(kindOf).sort((a, b) => actRank(a) - actRank(b)),
      agents: own
        .filter((s) => s.state === 'running')
        .map((s) => ({
          sessionId: s.id,
          label: sessionLabel(s),
          kind: kindOf(s),
          lastActiveAt: s.lastActiveAt,
        }))
        .sort((a, b) => actRank(a.kind) - actRank(b.kind)),
    };
  });

  const panel = view.panel && {
    ...view.panel,
    running: view.panel.running
      .map((r) => {
        const s = byId.get(r.id);
        return s ? { ...r, kind: kindOf(s) } : r;
      })
      .sort((a, b) => actRank(a.kind) - actRank(b.kind)),
  };
  return { ...view, items, panel };
}
