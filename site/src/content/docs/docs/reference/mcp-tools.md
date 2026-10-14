---
title: MCP tools
description: Every tool each Kira MCP server offers, with its arguments.
sources:
  - internal/llmprompts/registry.go
  - internal/memory/mcpserver
  - apps/kira-studio/internal/dbmcp/server.go
  - internal/claudeheadless
  - internal/mcpinstall
sidebar:
  order: 3
---

Tool descriptions are editable defaults. See [Prompts](../prompts/).

## kira-memory (Kira Space)

Registered in your Claude Code user scope from `Settings > Memory`. Claude Code starts it per session over stdio. See [Memory](../../space/memory/).

### store_memory

Store facts. The store splits independent claims into separate facts. A list about one subject stays one fact. It rewords each fact and updates a matching fact in the same scope, unless the stored one has a higher origin. An unclear item or weak reason is challenged: nothing is stored and questions come back.

- `items`: 1 to 20 items. Each has `fact`, `reason`, `origin` (user, agent or external), `scope` (company, project or personal), plus `sourceTag` for external and `project` for project scope.
- `clarifications`: question and answer pairs for an earlier challenge.
- `session`: a Claude Code session id. Defaults to the current session.
- `groups`: up to 5 groups of kind task, document or thread, each with `key` and optional `title`.
- `asComment`: a path or extension. Stores nothing and returns the facts as a code comment.

### search_memories

Search by words and meaning, best first.

- `query`: free text.
- `includeHistory`: also return older versions.
- `limit`: default 40, maximum 200.
- `scopes`, `origins`: filters.
- `project`: a project key whose facts rank first.

### memory_history

Every version of one memory, oldest first. Argument: `id`.

### memory_context

The facts stored with one fact, per group, newest first. Arguments: `id`, `limit` (default 20, maximum 100).

### ingest_files

Store the facts of files and folders by path, in the background. Send absolute paths, never content.

- `paths`: 1 to 100 paths.
- `origin`, `sourceTag`, `scope`, `project`: as in `store_memory`.
- `groups`: up to 4 groups of kind task or thread.
- `writeDoc`: also write `<name>.memory.md` beside each file. Default false.
- `session`: a Claude Code session id.

A large job waits for you to start it in Kira Space. So does a job holding a kira-memory doc whose header claims a higher origin, or another scope or project, than the job. A doc's header provenance wins on import, so you confirm it first.

### ingest_status

State of an ingest job. Argument: `id`, the job id from `ingest_files`.

### distill

Condense text or a file into short, atomic lines, in source order. Stores nothing and never touches the memory store, so no gate runs. To store a file, use `ingest_files`.

- `text`: the text, up to 120,000 characters. Give `text` or `path`, not both.
- `path`: an absolute file path.
- `mode`: `facts` (default) or `instructions`. `instructions` keeps each rule as a short imperative and keeps negations and numbers verbatim, for condensing prompts.

The result is the lines only, one per line. A call costs Claude tokens: large input is split into at most 16 parts, and the call stops at 2 USD. `distill` is not available to the agent an import runs.

### remember (prompt)

Run `/mcp__kira-memory__remember` to store durable facts from given text or the recent conversation. Argument: `text`.

## Database MCP server (Kira Studio)

Server name `kira-db`. See [Database MCP server](../../studio/database-mcp/).

- `list_connections`: every exposed connection with its kind, read-only flag, status, permissions and masked columns.
- `list_children`: the children of one container. Arguments: `connectionId`, `path`, `refresh`.
- `describe_table`: columns, primary key, foreign keys, indexes and row estimate. Arguments: `connectionId`, `path`, `refresh`.
- `describe_schema`: every table and view in one database or schema. Arguments: `connectionId`, `path`, `refresh`.
- `run_query`: one statement per call. Arguments: `connectionId`, `sql`, `path`, `maxRows` (default 200, maximum 2000).
- `explain_query`: a plan for one SELECT or WITH statement, without running it. Arguments: `connectionId`, `sql`, `path`, `includeRaw`. Not available on MongoDB, Redis, Kafka, S3 or SQS.

## Agent tools (Kira Space)

Server name `kira-ade`. `finish_step` is available to every agent run. The other tools need `kira_space_mcp: true` in the workflow. See [Agents](../../space/agents/).

- `finish_step`: report how a step ended. Call it once, last. Arguments: `status`, `summary`, `reason`, `conflictedFiles`, `lastGitError`, `tried`.
- `reply_review_comment`: answer one review comment. Only in a workflow review round. Call once per comment. Arguments: `id`, `reply`, `resolved`.
- `task_info`: the task, its workflow, stage, repositories and branches.
- `declare_repos`: add registered repositories to the task. Argument: `repos`, 1 to 20.
- `request_branch`: create a branch and its worktree. Arguments: `repo`, `name`.
- `branch_status`: the worktree and setup state of a branch. Arguments: `repo`, `waitSeconds` (0 to 600).
- `run_outcome`: how the latest runs of the task ended. Arguments: `runId`, `branch`, `kind`, `limit` (default 3, maximum 10).
- `git`: run restricted git in a named worktree. Used by rebase runs. Arguments: `worktree`, `args`.
