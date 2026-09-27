import type { AgentActivity, AgentPhase } from '@shared/domain/agent';
import type { DialogCtx } from '../../../frontend/src/ade/dialogCompose';
import { type QueueInput, useQueue } from '../../../frontend/src/ade/useQueue';
import type {
  AdeBranch,
  AdeNewWork,
  AdePair,
  AdePlan,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
} from '../../../frontend/src/ade/wire';
import type { Settings } from '../../../frontend/src/state/settingsDomain';
import type { MockupComponent } from './mockupOracle';

const DAY_MS = 86_400_000;
// The mockup's own `TODAY = new Date(2026, 8, 22)` (line 935), as the ISO string `useQueue`'s own
// `today` input wants (§0.6) — `mockupOracle.ts` forces `TZ=UTC` process-wide, so this local literal
// and `Date.UTC(2026, 8, 22)` name the same instant.
export const MOCKUP_TODAY = '2026-09-22';

function baseDays(): number {
  return Date.UTC(2026, 8, 22) / DAY_MS;
}

/** Exported for `ade-dialog-parity.spec.ts`'s own Move scenario (§3.1 family 8): the mockup's own
 *  `D.day` is a raw day offset (`moveDialog`'s own `dval`), while our `moveSpec` takes an ISO date
 *  (or `null` for Later, §0.6) — the same offset<->ISO mapping `mockupToWire` already uses for
 *  `plan.day`. */
