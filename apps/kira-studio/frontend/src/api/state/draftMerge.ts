// P112 §6.5: VariableSetView.vue's and EnvironmentsView.vue's own `syncDrafts` used to wipe every
// draft — including a trailing/in-progress edit — on any change to the underlying rows list. That
// was harmless while the list only ever changed after this same window's own commit. Once a
// cross-window `api-data-changed` broadcast can refetch the same list mid-edit, wiping would erase
// text the user is actively typing — a regression this phase itself would introduce.
//
// The rule, extracted once so both views share it: for each incoming row, keep the existing draft
// only when it has changed since it was last seeded ("dirty against its seed") *and* it still
// differs from what the incoming row would produce — otherwise reseed from the incoming row. A row
// no longer present is dropped. After this window's own commit the draft equals the incoming row
// again, so it reseeds — today's behaviour, unchanged. A remote edit to an untouched row reseeds. A
// remote edit to a row the user is mid-edit on is kept.

export interface MergeDraftsOptions<TRow, TDraft> {
  /** The row's own stable id — matches drafts/seeds keys and incomingRows entries. */
  rowId: (row: TRow) => string;
  /** A fresh draft as it would be seeded from this row today (no pending edit). */
  toDraft: (row: TRow) => TDraft;
  /** Field-level equality — only the fields the row itself carries, not bookkeeping flags. */
  equalDraft: (a: TDraft, b: TDraft) => boolean;
}

export interface MergeDraftsResult<TDraft> {
  drafts: Record<string, TDraft>;
  seeds: Record<string, TDraft>;
  order: string[];
}

/** Pure — no store/ref access, so it is trivial to test the four interacting cases directly. */
export function mergeDrafts<TRow, TDraft>(
  seeds: Record<string, TDraft>,
  drafts: Record<string, TDraft>,
  incomingRows: TRow[],
  options: MergeDraftsOptions<TRow, TDraft>,
): MergeDraftsResult<TDraft> {
  const { rowId, toDraft, equalDraft } = options;
  const nextDrafts: Record<string, TDraft> = {};
  const nextSeeds: Record<string, TDraft> = {};

  for (const row of incomingRows) {
    const id = rowId(row);
    const incoming = toDraft(row);
    const draft = drafts[id];
    const seed = seeds[id];
    const dirtyAgainstSeed = draft !== undefined && seed !== undefined && !equalDraft(draft, seed);
    const stillDiffersFromIncoming = draft !== undefined && !equalDraft(draft, incoming);

    if (dirtyAgainstSeed && stillDiffersFromIncoming) {
      nextDrafts[id] = draft;
      nextSeeds[id] = seed as TDraft;
      continue;
    }
    nextDrafts[id] = incoming;
    nextSeeds[id] = incoming;
  }

  return { drafts: nextDrafts, seeds: nextSeeds, order: incomingRows.map(rowId) };
}

/** After this window's own successful commit of `sent`: reseeds that row's draft and seed from the
 *  refetched `incoming` draft, unless the user has edited the row again since (`equalEdit` over the
 *  full edit state, flags included). Without it a typed secret stays in the draft as plaintext and
 *  the row never reseeds again. Returns whether it reseeded. */
export function reseedCommitted<TDraft>(
  seeds: Record<string, TDraft>,
  drafts: Record<string, TDraft>,
  id: string,
  sent: TDraft,
  incoming: TDraft,
  equalEdit: (a: TDraft, b: TDraft) => boolean,
): boolean {
  const draft = drafts[id];
  if (draft === undefined || !equalEdit(draft, sent)) return false;
  drafts[id] = incoming;
  seeds[id] = incoming;
  return true;
}

/** Keeps the user's current order for ids still present and appends ids it lacks (a row added
 *  remotely while a drag held the order frozen); drops ids no longer present. */
export function reconcileOrder(order: readonly string[], ids: readonly string[]): string[] {
  const live = new Set(ids);
  const kept = order.filter((id) => live.has(id));
  const known = new Set(kept);
  return [...kept, ...ids.filter((id) => !known.has(id))];
}
