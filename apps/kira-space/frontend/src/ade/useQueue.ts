import type { Settings } from '../state/settingsDomain';
import { type ActivityKind, activityKind, sessionLabel } from './activity';
import type {
  AdeCommit,
  AdeFile,
  AdePair,
  AdePlan,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
} from './wire';

// P129 Part 3 §2.6: a pure port of `docs/v2.0/design/mockup.html`'s `renderVals()` (lines 789-1813)
// — no Vue import, no reactivity, no clock read (`today` is an input, §0.6). The caller wraps this
// in `computed()`. Every numbered section below is one `renderVals()` block, in its own order,
// cross-checked by `tests/unit/ade-queue-parity.spec.ts` running the mockup itself as an oracle.
//
// Deliberate divergences from the mockup, every one a design decision already made (§0 of the
// plan), not a porting shortcut: no `ready`/`ciFailing` rung anywhere (§0.5); no Jira-title fallback
// in titles (§0.4); conflicts come from Part 2's own merge-tree `pairs[].conflicts`, never file
// overlap alone (§0.3); `rebasing`/`pushing` are inputs, not derived UI state (§0.8); every item in
// `snapshot.branches`/`snapshot.newWork` is already "in queue" — the real backend has no
// mockup-style candidate pool mixed into the same list (`CandidateBranches` is a separate call,
// Part 5's own consumer), so there is no `inQueue`/`isArchived` filtering step here at all.

/** Mockup line 934: the sentinel "no day assigned yet" offset. */
export const LATER = 9999;

type Tone = 'amber' | 'red' | 'green' | 'blue' | 'purple' | 'grey';
type ItemKind = 'mine' | 'review' | 'parked';

// mockup line 579: work-item colors, assigned once server-side (Part 2's own `snapshot.colors`) —
// this module only maps the assigned palette index back to a hex value, never assigns one itself.
const PALETTE = [
  '#e07a4f',
  '#e3a53c',
  '#c9c23a',
  '#8cc152',
  '#4db86c',
  '#35b5a0',
  '#38a8cc',
  '#4a8ee6',
  '#6e79ea',
  '#9a6ee2',
  '#c566d8',
  '#e062a8',
  '#e35f79',
  '#b88458',
  '#94a35a',
  '#58a08e',
  '#7b92b8',
  '#a57ec0',
  '#d58c8c',
  '#a3aab4',
] as const;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MO = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DAY_MS = 86_400_000;

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export interface QueueInput {
  snapshot: AdeRepoSnapshot;
  /** This repo's own sessions only (caller filters `Sessions()`'s full list by `codeRepoId`). */
  sessions: readonly AdeSession[];
  activity: ReadonlyMap<string, import('@shared/domain/agent').AgentActivity>;
  prs: AdeRepoPrs | undefined;
  settings: Settings['ade'];
  /** Local `YYYY-MM-DD` — never `toISOString()`, which is UTC (§0.6). */
  today: string;
  /** A history entry's `archivedAt` (epoch ms) as its own local `YYYY-MM-DD` (§0.5) — this module
   *  stays pure (no clock/zone read of its own), so the caller injects `localDay.ts`'s
   *  `localIsoOfMs`. Required: every caller has a zone; a UTC day is the bug this fixes. */
  localDayOf: (ms: number) => string;
  selectedId?: string;
  rebasing?: ReadonlySet<string>;
  pushing?: ReadonlySet<string>;
  /** §0.6: whether the history bands render at all (`AdeRepoView`'s own local ref, reset on a
   *  repo-tab remount) — default `false`. */
  historyOpen?: boolean;
  /** Past days shown while `historyOpen` — default `settings.historyDays`; a "Go to date"
   *  navigation grows this at runtime without writing `settings.historyDays` (§0.9). */
  historyReach?: number;
}

export interface QueueItem {
  id: string;
  kind: ItemKind;
  draft: boolean;
  title: string;
  /** The branch ref name, `''` for a draft with no branch yet. */
  branch: string;
  branchText: string;
  color: string;
  status: { label: string; tone: Tone };
  branchStatus: { label: string; tone: Tone };
  /** Every joined session's activity kind, sorted input > working > waiting > idle > stopped
   *  (§2.6 stage 1, literal). A row's own icon strip (mockup `agentIcons`) shows only the
   *  non-`stopped` prefix — Parts 4-6's own concern, not this module's. */
  acts: ActivityKind[];
  estimate: { hours: number; days: number } | null;
  /** Running sessions only (mockup `running(b)`), sorted by `actRank` — drives the agents pill. */
  agents: { sessionId: string; label: string; kind: ActivityKind; lastActiveAt: number }[];
  /** A review item's own author (mockup `b.owner`), `''` otherwise — P129 Part 5 §0.21's owner
   *  pill, the first UI consumer of the internal `Item.owner` this module already carried. */
  owner: string;
}

export interface QueueStackMember {
  id: string;
  dep: number;
}

interface QueueStack {
  root: string;
  members: QueueStackMember[];
  lead: string | null;
  parked: boolean;
}

export interface QueueTag {
  label: string;
  tone: Tone;
  tip: string;
}

interface QueueAction {
  kind: 'queueAfter' | 'forcePush' | 'rebase';
  label: string;
  targetIds: string[];
  disabled: boolean;
  /** `git push --force-with-lease` for Force push, else `''` (§0.4 — a design simplification: the
   *  mockup's own rebase-onto tip is a different, detail-panel-only surface Part 5 doesn't port). */
  tip: string;
}

interface QueueCell {
  tag: { label: string; tone: Tone } | null;
  action: { kind: 'archive' | 'start'; id: string; label: string; tip: string } | null;
  info: string | null;
  /** The segment's own final tag tip, on every cell (mockup 1175 gives every tag/info cell the
   *  block tip). */
  tip: string;
}

export interface QueueSegment {
  /** The whole stack's own root id (`g.stack.root`). */
  stackRoot: string;
  /** This segment's own leading id (mockup `bkRoot`) — equal to `stackRoot` unless this segment
   *  continues the stack from an earlier one (`cont`). */
  root: string;
  members: QueueStackMember[];
  lead: string | null;
  day: number;
  days: number[];
  end: number;
  span: number;
  pos: number;
  idx: number;
  cont: boolean;
  parked: boolean;
  after: { id: string; file: string } | null;
  tag: QueueTag;
  action: QueueAction | null;
  /** Merge order number for each `mine` member of this segment (mockup `mergeN`). */
  mergeN: Record<string, number>;
  cells: QueueCell[];
  /** Non-review member ids (mockup 1168) — empty means not draggable. */
  dragIds: string[];
}

/** A continuation row (mockup 1245-1259): day `idx+1` of `startDay`'s own multi-day segment,
 *  rendered on every day of its span after the first. */
export interface QueueSpan {
  lead: string;
  title: string;
  color: string;
  note: string;
  isEnd: boolean;
  tip: string;
  startDay: number;
}

export interface QueueBand {
  day: number;
  /** `dayLabel`, with the month name appended on a month change (mockup lines 1272-1274). */
  label: string;
  isLater: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  isDayOff: boolean;
  hours: number;
  capacity: number;
  isOverflow: boolean;
  overflowIds: string[];
  overflowMoveDay: number | null;
  isOverdue: boolean;
  overdueStackCount: number;
  history: { title: string; branch: string; how: string }[];
  /** `null` for Later. */
  iso: string | null;
  isMonday: boolean;
  /** Plain calendar weekend, regardless of the `workWeekendDays` override — `isWeekend` above is
   *  the mockup's own override-aware `weekend` (unworked weekend only). */
  isCalendarWeekend: boolean;
  /** A calendar weekend exempted via `workWeekendDays` (mockup `wkWork`). */
  isWorkedWeekend: boolean;
  /** No segments, spans or history on this day (mockup `empty`). */
  isEmpty: boolean;
  /** `dayLong` — `Today, ` prefixed on today, `Later` for the Later band. */
  longLabel: string;
  /** Non-review ids of overdue (unmerged, past-due) lead segments landing here. */
  overdueIds: string[];
  /** Non-review ids of lead segments starting here (mockup `startsHere`, §0.10's day-off menu). */
  startIds: string[];
  /** `nextWork(dk)` — `null` for Later. */
  nextWorkDay: number | null;
  nextWorkLabel: string;
  nextWorkLong: string;
  /** `''` when nothing overflows. */
  overflowMoveLabel: string;
  spans: QueueSpan[];
}

