import { describe, expect, test } from 'bun:test';
import { dropVerdict, movePlanArgs, shiftPlanArgs } from '../../frontend/src/ade/v2/board/dropPlan';
import type { Plan } from '../../frontend/src/ade/v2/wire';

const TODAY = '2026-09-22';
const LATER = 9999;

const plan: Plan = {
  day: { a: '2026-09-22', b: '2026-09-23', c: '2026-09-23' },
  order: ['a', 'b', 'c', 'd'],
  queuedAfter: {},
  unpushed: {},
};

describe('movePlanArgs', () => {
  test('inserts before the target and takes its day', () => {
    expect(movePlanArgs(plan, TODAY, 'd', 'b', 1)).toEqual({
      order: ['a', 'd', 'b', 'c'],
      days: { d: '2026-09-23' },
    });
  });
  test('appends when before is unknown or null; LATER clears the day', () => {
    expect(movePlanArgs(plan, TODAY, 'a', 'zz', LATER)).toEqual({
      order: ['b', 'c', 'd', 'a'],
      days: { a: null },
    });
    expect(movePlanArgs(plan, TODAY, 'b', null, 0).order).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('shiftPlanArgs', () => {
  test('moves the block before the first remaining task on the target day', () => {
    expect(shiftPlanArgs(plan, TODAY, ['a'], 1)).toEqual({
      order: ['a', 'b', 'c', 'd'],
      days: { a: '2026-09-23' },
    });
    expect(shiftPlanArgs(plan, TODAY, ['b', 'c'], 0)).toEqual({
      order: ['b', 'c', 'a', 'd'],
      days: { b: '2026-09-22', c: '2026-09-22' },
    });
  });
  test('appends when no remaining task sits on the target day', () => {
    expect(shiftPlanArgs(plan, TODAY, ['a'], 5).order).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('dropVerdict', () => {
  const view = {
    bands: [
      { key: -1, isPast: true, dayOff: false },
      { key: 0, isPast: false, dayOff: false },
      { key: 1, isPast: false, dayOff: true },
    ],
    entries: new Map([
      ['a', { day: 0, kind: 'task' as const }],
      ['r', { day: 0, kind: 'review' as const }],
      ['p', { day: -1, kind: 'task' as const }],
      ['o', { day: 1, kind: 'task' as const }],
    ]),
  };
  test('refuses itself, review cards, cards and bands that are past or a day off', () => {
    for (const target of [
      { kind: 'card', taskId: 'a' },
      { kind: 'card', taskId: 'r' },
      { kind: 'card', taskId: 'p' },
      { kind: 'card', taskId: 'o' },
      { kind: 'band', day: -1 },
      { kind: 'band', day: 1 },
      null,
    ] as const) {
      expect(dropVerdict(view, plan, TODAY, 'a', target)).toEqual({ kind: 'refuse' });
    }
  });
  test('moves before a card on its day, or to the end of a band', () => {
    expect(dropVerdict(view, plan, TODAY, 'd', { kind: 'card', taskId: 'a' })).toEqual({
      kind: 'move',
      args: { order: ['d', 'a', 'b', 'c'], days: { d: '2026-09-22' } },
    });
    expect(dropVerdict(view, plan, TODAY, 'b', { kind: 'band', day: 0 })).toEqual({
      kind: 'move',
      args: { order: ['a', 'c', 'd', 'b'], days: { b: '2026-09-22' } },
    });
  });
});
