-- P28 D12: the checkbox filter's set model replaces the rule list. No synthetic id and no
-- ordering: a set has neither, and the ordering the old table carried was never read (F8).
-- Existing rows are dropped, not migrated — there is no honest conversion from a glob/regex
-- pattern to a node identity (D12).
CREATE TABLE connection_tree_filters (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,           -- 'kind' | 'path'
  value         TEXT NOT NULL,
  PRIMARY KEY (connection_id, scope, value)
);
DROP TABLE connection_filters;