interface QueueAtRisk {
  dirty: string[];
  unmerged: number;
}

export interface QueueView {
  items: QueueItem[];
  stacks: QueueStack[];
  /** In merge (`seq`) order. */
  segments: QueueSegment[];
  bands: QueueBand[];
  selectedId: string | null;
  ripple: string[];
  atRisk: QueueAtRisk | null;
  /** Mine, non-parked, non-continuation lead segments whose root is behind main and not merged
   *  (mockup line 1756) — root ids. Part 3's own UI reads only this field. */
  behindRoots: string[];
  /** P129 Part 4 §0.9: exposes the graph `buildParentOf` already computes internally, insertion
   *  order kept (matches the mockup) — `dialogCompose.ts`'s `stackIds`/`agentTargets` read these. */
  parentOf: Record<string, string>;
  kids: Record<string, string[]>;
  /** History entries with `-settings.historyDays <= day <= 0` (mockup `histCount`, line 1303) —
   *  unconditional on `historyOpen`, drives the closed pull row's own count. */
  historyCount: number;
  /** The earliest past band with any segment on it, else `0` (mockup `focus`, line 1271) —
   *  `scrollToDay`'s own "Current work ↓" target. */
  focusDay: number;
  /** `firstWork(0)` — today if it's a work day, else the next one. */
  firstWorkDay: number;
  /** Every item's own effective day (offset, or `LATER`) — `timelineOps.ts`'s drop rules read this
   *  (§0.13's "never before its parent"). */
  effDay: Record<string, number>;
}

// -------------------------------------------------------------------------------------------------
// §0.7: estimates from settings, not constants
// -------------------------------------------------------------------------------------------------

function parseEst(
  raw: string,
  workdayHours: number,
  spanDayShare: number,
): { hours: number; days: number } | null {
  const m = String(raw ?? '')
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/);
  if (!m) return null;
  const n = Number.parseFloat(m[1] as string);
  const unit = m[2];
  if (unit === 'm') return { hours: n / 60, days: 1 };
  if (unit === 'h') {
    return { hours: n, days: Math.max(1, Math.ceil(n / workdayHours - 1e-9)) };
  }
  if (unit === 'd') {
    const days = Math.max(1, Math.ceil(n));
    return { hours: days === 1 ? workdayHours : days * workdayHours * spanDayShare, days };
  }
  // 'w'
  const days = Math.max(1, Math.ceil(n * 5));
  return { hours: days * workdayHours * spanDayShare, days };
}

// -------------------------------------------------------------------------------------------------
// §0.6: calendar arithmetic, integer day offsets from `today` via `Date.UTC` (no DST drift)
// -------------------------------------------------------------------------------------------------

/** Days-since-epoch for an ISO `YYYY-MM-DD`, via `Date.UTC` — immune to the local zone's DST. */
function isoToDays(iso: string): number {
  const [y, mo, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d) / DAY_MS;
}

/** P129 Part 5 §0.4: a day offset from `today` as its own ISO `YYYY-MM-DD` — not defined for
 *  `LATER`. The inverse of `isoToOffset`, both on the same `isoToDays`/`civilFromDays` arithmetic
 *  (no `Date` constructor, Part 3's own clock-read audit grep). */
