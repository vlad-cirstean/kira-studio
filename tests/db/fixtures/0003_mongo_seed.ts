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

  // P27 §5/D22: a document well past DOCUMENT_TRUNCATE_BYTES (64 KB) on a multi-row page, so a
  // real read exercises the tree's raw-text fallback rather than a synthetic string.
  const oversizedNote = 'x'.repeat(100_000);
  await db.collection('oversized_widgets').insertOne({
    _id: new ObjectId(hexId(900)),
    name: 'giant-note',
    note: oversizedNote,
  });

  // P27 §5's two page-size-1000 tripwires (bounded DOM row count, no CodeMirror while nothing is
  // being edited) and the go-to-match scroll case need a page substantially larger than any single
  // fetch — plain, uniform documents are enough; nothing here needs realistic field variety.
  const bigHexId = (i: number) => `0000000000000000000${i.toString(16).padStart(5, '0')}`;
  const bigWidgets = Array.from({ length: 1200 }, (_, i) => ({
    _id: new ObjectId(bigHexId(i)),
    seq: i,
    label: `big-widget-${i}`,
  }));
  await db.collection('big_widgets').insertMany(bigWidgets);

  // P19 D17: a validated collection so the definition view's Validation section has both a
  // real $jsonSchema (rendered as a field table) and validationLevel/validationAction to show.
  await db.createCollection('validated_widgets', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['name', 'price'],
        properties: {
          name: { bsonType: 'string', description: 'must be a string and is required' },
          price: { bsonType: 'number', minimum: 0, description: 'must be a positive number' },
        },
      },
    },
    validationLevel: 'moderate',
    validationAction: 'warn',
  });
}
