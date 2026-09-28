import type { AgentActivity } from '@shared/domain/agent';
import {
  ACTIVITY_LABEL,
  type ActivityKind,
  activityKind,
  activitySummary,
  actRank,
  sessionLabel,
} from './activity';
import { PALETTE, type QueueView } from './useQueue';
import type { AdeRepoSnapshot, AdeSession } from './wire';

// P129 Part 7 §0.6: a pure port of `docs/v2.0/design/mockup.html`'s own All-agents build (lines
// 862-891) — no Vue import, no clock read. The mockup iterates its own `DATA[r]` branches directly
// (archived ones included, flagged `isArchived(b)`); the real backend instead drops an archived
// branch out of `snapshot.branches` into `snapshot.history`, so this module's own row join (below)
// is the adaptation: a session's own queue-item row (still live), else a matching history entry
// (archived), else an orphan (its branch was removed outside the app). Cross-checked by
// `tests/unit/ade-all-agents-parity.spec.ts` against the mockup's own `renderVals().allView`.

/** `'#3a3e48'` — the mockup's own fallback swatch (line 875) for a colour index no longer assigned,
 *  reused for every no-palette-colour case here (an archived item with no recorded colour slot, or
 *  an orphan with no queue item at all). */
const NO_COLOR = '#3a3e48';

/** One repo's own inputs, already computed by the caller (`AdeAllAgentsView.vue`'s own per-repo
 *  `useQueue`/`useQueries`, §0.5) — `view`/`snapshot` are `null` only while that repo's own fetch is
 *  still in flight. Repo order is the caller's own `codeReposStore.records` order (§2.4: groups
 *  render in that same order, never re-sorted here). */
export interface AllAgentsRepoInput {
  codeRepoId: string;
  name: string;
  view: QueueView | null;
  snapshot: AdeRepoSnapshot | null;
  sessions: readonly AdeSession[];
}

export interface AllAgentsRow {
  sessionId: string;
  codeRepoId: string;
  /** The queue item id this session joins to, `null` for an orphan (§0.6 rule 3). */
  itemId: string | null;
  /** `claude <8 chars>` (`sessionLabel`). */
  claudeLabel: string;
  kind: ActivityKind;
  /** `ACTIVITY_LABEL[kind]`, or `'stopped · archived'` when `archived`. */
  label: string;
  lastActiveAt: number;
  /** `'open'` for a running session (this window or another), `'start'`/`'resume'` otherwise — the
   *  row's own button. Named `action` after the design/mockup's own `btn`; the view component reads
   *  `archived`/`cwdMissing` itself to decide the dialog's own worktree-choice shape (§0.10). */
  action: 'open' | 'start';
  title: string;
  /** `''` when `title === branch` (§0.6: the same "blank when redundant" rule live, archived and
   *  orphan rows all share). */
  branchText: string;
  /** The session's own real, absolute cwd — never the mockup's own fixture `~/wt/<repo>/<leaf>`. */
  worktree: string;
  color: string;
  archived: boolean;
  terminalId: string;
}

export interface AllAgentsGroup {
  codeRepoId: string;
  name: string;
  rows: AllAgentsRow[];
}

export interface AllAgentsResult {
  /** Every running session across every repo (mockup `activeN`, line 863). */
  activeN: number;
  /** Every non-running (stopped) session across every repo (mockup `olderN` — `allSess.length -
   *  activeN`, line 864). */
  olderN: number;
  /** `activitySummary` over every session across every repo, always computed (not filter-gated) —
   *  the pinned tab's own count reads `.input` regardless of which filter is showing (§0.4); the
   *  Active-only aggregated line is the view component's own call to render it or not. */
  summary: { input: number; working: number; waiting: number };
  /** Only groups whose filtered rows are non-empty (mockup's own `.filter(g => g.has)`, line 889) —
   *  an empty result means the view shows `Nothing here.` */
  groups: AllAgentsGroup[];
}

/** §0.6 rule 1-3: one session's own row, joined against its repo's live queue, else archive
 *  history, else neither. */
function buildRow(
  repo: AllAgentsRepoInput,
  session: AdeSession,
  activity: ReadonlyMap<string, AgentActivity>,
): AllAgentsRow {
  const kind = activityKind(session, activity);
  const liveItem = repo.view?.items.find((item) => item.sessionIds.includes(session.id));

  let itemId: string | null;
  let title: string;
  let branchText: string;
  let color: string;
  let archived: boolean;

  if (liveItem) {
    itemId = liveItem.id;
    title = liveItem.title;
    branchText = title === liveItem.branch ? '' : liveItem.branch;
    color = liveItem.color;
    archived = false;
  } else {
    const hist = repo.snapshot?.history.find(
      (h) =>
        (session.branch !== '' && h.branch === session.branch) ||
        (session.newWorkId !== '' && h.item === session.newWorkId),
    );
    if (hist) {
      itemId = hist.item;
      title = hist.title;
      branchText = title === hist.branch ? '' : hist.branch;
      const colorIndex = repo.snapshot?.colors[hist.item];
      color =
        colorIndex !== undefined ? (PALETTE[colorIndex % PALETTE.length] as string) : NO_COLOR;
      archived = true;
    } else {
      itemId = null;
      title = session.branch || 'New work';
      branchText = '';
      color = NO_COLOR;
      archived = false;
    }
  }

  return {
    sessionId: session.id,
    codeRepoId: repo.codeRepoId,
    itemId,
    claudeLabel: sessionLabel(session),
    kind,
    label: archived ? 'stopped · archived' : ACTIVITY_LABEL[kind],
    lastActiveAt: session.lastActiveAt,
    action: session.state === 'running' ? 'open' : 'start',
    title,
    branchText,
    worktree: session.cwd,
    color,
    archived,
    terminalId: session.terminalId,
  };
}

export function buildAllAgents(
  repos: readonly AllAgentsRepoInput[],
  activity: ReadonlyMap<string, AgentActivity>,
  filter: 'active' | 'older',
): AllAgentsResult {
  const allSessions = repos.flatMap((r) => r.sessions);
  const activeN = allSessions.filter((s) => s.state === 'running').length;
  const olderN = allSessions.length - activeN;
  const wantActive = filter === 'active';

  const groups: AllAgentsGroup[] = [];
  for (const repo of repos) {
    const rows = repo.sessions
      .filter((s) => (s.state === 'running') === wantActive)
      .map((s) => buildRow(repo, s, activity))
      // §0.6: within a repo, urgency (actRank) first, ties by most-recently-active.
      .sort((a, b) => actRank(a.kind) - actRank(b.kind) || b.lastActiveAt - a.lastActiveAt);
    if (rows.length === 0) continue;
    groups.push({ codeRepoId: repo.codeRepoId, name: repo.name, rows });
  }

  return { activeN, olderN, summary: activitySummary(allSessions, activity), groups };
}
