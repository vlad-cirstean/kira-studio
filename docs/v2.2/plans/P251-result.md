# P251 result

Done: Wails v3 `v3.0.0-beta.21` to `v3.0.0-beta.26`; `@wailsio/runtime` `3.0.0-beta.21` to `3.0.0-beta.26`; `wails3` CLI follows `go.mod` via `scripts/setup.sh`. Direct Sonnet implementation, no Opus plan (user override).

Version choice: latest is `beta.28` (2026-10-05) and `beta.27` (2026-10-01), both under 14 days old. `beta.26` (2026-09-25) is newest at least 14 days old.

Breaking changes: none hit. Release notes unreachable (GitHub access for `wailsapp/wails` denied in session); checked empirically instead. `go build ./...`, `go vet ./...`, `go build -tags server ./apps/...` clean with zero source changes. Every `application.Mac*` and `events.Mac.*` symbol used by darwin code exists in `beta.26`. Bindings regenerate clean (`sh scripts/setup.sh`): Studio 28 services/162 methods, Space unchanged shape.

Verification:
- Pass: go build, go vet, `-tags server` build, `bun run lint`, `lint:dead`, `typecheck`, `test:flows:studio`, `test:flows:space` (`exempt.txt` empty), e2e-real spot per app (Space `boot-real`, Studio `api-boot-real`).
- Studio UI (`ui` project): 374 passed, 2 failed under load (`sql-schema` D3, `tooltips` a11y); both pass rerun alone.
- Skipped (orchestrator instruction, load ~30, timing noise): `ui-timing` project (4 tests did not run after the load failures), Space UI suite, visual suites.
- Skipped: `GOOS=darwin go vet` and golangci-lint. Darwin vet needs cgo plus macOS SDK, not available on Linux (wails darwin files fail to build, also true before). No Go source changed, so lint has no target.
- A first full flows run showed one FAIL line under load; rerun passed all 26 packages.

Note: `bun install` in the worktree wrote through the `node_modules` symlink into `/home/user/kira-studio/node_modules`, so the shared copy now holds `@wailsio/runtime` `beta.26`.
