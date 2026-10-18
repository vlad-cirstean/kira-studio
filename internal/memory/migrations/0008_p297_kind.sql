-- A memory is a fact or a rule. Fixed per version; existing rows are facts.
ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact', 'rule'));

DROP TRIGGER memories_immutable;
CREATE TRIGGER memories_immutable
BEFORE UPDATE OF id, lineage_id, version, fact, reason, keywords, origin, source_tag, scope, project, session_id,
  fact_hash, created_at, supersedes_id, kind ON memories
BEGIN SELECT RAISE(ABORT, 'memory values are immutable'); END;
