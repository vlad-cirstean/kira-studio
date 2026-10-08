-- One row per memory version (superseded versions too, for includeHistory), L2-normalised
-- little-endian float32. One model at a time: a model change overwrites rows. Writing a vector does
-- not bump memory_revision, since it changes no memory content.
CREATE TABLE memory_embeddings (
  seq        INTEGER PRIMARY KEY REFERENCES memories(seq),
  model      TEXT NOT NULL,
  vec        BLOB NOT NULL CHECK (length(vec) > 0 AND length(vec) % 4 = 0),
  created_at TEXT NOT NULL
);
