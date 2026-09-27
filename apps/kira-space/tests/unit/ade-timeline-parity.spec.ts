import { describe, expect, test } from 'bun:test';
import type { DialogCtx } from '../../frontend/src/ade/dialogCompose';
import {
  type DayMenuResult,
  type DropTarget,
  type DropVerdict,
  dayMenuFor,
  dropVerdict,
  movePlanArgs,
  type SetPlanArgs,
  shiftWorkArgs,
} from '../../frontend/src/ade/timelineOps';
import { isoToOffset, LATER, offsetToIso, type QueueBand } from '../../frontend/src/ade/useQueue';
import type { AdePlan } from '../../frontend/src/ade/wire';
import { loadNeutralizedComponent, type MockupComponent } from './support/mockupOracle';
import {
  isoFromOffset,
  type MockupToWireResult,
  mockupToWire,
  toDialogContext,
} from './support/mockupToWire';

// P129 Part 5 §3.2 — the mockup itself (`support/mockupOracle.ts`), run unmodified via `node:vm`, is
// the oracle for `timelineOps.ts`'s own drop rules and plan writes. Ids are shared verbatim between
// the mockup fixture and the converted wire domain (`mockupToWire`'s own `id: b.id`/`id: dr.id`), so
// unlike the render-facing parity specs this file compares by id directly, no name-key matching.

type Repo = 'web-app' | 'api' | 'mobile';
const REPOS: Repo[] = ['web-app', 'api', 'mobile'];

function stubEvent(): { preventDefault: () => void; stopPropagation: () => void } {
  return { preventDefault: () => {}, stopPropagation: () => {} };
}

function domIdToDay(domId: string): number {
  const suffix = domId.replace('aq-day-', '');
  if (suffix === 'later') return LATER;
  if (suffix.startsWith('m')) return -Number(suffix.slice(1));
  return Number(suffix);
}

function buildScenario(
  repo: Repo,
  configure?: (comp: MockupComponent) => void,
): { comp: MockupComponent; wire: MockupToWireResult; ctx: DialogCtx } {
  const comp = loadNeutralizedComponent();
  comp.state.repo = repo;
  comp.state.lastRepo = repo;
  configure?.(comp);
  const wire = mockupToWire(comp, repo);
  const ctx = toDialogContext(wire, repo);
  return { comp, wire, ctx };
}

/** `mockPlan.day[id]` is a raw offset (or absent, meaning Later) — `args.days[id]` is its own ISO
 *  (or `null`) — compared through `isoFromOffset` so both sides read in the same unit. */
function compareSetPlan(
  mockPlan: { order: string[]; day: Record<string, number> },
  args: SetPlanArgs,
  touchedIds: readonly string[],
): void {
  expect(mockPlan.order).toEqual(args.order);
  for (const id of touchedIds) {
    const mockDay = mockPlan.day[id];
    const expectedIso = mockDay === undefined ? null : isoFromOffset(mockDay);
    expect(args.days[id]).toBe(expectedIso);
  }
}

// -------------------------------------------------------------------------------------------------
// Plan writes (§3.2): before present/absent/unknown, Later, ids not yet in order, multi-id box.
// -------------------------------------------------------------------------------------------------

