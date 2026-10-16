# v2.6 SPEC

Continues the one running `P` sequence from P294 (`CLAUDE.md`; v2.5 ends at P293). One feature
branch for the chapter: `v2.6`, cut from `v2.0`. Nothing is committed on `v2.0`.

Theme: test and CI speed. Rows run top to bottom, one at a time.

| Phase | Title | Status |
|---|---|---|
| P294 | Test and CI speed. Goal: cut PR CI wall time and local test time sharply; planner decides every deferred point. Evidence (PR #2 run 22, `.github/workflows/pr.yml`): critical path is `wails-linux-cli` (1.5 min) then `checks (Linux)` (4 min, `typecheck` alone 1 min 50 s) then `ui` and `container-tests` in parallel (10 min and 9 min); `ui` and `container-tests` `needs` all three check jobs, so they idle until lint, typecheck and macOS finish. `test:ui:studio` took ~8 min before failing, and the `ipc-frontend` and `visual` steps run serially after it in the same job. `container-tests`: `docker load` of the cached image tar ~80 s, Go tests ~5.5 min, `test:unit` 12 s. Every Linux job repeats `apt-get install` of GTK4/WebKitGTK (~30 s), `setup-go` (~20 s) and `bun install`. Scope (1) CI: remove needless `needs` edges so test jobs start at once; split `ipc-frontend` and `visual` into own jobs; shard Playwright (`--shard`) across runners; cache the apt packages, the Go build and test cache and the Playwright browsers; avoid the `docker load` tar (pull in parallel, or smaller images); share one setup via a composite action instead of copy-pasted steps (workflow edits go through `docs/pending-workflows/`, see `docs/DEV_ENVIRONMENT.md`). (2) Tests: measure per-spec and per-package duration (Playwright JSON reporter, `go test -json`), list the slowest, then fix causes: fixed sleeps and long timeouts, `retries`, serial `workers: 1` projects, per-test app/DB/container setup that can be shared, duplicate coverage between flow tests and UI specs, `-count` or `-race` overuse, Testcontainers started per test not per package. Split a fast default tier from the slow tier where a test cannot be made fast. (3) This box: check why local runs are slow (4 cores, 15 GB; Playwright `workers: '100%'`, Docker, `build:test:studio` rebuilt on every run, cold Go and bun caches, hooks running the whole suite) and fix or document in `docs/DEV_ENVIRONMENT.md`. Record before and after timings in the plan result. Decline nothing silently: name each rejected option and its reason. | Open |

## Process notes

- Opus plan under `plans/` first (with `codegraph_explore` discovery), then Sonnet implementation,
  per `CLAUDE.md`.
- Expensive suites run once near phase end; fixes land as follow-up commits.
