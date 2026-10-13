---
title: Build and test
description: Requirements, scripts, hooks and test tiers for working on the code.
sources:
  - README.md
  - package.json
  - docs/ARCHITECTURE.md
  - docs/DEV_ENVIRONMENT.md
  - .githooks/pre-commit
sidebar:
  order: 2
---

## Requirements

- macOS 14 or later, Apple Silicon, with Xcode command-line tools.
- [Go](https://go.dev) 1.27 or newer, and the [Wails v3](https://v3.wails.io) CLI. `bun run setup` installs the version pinned in `go.mod`.
- [Bun](https://bun.sh): package manager, script runner and test runner. It is build tooling only.
- Optional: [Colima](https://github.com/abiosoft/colima) or another Docker-compatible daemon for database tests.

## Run and package

Run from the repository root:

```sh
bun run dev:studio       # native window with hot reload
bun run dev:space
bun run package:studio   # build and ad-hoc sign the .app and .dmg
bun run package:space
```

Each command installs dependencies first. A locally built app has not gone through the installer, so its first launch needs a Gatekeeper workaround. Right-click it and choose Open, or run `xattr -dr com.apple.quarantine` on the app.

`docs/PACKAGING.md` covers the bundle layout, releases and verification.

## Scripts by purpose

- Setup: `bun run setup` installs dependencies without building.
- Checks: `bun run lint` runs Biome, the repository's style guards and the docs style check. `bun run typecheck` covers every package. `bun run lint:dead` runs knip.
- Unit and Go: `bun run test:unit`, `bun run test:go`.
- UI: `bun run test:ui:studio`, `bun run test:ui:space`, `bun run test:ui:space-mobile`.
- Flow tests, which run the real app wiring on a temp home: `bun run test:flows:studio`, `bun run test:flows:space`. Add `:complete` for the slow permutations.
- Full stack: `bun run test:e2e-real:studio`, `bun run test:e2e-real:space`.
- Screenshots: `bun run screenshots` regenerates `screenshots/` from the built frontends.
- Site: `bun run site:dev` serves this site. `bun run site:check` builds it and checks its layout at phone and desktop widths.

## Hooks

`bun install` installs git hooks.

- `pre-commit` runs `bun run lint` and `bun run typecheck`.
- `pre-push` runs the Go build and the Go linters.

## Test tiers

- Unit tests cover plain TypeScript modules with fakes.
- UI tests run Playwright in WebKit against the built bundle.
- Flow tests boot the whole app in-process with real SQLite, git, HTTP, gRPC and Docker. The `claude` and `gh` CLIs are faked.
- A feature test splits at the IPC boundary. The same scenario runs once as a Go flow test and once as a UI spec, both reading one contract fixture.
- `e2e-real` keeps only what cannot split.
- Real-container adapter suites need Docker and skip without it.

## Real claude tests

Tests against the real `claude` CLI are opt-in and spend tokens. Never wire them into hooks or CI. Run `bun run test:claude`, `test:claude:space` or `test:claude:studio` after changing Claude integration code. `docs/DEV_ENVIRONMENT.md` maps changed paths to the matching command.

## Sandbox notes

`docs/DEV_ENVIRONMENT.md` covers building and testing inside a given sandbox. The presentation screenshots and site check have their own section there.