export function isoFromOffset(offset: number): string {
  const d = new Date((baseDays() + offset) * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function msFromOffset(offset: number): number {
  return (baseDays() + offset) * DAY_MS + 12 * 3600 * 1000; // noon, clear of any boundary rounding
}

/** mockup `f[1]` is `'+N'` or `'+N −M'` (line 590 etc.) — no binary example exists in the fixture, so
 *  anything that doesn't match is treated as binary (matching `AdeFile`'s own `added?`/`deleted?`
 *  optionality for that case). */
function parseFileDelta(raw: string): {
  added: number | null;
  deleted: number | null;
  binary: boolean;
} {
  const m = raw.match(/^\+(\d+)(?:\s*[−-](\d+))?$/);
  if (!m) return { added: null, deleted: null, binary: true };
  return { added: Number(m[1]), deleted: m[2] !== undefined ? Number(m[2]) : null, binary: false };
}

function jiraKeyOf(v: string): string {
  const m = String(v || '').match(/([A-Z][A-Z0-9]+-\d+)/);
  return m ? (m[1] as string) : '';
}

function actToPhase(act: string): AgentPhase {
  if (act === 'input') return 'attention';
  if (act === 'working') return 'working';
  if (act === 'waiting') return 'waiting';
  return 'idle';
}

// biome-ignore lint/suspicious/noExplicitAny: mirrors the mockup's own untyped fixture shape.
type RawItem = any;

export interface MockupToWireResult {
  snapshot: AdeRepoSnapshot;
  sessions: AdeSession[];
  activity: Map<string, AgentActivity>;
  prs: AdeRepoPrs;
  settings: Settings['ade'];
  rebasing: Set<string>;
  pushing: Set<string>;
  today: string;
  historyOpen: boolean;
  historyReach: number;
}

/** Converts one mockup repo's own raw fixture data (`repoData()`, `historyData()`, `state.plans` /
 *  `.merged` / `.newWork` / off-day settings) into a `QueueInput`, reading `comp` directly — never
 *  `renderVals()`'s own output (plan §3.1's own risk mitigation: the converter and the port must be
 *  independent, or a shared bug would cancel out instead of showing up as a parity mismatch).
 *  `comp.state` must already carry every state patch this scenario wants (same instance the caller
 *  also renders with `runMockup`), so both sides read one live state. */
export function mockupToWire(comp: MockupComponent, repo: string): MockupToWireResult {
  const s = comp.state;
  const rawList: RawItem[] = (comp.repoData()[repo] as RawItem[]).filter(
    (b) => !b.pool || (s.added as string[]).indexOf(b.id) >= 0,
  );
  const byId = new Map<string, RawItem>(rawList.map((b) => [b.id, b] as const));
  const merged: Record<string, boolean> = s.merged ?? {};

  // ---- branches --------------------------------------------------------------------------------
  const sessions: AdeSession[] = [];
  const activity = new Map<string, AgentActivity>();
  const branches: AdeBranch[] = rawList.map((b) => {
    for (const raw of b.sessions ?? []) {
      const terminalId = `${b.id}:${raw.id}`;
      sessions.push({
        id: terminalId,
        claudeSessionId: raw.id,
        codeRepoId: repo,
        branch: b.name,
        newWorkId: '',
        cwd: '',
        state: raw.state,
        terminalId,
        startedAt: 0,
        lastActiveAt: 0,
      });
      if (raw.state === 'running') {
        activity.set(terminalId, {
          phase: actToPhase(raw.act),
          runningTools: [],
          toolName: null,
          message: null,
          sessionId: null,
          wakeArmed: false,
          at: 0,
        });
      }
    }
    const isMerged = !!merged[b.id];
    return {
      id: b.id,
      branch: b.name,
      kind: b.kind,
      name: (s.names?.[b.id] as string) || '',
      draftTitle: '',
      startFrom: b.base === 'main' ? '' : b.base,
      exists: true,
      ref: `refs/heads/${b.name}`,
      tip: '0000000',
      owner: b.owner || '',
      authorEmail: '',
      isMine: b.kind === 'mine',
      lastCommitAt: 0,
      base: b.base === 'main' ? '' : b.base,
      ahead: b.ahead ?? 0,
      behind: b.behind ?? 0,
      merged: isMerged,
      mergedAt: isMerged ? msFromOffset(0) : null,
      worktree: '',
      files: (b.files ?? []).map(([path, delta]: [string, string]) => ({
        path,
        ...parseFileDelta(delta),
      })),
      commits: (b.commits ?? []).map(([sha, message]: [string, string]) => ({ sha, message })),
      commitCount: (b.commits ?? []).length,
      dirty: (b.dirty ?? []).map(([code, path]: [string, string]) => ({ code, path })),
      upstream: '',
      upstreamAhead: 0,
      upstreamBehind: 0,
      jira: b.jira ? { key: b.jira.key, url: b.jira.url } : { key: '', url: '' },
      prUrl: b.pr ? b.pr.url : '',
      // mockup `estOf` (line 833): `s.est[id]` overrides the fixture's own `est` when present.
      est: (s.est?.[b.id] as string | undefined) ?? b.est ?? '',
      notes: (s.notes?.[b.id] as string) || '',
      addedAt: 0,
    };
  });

  // ---- new work (drafts — no branch, no sessions, §0.10) ----------------------------------------
  const newWork: AdeNewWork[] = ((s.newWork?.[repo] as RawItem[]) ?? []).map((dr) => ({
    id: dr.id,
    title: dr.title || '',
    startFrom: dr.base === 'main' ? '' : dr.base,
    branchName: '',
    est: (s.est?.[dr.id] as string | undefined) ?? dr.est ?? '',
    notes: dr.notes || '',
    jira: {
      key: jiraKeyOf(dr.jira),
      url: dr.jira ? `https://acme.atlassian.net/browse/${jiraKeyOf(dr.jira)}` : '',
    },
    createdAt: 0,
  }));

  // ---- plan --------------------------------------------------------------------------------------
  const rawPlan = s.plans[repo];
  const day: Record<string, string | null> = {};
  for (const [id, offset] of Object.entries(rawPlan.day as Record<string, number>)) {
    day[id] = offset === undefined ? null : isoFromOffset(offset as number);
  }
  const plan: AdePlan = {
    day,
    order: [...(rawPlan.order as string[])],
    queuedAfter: { ...(rawPlan.queuedAfter as Record<string, string>) },
    unpushed: { ...(rawPlan.unpushed as Record<string, boolean>) },
  };

  // ---- pairs: mine×mine `shared`; mine×review `shared` and `conflicts` (§0.3's own converter rule:
  // conflicts = shared for every mine×review overlap, reproducing the mockup's own file-overlap
  // approximation exactly, so parity holds even though `useQueue` itself reads `conflicts` alone). --
  const fileList = (id: string): string[] =>
    (byId.get(id)?.files ?? []).map((f: [string, string]) => f[0]);
  const sharedOf = (a: string, b: string): string[] => {
    const fb = fileList(b);
    return fileList(a).filter((f) => fb.indexOf(f) >= 0);
  };
  const parentOfPairs = new Map<string, string>();
  for (const b of rawList) {
    if (b.base !== 'main' && byId.has(b.base)) parentOfPairs.set(b.id, b.base);
  }
  for (const [id, after] of Object.entries(rawPlan.queuedAfter as Record<string, string>)) {
    if (byId.has(id) && byId.has(after)) parentOfPairs.set(id, after);
  }
  const ancestorsOfPairs = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    let p = parentOfPairs.get(id);
    while (p !== undefined && !seen.has(p)) {
      out.push(p);
      seen.add(p);
      p = parentOfPairs.get(p);
    }
    return out;
  };
  const pairs: AdePair[] = [];
  const mineItems = rawList.filter((b) => b.kind === 'mine');
  const reviewItems = rawList.filter((b) => b.kind === 'review');
  for (let i = 0; i < mineItems.length; i++) {
    for (let j = i + 1; j < mineItems.length; j++) {
      const a = mineItems[i] as RawItem;
      const b = mineItems[j] as RawItem;
      const shared = sharedOf(a.id, b.id);
      if (shared.length) pairs.push({ a: a.id, b: b.id, shared, conflicts: [] });
    }
  }
  for (const b of mineItems) {
    if (merged[b.id]) continue;
    for (const r of reviewItems) {
      if (ancestorsOfPairs(b.id).indexOf(r.id) >= 0) continue;
      const shared = sharedOf(b.id, r.id);
      if (shared.length) pairs.push({ a: b.id, b: r.id, shared, conflicts: shared });
    }
  }

  // ---- history -------------------------------------------------------------------------------
  const rawHistory: RawItem[] = comp.historyData()[repo] ?? [];
  const history: AdeRepoSnapshot['history'] = rawHistory.map((h) => ({
    item: h.name,
    kind: h.how.startsWith('merged') ? 'merged' : 'archived',
    title: h.title,
    branch: h.name,
    mergedAt: h.how.startsWith('merged') ? msFromOffset(h.day) : null,
    archivedAt: msFromOffset(h.day),
  }));

  // ---- colors (order only — not part of the parity comparison list, §3.1) ----------------------
  const colors: Record<string, number> = {};
  [...branches, ...newWork].forEach((item, i) => {
    colors[item.id] = i;
  });

  // ---- PRs (raw state plus title, §0 — `merged` state wins per mockup `linkOf` line 827) --------
  const prBranches: AdeRepoPrs['branches'] = {};
  for (const b of rawList) {
    if (b.pr) {
      prBranches[b.name] = {
        number: b.pr.num,
        title: b.pr.title,
        url: b.pr.url,
        state: merged[b.id] ? 'Merged' : b.pr.state,
      };
    }
  }

  const snapshot: AdeRepoSnapshot = {
    codeRepoId: repo,
    gitRepoId: repo,
    // P129 Part 4 §0.5/§3.1: `main`'s own ref is the short display form (`mainDisplay`'s own
    // `refs/remotes/<r>/X` -> `<r>/X` case) — the mockup's own dialog templates assume a
    // remote-tracking main (`ontoRef` defaults to `origin/main`), so this is the real shape that
    // reproduces its output, not the plain `refs/heads/main` the useQueue-only converter had before
    // (useQueue itself never reads `snapshot.main`, so this had no effect on Part 3's own parity).
    main: { name: 'main', ref: 'origin/main', tip: '0000000' },
    remote: 'origin',
    branches,
    newWork,
    plan,
    colors,
    pairs,
    history,
    lastFetchAt: null,
    autofetchMinutes: 0,
    worktreeBasePath: '',
  };

  const settings: Settings['ade'] = {
    panelWidth: 0,
    allAgentsFilter: 'active',
    horizonDays: s.horizon,
    historyDays: s.history,
    extraDays: (s.extraDays as number[]).map(isoFromOffset),
    offDays: (s.offDays as number[]).map(isoFromOffset),
    workWeekendDays: (s.workWeekend as number[]).map(isoFromOffset),
    // mockup's own constants (WORKDAY = 6, line 934; the implicit `*3`/`dd*3` factor in `parseEst`
    // for 'd'/'w' units, lines 686-688, is `workdayHours * spanDayShare`) — every parity scenario
    // uses these; rule test 2 exercises 8/0.25 independently of the oracle.
    workdayHours: 6,
    spanDayShare: 0.5,
  };

  return {
    snapshot,
    sessions,
    activity,
    prs: { kind: 'ok', branches: prBranches },
    settings,
    rebasing: new Set(s.rebasing ?? []),
    pushing: new Set(s.pushing ?? []),
    today: MOCKUP_TODAY,
    historyOpen: !!s.showHistory,
    historyReach: s.history as number,
  };
}

// §0.5/§3.1: recovers the fixture's own day offset from `msFromOffset`'s own noon-anchored instant
// (`Math.floor` never crosses a day boundary, noon being clear of both ends) and maps it back
// through `isoFromOffset` — exact fixture-offset parity, independent of the real `localIso`'s own
// local-getter implementation (which `localIsoOfMs` above still covers for every other call site).
function localDayOfFixture(ms: number): string {
  return isoFromOffset(Math.floor(ms / DAY_MS) - baseDays());
}

export function toQueueInput(result: MockupToWireResult, selectedId?: string): QueueInput {
  return {
    snapshot: result.snapshot,
    sessions: result.sessions,
    activity: result.activity,
    prs: result.prs,
    settings: result.settings,
    today: result.today,
    localDayOf: localDayOfFixture,
    historyOpen: result.historyOpen,
    historyReach: result.historyReach,
    selectedId,
    rebasing: result.rebasing,
    pushing: result.pushing,
  };
}

function lastSegmentForFixture(name: string): string {
  const parts = name.split('/');
  return (parts.length ? parts[parts.length - 1] : name) as string;
}

/** P129 Part 4 §3.1: `dialogCompose.ts`'s own `DialogCtx`, over the same converted data — every
 *  branch's `worktree` is set explicitly to what `wtOf`'s own fallback would compute anyway
 *  (`worktreeBasePath` trimmed plus the branch's last segment), so parity holds regardless of which
 *  of the two paths a template actually takes. Built from `comp.state`/`repoData()` directly (never
 *  `renderVals()`'s own output), same independence rule as `mockupToWire` itself. */
export function toDialogContext(
  result: MockupToWireResult,
  repo: string,
  selectedId?: string,
): DialogCtx {
  const worktreeBasePath = `~/wt/${repo}`;
  const branches = result.snapshot.branches.map((b) => ({
    ...b,
    worktree: b.branch ? `${worktreeBasePath}/${lastSegmentForFixture(b.branch)}` : '',
  }));
  const snapshot: AdeRepoSnapshot = { ...result.snapshot, branches, worktreeBasePath };
  const withSnapshot: MockupToWireResult = { ...result, snapshot };
  const view = useQueue(toQueueInput(withSnapshot, selectedId));
  return { view, snapshot, sessions: result.sessions, today: result.today, repoRoot: '' };
}
