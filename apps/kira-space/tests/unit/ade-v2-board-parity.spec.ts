import { beforeAll, describe, expect, test } from 'bun:test';
import { branchTag, taskCell } from '../../frontend/src/ade/v2/board/actions';
import { baseMarker } from '../../frontend/src/ade/v2/board/baseMarker';
import { buildBranchGraph } from '../../frontend/src/ade/v2/board/branchGraph';
import { branchLine2 } from '../../frontend/src/ade/v2/board/labels';
import { buildNeedsYou, NEEDS_RANK } from '../../frontend/src/ade/v2/board/needsYou';
import { buildTaskProgress, type TaskProgress } from '../../frontend/src/ade/v2/board/progress';
import { deriveStatus } from '../../frontend/src/ade/v2/board/status';
import { buildTimeline, type TimelineView } from '../../frontend/src/ade/v2/board/timeline';
import type {
  Board,
  Branch,
  Pair,
  PrsResult,
  ReposResult,
  SessionsResult,
  Workflow,
  WorkflowsResult,
} from '../../frontend/src/ade/v2/wire';
import { loadFixture, mkBranch, mkPlan, mkRun, mkStage, mkTask } from './support/adeV2Fixtures';
import { type MockupComponent, runMockupV2 } from './support/mockupV2Oracle';

// Parity: the board logic over the P143 fixtures equals the mockup's own `renderVals()` for status,
// stage label and percent, task action, branch tag and actions, base marker, day bands and the
// Needs-you list. The fixtures describe the mockup's default data, with four input normalizations
// the mockup derives itself and the wire carries as backend facts:
//   1. a running headless run whose session waits for input is `stuck` (the mockup reads the session);
//   2. `pairs` are recomputed from each branch's file list, and a pair conflicts when one side is a
//      review item (the mockup's file-overlap rule; the backend uses git merge-tree);
//   3. `now` is 3m 40s after the `preparing` worktree setup started;
//   4. the fixture's `tk01` session (a take-over the mockup only creates on click) is dropped.
// Deliberate divergences (asserted in DIVERGENCE, never skipped): CI failing is dropped (D9).

const NOW = 1790067000000 + 220_000;
const TODAY = '2026-09-22';
const SETTINGS = {
  panelWidth: 0,
  horizonDays: 14,
  historyDays: 14,
  extraDays: [] as string[],
  offDays: [] as string[],
  workWeekendDays: [] as string[],
  workdayHours: 6,
  spanDayShare: 0.5,
  headlessSettingSources: 'all' as const,
};

/** Branch id -> what the new logic shows instead of the mockup, with the reason. */
const DIVERGENCE: Record<string, { mockup: string; ours: string; why: string }> = {
  b_deps: { mockup: 'CI failing', ours: '✓ clean', why: 'D9: no CI badge' },
};

let board: Board;
let sessions: SessionsResult;
let workflows: Workflow[];
let nicks: Map<string, string>;
let oracle: MockupComponent;
let timeline: TimelineView;
let progress: Map<string, TaskProgress>;

function normalizeBoard(raw: Board, sess: SessionsResult): Board {
  const runs = (t: Board['tasks'][number]) =>
    t.runs.map((r) => {
      const stuck = sess.sessions.some(
        (s) =>
          s.mode === 'headless' &&
          s.state === 'running' &&
          s.activity === 'input' &&
          s.taskId === t.id &&
          s.branchId === r.branchId &&
          s.stageId === r.stageId &&
          s.stepId === r.stepId,
      );
      return r.state === 'running' && stuck ? { ...r, state: 'stuck' as const } : r;
    });
  const pairs: Pair[] = [];
  const bs = raw.branches;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i] as Branch;
      const b = bs[j] as Branch;
      if (a.codeRepoId !== b.codeRepoId) continue;
      const files = new Set(b.files.map((f) => f.path));
      const shared = a.files.map((f) => f.path).filter((p) => files.has(p));
      if (!shared.length) continue;
      const review = a.kind === 'review' || b.kind === 'review';
      pairs.push({ a: a.id, b: b.id, shared, conflicts: review ? shared : [] });
    }
  }
  return { ...raw, tasks: raw.tasks.map((t) => ({ ...t, runs: runs(t) })), pairs };
}

