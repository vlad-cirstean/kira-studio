# docs/v1.7/ — the v1.7 record

v1.6 shipped six independent phases across existing modules (`docs/v1.6/SPEC.md`, P60-P70). This
folder holds the next chapter: a genuinely new subsystem, a **local database MCP server** — list/
metadata/query tools, a permissions model configured per connection, PII anonymization filters
usable both over MCP and in the normal data viewer, and Faker exposed as an MCP tool. Like v1.5's
code-intelligence chapter (`docs/v1.5/SPEC.md`, C1-C14), every phase here builds one subsystem
rather than unrelated independent phases, so it takes its own fresh letter — `M` (MCP) — instead of
continuing v1.6's `P` numbering.

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward.
- **`mcp-repo-map-issues.md`** — every phase dogfoods the repo-map MCP server for its own
  implementation work and logs what it finds, continuing v1.5/v1.6's own practice.
