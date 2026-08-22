import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const filterHistory = sqliteTable('filter_history', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  path: text('path').notNull(),
  whereText: text('where_text'),
  orderByJson: text('order_by_json'),
  usedAt: text('used_at').notNull(),
});