beforeAll(() => {
  const rawSessions = loadFixture<SessionsResult>('sessions');
  sessions = { sessions: rawSessions.sessions.filter((s) => s.id !== 'tk01') };
  board = normalizeBoard(loadFixture<Board>('board'), sessions);
  workflows = loadFixture<WorkflowsResult>('workflows').workflows.flatMap((w) =>
    w.workflow && w.error === null ? [w.workflow] : [],
  );
  nicks = new Map(
    loadFixture<ReposResult>('repos').repos.map((r) => [r.codeRepoId, r.nickname || r.name]),
  );
  oracle = runMockupV2();
  const nick = (id: string) => nicks.get(id) ?? id;
  timeline = buildTimeline({
    board,
    settings: SETTINGS,
    today: TODAY,
    localDayOf: (ms) => new Date(ms).toISOString().slice(0, 10),
    repoLabel: nick,
    showAllItems: true,
    showHistory: false,
  });
  const byBranch = new Map(board.branches.map((b) => [b.id, b]));
  progress = new Map(
    board.tasks.map((t) => [
      t.id,
      buildTaskProgress({
        task: t,
        workflow: workflows.find((w) => w.id === t.workflowId) ?? null,
        branch: (id) => byBranch.get(id),
        repoNick: nick,
      }),
    ]),
  );
});

const nick = (id: string) => nicks.get(id) ?? id;
const boxes = (): MockupComponent[] => oracle.bands.flatMap((b: MockupComponent) => b.tasks);
const boxOf = (id: string): MockupComponent => boxes().find((b) => b.id === id);

describe('timeline', () => {
  test('bands list the same days, labels and hours', () => {
    const ours = timeline.bands.map((b) => [b.label, b.hours ? `${b.hours}h` : '']);
    const theirs = oracle.bands.map((b: MockupComponent) => [
      b.label,
      b.sub === 'off' ? '' : b.sub,
    ]);
    expect(ours).toEqual(theirs);
  });

  test('tasks fall in the same order within every band', () => {
    expect(timeline.bands.flatMap((b) => b.taskIds)).toEqual(boxes().map((b) => b.id));
  });

  test('overflow and overdue flags agree', () => {
    const ours = timeline.bands.map((b) => [
      b.overflowTaskIds.length > 0,
      b.overdueTaskIds.length > 0,
    ]);
    const theirs = oracle.bands.map((b: MockupComponent) => [b.isOver, b.isOverdue]);
    expect(ours).toEqual(theirs);
  });
});

