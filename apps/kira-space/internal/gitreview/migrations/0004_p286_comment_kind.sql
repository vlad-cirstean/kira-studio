ALTER TABLE review_comment ADD COLUMN kind TEXT NOT NULL DEFAULT 'change' CHECK (kind IN ('change', 'question'));
ALTER TABLE review_comment ADD COLUMN state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'addressed'));
ALTER TABLE review_comment ADD COLUMN reply TEXT NOT NULL DEFAULT '';
ALTER TABLE review_comment ADD COLUMN replied_at INTEGER;
ALTER TABLE review_comment ADD COLUMN sent_at INTEGER;
