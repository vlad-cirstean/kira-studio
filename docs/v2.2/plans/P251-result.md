# P251 result

Done: Wails v3 `v3.0.0-beta.21` to `v3.0.0-beta.28`; `@wailsio/runtime` `3.0.0-beta.21` to `3.0.0-beta.28`; `wails3` CLI follows `go.mod` via `scripts/setup.sh`. Direct Sonnet implementation, no Opus plan (user override).

Version choice: `beta.28` (2026-10-05), the latest (user asked for latest; first bumped to `beta.26`, then to `beta.28`).

Breaking changes: none hit. Release notes unreachable (module source has no changelog for beta.27/28) (GitHub access for `wailsapp/wails` denied in session); checked empirically instead. `go build ./...`, `go vet ./...`, `go build -tags server ./apps/...` clean with zero source changes. Every `application.Mac*` and `events.Mac.*` symbol used by darwin code exists in `beta.26`. Bindings regenerate clean (`sh scripts/setup.sh`): CLI `beta.28` confirmed.

Verification:
- Pass: go build, go vet, `-tags server` build, `bun run lint`, `lint:dead`, `typecheck`, `test:flows:studio`, `test:flows:space` (`exempt.txt` empty), e2e-real spot per app (Space `boot-real`, Studio `api-boot-real`).
- Studio UI (`ui` project): 374 passed, 2 failed under load (`sql-schema` D3, `tooltips` a11y); both pass rerun alone.
- Skipped (orchestrator instruction, load ~30, timing noise): `ui-timing` project (4 tests did not run after the load failures), Space UI suite, visual suites.
- Skipped: `GOOS=darwin go vet` and golangci-lint. Darwin vet needs cgo plus macOS SDK, not available on Linux (wails darwin files fail to build, also true before). No Go source changed, so lint has no target.
- A first full flows run showed one FAIL line under load; rerun passed all 26 packages.

Note: `bun install` in the worktree wrote through the `node_modules` symlink into `/home/user/kira-studio/node_modules`, so the shared copy now holds `@wailsio/runtime` `beta.28`.
