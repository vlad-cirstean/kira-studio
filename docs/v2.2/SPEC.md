# v2.2 SPEC

Branch `v2.0`. Max 2 concurrent streams. Stream A: P210 then P211 (memory, same subsystem). Stream B: P212.

| Phase | Title | Status |
|---|---|---|
| P210 | Memory embedding search: local embedding model (best quality under 500 MB RAM, less if possible), vectors in SQLite, hybrid with existing FTS recall-first search | Not started |
| P211 | Memory bulk import: pick file or folder; chunk to a Sonnet-friendly size; per-chunk clean-context agent extracts atomic facts; one final agent holding all chunk facts of the file adds memories through the MCP; progress and failure shown | Not started |
| P212 | Mobile agents web: local web server in Kira Space serving a read-only mobile-laid-out Vue agents module; first-load device approval in Kira Space like the git extension pairing; installable PWA | Not started |
| P213 | Requirements audit: verify every P210–P212 requirement is implemented | Not started |
| P214 | Code review (one Opus round) and fixes | Not started |

## Requirements (user's words, condensed)

- P210: search over embeddings too; SQLite; local model; best under 500 MB RAM, maybe less.
- P211: import lots of docs; select file or folder, import starts; each file chunked; chunk size suits Sonnet; step 1 extract atomic facts per chunk (agent with clean context each); step 2 one agent sees all chunks' facts of the file and adds memories via MCP so context of whole file is kept.
- P212: local web server serves mobile version of agents module; first load on phone must be allowed in Kira Space (like git extension); Vue, mobile layout, read-only for now; PWA so it runs outside browser.