describe('ade-timeline-parity — plan writes (§3.2)', () => {
  const repo: Repo = 'web-app';

  test('before present in order', () => {
    const { comp, wire } = buildScenario(repo);
    comp.movePlan(repo, ['auth'], 'billing', 1);
    const args = movePlanArgs(wire.snapshot.plan, wire.today, ['auth'], 'billing', 1);
    compareSetPlan(comp.state.plans[repo], args, ['auth']);
  });

  test('before absent (appends)', () => {
    const { comp, wire } = buildScenario(repo);
    comp.movePlan(repo, ['auth'], null, 1);
    const args = movePlanArgs(wire.snapshot.plan, wire.today, ['auth'], null, 1);
    compareSetPlan(comp.state.plans[repo], args, ['auth']);
  });

  test('before names an id not in order (appends)', () => {
    const { comp, wire } = buildScenario(repo);
    comp.movePlan(repo, ['auth'], 'not-a-real-id', 1);
    const args = movePlanArgs(wire.snapshot.plan, wire.today, ['auth'], 'not-a-real-id', 1);
    compareSetPlan(comp.state.plans[repo], args, ['auth']);
  });

  test('Later (day null)', () => {
    const { comp, wire } = buildScenario(repo);
    comp.movePlan(repo, ['auth'], 'billing', null);
    const args = movePlanArgs(wire.snapshot.plan, wire.today, ['auth'], 'billing', LATER);
    compareSetPlan(comp.state.plans[repo], args, ['auth']);
    expect(args.days.auth).toBeNull();
  });

  test('an id not yet in the plan order', () => {
    const { comp, wire } = buildScenario(repo);
    expect(wire.snapshot.plan.order.includes('authui')).toBe(false);
    comp.movePlan(repo, ['authui'], 'billing', 2);
    const args = movePlanArgs(wire.snapshot.plan, wire.today, ['authui'], 'billing', 2);
    compareSetPlan(comp.state.plans[repo], args, ['authui']);
  });

  test('multi-id box (a stack moving together)', () => {
    const { comp, wire } = buildScenario(repo);
    comp.movePlan(repo, ['auth', 'authui'], 'billing', 3);
    const args = movePlanArgs(wire.snapshot.plan, wire.today, ['auth', 'authui'], 'billing', 3);
    compareSetPlan(comp.state.plans[repo], args, ['auth', 'authui']);
  });

  test('shiftWorkArgs matches shiftWork', () => {
    const { comp, wire } = buildScenario(repo);
    comp.shiftWork(repo, ['deps', 'd_csv'], 0);
    const args = shiftWorkArgs(wire.snapshot.plan, wire.today, ['deps', 'd_csv'], 0);
    compareSetPlan(comp.state.plans[repo], args, ['deps', 'd_csv']);
  });
});

// -------------------------------------------------------------------------------------------------
// Drop verdicts (§3.2): every drag source dropped on every block and band, per repo.
// -------------------------------------------------------------------------------------------------

function buildItemKind(ctx: DialogCtx): (id: string) => string | undefined {
  const byId = new Map(ctx.view.items.map((it) => [it.id, it.kind] as const));
  return (id) => byId.get(id);
}

/** Mockup `ids` local (1168): non-review member ids of one block's own raw segment — recomputed here
 *  via the converted wire domain's own item kinds, since mockup ids and wire ids are the same string
 *  (module header). */
function dragIdsForBlock(
  block: MockupComponent,
  itemKind: (id: string) => string | undefined,
): string[] {
  return (block._g.m as { id: string }[])
    .map((m) => m.id)
    .filter((id) => itemKind(id) !== 'review');
}

type DropOutcome =
  | { kind: 'refuse' }
  | { kind: 'dialog'; before: string | null; day: number | null }
  | { kind: 'direct'; plan: { order: string[]; day: Record<string, number> } };

/** Runs one drop attempt against the mockup's own real `dropOn`/`drop` closure and classifies the
 *  result by which of `comp.state.dialog`/`comp.state.plans[repo]` changed — then reverts whichever
 *  one did, so `comp`/`view` (rendered once per test) can be reused across every attempt. */
function attemptMockDrop(
  comp: MockupComponent,
  repo: Repo,
  ids: string[],
  run: () => void,
): DropOutcome {
  const beforeDialog = comp.state.dialog;
  const beforePlanRef = comp.state.plans[repo];
  comp.dragIds = ids;
  run();
  if (comp.state.dialog !== beforeDialog) {
    const spec = comp.state.dialog;
    comp.state.dialog = beforeDialog;
    return { kind: 'dialog', before: spec.before ?? null, day: spec.day ?? null };
  }
  if (comp.state.plans[repo] !== beforePlanRef) {
    const plan = comp.state.plans[repo];
    comp.state.plans[repo] = beforePlanRef;
    return { kind: 'direct', plan };
  }
  return { kind: 'refuse' };
}

function compareOutcome(outcome: DropOutcome, verdict: DropVerdict, ids: readonly string[]): void {
  expect(verdict.kind).toBe(outcome.kind);
  if (outcome.kind === 'dialog' && verdict.kind === 'dialog') {
    expect(verdict.before).toBe(outcome.before);
    expect(verdict.day === LATER ? null : verdict.day).toBe(outcome.day);
  }
  if (outcome.kind === 'direct' && verdict.kind === 'direct') {
    compareSetPlan(outcome.plan, verdict.args, ids);
  }
}

