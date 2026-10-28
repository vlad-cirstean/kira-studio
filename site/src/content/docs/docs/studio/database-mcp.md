---
title: Database MCP server
description: Let an AI client read your databases under rules you set.
sources:
  - README.md
  - apps/kira-studio/internal/dbmcp/server.go
  - apps/kira-studio/internal/dbmcp/tools.go
  - apps/kira-studio/frontend/src/state/settingsDomain.ts
  - internal/llmprompts/registry.go
  - docs/ARCHITECTURE.md
  - packages/theme/src/i18n/en.json
sidebar:
  order: 6
---

An optional local [MCP](https://modelcontextprotocol.io) server. An AI client lists, browses and queries your connections through the same path the SQL console uses.

The server is off by default. Turn it on with **Enable the database MCP server** in `Settings > Database MCP`.

## Access

- Loopback only, on port 8766.
- Its own bearer token. **Regenerate token** issues a new one.
- A port conflict stops the server. It never falls back to another port.
- Tool list: see [MCP tools](../../reference/mcp-tools/).

## Exposed connections

Deny by default. A connection stays invisible until you check it under **Exposed connections**.

## Permissions

Each exposed connection has three modes: read, write and DDL. Each mode is allow, deny or prompt.

| Mode | Default | Meaning of prompt | Applies to |
|---|---|---|---|
| Read | allow | you approve each statement | queries that read |
| Write | prompt | you approve each statement | inserts, updates, deletes |
| DDL | deny | you approve each statement | schema changes |

A statement the app cannot classify gets the strictest mode.

## Approvals

A prompt waits for you to approve the exact statement. The dialog names the connection and the statement class.

When auto-explain is on, a query estimated above your expensive-query threshold pauses for approval. The dialog shows the estimate and the threshold.

You can also review each query result before the AI client gets it. The app-wide switch is in Settings, under Database MCP. A connection's MCP tab can override it with Always or Never. A write has already run when its result shows, so withholding hides the result and does not undo the change.

## Masking

PII masking rules apply to results before the AI client sees them.
