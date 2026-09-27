import type { Settings, SettingsPatch } from '../state/settingsDomain';
import { LATER, offsetToIso, type QueueBand, type QueueView } from './useQueue';
import type { AdePlan } from './wire';

// P129 Part 5 §0.13: drop rules and plan writes, ported from `docs/v2.0/design/mockup.html`'s
// `movePlan` (695-703), `shiftWork` (706-716) and `moveDialog` (1132-1138). Pure — no Vue import,
// no store read — `AdeTimeline`'s own drag handling and `state/adeActions.ts` call into this,
// cross-checked by `tests/unit/ade-timeline-parity.spec.ts` running the mockup itself as an oracle.

/** The element under the pointer while a row or box is being dragged (§0.12) — resolved by
 *  `AdeTimeline` from `data-ade-box`/`data-ade-band`, `null` when the pointer is over neither. A
 *  box's own `lead` is `null` for a leadless segment (mockup 1165's own `!g.lead` "unused" rung). */
export type DropTarget =
  | { kind: 'box'; lead: string | null; day: number }
  | { kind: 'band'; day: number };

/** `AdeSetPlanArgs` minus `codeRepoId` — `days` only for the touched ids, `order` always the full
 *  array (§0.13's own divergence from the mockup's own full-map `Object.assign` replacement, which
 *  the real `SetPlan` RPC has no need for — it patches per id, Part 2's `adequeue.go`). */
export interface SetPlanArgs {
  days: Record<string, string | null>;
  order: string[];
}

export type DropVerdict =
  | { kind: 'refuse' }
  | { kind: 'direct'; args: SetPlanArgs }
  | { kind: 'dialog'; ids: string[]; before: string | null; day: number };

/** Mockup `movePlan` (695-703): `ids[0]` moves in `order` (before `before` when present and still in
 *  the order, else appended); every id in `ids` gets `day`'s own ISO (`null` for `LATER`). */
export function movePlanArgs(
  plan: AdePlan,
  today: string,
  ids: readonly string[],
  before: string | null,
  day: number,
): SetPlanArgs {
  const lead = ids[0] as string;
  const order = plan.order.filter((id) => id !== lead);
  const insertAt = before !== null ? order.indexOf(before) : -1;
  if (insertAt >= 0) order.splice(insertAt, 0, lead);
  else order.push(lead);
  const iso = day === LATER ? null : offsetToIso(today, day);
  const days: Record<string, string | null> = {};
  for (const id of ids) days[id] = iso;
  return { days, order };
}

/** Mockup `shiftWork` (706-716): every id in `ids` already in `order` keeps its relative order and
 *  moves as a block to just before the first remaining item whose own day equals `toDay` (else the
 *  end); every id in `ids` gets `toDay`'s own ISO. */
export function shiftWorkArgs(
  plan: AdePlan,
  today: string,
  ids: readonly string[],
  toDay: number,
): SetPlanArgs {
  const moving = new Set(ids);
  const firsts = plan.order.filter((id) => moving.has(id));
  const rest = plan.order.filter((id) => !moving.has(id));
  const iso = toDay === LATER ? null : offsetToIso(today, toDay);
  let at = rest.findIndex((id) => (plan.day[id] ?? null) === iso);
  if (at < 0) at = rest.length;
  const order = [...rest.slice(0, at), ...firsts, ...rest.slice(at)];
  const days: Record<string, string | null> = {};
  for (const id of ids) days[id] = iso;
  return { days, order };
}

/** Mockup `dropOn`/`drop`/`moveDialog` (1132-1138, 1201, 1293), unified into one pure verdict:
 *  `refuse` (nothing happens), `direct` (every id is parked — the mockup's own no-dialog branch, so
 *  the caller writes `args` straight through `SetPlan`), or `dialog` (open the Move dialog, which
 *  itself writes the plan on send, §0.14). */
export function dropVerdict(
  view: QueueView,
  plan: AdePlan,
  today: string,
  ids: readonly string[],
  target: DropTarget | null,
): DropVerdict {
  if (target === null || ids.length === 0) return { kind: 'refuse' };
  // mockup `dropOn` (1201): a box with no lead, or dropping a segment onto itself, does nothing.
  if (target.kind === 'box' && (target.lead === null || ids.includes(target.lead))) {
    return { kind: 'refuse' };
  }
  const band = view.bands.find((b) => b.day === target.day);
  // mockup `drop` (1293): the band's own DOM handler only fires for a day that is neither off nor
  // past — a box target has no such gate (dropping onto an existing box on a past day is allowed).
  if (target.kind === 'band' && (!band || band.isPast || band.isDayOff)) {
    return { kind: 'refuse' };
  }
  const day = target.day;
  // mockup `moveDialog` rung 1 (1133): day off (non-Later) refuses regardless of target kind.
  if (day !== LATER && band?.isDayOff) return { kind: 'refuse' };

  const before = target.kind === 'box' ? target.lead : null;
  const byId = new Map(view.items.map((item) => [item.id, item]));
  const lead = ids[0] as string;
  const parent = view.parentOf[lead];
  if (day !== LATER && parent !== undefined) {
    const parentEff = view.effDay[parent];
    // mockup `moveDialog` rung 2 (1136): never before the lead's own parent, unless the parent is a
    // review (nothing to reorder against) or is itself unscheduled (Later).
    if (
      byId.get(parent)?.kind !== 'review' &&
      parentEff !== undefined &&
      parentEff !== LATER &&
      day < parentEff
    ) {
      return { kind: 'refuse' };
    }
  }

  const allParked = ids.every((id) => byId.get(id)?.kind === 'parked');
  if (allParked) return { kind: 'direct', args: movePlanArgs(plan, today, ids, before, day) };
  return { kind: 'dialog', ids: [...ids], before, day };
}

export interface DayMenuResult {
  label: string;
  patch: SettingsPatch['ade'];
  confirmAfter: boolean;
}

/** Mockup day context menu (1315-1332): `null` on Later and past days (menu doesn't open, mockup
 *  1295). Otherwise off > weekend > weekday, same precedence as the mockup's own label ternary
 *  (1320). `confirmAfter` tells the caller (§0.11) whether to also open the confirm dialog — using
 *  `band.startIds`/`band.nextWorkDay`, already computed, never recomputed here. */
export function dayMenuFor(band: QueueBand, settings: Settings['ade']): DayMenuResult | null {
  if (band.isLater || band.isPast || band.iso === null) return null;
  const iso = band.iso;
  if (band.isDayOff) {
    return {
      label: 'Mark as working day',
      patch: { offDays: settings.offDays.filter((d) => d !== iso) },
      confirmAfter: false,
    };
  }
  if (band.isCalendarWeekend) {
    if (band.isWorkedWeekend) {
      return {
        label: 'Mark as weekend (off)',
        patch: { workWeekendDays: settings.workWeekendDays.filter((d) => d !== iso) },
        confirmAfter: false,
      };
    }
    return {
      label: 'Work this day',
      patch: { workWeekendDays: [...settings.workWeekendDays, iso] },
      confirmAfter: false,
    };
  }
  return {
    label: 'Mark as day off',
    patch: { offDays: [...settings.offDays, iso] },
    confirmAfter: band.startIds.length > 0,
  };
}
