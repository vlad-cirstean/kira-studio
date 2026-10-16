import type { Plan, SetPlanArgs } from '../wire';
import { LATER, offsetToIso } from './calendar';
import type { TimelineBand, TimelineEntry } from './timeline';

// Plan writes for a dropped or shifted task, ported from mockup v2 `moveTask` / `shiftTasks`
// (lines 1271-1285) on the wire `SetPlanArgs`: `order` is always the full order, `days` only the
// touched tasks (`null` = Later).

/** What the pointer is over when a task card is released. */
export type DropTarget = { kind: 'card'; taskId: string } | { kind: 'band'; day: number };

export type DropVerdict = { kind: 'refuse' } | { kind: 'move'; args: SetPlanArgs };

function isoOf(today: string, day: number): string | null {
  return day === LATER ? null : offsetToIso(today, day);
}

/** `taskId` moves before `before` (or to the end) and takes `day`. */
export function movePlanArgs(
  plan: Plan,
  today: string,
  taskId: string,
  before: string | null,
  day: number,
): SetPlanArgs {
  const order = plan.order.filter((id) => id !== taskId);
  const at = before === null ? -1 : order.indexOf(before);
  if (at >= 0) order.splice(at, 0, taskId);
  else order.push(taskId);
  return { order, days: { [taskId]: isoOf(today, day) } };
}

/** `ids` move together, in the given order, to just before the first remaining task already on `toDay`. */
export function shiftPlanArgs(
  plan: Plan,
  today: string,
  ids: readonly string[],
  toDay: number,
): SetPlanArgs {
  const moving = new Set(ids);
  const rest = plan.order.filter((id) => !moving.has(id));
  const iso = isoOf(today, toDay);
  let at = rest.findIndex((id) => (plan.day[id] ?? null) === iso);
  if (at < 0) at = rest.length;
  const days: Record<string, string | null> = {};
  for (const id of ids) days[id] = iso;
  return { order: [...rest.slice(0, at), ...ids, ...rest.slice(at)], days };
}

/** Mockup `dropOn` / band `drop`: a card is never dropped on itself or a review item, and a band
 *  takes a drop only when it is neither past nor a day off. */
export function dropVerdict(
  view: {
    bands: readonly Pick<TimelineBand, 'key' | 'isPast' | 'dayOff'>[];
    entries: ReadonlyMap<string, Pick<TimelineEntry, 'day' | 'kind'>>;
  },
  plan: Plan,
  today: string,
  draggedId: string,
  target: DropTarget | null,
): DropVerdict {
  if (target === null) return { kind: 'refuse' };
  if (target.kind === 'card') {
    const entry = view.entries.get(target.taskId);
    if (!entry || target.taskId === draggedId || entry.kind === 'review') return { kind: 'refuse' };
    const cardBand = view.bands.find((b) => b.key === entry.day);
    if (cardBand && (cardBand.isPast || cardBand.dayOff)) return { kind: 'refuse' };
    return {
      kind: 'move',
      args: movePlanArgs(plan, today, draggedId, target.taskId, entry.day),
    };
  }
  const band = view.bands.find((b) => b.key === target.day);
  if (!band || band.isPast || band.dayOff) return { kind: 'refuse' };
  return { kind: 'move', args: movePlanArgs(plan, today, draggedId, null, target.day) };
}