describe('ade-timeline-parity — drop verdicts (§3.2)', () => {
  for (const repo of REPOS) {
    test(`${repo}: every drag source dropped on every block and band matches dropVerdict`, () => {
      const { comp, wire, ctx } = buildScenario(repo);
      const itemKind = buildItemKind(ctx);
      const view = comp.renderVals();
      const blocks: MockupComponent[] = view.bands.flatMap((b: MockupComponent) => b.blocks);
      const bands: MockupComponent[] = view.bands;

      const sources: string[][] = [];
      for (const block of blocks) {
        const boxIds = dragIdsForBlock(block, itemKind);
        if (boxIds.length === 0) continue;
        sources.push(boxIds);
        if (boxIds.length > 1) for (const id of boxIds) sources.push([id]);
      }

      let checked = 0;
      for (const ids of sources) {
        for (const block of blocks) {
          const target: DropTarget = { kind: 'box', lead: block._g.lead, day: block._day };
          const outcome = attemptMockDrop(comp, repo, ids, () => block.dropOn(stubEvent()));
          const verdict = dropVerdict(ctx.view, wire.snapshot.plan, wire.today, ids, target);
          compareOutcome(outcome, verdict, ids);
          checked++;
        }
        for (const band of bands) {
          const target: DropTarget = { kind: 'band', day: domIdToDay(band.domId) };
          const outcome = attemptMockDrop(comp, repo, ids, () => band.drop(stubEvent()));
          const verdict = dropVerdict(ctx.view, wire.snapshot.plan, wire.today, ids, target);
          compareOutcome(outcome, verdict, ids);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('ade-timeline-parity — drop refusals, explicit (§3.2)', () => {
  test('band target on an off day refuses (state patch offDays)', () => {
    const repo: Repo = 'web-app';
    const { comp, wire, ctx } = buildScenario(repo, (c) => {
      c.state.offDays = [2];
    });
    const target: DropTarget = { kind: 'band', day: 2 };
    const verdict = dropVerdict(ctx.view, wire.snapshot.plan, wire.today, ['auth'], target);
    expect(verdict.kind).toBe('refuse');

    const view = comp.renderVals();
    const band = (view.bands as MockupComponent[]).find((b) => domIdToDay(b.domId) === 2);
    expect(band).toBeDefined();
    const beforeDialog = comp.state.dialog;
    const beforePlan = comp.state.plans[repo];
    comp.dragIds = ['auth'];
    (band as MockupComponent).drop(stubEvent());
    expect(comp.state.dialog).toBe(beforeDialog);
    expect(comp.state.plans[repo]).toBe(beforePlan);
  });

  test('band target on a past day refuses (cart is already scheduled at day -1)', () => {
    const repo: Repo = 'web-app';
    const { wire, ctx } = buildScenario(repo);
    const pastBand = ctx.view.bands.find((b) => b.day === -1) as QueueBand;
    expect(pastBand.isPast).toBe(true);
    const verdict = dropVerdict(ctx.view, wire.snapshot.plan, wire.today, ['auth'], {
      kind: 'band',
      day: -1,
    });
    expect(verdict.kind).toBe('refuse');
  });

  test('a lead scheduled before its own parent refuses ("never before its parent")', () => {
    const repo: Repo = 'web-app';
    const { wire, ctx } = buildScenario(repo);
    const parent = ctx.view.parentOf.authui;
    expect(parent).toBe('auth');
    const parentEff = ctx.view.effDay[parent as string] as number;
    expect(parentEff).toBeGreaterThan(0);
    const verdict = dropVerdict(ctx.view, wire.snapshot.plan, wire.today, ['authui'], {
      kind: 'band',
      day: 0,
    });
    expect(verdict.kind).toBe('refuse');
  });
});

// -------------------------------------------------------------------------------------------------
// Rollover / overflow (§3.2)
// -------------------------------------------------------------------------------------------------

describe('ade-timeline-parity — rollover and overflow (§3.2)', () => {
  test('overdue rollover matches shiftWorkArgs (state patch: auth moved to day -1)', () => {
    const repo: Repo = 'web-app';
    const { comp, wire, ctx } = buildScenario(repo, (c) => {
      c.state.plans = {
        ...c.state.plans,
        [repo]: { ...c.state.plans[repo], day: { ...c.state.plans[repo].day, auth: -1 } },
      };
    });
    const view = comp.renderVals();
    const band = (view.bands as MockupComponent[]).find((b) => domIdToDay(b.domId) === -1);
    expect((band as MockupComponent).isOverdue).toBe(true);

    let called: unknown[] | null = null;
    comp.shiftWork = (...args: unknown[]) => {
      called = args;
    };
    (band as MockupComponent).rollover();
    expect(called).not.toBeNull();
    const [calledRepo, ids, toDay] = called as unknown as [string, string[], number];
    expect(calledRepo).toBe(repo);

    const qband = ctx.view.bands.find((b) => b.day === -1) as QueueBand;
    expect(ids).toEqual(qband.overdueIds);
    expect(toDay).toBe(ctx.view.firstWorkDay);
    const got = shiftWorkArgs(wire.snapshot.plan, wire.today, ids, toDay);
    const expected = shiftWorkArgs(
      wire.snapshot.plan,
      wire.today,
      qband.overdueIds,
      ctx.view.firstWorkDay,
    );
    expect(got).toEqual(expected);
  });

  test('overflow move matches shiftWorkArgs (state patch: auth also on day 0, over capacity)', () => {
    const repo: Repo = 'web-app';
    const { comp, wire, ctx } = buildScenario(repo, (c) => {
      c.state.plans = {
        ...c.state.plans,
        [repo]: { ...c.state.plans[repo], day: { ...c.state.plans[repo].day, auth: 0 } },
      };
    });
    const view = comp.renderVals();
    const band = (view.bands as MockupComponent[]).find((b) => domIdToDay(b.domId) === 0);
    expect((band as MockupComponent).isOver).toBe(true);

    let called: unknown[] | null = null;
    comp.shiftWork = (...args: unknown[]) => {
      called = args;
    };
    (band as MockupComponent).overflowMove();
    expect(called).not.toBeNull();
    const [calledRepo, ids, toDay] = called as unknown as [string, string[], number];
    expect(calledRepo).toBe(repo);

    const qband = ctx.view.bands.find((b) => b.day === 0) as QueueBand;
    expect(ids).toEqual(qband.overflowIds);
    expect(toDay).toBe(qband.overflowMoveDay as number);
    const got = shiftWorkArgs(wire.snapshot.plan, wire.today, ids, toDay);
    const expected = shiftWorkArgs(
      wire.snapshot.plan,
      wire.today,
      qband.overflowIds,
      qband.overflowMoveDay as number,
    );
    expect(got).toEqual(expected);
  });
});

// -------------------------------------------------------------------------------------------------
// Day-off menu (§3.2)
// -------------------------------------------------------------------------------------------------

function openDayMenu(comp: MockupComponent, dk: number): MockupComponent {
  comp.state.ctx = { dk, x: 0, y: 0, label: 'x' };
  return comp.renderVals();
}

function offDaysOf(result: DayMenuResult | null): string[] {
  const arr = result?.patch?.offDays;
  expect(arr).toBeDefined();
  return arr as string[];
}

function workWeekendOf(result: DayMenuResult | null): string[] {
  const arr = result?.patch?.workWeekendDays;
  expect(arr).toBeDefined();
  return arr as string[];
}

function spyToggle(comp: MockupComponent): { patch: Record<string, unknown> | null } {
  const box: { patch: Record<string, unknown> | null } = { patch: null };
  comp.setState = (patch: Record<string, unknown>) => {
    box.patch = patch;
    Object.assign(comp.state, patch);
  };
  return box;
}

describe('ade-timeline-parity — day-off menu (§3.2)', () => {
  test('plain weekday with starts here: "Mark as day off", confirm on toggle', () => {
    const repo: Repo = 'web-app';
    const { comp, wire, ctx } = buildScenario(repo);
    const qband = ctx.view.bands.find((b) => b.day === 0) as QueueBand;
    expect(qband.startIds.length).toBeGreaterThan(0);
    const result = dayMenuFor(qband, wire.settings);
    expect(result).not.toBeNull();

    const view = openDayMenu(comp, 0);
    expect(view.ctx.label).toBe(result?.label);
    const spy = spyToggle(comp);
    view.ctx.toggle(stubEvent());
    expect(spy.patch).not.toBeNull();
    const patch = spy.patch as Record<string, unknown>;
    expect((patch.offDays as number[]).map(isoFromOffset)).toEqual(offDaysOf(result));
    expect(result?.confirmAfter).toBe(true);
    const confirm = patch.confirm as { keys: string[]; to: number };
    expect(confirm.keys).toEqual(qband.startIds);
    expect(confirm.to).toBe(qband.nextWorkDay as number);
  });

  test('a day already off: "Mark as working day", no confirm', () => {
    const repo: Repo = 'web-app';
    const { comp, wire, ctx } = buildScenario(repo, (c) => {
      c.state.offDays = [4];
    });
    const qband = ctx.view.bands.find((b) => b.day === 4) as QueueBand;
    expect(qband.isDayOff).toBe(true);
    const result = dayMenuFor(qband, wire.settings);
    expect(result?.confirmAfter).toBe(false);

    const view = openDayMenu(comp, 4);
    expect(view.ctx.label).toBe(result?.label);
    const spy = spyToggle(comp);
    view.ctx.toggle(stubEvent());
    const patch = spy.patch as Record<string, unknown>;
    expect((patch.offDays as number[]).map(isoFromOffset)).toEqual(offDaysOf(result));
    expect(patch.confirm).toBeUndefined();
  });

  test('a worked weekend: "Mark as weekend (off)", no confirm', () => {
    const repo: Repo = 'web-app';
    const { wire, ctx } = buildScenario(repo);
    const weekend = ctx.view.bands.find((b) => b.isCalendarWeekend && !b.isLater) as QueueBand;
    expect(weekend).toBeDefined();
    const { comp, ctx: patchedCtx } = buildScenario(repo, (c) => {
      c.state.workWeekend = [weekend.day];
    });
    const qband = patchedCtx.view.bands.find((b) => b.day === weekend.day) as QueueBand;
    expect(qband.isWorkedWeekend).toBe(true);
    const result = dayMenuFor(qband, wire.settings);
    expect(result?.label).toBe('Mark as weekend (off)');
    expect(result?.confirmAfter).toBe(false);

    const view = openDayMenu(comp, weekend.day);
    expect(view.ctx.label).toBe(result?.label);
    const spy = spyToggle(comp);
    view.ctx.toggle(stubEvent());
    const patch = spy.patch as Record<string, unknown>;
    expect((patch.workWeekend as number[]).map(isoFromOffset)).toEqual(workWeekendOf(result));
  });

  test('a plain unworked weekend: "Work this day"', () => {
    const repo: Repo = 'web-app';
    const { comp, wire, ctx } = buildScenario(repo);
    const qband = ctx.view.bands.find(
      (b) => b.isCalendarWeekend && !b.isWorkedWeekend && !b.isLater,
    ) as QueueBand;
    expect(qband).toBeDefined();
    const result = dayMenuFor(qband, wire.settings);
    expect(result?.label).toBe('Work this day');

    const view = openDayMenu(comp, qband.day);
    expect(view.ctx.label).toBe(result?.label);
    const spy = spyToggle(comp);
    view.ctx.toggle(stubEvent());
    const patch = spy.patch as Record<string, unknown>;
    expect((patch.workWeekend as number[]).map(isoFromOffset)).toEqual(workWeekendOf(result));
  });

  test('null on Later and past days', () => {
    const repo: Repo = 'web-app';
    const { wire, ctx } = buildScenario(repo);
    const laterBand = ctx.view.bands.find((b) => b.isLater) as QueueBand;
    const pastBand = ctx.view.bands.find((b) => b.isPast) as QueueBand;
    expect(dayMenuFor(laterBand, wire.settings)).toBeNull();
    expect(dayMenuFor(pastBand, wire.settings)).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------------
// Real-only rules (§3.2): ISO arithmetic, no mockup equivalent to run as an oracle.
// -------------------------------------------------------------------------------------------------

describe('ade-timeline-parity — real-only rules (§3.2)', () => {
  test('ISO arithmetic crosses a month end correctly', () => {
    const today = '2026-01-31';
    expect(offsetToIso(today, 1)).toBe('2026-02-01');
    expect(isoToOffset(today, '2026-02-01')).toBe(1);
  });

  test('ISO arithmetic is unaffected by a DST change (UTC-day based, no local-zone drift)', () => {
    // 2026-03-08 is the US spring-forward date; UTC day arithmetic has no notion of it.
    const today = '2026-03-07';
    expect(offsetToIso(today, 1)).toBe('2026-03-08');
    expect(offsetToIso(today, 2)).toBe('2026-03-09');
    expect(isoToOffset(today, '2026-03-09')).toBe(2);
  });

  test('a null plan day round-trips as LATER', () => {
    const plan: AdePlan = { day: {}, order: ['a'], queuedAfter: {}, unpushed: {} };
    const args = movePlanArgs(plan, '2026-09-22', ['a'], null, LATER);
    expect(args.days.a).toBeNull();
    expect(args.order).toEqual(['a']);
  });
});