describe('per task', () => {
  const tasks = () => board.tasks.filter((t) => t.kind !== 'review');

  const cellOf = (taskId: string) => {
    const t = board.tasks.find((x) => x.id === taskId);
    if (!t) throw new Error(taskId);
    const branches = t.branchIds.flatMap((id) => board.branches.filter((b) => b.id === id));
    const p = progress.get(t.id) as TaskProgress;
    const status = deriveStatus({
      task: t,
      progress: p,
      branches,
      hasSessions: sessions.sessions.some((s) => s.taskId === t.id),
    });
    return {
      status,
      cell: taskCell({
        task: t,
        progress: p,
        status,
        branches,
        sessions: sessions.sessions.filter((s) => s.taskId === t.id),
      }),
    };
  };

  test('status chip and stage action equal the mockup', () => {
    for (const t of tasks()) {
      const box = boxOf(t.id);
      const { cell } = cellOf(t.id);
      expect([t.id, cell?.tag.label]).toEqual([t.id, box.cells[0].tag]);
      expect([t.id, cell?.action ? [cell.action.label] : []]).toEqual([
        t.id,
        box.cells[0].btns.map((b: MockupComponent) => b.label),
      ]);
    }
  });

  test('derived status equals the mockup row status', () => {
    for (const t of tasks().filter((x) => x.kind === 'task')) {
      expect([t.id, cellOf(t.id).status]).toEqual([t.id, boxOf(t.id).rows[0].status]);
    }
  });

  test('stage label, percent and segment widths equal the mockup', () => {
    for (const t of tasks().filter((x) => x.kind === 'task')) {
      const p = progress.get(t.id) as TaskProgress;
      const phase = boxOf(t.id).rows[0].phase;
      expect([t.id, p.label, `${p.percent}%`, p.showBar]).toEqual([
        t.id,
        phase.label,
        phase.pct,
        phase.showBar,
      ]);
      expect(p.segments.length).toBe(phase.segs.length);
    }
  });

  test('workflow and bar tooltips equal the mockup', () => {
    for (const t of tasks().filter((x) => x.kind === 'task')) {
      const p = progress.get(t.id) as TaskProgress;
      const phase = boxOf(t.id).rows[0].phase;
      expect([t.id, p.workflowTip]).toEqual([t.id, phase.tip]);
      if (p.showBar) expect([t.id, p.barTip]).toEqual([t.id, phase.barTip]);
    }
  });
});

const flat = (parts: readonly (string | { value: string })[]): string =>
  parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');

describe('per branch', () => {
  const byBranch = () => new Map(board.branches.map((b) => [b.id, b]));

  /** Mockup row/cell for a branch, matched by display name and repo (draft rows are `new branch`). */
  function oracleRow(taskId: string, b: Branch): { row: MockupComponent; cell: MockupComponent } {
    const box = boxOf(taskId);
    const offset = box.rows[0].isTask ? 1 : 0;
    const rows: MockupComponent[] = box.rows.slice(offset);
    const hits = rows
      .map((row, i) => ({ row, cell: box.cells[offset + i] }))
      .filter(
        ({ row }) => row.label === (b.name || 'new branch') && row.repo === nick(b.codeRepoId),
      );
    expect(hits).toHaveLength(1);
    return hits[0] as { row: MockupComponent; cell: MockupComponent };
  }

  test('tag, tone-independent label and actions equal the mockup', () => {
    for (const t of board.tasks) {
      for (const id of t.branchIds) {
        const b = byBranch().get(id) as Branch;
        const { cell } = oracleRow(t.id, b);
        const ours = branchTag({
          branch: b,
          graph: timeline.graph,
          plan: board.plan,
          after: timeline.after,
          runs: [],
          nowMs: NOW,
          hadSession: sessions.sessions.some((s) => s.branchId === b.id),
          mainName: 'main',
        });
        const expected = DIVERGENCE[b.id];
        if (expected) {
          expect([b.id, cell.tag]).toEqual([b.id, expected.mockup]);
          expect([b.id, ours.label]).toEqual([b.id, expected.ours]);
          continue;
        }
        expect([b.id, ours.label]).toEqual([b.id, cell.tag]);
        expect([b.id, ours.actions.map((a) => a.label)]).toEqual([
          b.id,
          cell.btns.map((x: MockupComponent) => x.label),
        ]);
      }
    }
  });

  test('rows come in the same order', () => {
    for (const t of board.tasks) {
      const box = boxOf(t.id);
      const rows: MockupComponent[] = box.rows.slice(box.rows[0].isTask ? 1 : 0);
      const ours = timeline
        .branchRows(t.id)
        .map((r) => byBranch().get(r.id) as Branch)
        .map((b) => `${b.name || 'new branch'}|${nick(b.codeRepoId)}`);
      expect([t.id, ours]).toEqual([t.id, rows.map((r) => `${r.label}|${r.repo}`)]);
    }
  });

  test('base marker label and tone equal the mockup', () => {
    for (const t of board.tasks) {
      for (const id of t.branchIds) {
        const b = byBranch().get(id) as Branch;
        const { row } = oracleRow(t.id, b);
        const m = baseMarker(b, timeline.graph, 'main');
        expect([b.id, flat(m?.label ?? [])]).toEqual([b.id, row.baseLabel]);
        if (m) {
          expect([b.id, m.tone === 'blue']).toEqual([b.id, row.baseStyle.includes('#93b6ff')]);
          expect([b.id, flat(m.tip)]).toEqual([b.id, row.baseTip]);
        }
      }
    }
  });
});

