---
title: Architecture
description: How Kira Studio and Kira Space are built, and where the code lives.
sources:
  - README.md
  - docs/ARCHITECTURE.md
  - apps/kira-studio/internal/adapters/adapter.go
sidebar:
  order: 1
---

The full current-state reference is [`docs/ARCHITECTURE.md`](https://github.com/vlad-cirstean/kira-studio/blob/main/docs/ARCHITECTURE.md) in the repository. This page is the short map.

## Process model

Each app is one native Go process built on Wails v3. It handles windowing, IPC, SQLite storage and, in Kira Studio, every database driver. There is no sidecar and no second runtime.

The Vue 3 frontend runs in the system WebView (WKWebView on macOS).

- Control calls go through generated Wails bindings.
- Result pages travel over a binary FlatBuffers data plane.

## Invariants

- The renderer never imports a database driver and never parses a wire protocol.
- The grid is virtualized in both axes. Long lists are virtualized too.
- Rows live in plain frozen structures, not in Vue reactivity.
- An operation over about 150 ms shows progress and a working stop button.
- Every database read goes through the cache layer.
- Bulk data is built and encoded once, in the process that owns the window.

## Adapters

Adapters are capability-driven. Each engine package declares its capabilities, and the UI reads them. To add an engine, add one package under `apps/kira-studio/internal/adapters/`. The UI stays unchanged.

Every adapter call runs behind a `recover()`. A panic fails one operation instead of the app.

## Repository layout

- `apps/kira-studio`: Kira Studio. Go backend in `internal/`, Vue frontend in `frontend/src`, tests.
- `apps/kira-space`: Kira Space.
- `internal`: Go shared by both apps.
- `packages`: TypeScript and Vue shared by both apps. They hold the workbench shell, theme, wire protocol, Api logic and git UI.
- `docs`: architecture, packaging, performance and the per-chapter records.
- `site`: this site.

## Git, agents and memory

Kira Space owns the git backend, the native code workspace, the agents module and the memory store. The git module runs inside the app: spawn discipline, porcelain parsing, paged log walk and pre-flight analysis.

Agents run Claude Code headless or in a terminal. Memory is a SQLite store with a keyword index and an optional local embedding model, served over MCP.
