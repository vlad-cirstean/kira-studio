import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

// The migrations table is `ui_layout` (the `layout` name is taken by the shared domain type).
export const uiLayout = sqliteTable('ui_layout', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