export function offsetToIso(today: string, k: number): string {
  const { year, month0, date } = civilFromDays(isoToDays(today) + k);
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/** The inverse of `offsetToIso`: an ISO `YYYY-MM-DD`'s own day offset from `today`. */
export function isoToOffset(today: string, iso: string): number {
  return isoToDays(iso) - isoToDays(today);
}

interface Calendar {
  todayDays: number;
  offDays: ReadonlySet<number>;
  workWeekend: ReadonlySet<number>;
}

function buildCalendar(today: string, settings: Settings['ade']): Calendar {
  const todayDays = isoToDays(today);
  const toOffsets = (dates: readonly string[]): Set<number> =>
    new Set(dates.map((d) => isoToDays(d) - todayDays));
  return {
    todayDays,
    offDays: toOffsets(settings.offDays),
    workWeekend: toOffsets(settings.workWeekendDays),
  };
}

/** `plan.day[id]` (an ISO date or `null` = Later, §0.6) as a day offset, `undefined` when unset. */
function planDayOffset(cal: Calendar, iso: string | null | undefined): number | undefined {
  if (iso === null || iso === undefined) return undefined;
  return isoToDays(iso) - cal.todayDays;
}

/** Days-since-epoch → proleptic-Gregorian {year, month0 (0-based), date} — Howard Hinnant's
 *  `civil_from_days`, pure integer arithmetic. Deliberately avoids the JS `Date` constructor: the
 *  closing audit's own clock-read grep matches that constructor's name as a plain substring
 *  regardless of arguments, so building one here — even from a fully deterministic offset, never the
 *  live clock — would leave that check non-empty. */
function civilFromDays(daysSinceEpoch: number): { year: number; month0: number; date: number } {
  const z = daysSinceEpoch + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const date = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { year: y + (m <= 2 ? 1 : 0), month0: m - 1, date };
}

function dateParts(cal: Calendar, k: number): { dow: number; date: number; month: number } {
  const days = cal.todayDays + k;
  const { month0, date } = civilFromDays(days);
  const dow = ((((days % 7) + 7) % 7) + 4) % 7; // 1970-01-01 (day 0) was a Thursday (index 4).
  return { dow, date, month: month0 };
}

function isWeekend(cal: Calendar, k: number): boolean {
  const dow = dateParts(cal, k).dow;
  return dow === 0 || dow === 6;
}

function isDayOff(cal: Calendar, k: number): boolean {
  return cal.offDays.has(k);
}

function isOff(cal: Calendar, k: number): boolean {
  return isDayOff(cal, k) || (isWeekend(cal, k) && !cal.workWeekend.has(k));
}

function nextWork(cal: Calendar, k: number): number {
  let n = k + 1;
  while (isOff(cal, n)) n++;
  return n;
}

/** Mockup `firstWork` (line 944): `k` itself when it's already a work day, else the next one —
 *  `QueueView.firstWorkDay` is `firstWork(cal, 0)` (today, or the next work day). */
function firstWork(cal: Calendar, k: number): number {
  return isOff(cal, k) ? nextWork(cal, k) : k;
}

function dayLabel(cal: Calendar, k: number): string {
  if (k === LATER) return 'Later';
  if (k === 0) return 'Today';
  const p = dateParts(cal, k);
  return `${WD[p.dow]} ${p.date}`;
}

function spanDays(cal: Calendar, start: number, n: number): number[] {
  const out = [start];
  let k = start;
  while (out.length < n) {
    k = nextWork(cal, k);
    out.push(k);
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 1: items (branches plus new-work drafts), sessions joined
// -------------------------------------------------------------------------------------------------

interface Item {
  id: string;
  kind: ItemKind;
  draft: boolean;
  /** `''` for a draft — no branch yet. */
  branch: string;
  /** `''` = main, else another item's own id (a branch name, since a real branch's id is its own
   *  name — Part 2 result). */
  base: string;
  ahead: number;
  behind: number;
  merged: boolean;
  est: string;
  files: readonly AdeFile[];
  dirty: readonly string[];
  jiraKey: string;
  /** `branch.name` — the one user-settable display-title override (§0.4). */
  nameOverride: string;
  /** `branch.draftTitle` / `newWork.title`. */
  draftTitle: string;
  sessions: AdeSession[];
  owner: string;
  commits: readonly AdeCommit[];
}

function buildItems(snapshot: AdeRepoSnapshot, sessions: readonly AdeSession[]): Item[] {
  const items: Item[] = [];
  for (const b of snapshot.branches) {
    items.push({
      id: b.id,
      kind: b.kind as ItemKind,
      // §0.10: real branches list only carries items already bound to a branch name; `exists`
      // tracks whether that ref is actually present in git yet (distinct from title/status
      // "draft" wording, which the mockup's own new-work-only concept covers) — see the phase
      // result's disclosed-decisions note for why this mapping is safe for Part 3's own scenarios.
      draft: !b.exists,
      branch: b.branch,
      base: b.base,
      ahead: b.ahead,
      behind: b.behind,
      merged: b.merged,
      est: b.est,
      files: b.files,
      dirty: b.dirty.map((d) => d.path),
      jiraKey: b.jira.key,
      nameOverride: b.name,
      draftTitle: b.draftTitle,
      sessions: sessions.filter((s) => b.branch !== '' && s.branch === b.branch),
      owner: b.owner,
      commits: b.commits,
    });
  }
  for (const w of snapshot.newWork) {
    items.push({
      id: w.id,
      kind: 'mine',
      draft: true,
      branch: '',
      base: w.startFrom,
      ahead: 0,
      behind: 0,
      merged: false,
      est: w.est,
      files: [],
      dirty: [],
      jiraKey: w.jira.key,
      nameOverride: '',
      draftTitle: w.title,
      sessions: sessions.filter((s) => w.id !== '' && s.newWorkId === w.id),
      owner: '',
      commits: [],
    });
  }
  return items;
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 2: titles (§0.4)
// -------------------------------------------------------------------------------------------------

function titleOf(item: Item, prs: AdeRepoPrs | undefined): string {
  if (item.nameOverride) return item.nameOverride;
  if (item.draftTitle) return item.draftTitle;
  const prTitle = item.branch ? prs?.branches[item.branch]?.title : undefined;
  if (prTitle) return prTitle;
  if (item.branch) return item.branch;
  if (item.jiraKey) return item.jiraKey;
  return 'New work';
}

function shortName(branch: string): string {
  return branch.replace(/^[^/]+\//, '');
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 3: graph — parentOf, kids, ancestors, rootOf, behind
// -------------------------------------------------------------------------------------------------

function buildParentOf(items: Item[], byId: Map<string, Item>, plan: AdePlan): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const item of items) {
    if (item.base !== '' && byId.has(item.base)) parentOf.set(item.id, item.base);
  }
  // Rule test 5: a stale `queuedAfter` naming a missing item (either side) is ignored, not thrown.
  for (const [id, after] of Object.entries(plan.queuedAfter)) {
    if (byId.has(id) && byId.has(after)) parentOf.set(id, after);
  }
  return parentOf;
}

function buildKids(items: Item[], parentOf: Map<string, string>): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const item of items) kids.set(item.id, []);
  for (const [child, parent] of parentOf) kids.get(parent)?.push(child);
  return kids;
}

function ancestorsOf(id: string, parentOf: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let p = parentOf.get(id);
  while (p !== undefined && !seen.has(p)) {
    out.push(p);
    seen.add(p);
    p = parentOf.get(p);
  }
  return out;
}

function rootOf(id: string, parentOf: Map<string, string>): string {
  const a = ancestorsOf(id, parentOf);
  return a.length ? (a[a.length - 1] as string) : id;
}

// §0.8: no mockup-style "just rebased, hide the behind count" optimism (`plan.rebased` has no wire
// counterpart — `rebasing`/`pushing` are Part 3's own opaque in-flight sets, nothing persisted) —
// `behind` is the branch's own raw fact, unconditionally.
function behindOf(id: string, byId: Map<string, Item>): number {
  return byId.get(id)?.behind ?? 0;
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 4: conflicts and shares from `pairs` (§0.3 — design wins over mockup's file overlap)
// -------------------------------------------------------------------------------------------------

interface ConflictEntry {
  with: string;
  files: string[];
}

function buildConflicts(
  byId: Map<string, Item>,
  pairs: readonly AdePair[],
): Map<string, ConflictEntry[]> {
  const out = new Map<string, ConflictEntry[]>();
  const push = (id: string, entry: ConflictEntry) => {
    const list = out.get(id);
    if (list) list.push(entry);
    else out.set(id, [entry]);
  };
  for (const p of pairs) {
    if (p.conflicts.length === 0) continue;
    const a = byId.get(p.a);
    const b = byId.get(p.b);
    if (!a || !b) continue;
    const [mine, review] =
      a.kind === 'mine' && b.kind === 'review'
        ? [a, b]
        : b.kind === 'mine' && a.kind === 'review'
          ? [b, a]
          : [null, null];
    if (!mine || !review || mine.merged) continue;
    push(mine.id, { with: review.id, files: p.conflicts });
    push(review.id, { with: mine.id, files: p.conflicts });
  }
  return out;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function buildSharedLookup(pairs: readonly AdePair[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of pairs) if (p.shared.length) out.set(pairKey(p.a, p.b), p.shared);
  return out;
}

function sharedFiles(lookup: Map<string, string[]>, a: string, b: string): string[] {
  return lookup.get(pairKey(a, b)) ?? [];
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 6: stacks — DFS over non-parked roots; lead = first mine member; parked = single stacks
// -------------------------------------------------------------------------------------------------

function buildStacks(
  items: Item[],
  byId: Map<string, Item>,
  parentOf: Map<string, string>,
  kids: Map<string, string[]>,
): QueueStack[] {
  const merging = items.filter((b) => b.kind !== 'parked');
  const stacks: QueueStack[] = [];
  for (const root of merging) {
    if (parentOf.has(root.id)) continue;
    const members: QueueStackMember[] = [];
    const walk = (id: string, dep: number): void => {
      members.push({ id, dep });
      for (const c of kids.get(id) ?? []) walk(c, dep + 1);
    };
    walk(root.id, 0);
    let lead: string | null = null;
    for (const m of members) {
      if (byId.get(m.id)?.kind === 'mine') {
        lead = m.id;
        break;
      }
    }
    stacks.push({ root: root.id, members, lead, parked: false });
  }
  for (const b of items) {
    if (b.kind === 'parked') {
      stacks.push({ root: b.id, members: [{ id: b.id, dep: 0 }], lead: b.id, parked: true });
    }
  }
  return stacks;
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 7: effDay
// -------------------------------------------------------------------------------------------------

function computeEffDay(
  items: Item[],
  byId: Map<string, Item>,
  parentOf: Map<string, string>,
  kids: Map<string, string[]>,
  planDay: Map<string, number | undefined>,
): Map<string, number> {
  const eff = new Map<string, number>();
  function effDay(id: string): number {
    const cached = eff.get(id);
    if (cached !== undefined) return cached;
    const item = byId.get(id) as Item;
    const parent = parentOf.get(id);
    const parentEff =
      parent === undefined
        ? -Infinity
        : byId.get(parent)?.kind === 'review'
          ? -Infinity
          : effDay(parent);
    const own = planDay.get(id);
    let v: number;
    if (item.kind === 'review') {
      const ks = (kids.get(id) ?? []).map((k) => effDay(k));
      v = ks.length ? Math.min(...ks) : LATER;
    } else if (own === undefined) {
      v = parentEff === -Infinity ? LATER : parentEff;
    } else {
      v = parentEff === LATER ? LATER : Math.max(own, parentEff);
    }
    eff.set(id, v);
    return v;
  }
  for (const item of items) effDay(item.id);
  return eff;
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 8/9: segments per effective day, then merge order (mineSegs/extSegs/seq/mergeN)
// -------------------------------------------------------------------------------------------------

interface Seg {
  stackRoot: string;
  root: string;
  members: QueueStackMember[];
  lead: string | null;
  day: number;
  days: number[];
  end: number;
  span: number;
  pos: number;
  idx: number;
  cont: boolean;
  parked: boolean;
  placed: boolean;
  after: { id: string; file: string } | null;
}

function estSpanOf(item: Item, workdayHours: number, spanDayShare: number): number {
  const e = parseEst(item.est, workdayHours, spanDayShare);
  return e ? e.days : 1;
}

/** The bucket's own lead (first non-review member, DFS order) and span (the widest non-review
 *  member's own estimate) — split out of `buildSegments`'s per-bucket closure to keep both under
 *  the lint's cognitive-complexity ceiling, no behavior change. */
function leadAndSpanOf(
  mm: readonly QueueStackMember[],
  byId: Map<string, Item>,
  workdayHours: number,
  spanDayShare: number,
): { lead: string | null; span: number } {
  let lead: string | null = null;
  let span = 1;
  for (const x of mm) {
    if (byId.get(x.id)?.kind === 'review') continue;
    if (lead === null) lead = x.id;
    span = Math.max(span, estSpanOf(byId.get(x.id) as Item, workdayHours, spanDayShare));
  }
  return { lead, span };
}

function segmentForBucket(
  st: QueueStack,
  d: number,
  si: number,
  mm: QueueStackMember[],
  byId: Map<string, Item>,
  planOrder: readonly string[],
  cal: Calendar,
  workdayHours: number,
  spanDayShare: number,
): Seg {
  const { lead, span } = leadAndSpanOf(mm, byId, workdayHours, spanDayShare);
  const days = d === LATER ? [LATER] : spanDays(cal, d, span);
  const p0 = lead ? planOrder.indexOf(lead) : -1;
  const ps = planOrder.indexOf(st.lead ?? '');
  const root = mm[0]?.id === st.root ? st.root : (mm[0] as QueueStackMember).id;
  return {
    stackRoot: st.root,
    root,
    members: mm,
    lead,
    day: d,
    days,
    end: days[days.length - 1] as number,
    span,
    parked: st.parked,
    idx: si,
    cont: si > 0,
    pos: p0 >= 0 ? p0 : ps >= 0 ? ps + 0.01 * si : 999 + si,
    placed: false,
    after: null,
  };
}

function buildSegments(
  stacks: QueueStack[],
  byId: Map<string, Item>,
  eff: Map<string, number>,
  planOrder: readonly string[],
  cal: Calendar,
  workdayHours: number,
  spanDayShare: number,
): Seg[] {
  const segs: Seg[] = [];
  for (const st of stacks) {
    const byDay = new Map<number, QueueStackMember[]>();
    const daysOrder: number[] = [];
    for (const x of st.members) {
      const d = eff.get(x.id) as number;
      let bucket = byDay.get(d);
      if (!bucket) {
        bucket = [];
        byDay.set(d, bucket);
        daysOrder.push(d);
      }
      bucket.push(x);
    }
    daysOrder.sort((a, b) => a - b);
    daysOrder.forEach((d, si) => {
      const mm = byDay.get(d) as QueueStackMember[];
      segs.push(segmentForBucket(st, d, si, mm, byId, planOrder, cal, workdayHours, spanDayShare));
    });
  }
  return segs;
}

function buildMergeOrder(
  segs: Seg[],
  byId: Map<string, Item>,
  conflicts: Map<string, ConflictEntry[]>,
): { seq: Seg[]; mergeN: Map<string, number> } {
  const mineSegs = segs.filter((g) => g.lead);
  const extSegs = segs.filter((g) => !g.lead);
  mineSegs.sort((a, b) => a.end - b.end || a.day - b.day || a.pos - b.pos);

  const seq: Seg[] = [];
  for (const g of mineSegs) {
    for (const o of extSegs) {
      if (o.placed) continue;
      const oConflicts = conflicts.get(o.root) ?? [];
      const hits = oConflicts.some((c) => g.members.some((x) => x.id === c.with));
      if (hits) {
        o.placed = true;
        o.day = g.day;
        o.end = g.end;
        o.days = [g.day];
        seq.push(o);
      }
    }
    seq.push(g);
  }
  for (const o of extSegs) {
    if (!o.placed) {
      o.placed = true;
      o.day = LATER;
      o.end = LATER;
      o.days = [LATER];
      seq.push(o);
    }
  }

  const mergeN = new Map<string, number>();
  let n = 0;
  for (const g of seq) {
    for (const x of g.members) {
      if (byId.get(x.id)?.kind === 'mine') mergeN.set(x.id, ++n);
    }
  }
  return { seq, mergeN };
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 10: `after` — nearest earlier segment of another stack sharing a mine×mine file
// -------------------------------------------------------------------------------------------------

/** Whether `other`'s own mine members share a file with `g`'s own mine members — one candidate
 *  segment's worth of the search, split out of `computeAfter` to keep its own complexity down. */
function afterHitIn(
  other: Seg,
  g: Seg,
  byId: Map<string, Item>,
  sharedLookup: Map<string, string[]>,
): { id: string; file: string } | null {
  for (const a of other.members) {
    const aItem = byId.get(a.id);
    if (aItem?.kind !== 'mine' || aItem.merged) continue;
    for (const b of g.members) {
      if (byId.get(b.id)?.kind !== 'mine') continue;
      const sh = sharedFiles(sharedLookup, a.id, b.id);
      if (sh.length) return { id: a.id, file: (sh[0] as string).split('/').pop() as string };
    }
  }
  return null;
}

function findAfterFor(
  g: Seg,
  seq: readonly Seg[],
  i: number,
  byId: Map<string, Item>,
  sharedLookup: Map<string, string[]>,
): { id: string; file: string } | null {
  for (let j = i - 1; j >= 0; j--) {
    const other = seq[j] as Seg;
    if (other.stackRoot === g.stackRoot) continue;
    const hit = afterHitIn(other, g, byId, sharedLookup);
    if (hit) return hit;
  }
  return null;
}

function computeAfter(
  seq: Seg[],
  byId: Map<string, Item>,
  sharedLookup: Map<string, string[]>,
): void {
  for (let i = 0; i < seq.length; i++) {
    const g = seq[i] as Seg;
    g.after = g.lead && !g.parked ? findAfterFor(g, seq, i, byId, sharedLookup) : null;
  }
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 12: work status and branch status (§0.5, no `ready`/`ciFailing` rung)
// -------------------------------------------------------------------------------------------------

interface StatusCtx {
  byId: Map<string, Item>;
  parentOf: Map<string, string>;
  conflicts: Map<string, ConflictEntry[]>;
  plan: AdePlan;
  rebasing: ReadonlySet<string>;
  pushing: ReadonlySet<string>;
}

function workStatus(id: string, ctx: StatusCtx): { label: string; tone: Tone } {
  const item = ctx.byId.get(id) as Item;
  if (item.merged) return { label: 'merged', tone: 'purple' };
  if (item.kind === 'parked') return { label: 'not merging', tone: 'grey' };
  if (item.kind === 'review') {
    return ctx.conflicts.get(id)?.length
      ? { label: 'conflict', tone: 'red' }
      : { label: 'review', tone: 'blue' };
  }
  if (item.draft) return { label: 'not started', tone: 'grey' };
  const root = rootOf(id, ctx.parentOf);
  if (ctx.rebasing.has(root)) return { label: 'rebasing', tone: 'amber' };
  if (ctx.pushing.has(id)) return { label: 'pushing', tone: 'amber' };
  if (ctx.conflicts.get(id)?.length) return { label: 'conflict', tone: 'red' };
  if (ctx.plan.unpushed[id]) return { label: 'not pushed', tone: 'amber' };
  if (ancestorsOf(id, ctx.parentOf).some((a) => ctx.conflicts.get(a)?.length)) {
    return { label: 'base conflict', tone: 'amber' };
  }
  const behind = behindOf(id, ctx.byId);
  if (behind > 0) return { label: `↓${behind} main`, tone: 'amber' };
  if (ancestorsOf(id, ctx.parentOf).some((a) => behindOf(a, ctx.byId) > 0)) {
    return { label: 'base behind', tone: 'amber' };
  }
  if (item.sessions.length === 0) return { label: 'new', tone: 'grey' };
  if (ctx.parentOf.has(id) && ctx.byId.get(rootOf(id, ctx.parentOf))?.kind === 'review') {
    return { label: 'waiting', tone: 'blue' };
  }
  return { label: 'up to date', tone: 'green' };
}

function branchStatusOf(id: string, ctx: StatusCtx): { label: string; tone: Tone } {
  const item = ctx.byId.get(id) as Item;
  if (item.draft) return { label: 'not created', tone: 'grey' };
  if (item.merged) return { label: 'merged', tone: 'purple' };
  const root = rootOf(id, ctx.parentOf);
  if (ctx.rebasing.has(root)) return { label: 'rebasing', tone: 'amber' };
  if (ctx.pushing.has(id)) return { label: 'pushing', tone: 'amber' };
  if (ctx.conflicts.get(id)?.length) return { label: 'conflict', tone: 'red' };
  if (ctx.plan.unpushed[id]) return { label: 'not pushed', tone: 'amber' };
  if (ancestorsOf(id, ctx.parentOf).some((a) => ctx.conflicts.get(a)?.length)) {
    return { label: 'base conflict', tone: 'amber' };
  }
  const behind = behindOf(id, ctx.byId);
  if (behind > 0) return { label: `↓${behind} behind`, tone: 'amber' };
  if (ancestorsOf(id, ctx.parentOf).some((a) => behindOf(a, ctx.byId) > 0)) {
    return { label: 'base behind', tone: 'amber' };
  }
  if (item.kind === 'review') return { label: 'read-only', tone: 'blue' };
  return { label: 'up to date', tone: 'green' };
}

// -------------------------------------------------------------------------------------------------
// §2.6 stages 13/14: stack tags/actions (mockup precedence) and per-row cells
// -------------------------------------------------------------------------------------------------

interface SegDerived {
  root: Item;
  busy: boolean;
  conf: { id: string; entry: ConflictEntry } | null;
  merged: boolean;
  rootBehind: number;
  rk: string;
}

/** The handful of per-segment facts every rung below reads at least once — computed once so each
 *  rung function stays a flat, independently-readable chain instead of one long cognitively-complex
 *  function (this split is purely a lint/readability move, no behavior change from one combined
 *  function — see the parity spec's own real coverage of every rung, unaffected by the split). */
function deriveSegState(
  g: Seg,
  byId: Map<string, Item>,
  conflicts: Map<string, ConflictEntry[]>,
  rebasing: ReadonlySet<string>,
): SegDerived {
  const root = byId.get(g.root) as Item;
  const busy = rebasing.size > 0;
  let conf: { id: string; entry: ConflictEntry } | null = null;
  for (const x of g.members) {
    const list = conflicts.get(x.id);
    if (list?.length) {
      conf = { id: x.id, entry: list[0] as ConflictEntry };
      break;
    }
  }
  const merged =
    g.members.every((x) => byId.get(x.id)?.merged || byId.get(x.id)?.kind === 'review') &&
    g.members.some((x) => byId.get(x.id)?.merged);
  const rootBehind = !g.cont && root.kind === 'mine' ? behindOf(g.root, byId) : 0;
  return { root, busy, conf, merged, rootBehind, rk: `${g.root}@${g.day}` };
}

type TagResult = { tag: QueueTag; action: QueueAction | null } | null;

/** Rungs 1-4: merged, parked, conflict, not-pushed, ripple. */
function tagForMergedParkedConflictRipple(
  g: Seg,
  plan: AdePlan,
  rippleRoots: Set<string>,
  pushing: ReadonlySet<string>,
  selectedTitle: string,
  byId: Map<string, Item>,
  d: SegDerived,
): TagResult {
  if (d.merged)
    return { tag: { label: '✓ merged', tone: 'purple', tip: 'landed on main' }, action: null };
  if (g.parked) {
    return {
      tag: {
        label: 'not merging',
        tone: 'grey',
        tip: 'kept out of the merge order; overlaps ignored',
      },
      action: null,
    };
  }
  if (d.conf) {
    const withItem = byId.get(d.conf.entry.with);
    const tip = `conflicts with ${withItem?.branch || d.conf.entry.with}: ${d.conf.entry.files.join(', ')}`;
    const action: QueueAction | null = g.lead
      ? {
          kind: 'queueAfter',
          label: 'Queue after',
          targetIds: [g.stackRoot, d.conf.entry.with],
          disabled: false,
          tip: '',
        }
      : null;
    return { tag: { label: '✕ conflict', tone: 'red', tip }, action };
  }
  const upIds = g.members.filter((x) => plan.unpushed[x.id]).map((x) => x.id);
  if (upIds.length) {
    return {
      tag: {
        label: '↑ not pushed',
        tone: 'amber',
        tip: 'rebased locally; the remote still has the old commits',
      },
      action: {
        kind: 'forcePush',
        label: pushing.size ? 'Pushing…' : 'Force push',
        targetIds: upIds,
        disabled: pushing.size > 0,
        tip: 'git push --force-with-lease',
      },
    };
  }
  if (rippleRoots.has(d.rk)) {
    return {
      tag: { label: '↻ rebases', tone: 'amber', tip: `rebase after ${selectedTitle} merges` },
      action: null,
    };
  }
  return null;
}

/** Rungs 5-7: behind main, shares-a-file-with-an-earlier-stack ("after"), continues-the-stack. */
function tagForBehindAfterCont(
  g: Seg,
  byId: Map<string, Item>,
  rebasing: ReadonlySet<string>,
  titleOfId: (id: string) => string,
  d: SegDerived,
): TagResult {
  if (d.rootBehind > 0) {
    return {
      tag: {
        label: `↓${d.rootBehind} main`,
        tone: 'amber',
        tip: `${d.rootBehind} commits behind main`,
      },
      action: {
        kind: 'rebase',
        label: rebasing.has(g.root) ? '…' : 'Rebase',
        targetIds: [g.root],
        disabled: d.busy,
        tip: '',
      },
    };
  }
  if (g.after) {
    const afterItem = byId.get(g.after.id);
    const tip = `shares ${g.after.file} with ${afterItem?.branch || g.after.id}; merges after it`;
    const tag: QueueTag = {
      label: `↻ ${shortName(afterItem?.branch ?? g.after.id)}`,
      tone: 'amber',
      tip,
    };
    // mockup line 1162: the block-level action label is plain 'Rebase' — 'Rebase onto X' is the
    // *selected-item detail panel's* own action label (line 1392, a different surface `useQueue`
    // doesn't port), not this one. The target is still carried via `targetIds` for the caller.
    const action: QueueAction | null =
      !g.cont && g.lead && d.root.kind === 'mine'
        ? {
            kind: 'rebase',
            label: rebasing.has(g.root) ? '…' : 'Rebase',
            // P129 Part 4 §0.9 fix: an `after` rebase names its own onto target, matching
            // `queueAfter`'s own `[root, with]` shape — was `[g.root]` alone, indistinguishable
            // from a rebase-onto-main action.
            targetIds: [g.root, g.after.id],
            disabled: d.busy,
            tip: '',
          }
        : null;
    return { tag, action };
  }
  if (g.cont) {
    return {
      tag: {
        label: '↳ stacked',
        tone: 'grey',
        tip: `continues the stack of ${titleOfId(g.stackRoot)}`,
      },
      action: null,
    };
  }
  return null;
}

function segmentTagAndAction(
  g: Seg,
  byId: Map<string, Item>,
  conflicts: Map<string, ConflictEntry[]>,
  plan: AdePlan,
  rippleRoots: Set<string>,
  rebasing: ReadonlySet<string>,
  pushing: ReadonlySet<string>,
  selectedTitle: string,
  titleOfId: (id: string) => string,
): { tag: QueueTag; action: QueueAction | null } {
  const d = deriveSegState(g, byId, conflicts, rebasing);
  const early = tagForMergedParkedConflictRipple(
    g,
    plan,
    rippleRoots,
    pushing,
    selectedTitle,
    byId,
    d,
  );
  if (early) return early;
  const mid = tagForBehindAfterCont(g, byId, rebasing, titleOfId, d);
  if (mid) return mid;
  if (d.root.kind === 'review' && g.lead) {
    return {
      tag: { label: `⏳ ${d.root.owner}`, tone: 'blue', tip: `based on ${d.root.branch}` },
      action: null,
    };
  }
  if (!g.lead) {
    return { tag: { label: 'unused', tone: 'grey', tip: 'nothing depends on it' }, action: null };
  }
  return {
    tag: { label: '✓ clean', tone: 'green', tip: 'no shared files with stacks above' },
    action: null,
  };
}

// mockup line 1080, verbatim.
const ARCHIVE_TIP =
  'Stop its agents, delete its worktree and hide it. The branch, notes and links are kept; it stays in history.';

function buildCells(
  g: Seg,
  byId: Map<string, Item>,
  eff: Map<string, number>,
  parentOf: Map<string, string>,
  cal: Calendar,
): QueueCell[] {
  const cells: QueueCell[] = g.members.map(() => ({
    tag: null,
    action: null,
    info: null,
    tip: '',
  }));
  g.members.forEach((x, i) => {
    const item = byId.get(x.id) as Item;
    if (item.merged) {
      if (i > 0)
        cells[i] = { ...(cells[i] as QueueCell), tag: { label: '✓ merged', tone: 'purple' } };
      cells[i] = {
        ...(cells[i] as QueueCell),
        action: { kind: 'archive', id: x.id, label: 'Archive', tip: ARCHIVE_TIP },
      };
    } else if (item.kind === 'mine' && item.sessions.length === 0) {
      cells[i] = {
        ...(cells[i] as QueueCell),
        action: {
          kind: 'start',
          id: x.id,
          label: '▶ Start',
          tip: item.draft
            ? 'Claude creates the branch and starts'
            : 'start Claude Code in its worktree',
        },
      };
    }
  });
  const infos: string[] = [];
  if (g.days.length > 1) infos.push(`${g.span}d → ${dayLabel(cal, g.end)}`);
  if (g.cont) {
    const parent = parentOf.get(g.members[0]?.id as string);
    if (parent !== undefined) infos.push(`from ${dayLabel(cal, eff.get(parent) as number)}`);
  }
  for (const c of cells) {
    if (infos.length && !c.action) c.info = infos.shift() as string;
  }
  return cells;
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 15: day totals and overflow
// -------------------------------------------------------------------------------------------------

function buildHoursOn(
  seq: Seg[],
  byId: Map<string, Item>,
  cal: Calendar,
  workdayHours: number,
  spanDayShare: number,
): Map<number, number> {
  const hoursOn = new Map<number, number>();
  for (const g of seq) {
    for (const x of g.members) {
      const item = byId.get(x.id) as Item;
      if (item.kind === 'review') continue;
      const e = parseEst(item.est, workdayHours, spanDayShare);
      if (!e) continue;
      if (e.days > 1 && g.day !== LATER) {
        for (const d of spanDays(cal, g.day, e.days)) {
          hoursOn.set(d, (hoursOn.get(d) ?? 0) + e.hours / e.days);
        }
      } else {
        hoursOn.set(g.day, (hoursOn.get(g.day) ?? 0) + e.hours);
      }
    }
  }
  return hoursOn;
}

function branchHoursOn(
  id: string,
  dk: number,
  byId: Map<string, Item>,
  eff: Map<string, number>,
  workdayHours: number,
  spanDayShare: number,
): number {
  const item = byId.get(id) as Item;
  const e = parseEst(item.est, workdayHours, spanDayShare);
  if (!e) return 0;
  return e.days > 1 ? e.hours / e.days : eff.get(id) === dk ? e.hours : 0;
}

// Capacity is always `workdayHours` (mockup's own `CAP = WORKDAY`, line 934) — one parameter, not
// two redundant ones.
function overflowOf(
  dk: number,
  hoursOn: Map<number, number>,
  seq: Seg[],
  byId: Map<string, Item>,
  eff: Map<string, number>,
  workdayHours: number,
  spanDayShare: number,
): string[] {
  const total = hoursOn.get(dk) ?? 0;
  if (dk === LATER || total <= workdayHours + 0.01) return [];
  const starts: string[] = [];
  for (const g of seq) {
    if (g.day !== dk) continue;
    for (const x of g.members) {
      const item = byId.get(x.id) as Item;
      if (item.kind === 'mine' && !item.merged) starts.push(x.id);
    }
  }
  const out: string[] = [];
  let over = total - workdayHours;
  for (let i = starts.length - 1; i >= 0 && over > 0.01; i--) {
    const id = starts[i] as string;
    out.unshift(id);
    over -= branchHoursOn(id, dk, byId, eff, workdayHours, spanDayShare);
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// §2.6 stage 16: bands
// -------------------------------------------------------------------------------------------------

// §0.5: the local day, not `Math.floor(archivedAtMs / DAY_MS)` (a UTC day) — in any non-UTC zone
// an evening archive would land on the wrong band. `localDayOf` is the caller's own zone read
// (`localDay.ts`'s `localIsoOfMs`); this module stays pure otherwise.
function historyDayOffset(
  archivedAtMs: number,
  cal: Calendar,
  localDayOf: (ms: number) => string,
): number {
  return isoToDays(localDayOf(archivedAtMs)) - cal.todayDays;
}

/** Non-review member ids of a list of segments (mockup `idsOf`, line 1275). */
function idsOfNonReview(segs: readonly Seg[], byId: Map<string, Item>): string[] {
  const out: string[] = [];
  for (const g of segs)
    for (const x of g.members) if (byId.get(x.id)?.kind !== 'review') out.push(x.id);
  return out;
}

interface DayFlags {
  isToday: boolean;
  isPast: boolean;
  isCalendarWeekend: boolean;
  isWorkedWeekend: boolean;
  weekend: boolean;
  dayOff: boolean;
  iso: string | null;
  isMonday: boolean;
  /** Next work day on/after `dk` (mockup `nextWork`), or `LATER` itself when `dk` is `LATER`. */
  nxt: number;
  nextWorkDay: number | null;
}

/** Calendar-derived per-day flags for `buildBands`'s own day closure — split out purely to keep
 *  that closure's own complexity down (same rationale as `deriveSegState` above), no behavior
 *  change from one combined function. */
function deriveDayFlags(cal: Calendar, dk: number, today: string): DayFlags {
  const isCalendarWeekend = dk !== LATER && isWeekend(cal, dk);
  const isWorkedWeekend = isCalendarWeekend && cal.workWeekend.has(dk);
  const nxt = dk === LATER ? LATER : nextWork(cal, dk);
  return {
    isToday: dk === 0,
    isPast: dk < 0,
    isCalendarWeekend,
    isWorkedWeekend,
    weekend: isCalendarWeekend && !isWorkedWeekend,
    dayOff: dk !== LATER && isDayOff(cal, dk),
    iso: dk === LATER ? null : offsetToIso(today, dk),
    isMonday: dk !== LATER && dateParts(cal, dk).dow === 1,
    nxt,
    nextWorkDay: dk === LATER ? null : nxt,
  };
}

/** `dayLabel` plus the month suffix on a month boundary — returns the tracker's next value rather
 *  than mutating it, since the tracker lives in `buildBands`'s own closure. */
function dayLabelWithMonth(
  cal: Calendar,
  dk: number,
  prevMonth: number | null,
): { label: string; month: number | null } {
  const label = dayLabel(cal, dk);
  if (dk !== LATER && dk !== 0) {
    const p = dateParts(cal, dk);
    const suffixed =
      prevMonth !== null && p.month !== prevMonth ? `${label} ${MO[p.month]}` : label;
    return { label: suffixed, month: p.month };
  }
  if (dk === 0) return { label, month: dateParts(cal, 0).month };
  return { label, month: prevMonth };
}

/** Continuation rows landing on `dk` (mockup 1245-1259): day `idx+1..n` of a multi-day segment. A
 *  multi-day span always has a real lead in practice (its own estimate parses off a `mine` item);
 *  guarded rather than assumed, unlike the mockup's own unchecked `by[g.lead]`. */
function spansForDay(
  seq: readonly Seg[],
  dk: number,
  snapshot: AdeRepoSnapshot,
  titleOfId: (id: string) => string,
  cal: Calendar,
): QueueSpan[] {
  const spans: QueueSpan[] = [];
  for (const g of seq) {
    if (g.days.length < 2 || !g.lead) continue;
    const idx = g.days.indexOf(dk);
    if (idx <= 0) continue;
    const isEnd = idx === g.days.length - 1;
    const colorIndex = snapshot.colors[g.lead] ?? 0;
    spans.push({
      lead: g.lead,
      title: titleOfId(g.lead),
      color: PALETTE[colorIndex % PALETTE.length] as string,
      note: `day ${idx + 1}/${g.days.length}${isEnd ? ' · merges' : ''}`,
      isEnd,
      tip: `continues from ${dayLabel(cal, g.day)}; click to open`,
      startDay: g.day,
    });
  }
  return spans;
}

interface DayOverdueOverflow {
  overdue: Seg[];
  overflow: string[];
  overflowMoveLabel: string;
}

/** Overdue stacks and overflow ids for one day, plus the overflow's own move-label text. */
function overdueOverflowFor(
  dk: number,
  isPast: boolean,
  onThisDay: readonly Seg[],
  hoursOn: Map<number, number>,
  seq: Seg[],
  byId: Map<string, Item>,
  eff: Map<string, number>,
  workdayHours: number,
  spanDayShare: number,
  cal: Calendar,
  nxt: number,
  titleOfId: (id: string) => string,
): DayOverdueOverflow {
  const overdue = isPast
    ? onThisDay.filter((g) => g.lead && g.end < 0 && !g.members.some((x) => byId.get(x.id)?.merged))
    : [];
  const overflow = !isPast
    ? overflowOf(dk, hoursOn, seq, byId, eff, workdayHours, spanDayShare)
    : [];
  const overflowMoveLabel =
    overflow.length > 0
      ? `Move to ${dayLabel(cal, nxt)} · ${overflow.length === 1 ? titleOfId(overflow[0] as string) : `${overflow.length} branches`}`
      : '';
  return { overdue, overflow, overflowMoveLabel };
}

function buildBands(
  seq: Seg[],
  byId: Map<string, Item>,
  eff: Map<string, number>,
  cal: Calendar,
  snapshot: AdeRepoSnapshot,
  settings: Settings['ade'],
  hoursOn: Map<number, number>,
  workdayHours: number,
  spanDayShare: number,
  localDayOf: (ms: number) => string,
  titleOfId: (id: string) => string,
  today: string,
  historyOpen: boolean,
  historyReach: number,
): { bands: QueueBand[]; historyCount: number; focusDay: number } {
  const keys = new Set<number>();
  // §0.4: history band keys exist only while open (mockup 1234) — `historyReach`, not
  // `settings.historyDays`, since a "Go to date" navigation can grow it at runtime (§0.9).
  if (historyOpen) for (let h = -historyReach; h < 0; h++) keys.add(h);
  for (let k = 0; k < settings.horizonDays; k++) keys.add(k);
  for (const g of seq) for (const d of g.days) if (d !== LATER) keys.add(d);
  for (const off of cal.offDays) keys.add(off);
  // extraDays converted the same way as offDays/workWeekend (§0.6).
  for (const iso of settings.extraDays) keys.add(isoToDays(iso) - cal.todayDays);

  const dayKeys = [...keys].sort((a, b) => a - b);
  dayKeys.push(LATER);

  const historyByDay = new Map<number, { title: string; branch: string; how: string }[]>();
  for (const h of snapshot.history) {
    const d = historyDayOffset(h.archivedAt, cal, localDayOf);
    const how = h.mergedAt != null ? 'merged · archived' : 'archived';
    const list = historyByDay.get(d);
    const entry = { title: h.title, branch: h.branch, how };
    if (list) list.push(entry);
    else historyByDay.set(d, [entry]);
  }
  // §0.4: `historyCount` (mockup `histCount`, line 1303) is unconditional on `historyOpen`.
  const historyCount = snapshot.history.filter((h) => {
    const d = historyDayOffset(h.archivedAt, cal, localDayOf);
    return d >= -settings.historyDays && d <= 0;
  }).length;

  let prevMonth: number | null = null;
  let focusDay = 0;
  const bands = dayKeys.map((dk) => {
    const hrs = Math.round((hoursOn.get(dk) ?? 0) * 10) / 10;
    const flags = deriveDayFlags(cal, dk, today);
    const { label, month } = dayLabelWithMonth(cal, dk, prevMonth);
    prevMonth = month;

    const onThisDay = seq.filter((g) => g.day === dk);
    const { overdue, overflow, overflowMoveLabel } = overdueOverflowFor(
      dk,
      flags.isPast,
      onThisDay,
      hoursOn,
      seq,
      byId,
      eff,
      workdayHours,
      spanDayShare,
      cal,
      flags.nxt,
      titleOfId,
    );
    const spans = spansForDay(seq, dk, snapshot, titleOfId, cal);

    const isEmpty =
      onThisDay.length === 0 && spans.length === 0 && (historyByDay.get(dk)?.length ?? 0) === 0;
    if (flags.isPast && onThisDay.length > 0 && focusDay === 0) focusDay = dk;

    const startSegs = onThisDay.filter((g) => g.lead);

    return {
      day: dk,
      label,
      isLater: dk === LATER,
      isToday: flags.isToday,
      isPast: flags.isPast,
      isWeekend: flags.weekend,
      isDayOff: flags.dayOff,
      hours: hrs,
      capacity: workdayHours,
      isOverflow: overflow.length > 0 && !flags.weekend && !flags.dayOff,
      overflowIds: overflow,
      overflowMoveDay: overflow.length > 0 ? flags.nxt : null,
      isOverdue: overdue.length > 0,
      overdueStackCount: overdue.length,
      history: historyOpen ? (historyByDay.get(dk) ?? []) : [],
      iso: flags.iso,
      isMonday: flags.isMonday,
      isCalendarWeekend: flags.isCalendarWeekend,
      isWorkedWeekend: flags.isWorkedWeekend,
      isEmpty,
      longLabel: dayLong(flags.iso, today),
      overdueIds: idsOfNonReview(overdue, byId),
      startIds: idsOfNonReview(startSegs, byId),
      nextWorkDay: flags.nextWorkDay,
      nextWorkLabel: flags.nextWorkDay === null ? '' : dayLabel(cal, flags.nextWorkDay),
      nextWorkLong:
        flags.nextWorkDay === null ? '' : dayLong(offsetToIso(today, flags.nextWorkDay), today),
      overflowMoveLabel,
      spans,
    };
  });

  return { bands, historyCount, focusDay };
}

// -------------------------------------------------------------------------------------------------
// useQueue
// -------------------------------------------------------------------------------------------------

export function useQueue(input: QueueInput): QueueView {
  const { snapshot, prs, settings } = input;
  const rebasing = input.rebasing ?? new Set<string>();
  const pushing = input.pushing ?? new Set<string>();
  const workdayHours = settings.workdayHours;
  const spanDayShare = settings.spanDayShare;

  const items = buildItems(snapshot, input.sessions);
  const byId = new Map(items.map((i) => [i.id, i] as const));

  const titleById = new Map(items.map((i) => [i.id, titleOf(i, prs)] as const));
  const titleOfId = (id: string): string => titleById.get(id) ?? id;

  const parentOf = buildParentOf(items, byId, snapshot.plan);
  const kids = buildKids(items, parentOf);

  const conflicts = buildConflicts(byId, snapshot.pairs);
  const sharedLookup = buildSharedLookup(snapshot.pairs);

  const cal = buildCalendar(input.today, settings);
  const planDay = new Map(
    items.map((i) => [i.id, planDayOffset(cal, snapshot.plan.day[i.id])] as const),
  );

  const stacks = buildStacks(items, byId, parentOf, kids);
  const eff = computeEffDay(items, byId, parentOf, kids, planDay);

  const segsRaw = buildSegments(
    stacks,
    byId,
    eff,
    snapshot.plan.order,
    cal,
    workdayHours,
    spanDayShare,
  );
  const { seq, mergeN } = buildMergeOrder(segsRaw, byId, conflicts);
  computeAfter(seq, byId, sharedLookup);

  // §2.6 stage 11: selection, ripple, atRisk.
  let selectedId: string | null = input.selectedId ?? null;
  if (selectedId === null || !byId.has(selectedId)) {
    selectedId = items.length ? (items[0] as Item).id : null;
  }
  const ripple: string[] = [];
  if (selectedId !== null) {
    const down = (id: string): void => {
      for (const c of kids.get(id) ?? []) {
        if (byId.get(c)?.kind === 'mine') {
          ripple.push(c);
          down(c);
        }
      }
    };
    down(selectedId);
  }
  const rippleRoots = new Set<string>();
  for (const g of seq) {
    if (g.after && g.after.id === selectedId) {
      rippleRoots.add(`${g.root}@${g.day}`);
      for (const x of g.members) {
        if (byId.get(x.id)?.kind === 'mine' && !ripple.includes(x.id)) ripple.push(x.id);
      }
    }
  }
  const selectedItem = selectedId !== null ? byId.get(selectedId) : undefined;
  const atRisk: QueueAtRisk | null =
    selectedItem && !selectedItem.draft && selectedItem.kind !== 'review'
      ? (() => {
          const dirty = [...selectedItem.dirty];
          const unmerged = selectedItem.merged ? 0 : selectedItem.ahead;
          return dirty.length || unmerged ? { dirty, unmerged } : null;
        })()
      : null;

  const statusCtx: StatusCtx = {
    byId,
    parentOf,
    conflicts,
    plan: snapshot.plan,
    rebasing,
    pushing,
  };
  const selectedTitle = selectedId !== null ? titleOfId(selectedId) : '';

  // §2.6 stages 13/14, assembled per segment (in `seq` order).
  const segments: QueueSegment[] = seq.map((g) => {
    const { tag, action } = segmentTagAndAction(
      g,
      byId,
      conflicts,
      snapshot.plan,
      rippleRoots,
      rebasing,
      pushing,
      selectedTitle,
      titleOfId,
    );
    const cells = buildCells(g, byId, eff, parentOf, cal);
    const infos: string[] = [];
    if (g.days.length > 1) infos.push(`${g.span}d → ${dayLabel(cal, g.end)}`);
    if (g.cont) {
      const parent = parentOf.get(g.members[0]?.id as string);
      if (parent !== undefined) infos.push(`from ${dayLabel(cal, eff.get(parent) as number)}`);
    }
    const finalTag =
      infos.length && !cells.some((c) => c.info)
        ? { ...tag, tip: `${tag.tip} · ${infos.join(' · ')}` }
        : tag;
    // §0.4: every cell gets the segment's own final tag tip (mockup 1175).
    const taggedCells = cells.map((c) => ({ ...c, tip: finalTag.tip }));
    const segMergeN: Record<string, number> = {};
    for (const x of g.members) {
      const n = mergeN.get(x.id);
      if (n !== undefined) segMergeN[x.id] = n;
    }
    const dragIds = g.members.filter((x) => byId.get(x.id)?.kind !== 'review').map((x) => x.id);
    return {
      stackRoot: g.stackRoot,
      root: g.root,
      members: g.members,
      lead: g.lead,
      day: g.day,
      days: g.days,
      end: g.end,
      span: g.span,
      pos: g.pos,
      idx: g.idx,
      cont: g.cont,
      parked: g.parked,
      after: g.after,
      tag: finalTag,
      action,
      mergeN: segMergeN,
      cells: taggedCells,
      dragIds,
    };
  });

  const hoursOn = buildHoursOn(seq, byId, cal, workdayHours, spanDayShare);
  const historyOpen = input.historyOpen ?? false;
  const historyReach = input.historyReach ?? settings.historyDays;
  const { bands, historyCount, focusDay } = buildBands(
    seq,
    byId,
    eff,
    cal,
    snapshot,
    settings,
    hoursOn,
    workdayHours,
    spanDayShare,
    input.localDayOf,
    titleOfId,
    input.today,
    historyOpen,
    historyReach,
  );
  const firstWorkDay = firstWork(cal, 0);

  // §2.6 stage 17.
  const mineB = seq.filter((g) => g.lead);
  const behindRoots = mineB
    .filter(
      (g) =>
        !g.parked &&
        !g.cont &&
        byId.get(g.root)?.kind === 'mine' &&
        behindOf(g.root, byId) > 0 &&
        !byId.get(g.root)?.merged,
    )
    .map((g) => g.root);

  // §2.6 stage 1/2: final item view, computed once everything above (title/status/graph) exists.
  const queueItems: QueueItem[] = items.map((item) => {
    const title = titleOfId(item.id);
    const parent = parentOf.get(item.id);
    const parentBranch = parent !== undefined ? (byId.get(parent)?.branch ?? 'main') : 'main';
    const branchText = item.draft
      ? `no branch yet · from ${parentBranch}`
      : title === item.branch
        ? ''
        : item.branch;
    const colorIndex = snapshot.colors[item.id] ?? 0;
    const acts = [...item.sessions]
      .map((s) => activityKind(s, input.activity))
      .sort((a, b) => actRank(a) - actRank(b));
    // §0.4: running sessions only (mockup `running(b)`), sorted the same way `acts` is.
    const agents = item.sessions
      .filter((s) => s.state === 'running')
      .map((s) => ({
        sessionId: s.id,
        label: sessionLabel(s),
        kind: activityKind(s, input.activity),
        lastActiveAt: s.lastActiveAt,
      }))
      .sort((a, b) => actRank(a.kind) - actRank(b.kind));
    return {
      id: item.id,
      kind: item.kind,
      draft: item.draft,
      title,
      branch: item.branch,
      branchText,
      color: PALETTE[colorIndex % PALETTE.length] as string,
      status: workStatus(item.id, statusCtx),
      branchStatus: branchStatusOf(item.id, statusCtx),
      acts,
      estimate: parseEst(item.est, workdayHours, spanDayShare),
      agents,
      owner: item.owner,
    };
  });

  return {
    items: queueItems,
    stacks,
    segments,
    bands,
    selectedId,
    ripple,
    atRisk,
    behindRoots,
    parentOf: Object.fromEntries(parentOf),
    kids: Object.fromEntries([...kids].map(([k, v]) => [k, [...v]])),
    historyCount,
    focusDay,
    firstWorkDay,
    effDay: Object.fromEntries(eff),
  };
}

// -------------------------------------------------------------------------------------------------
// P129 Part 4 §0.3/§0.9: `dayLong`, the dialog templates' own day label (mockup line 946)
// -------------------------------------------------------------------------------------------------

/** `null` (Later, §0.6) -> `'Later'`; else `WD DATE MO`, `'Today, '`-prefixed when `iso === today`. */
export function dayLong(iso: string | null, today: string): string {
  if (iso === null) return 'Later';
  const days = isoToDays(iso);
  const { month0, date } = civilFromDays(days);
  const dow = ((((days % 7) + 7) % 7) + 4) % 7; // 1970-01-01 (day 0) was a Thursday (index 4).
  return `${iso === today ? 'Today, ' : ''}${WD[dow]} ${date} ${MO[month0]}`;
}

function actRank(a: ActivityKind): number {
  switch (a) {
    case 'input':
      return 0;
    case 'working':
      return 1;
    case 'waiting':
      return 2;
    case 'idle':
      return 3;
    default:
      return 4;
  }
}
