// P112 §6.5: mergeDrafts is the decision structure behind VariableSetView.vue's and
// EnvironmentsView.vue's own syncDrafts — CLAUDE.md's test bar admits a dedicated spec for exactly
// this: several interacting rules (dirty-against-seed, still-differs-from-incoming, drop-if-absent)
// that a plain visual read of the function body doesn't make obvious are all correct at once.
import { describe, expect, test } from 'bun:test';
import { mergeDrafts } from '../../frontend/src/api/state/draftMerge';

interface Row {
  id: string;
  name: string;
}

interface Draft {
  name: string;
}

function toDraft(row: Row): Draft {
  return { name: row.name };
}

function equalDraft(a: Draft, b: Draft): boolean {
  return a.name === b.name;
}

const options = { rowId: (row: Row) => row.id, toDraft, equalDraft };

describe('mergeDrafts', () => {
  test('own-commit reseed: a draft equal to the row this window itself just wrote reseeds', () => {
    // The draft was edited away from its seed ('Old' -> 'New'), and the incoming row now carries
    // that same 'New' value back (this window's own commit landing through the refetch) — the
    // draft no longer differs from incoming, so it reseeds rather than staying "kept" forever.
    const seeds = { a: { name: 'Old' } };
    const drafts = { a: { name: 'New' } };
    const incoming: Row[] = [{ id: 'a', name: 'New' }];

    const result = mergeDrafts(seeds, drafts, incoming, options);

    expect(result.drafts.a).toEqual({ name: 'New' });
    expect(result.seeds.a).toEqual({ name: 'New' });
  });

  test('untouched-row remote reseed: a draft unchanged since its seed follows a remote edit', () => {
    // The draft still equals its own seed (the user never touched it), so an unrelated remote
    // rename reseeds it to the new name.
    const seeds = { a: { name: 'Old' } };
    const drafts = { a: { name: 'Old' } };
    const incoming: Row[] = [{ id: 'a', name: 'Renamed remotely' }];

    const result = mergeDrafts(seeds, drafts, incoming, options);

    expect(result.drafts.a).toEqual({ name: 'Renamed remotely' });
    expect(result.seeds.a).toEqual({ name: 'Renamed remotely' });
  });

  test('dirty-row remote keep: an in-progress edit survives an unrelated remote change', () => {
    // The user is mid-edit ('Old' -> 'Typing…', never committed) when a remote change lands a
    // different name — the draft is dirty against its seed and still differs from incoming, so it
    // is kept untouched, seed included, rather than being overwritten mid-keystroke.
    const seeds = { a: { name: 'Old' } };
    const drafts = { a: { name: 'Typing…' } };
    const incoming: Row[] = [{ id: 'a', name: 'Renamed remotely' }];

    const result = mergeDrafts(seeds, drafts, incoming, options);

    expect(result.drafts.a).toEqual({ name: 'Typing…' });
    expect(result.seeds.a).toEqual({ name: 'Old' });
  });

  test('removed row dropped: a draft for a row no longer in the incoming list disappears', () => {
    const seeds = { a: { name: 'Old' }, b: { name: 'Gone' } };
    const drafts = { a: { name: 'Old' }, b: { name: 'Typing…' } };
    const incoming: Row[] = [{ id: 'a', name: 'Old' }];

    const result = mergeDrafts(seeds, drafts, incoming, options);

    expect(result.drafts).toEqual({ a: { name: 'Old' } });
    expect(result.seeds).toEqual({ a: { name: 'Old' } });
    expect(result.order).toEqual(['a']);
  });
});