describe('branch second line', () => {
  test('context, merged and deployed chips equal the mockup', () => {
    const prs = loadFixture<PrsResult>('prs');
    for (const t of board.tasks) {
      for (const b of t.branchIds.flatMap((id) => board.branches.filter((x) => x.id === id))) {
        const box = boxOf(t.id);
        const offset = box.rows[0].isTask ? 1 : 0;
        const i = box.rows
          .slice(offset)
          .findIndex(
            (r: MockupComponent) =>
              r.label === (b.name || 'new branch') && r.repo === nick(b.codeRepoId),
          );
        const row = box.rows[offset + i];
        const line = branchLine2(b, timeline.graph, prs.branches[b.id]?.title ?? '');
        // Re-merge is out of scope (P146 R5): the mockup's `Right-click to re-merge.` tip suffix is dropped.
        const pick = (c: { label: string; tip: string }) => [
          c.label,
          c.tip.replace('. Right-click to re-merge.', ''),
        ];
        expect([b.id, line.context]).toEqual([b.id, row.hasSub ? row.sub : '']);
        expect([b.id, line.merged.map(pick)]).toEqual([b.id, row.into.map(pick)]);
        expect([b.id, line.deployed.map(pick)]).toEqual([b.id, row.deploys.map(pick)]);
      }
    }
  });
});

