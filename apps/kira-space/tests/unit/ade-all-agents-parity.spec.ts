import { describe, expect, test } from 'bun:test';
import type { AgentActivity } from '@shared/domain/agent';
import { actRank } from '../../frontend/src/ade/activity';
import {
  type AllAgentsGroup,
  type AllAgentsRepoInput,
  type AllAgentsRow,
  buildAllAgents,
} from '../../frontend/src/ade/allAgents';
import { useQueue } from '../../frontend/src/ade/useQueue';
import { loadNeutralizedComponent, runMockup } from './support/mockupOracle';
import { mockupToWire, toQueueInput } from './support/mockupToWire';

// P129 Part 7 §3.1 — the mockup itself (its own `renderVals().allView`/`repoTabs[0]`, run via
// `support/mockupOracle.ts`) is the oracle for `allAgents.ts`'s `buildAllAgents`. Unlike the queue/
// dialog parity specs, the All-agents view is inherently cross-repo (mockup `groups = repos.map(...)`
// reads every repo regardless of `state.repo`), so this spec builds one shared, neutralized `comp`
// and converts every repo from it once, rather than one scenario per repo.

const REPOS = ['web-app', 'api', 'mobile'] as const;

/** Builds every repo's own `AllAgentsRepoInput` from ONE shared component instance —
 *  `mockupToWire`/`toQueueInput` never read `state.repo`/`state.lastRepo` (confirmed: no reference
 *  in `support/mockupToWire.ts`), so one instance safely serves all three repos' own conversions,
 *  each independently keyed by its own `repo` param. */
function buildOurRepos(): { repos: AllAgentsRepoInput[]; activity: Map<string, AgentActivity> } {
  const comp = loadNeutralizedComponent();
  const activity = new Map<string, AgentActivity>();
  const repos = REPOS.map((repo) => {
    const wire = mockupToWire(comp, repo);
    const view = useQueue(toQueueInput(wire));
    for (const [k, v] of wire.activity) activity.set(k, v);
    return { codeRepoId: repo, name: repo, view, snapshot: wire.snapshot, sessions: wire.sessions };
  });
  return { repos, activity };
}

/** `groups`/`repoTabs` read every repo's own `DATA[r]` directly (mockup line 869/851) — `state.repo`
 *  plays no part in either, so `runMockup`'s own `repo` param (needed only to satisfy its own
 *  required option) is arbitrary; `REPOS[0]` keeps it inside the fixture's real repo set. */
function mockupAllView(filter: 'active' | 'older') {
  return runMockup({ repo: REPOS[0], statePatch: { allFilter: filter } }) as {
    allView: {
      groups: {
        repo: string;
        rows: { title: string; branch: string; state: string; btn: string }[];
      }[];
      activeLabel: string;
      olderLabel: string;
      acts: { kind: string; count: number }[];
    };
    repoTabs: { acts: { count: number }[] }[];
  };
}

function rowKey(r: {
  title: string;
  branch?: string;
  branchText?: string;
  label?: string;
  state?: string;
  action?: string;
  btn?: string;
}): string {
  const branch = r.branch ?? r.branchText ?? '';
  const state = r.state ?? r.label ?? '';
  const btn = r.btn ?? (r.action === 'open' ? 'Open' : 'Start');
  return JSON.stringify({ title: r.title, branch, state, btn });
}

for (const filter of ['active', 'older'] as const) {
  describe(`ade-all-agents-parity — filter=${filter} (§3.1)`, () => {
    test('activeLabel/olderLabel counts', () => {
      const { repos, activity } = buildOurRepos();
      const ours = buildAllAgents(repos, activity, filter);
      const mv = mockupAllView(filter) as {
        allView: { activeLabel: string; olderLabel: string };
      };
      expect(ours.activeN).toBe(Number((mv.allView.activeLabel as string).replace('Active ', '')));
      expect(ours.olderN).toBe(Number((mv.allView.olderLabel as string).replace('Older ', '')));
    });

    test('acts (aggregated line, Active only) and the pinned tab count', () => {
      const { repos, activity } = buildOurRepos();
      const ours = buildAllAgents(repos, activity, filter);
      const mv = mockupAllView(filter) as {
        allView: { acts: { kind: string; count: number }[] };
        repoTabs: { acts: { count: number }[] }[];
      };
      if (filter === 'active') {
        const expectedActs = new Map(mv.allView.acts.map((a) => [a.kind, a.count]));
        expect(ours.summary.input).toBe(expectedActs.get('input') ?? 0);
        expect(ours.summary.working).toBe(expectedActs.get('working') ?? 0);
        expect(ours.summary.waiting).toBe(expectedActs.get('waiting') ?? 0);
      }
      const pinnedActs = mv.repoTabs[0]?.acts ?? [];
      expect(ours.summary.input).toBe(
        pinnedActs.length ? (pinnedActs[0] as { count: number }).count : 0,
      );
    });

    test('groups: repo order, row multiset, non-decreasing urgency', () => {
      const { repos, activity } = buildOurRepos();
      const ours = buildAllAgents(repos, activity, filter);
      const ourGroups: AllAgentsGroup[] = ours.groups;
      const mv = mockupAllView(filter) as {
        allView: {
          groups: {
            repo: string;
            rows: { title: string; branch: string; state: string; btn: string }[];
          }[];
        };
      };
      expect(ourGroups.map((g) => g.codeRepoId)).toEqual(mv.allView.groups.map((g) => g.repo));
      for (const group of ourGroups) {
        const mGroup = mv.allView.groups.find((g) => g.repo === group.codeRepoId);
        expect(mGroup, `no mockup group for ${group.codeRepoId}`).toBeDefined();
        const ourRows: AllAgentsRow[] = group.rows;
        const ourKeys = ourRows.map(rowKey).sort();
        const mKeys = (mGroup as { rows: unknown[] }).rows
          .map((r) => rowKey(r as Parameters<typeof rowKey>[0]))
          .sort();
        expect(ourKeys).toEqual(mKeys);
        for (let i = 1; i < group.rows.length; i++) {
          expect(
            actRank((group.rows[i - 1] as { kind: string }).kind as never),
          ).toBeLessThanOrEqual(actRank((group.rows[i] as { kind: string }).kind as never));
        }
      }
    });

    test('empty groups drop out (mockup g.has / our non-empty rows)', () => {
      const { repos, activity } = buildOurRepos();
      const ours = buildAllAgents(repos, activity, filter);
      expect(ours.groups.every((g) => g.rows.length > 0)).toBe(true);
    });
  });
}
