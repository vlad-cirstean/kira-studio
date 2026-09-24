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