describe('Needs you', () => {
  const ours = () =>
    buildNeedsYou({
      board,
      sessions: sessions.sessions,
      progress,
      repoNick: nick,
      nowMs: NOW,
    });

  test('same items (kind, text, action, scope) as the mockup', () => {
    const key = (kind: string, what: string, action: string, scope: string) =>
      [kind, what, action, scope].join('|');
    const theirs = oracle.needs.items
      .map((n: MockupComponent) => key(n.kind, n.what, n.btn, n.repo))
      .sort();
    const mine = ours()
      .items.map((n) => key(n.kind, n.what, n.action, n.scope))
      .sort();
    expect(mine).toEqual(theirs);
  });

  test('ordered by kind rank as SPEC2 §11 lists them, then oldest first', () => {
    const items = ours().items;
    const ranks = items.map((n) => NEEDS_RANK.indexOf(n.kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const stuck = items.filter((n) => n.kind === 'stuck run');
    expect(stuck.map((n) => n.ageMs)).toEqual(
      [...stuck.map((n) => n.ageMs)].sort((a, b) => (b ?? 0) - (a ?? 0)),
    );
  });

  test('badge counts the items; footer drops the CI count', () => {
    const n = ours();
    expect(n.badge).toBe(oracle.needs.items.length);
    expect(n.footer).toBe(oracle.needs.load.replace(/ · \d+ waiting on CI/, ''));
  });
});

// The mockup has no rebase-conflict check (D1), so these states have no oracle: fixed expectations.
describe('rebase-conflict check states', () => {
  const tagFor = (over: Partial<Branch>) => {
    const b = mkBranch({ id: 'b', taskId: 't', setup: null, ...over });
    const graph = buildBranchGraph({
      tasks: [mkTask({ id: 't', branchIds: ['b'] })],
      branches: [b],
      plan: mkPlan(),
      pairs: [],
    });
    const t = branchTag({
      branch: b,
      graph,
      plan: mkPlan(),
      after: new Map(),
      runs: [],
      nowMs: 0,
      hadSession: true,
      mainName: 'main',
    });
    return [t.label, t.actions.map((a) => a.label), t.tip];
  };

  test('done with paths is a conflict with Rebase, done without is clean', () => {
    expect(tagFor({ conflictsIfRebased: ['a.ts', 'b.ts'] })).toEqual([
      '✕ conflict',
      ['Rebase'],
      'conflicts with main if rebased: a.ts, b.ts',
    ]);
    expect(tagFor({})[0]).toBe('✓ clean');
  });

  test('checking and failed never read as clean', () => {
    expect(tagFor({ conflictCheck: 'checking' })[0]).toBe('checking…');
    expect(
      tagFor({ conflictCheck: 'failed', conflictCheckReason: 'git 2.30 is older than 2.38' }),
    ).toEqual(['conflict check failed', [], 'git 2.30 is older than 2.38']);
  });
});

describe('script stage recovery', () => {
  const actionFor = (state: 'failed' | 'stuck') => {
    const script = mkStage({
      id: 'release',
      kind: 'script',
      command: 'make release',
      runsOn: 'each repo',
    });
    const b = mkBranch({ id: 'b', taskId: 't', setup: null });
    const t = mkTask({
      id: 't',
      branchIds: ['b'],
      workflowId: 'w',
      stageId: 'release',
      currentStage: script,
      runs: [mkRun({ taskId: 't', stageId: 'release', stepId: 'release', branchId: 'b', state })],
    });
    const p = buildTaskProgress({
      task: t,
      workflow: { id: 'w', name: 'w', kiraSpaceMcp: false, stages: [script] },
      branch: () => b,
      repoNick: (id) => id,
    });
    const status = deriveStatus({ task: t, progress: p, branches: [b], hasSessions: false });
    return taskCell({ task: t, progress: p, status, branches: [b], sessions: [] })?.action;
  };

  test('a stuck script run offers Retry like a failed one (R23)', () => {
    expect(actionFor('failed')?.kind).toBe('retry');
    expect(actionFor('stuck')?.kind).toBe('retry');
  });
});

describe('Needs you extras (R16)', () => {
  const needsFor = (sessionId: string, finishedAt: number | null) => {
    const script = mkStage({
      id: 'release',
      kind: 'script',
      command: 'make release',
      runsOn: 'each repo',
    });
    const b = mkBranch({ id: 'b', taskId: 't', setup: null });
    const t = mkTask({
      id: 't',
      branchIds: ['b'],
      workflowId: 'w',
      stageId: 'release',
      currentStage: script,
      runs: [
        mkRun({
          id: 'run-1',
          taskId: 't',
          stageId: 'release',
          stepId: 'release',
          branchId: 'b',
          state: 'stuck',
          note: 'timed out after 10m',
          sessionId,
          finishedAt,
        }),
      ],
    });
    const p = buildTaskProgress({
      task: t,
      workflow: { id: 'w', name: 'w', kiraSpaceMcp: false, stages: [script] },
      branch: () => b,
      repoNick: (id) => id,
    });
    return buildNeedsYou({
      board: { tasks: [t], branches: [b] },
      sessions: [],
      progress: new Map([['t', p]]),
      repoNick: (id) => id,
      nowMs: 10_000,
    }).items.filter((n) => n.kind === 'stuck run');
  };

  test('a stuck script run is retried, carries its run id and note, and ages from its finish', () => {
    const [n] = needsFor('', 4_000);
    expect(n?.action).toBe('Retry');
    expect(n?.runIds).toEqual(['run-1']);
    expect(n?.detail).toBe('timed out after 10m');
    expect(n?.ageMs).toBe(6_000);
  });

  test('a stuck run with a session is taken over', () => {
    const [n] = needsFor('s1', 4_000);
    expect(n?.action).toBe('Take over');
    expect(n?.sessionId).toBe('s1');
  });
});
