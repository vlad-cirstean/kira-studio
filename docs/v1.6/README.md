# docs/v1.6/ — the v1.6 record

v1.5 shipped code intelligence as one cohesive chapter (`docs/v1.5/SPEC.md`, C1-C14). This folder
holds the next chapter: six independent phases across existing modules — editor consolidation
(CodeMirror removed, Monaco everywhere), a dependency/runtime upgrade, a native git-blame widget, an
S3/Redis browse-panel rework, an unsigned-app update-availability banner, and foreign-key-preview
edit mode. Like v1.1/v1.2/v1.4, this chapter continues `P` numbering (`P60`+) rather than taking a
fresh letter, since these are unrelated phases rather than one subsystem. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward. None is written as part of this chapter's opening spec.
- **`mcp-repo-map-issues.md`** — every phase dogfoods the repo-map MCP server for its own
  implementation work and logs what it finds, continuing v1.5's own practice.
