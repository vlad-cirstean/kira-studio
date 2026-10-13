-- Makes the per-model row count and stamp of memory_embeddings an index-only read. Without it each
-- search counted the table, whose rows carry the vector blobs.
CREATE INDEX memory_embeddings_model ON memory_embeddings(model);
