# docs/v1.8/ — the v1.8 record

v1.7 shipped the database MCP server as one cohesive chapter (`docs/v1.7/SPEC.md`, M1-M8). This
folder holds the next chapter: misc fixes and polish across two existing modules — the API client
(incognito mode, input sizing) and the git module (graph rendering/perf, PR integration, diff
viewing, code review UX, settings placement, branches/stashes UX, blame, worktrees). Like v1.1/v1.2/
v1.4/v1.6, this chapter continues `P` numbering (`P71`+) rather than taking a fresh letter, since
these are unrelated phases rather than one subsystem. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward. None is written as part of this chapter's opening spec.
- **`mcp-repo-map-issues.md`** — every phase dogfoods the repo-map MCP server for its own
  implementation work and logs what it finds, continuing v1.7's own practice.
