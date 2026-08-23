import type { Db } from 'mongodb';

// Mongo has no .sql-file seeding path (0001/0002's format), so this is a JS/TS seed function
// instead — run once against the root connection by support/mongo.ts, mirroring what the SQL
// fixtures do for the two relational adapters.
//
// `widgets` mixes field shapes deliberately (string/number/bool/date/nested/array/null) so the
// document view and D9's literal parser both have something real to render/filter against; the
// fixed hex `_id`s (rather than fresh ObjectIds) make keyset-pagination assertions deterministic.
export const WIDGET_COUNT = 25;

function hexId(i: number): string {
  return `000000000000000000000${i.toString(16).padStart(3, '0')}`;
}

export async function seedMongo(db: Db): Promise<void> {
  const { ObjectId } = await import('bson');
  const widgets = db.collection('widgets');
  const docs = Array.from({ length: WIDGET_COUNT }, (_, i) => ({
    _id: new ObjectId(hexId(i)),
    name: `widget-${i}`,
    price: (i + 1) * 1.5,
    active: i % 2 === 0,
    createdAt: new Date(Date.UTC(2024, 0, i + 1)),
    tags: i % 3 === 0 ? ['red', 'small'] : ['blue'],
    meta: { weight: i, note: i % 5 === 0 ? null : `note-${i}` },
  }));
  await widgets.insertMany(docs);
  await widgets.createIndex({ name: 1 }, { unique: true });

  await db.collection('empty_collection').createIndex({ _id: 1 });
}
