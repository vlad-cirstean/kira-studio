# P429 Part 2: Docker no credential reads

Plan for `docs/v0.2.24/SPEC.md` row P429, Part 2 (split rule: same number, no new row). Stream F, branch
`chapter/v0.2.24-stream-f`, worktree `/home/user/kira-worktrees/v0.2.24-stream-f`. Base: `d1fd65a81`
(`chapter/v0.2.24` tip, P429 iter2 landed). One sequential Sonnet implementer, no stream split.

Discovery: `codegraph_explore` (3 calls: `buildTLS`/`resolveEndpoint`/`currentContextName`/`endpointRemote`/
`listContexts`/`UseContext`/`osResolveEnv`; `Manager.client`/`resetLocked`/`notInstalled`/`endpoint_test`/
flowharness docker; toolexec/loginshell), then Read/Grep for `endpoint_test.go`, `go.mod`, module
cache sources (`go-connections@v0.8.1/tlsconfig`, `moby/moby/client@v0.5.1/client_options.go`,
`docker/cli@v29.8.2/cli/command/context/show.go`), `restore_tracker.go`, flow `TestContexts`, conventiontest G5.
Real CLI check: docker 29.9.2 `docker context show` (below).

## Ask

Binding user rule: Kira never reads tokens, keys or credentials of a CLI or library it drives. Secrets live only in
memory and only the owning library touches them. Make `internal/docker` comply. This moves the Docker half of v0.2.25
P443 into v0.2.24.

## Findings (current tree, `d1fd65a81`)

- `internal/docker/endpoint.go:157-178` `buildTLS`: Kira code does `os.ReadFile(t.ca)` (160) and
  `tls.LoadX509KeyPair(t.cert, t.key)` (171). Kira code opens and parses the client private key. Violation.
- `endpoint.go:113-128` `currentContextName`: after `DOCKER_CONTEXT`, reads the whole `<DOCKER_CONFIG>/config.json`
  (117) for `currentContext`. That file can hold `auths` (base64 user:password) and `credsStore`. Violation: the
  whole file lands in Kira memory.
- Callers of `currentContextName`: `resolveEndpoint` (254, only when `selected == ""` and no `DOCKER_HOST`) and
  `listContexts` (283, when `selected == ""`).
- `resolveEndpoint` callers: `Manager.client` (`manager.go:156`, under `m.mu`, result cached in `m.cli`),
  `Manager.endpointRemote` (`manager.go:196`, re-resolves on every restore-tracker tick while `m.cli == nil`, tick
  15 s, `restore.go:81`), `BoundService.UseContext` (`bound.go:145`, only with a non-empty name, so never reaches
  `currentContextName`). `listContexts` caller: `BoundService.Contexts` (`bound.go:135`).
- Non-secret reads stay, justified:
  - `readContext` (94-111) and `listContexts` (304) read `contexts/meta/<sha>/meta.json`: `Name`, `Description`,
    `Endpoints.docker.Host`, `SkipTLSVerify`. No key, token or password field exists in that file (docker/cli
    context store keeps TLS material in the separate `contexts/tls/` tree). Allowed by ARCHITECTURE "Non-secret
    config reads (host, `currentContext`) are allowed". Keep: listing via the file needs no CLI (Colima/OrbStack
    sockets work without one) and `UseContext` validation stays synchronous.
  - `contextTLS` (135-147) only `Stat`s `ca.pem`/`cert.pem`/`key.pem` and passes paths. `envTLS` (149-155) only
    joins paths. `notInstalled` (`manager.go:275-277`) only stats the config dir. No bytes read. Keep.
- `tlsconfig.Client` (`go-connections@v0.8.1/tlsconfig/config.go:208`) opens CA, cert and key itself
  (`certPool`, `getCert`) and returns `*tls.Config`. It is the loader moby's own `client.WithTLSClientConfig`
  (`client_options.go:240`) and the docker CLI use. `WithTLSClientConfig` itself cannot be used: it has no
  `InsecureSkipVerify`, which context `SkipTLSVerify` and unset `DOCKER_TLS_VERIFY` need. So call `tlsconfig.Client`
  directly, keep Kira's `http.Client` wiring in `hostOpts` (205). Kira then passes paths only; the key bytes live
  only inside the library and the resulting `tls.Config`.
- `tlsconfig.Client` behavior vs today: skips the CA when `InsecureSkipVerify` (today loads it anyway, unused);
  `ExclusiveRootPools: true` matches today's `x509.NewCertPool()`; bad CA PEM errors ("failed to append
  certificates"), so `TestResolveEndpointTLSMaterial` (`endpoint_test.go:142-161`) still passes both cases
  (both run with skipVerify false); encrypted keys error (`errEncryptedKeyDeprecated`), same as
  `LoadX509KeyPair`. License: Apache-2.0 (`go-connections@v0.8.1/LICENSE`). `go.mod:91` lists it `// indirect`.
- `docker context show` (`cli/command/context/show.go`): prints `dockerCli.CurrentContext()`. Measured, docker
  29.9.2, temp `DOCKER_CONFIG`: fresh config prints `default`; after `context use p2` prints `p2`; with
  `DOCKER_HOST` set prints `default`; with `DOCKER_CONTEXT=default` prints `default`; a `currentContext` naming a
  missing context prints that name, exit 0 (Kira's `readContext` then fails "not found", same as today). 29 ms.
  The CLI honours `DOCKER_CONFIG` from the inherited env, so Kira never needs the file path.
- No registry auth path exists in production `internal/docker`. Flow harness (`apps/kira-studio/internal/flowharness/
  docker.go:47-66`) already asks the CLI (`docker context inspect --format`) and reads no auth. Unchanged.
- `internal/toolexec` (`RunIO`, `Locate`) is the house argv-only, bounded-output, process-group spawn. GUI launches
  on macOS have a minimal `PATH`, so `Locate` with absolute candidates is needed (precedent: every discovery package).
- UI: `packages/docker-ui` (`EndpointChip.vue`, `ContainerList.vue`, `testing/ui/dockerMock.ts`) consumes
  `Endpoint.Source`/`ContextInfo` only. Source values do not change. No frontend change, no UI spec change.
- Flow: `apps/kira-studio/internal/flows/dockerflow/streams_test.go:268` `TestContexts` writes a `meta.json`, sets
  `DOCKER_HOST` (harness), selects `flow-ctx`, then automatic. With `DOCKER_HOST` set, `currentContextName` is never
  consulted by `resolveEndpoint`; `listContexts` now gets `default` from the CLI (or `""` without one), so
  `default` stays current. Still passes unchanged.

## Decision: current context from the CLI

Replace the `config.json` read with `docker context show`, cached until the client is rebuilt.

- Order: `DOCKER_CONTEXT` env first (no spawn). Else run `docker context show`. CLI missing, timeout, non-zero exit,
  empty or multi-line output: `""`, so resolution falls through to the default socket and probe, as today without a
  config file.
- Why not the docker/cli `config` package: it parses the whole file, `auths` included, into Kira memory. The rule
  says only the owning tool touches it; the CLI subprocess is that tool. Why not keep the read and drop other keys:
  the file still enters Kira memory. Why not `context inspect`: prints more (TLS paths, host); `show` prints the
  name only.
- Behavior change, acceptable: with `DOCKER_HOST` set, `listContexts` marks `default` current. That matches the CLI
  (`docker context ls` does the same); today Kira marked the config's context.
- Cost: one 30 ms spawn per cache fill. Cache fills on first resolve and after each `resetLocked` (status refresh,
  `UseContext`, `dropFallbackClient`, shutdown). Restore-tracker ticks with `m.cli == nil` reuse the cache: no
  spawn per tick. Trade-off: an external `docker context use` shows in `Contexts()` after the next refresh, not
  instantly. The UI Refresh already calls `status(refresh=true)`.

## Changes

All in `internal/docker` plus `go.mod`. No other file.

### 1. `internal/docker/endpoint.go`

- `resolveEnv` (54-59): add field `Current currentContexter` (comment: "the docker CLI's current context; a seam
  for tests").
- New type near `resolveEnv`:

  ```go
  // currentContexter names the docker CLI's current context ("" when unknown) and forgets a cached answer.
  type currentContexter interface {
  	name() string
  	forget()
  }
  ```

- `osResolveEnv` (61-64): set `Current: &cliContext{home: home}`.
- New file `internal/docker/clicontext.go` holding `cliContext`:
  - fields `home string`, `mu sync.Mutex`, `known bool`, `value string`; plus seams `lookPath func(string)
    (string, error)`, `stat func(string) (os.FileInfo, error)`, `run func(ctx context.Context, path string,
    args []string) ([]byte, error)`, zero values meaning `exec.LookPath`, `os.Stat`,
    `toolexec.RunIO(ctx, path, args, "", os.Environ(), nil)`. Only add a seam the unit test (step 4) uses; drop
    the rest.
  - `name()`: lock; if `known` return `value`; else `toolexec.Locate(lookPath, stat, "docker", candidates)`,
    `context.WithTimeout(context.Background(), contextShowTimeout)` (`const contextShowTimeout = 3 * time.Second`),
    run `docker context show`, `strings.TrimSpace`, reject empty or containing `\n`; store, `known = true`.
    On any failure store `""` (still `known`), so a missing CLI costs one probe per cache fill.
  - `forget()`: lock, `known = false`.
  - candidates, absolute only: `/usr/local/bin/docker`, `/opt/homebrew/bin/docker`, `/usr/bin/docker`,
    `/Applications/Docker.app/Contents/Resources/bin/docker`, `<home>/.docker/bin/docker`,
    `<home>/.orbstack/bin/docker`, `<home>/.rd/bin/docker`.
  - Never log the output; it is a context name only, but keep the spawn silent like today's file read.
- `currentContextName` (113-128): body becomes `DOCKER_CONTEXT` check, then `if e.Current == nil { return "" }`,
  then `return e.Current.name()`. Drop the `os.ReadFile` and `json` decode.
- `buildTLS` (157-178): body becomes

  ```go
  cfg, err := tlsconfig.Client(tlsconfig.Options{
  	CAFile: t.ca, CertFile: t.cert, KeyFile: t.key,
  	InsecureSkipVerify: skipVerify, ExclusiveRootPools: true, MinVersion: tls.VersionTLS12,
  })
  if err != nil {
  	return nil, fmt.Errorf("docker TLS material: %w", err)
  }
  return cfg, nil
  ```

  Keep the `//nolint:gosec` reason on the `InsecureSkipVerify` line. Add a one-line comment: the library opens
  the PEMs; Kira passes paths only (CLI credentials rule).
- Imports: add `github.com/docker/go-connections/tlsconfig`; drop `crypto/x509` (no other use in this file);
  keep `encoding/json` (`readContext`, `listContexts`), `os` (`ReadDir`, `ReadFile` of `meta.json`).
- Comment at 240-241: "DOCKER_CONTEXT or config currentContext" becomes "DOCKER_CONTEXT or the CLI's current
  context".

### 2. `internal/docker/manager.go`

- `resetLocked` (169-175): after the `if m.cli != nil` block, `if m.env.Current != nil { m.env.Current.forget() }`.
  Must sit outside the `if`: `status(refresh)` after a failed resolve has `m.cli == nil` and must still re-ask.
- No other change. `client()` and `endpointRemote()` keep calling `resolveEndpoint`.

### 3. `go.mod`

- Move `github.com/docker/go-connections v0.8.1` from the indirect block (line 91) to the direct require block.
  Run `go mod tidy`; confirm `go.sum` unchanged or tidy-only.

### 4. Tests

- `internal/docker/endpoint_test.go`:
  - fixture (10-23): add field `cur string`; `resolveEnv()` sets `Current: fixedContext{&f.cur}` (or a closure
    type) whose `name()` returns `*cur` and `forget()` is a no-op.
  - `current` (44-46): set `f.cur = name` instead of writing `config.json`.
  - `TestResolveEndpointPrecedence` case names: "DOCKER_CONTEXT beats config" becomes "DOCKER_CONTEXT beats CLI
    context", "currentContext" becomes "CLI current context". Expectations unchanged.
  - `TestResolveEndpointTLSMaterial`, `TestListContexts`: unchanged; must pass.
- `cliContext` unit test (`internal/docker/clicontext_test.go`): earns its keep under CLAUDE.md's bar only for the
  cache rules (filled once, `forget` refills, failure caches `""`, multi-line rejected). One table test with a
  fake `run` counting calls. Skip anything else (no real-binary test).
- No flow test change (`TestContexts` verified above). No UI spec change (no frontend change).

## Checks

1. `go build ./...` and `go vet ./internal/docker/...`.
2. `go test -race ./internal/docker/...` (real-engine `TestEngine` skips without dockerd; start dockerd per
   `docs/DEV_ENVIRONMENT.md` "Docker" to run it, cheap here: docker 29.9.2 is installed).
3. Docker flow tests once, near the end: `go test -race ./apps/kira-studio/internal/flows/dockerflow/...` with
   dockerd up (`docs/DEV_ENVIRONMENT.md` "Studio Docker flow tests"). Rerun only failing specs after a fix.
4. `bun run lint:all` (includes `lint:go`, `lint:dead`) and the pre-commit hook clean, no `--no-verify`.
5. Acceptance greps, each must print nothing:
   - `grep -rn "LoadX509KeyPair\|X509KeyPair\|AppendCertsFromPEM" internal/docker --include=*.go`
   - `grep -rn "config.json" internal/docker --include=*.go` (test files included; the fixture no longer writes it)
   - `grep -rn "os.ReadFile" internal/docker/endpoint.go | grep -v meta.json` (only the two `meta.json` reads
     remain; confirm by reading the two hits)
   - Positive: `grep -n "tlsconfig.Client" internal/docker/endpoint.go` prints one line;
     `grep -n "go-connections" go.mod` shows no `// indirect`.
6. Optional real check, cheap (dockerd up): `DOCKER_CONFIG=$(mktemp -d)`, `docker context create p2 --docker
   host=unix:///var/run/docker.sock`, `docker context use p2`, unset `DOCKER_HOST`, then a throwaway
   `go test -run TestEngine` style call or `go run` snippet printing `NewManager(nil).status(...)` must show
   `Endpoint.Context == "p2"`, `Source == "context"`. Do not commit the snippet. Skip if TestEngine already
   covers the default socket only and the snippet costs more than 10 minutes.

## Commits

- `fix(docker): TLS material loaded by go-connections, not Kira` (step 1 `buildTLS`, step 3 go.mod).
- `fix(docker): current context from the docker CLI, never config.json` (steps 1 rest, 2, 4).
- Trailers per the implementer session's attribution reminder.

## After stream E lands (orchestrator or the implementer, once stream E is merged into `chapter/v0.2.24`)

Stream E edits `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/v0.2.24/SPEC.md`, `internal/conventiontest/
conventions_test.go` (G5) and `githost`/`issuetracker`. This plan touches none of them before that point. Overlap
risk: all four doc/guard files below; also `docs/v0.2.25/SPEC.md` (P443) if stream E edits it. Do these on top of
stream E's tip, re-reading each file first (line numbers below are at `d1fd65a81` and will move):

1. `docs/v0.2.24/SPEC.md`: under the P429 section (`### P429 ...`, line 68 at base) add a "Part 2: Docker no
   credential reads" line plus its Result (plan path, commits, check outcomes). Do not add a table row or a new
   P number.
2. `docs/ARCHITECTURE.md`:
   - Delete the Known open items entry "**Kira reads Docker TLS key material and config itself (CLI credentials
     rule violation).**" (line 3311 at base).
   - "CLI credentials: never touched" section (3045-3057): line 3056 becomes "Non-secret reads are allowed:
     docker context `meta.json` (name, host, SkipTLSVerify) and stat of PEM paths. Never a CLI config file that can
     hold credentials (`~/.docker/config.json`): ask the CLI (`docker context show`). Key material is opened only
     by the owning library (`go-connections/tlsconfig`)." Line 3057: drop `docker/endpoint.go` from the known
     violations, keep `usermcp.go`; add `internal/docker` to the G5 coverage line (3055).
   - Docker module line 2858: "DOCKER_CONTEXT/currentContext" becomes "DOCKER_CONTEXT, then `docker context show`
     (cached until the client is rebuilt)".
3. `docs/v0.2.25/SPEC.md` P443 (row line 16, section 72-77): narrow to claude MCP headers only. Row title
   "Remove CLI credential reads: claude MCP headers". Drop the two docker sub-bullets; in the G5 bullet drop
   `internal/docker` (covered by v0.2.24 P429 Part 2).
4. `internal/conventiontest/conventions_test.go` G5: extend to `internal/docker`. Do not reuse `credentialCall`
   there (it flags `os.Getenv`/`os.UserHomeDir`, which endpoint resolution legitimately needs for `DOCKER_HOST`,
   `DOCKER_CERT_PATH`, home sockets). Add `inDocker := dir == "internal/docker"` and a `dockerCredential`
   check that flags, in non-test files: selector calls `tls.LoadX509KeyPair`, `tls.X509KeyPair`,
   `(*x509.CertPool).AppendCertsFromPEM` (any `.AppendCertsFromPEM` selector), and any string literal containing
   `config.json`. Message: why + `g5Rule`. Confirm it passes on the fixed tree and fails if `buildTLS` is reverted
   (one local revert, not committed).
5. `CLAUDE.md`: no change needed unless stream E's rule bullet names Docker as an exception; if so, drop that.
6. Run `bun run lint:all` and `go test ./internal/conventiontest/...`; commit as `docs: P429 Part 2 result` and
   `test: G5 covers internal/docker`.

## Out of scope

- `internal/harness/claude/usermcp.go` MCP headers (stays v0.2.25 P443).
- Context listing through the CLI (`docker context ls`): `meta.json` is non-secret; no change.
- Flow harness `resolveDockerHost`: already CLI-driven.

## Result

- Commit `fix(docker): TLS material and current context via owning tools, no credential reads` (steps 1-4 in one commit; hook full-run because go.mod changed). New `internal/docker/clicontext.go` and `clicontext_test.go` (cache rules only).
- G5 extended: `dockerCredential` flags `LoadX509KeyPair`, `X509KeyPair`, `AppendCertsFromPEM` selectors and `config.json` literals in `internal/docker`. Proved: temporary `tls.LoadX509KeyPair` in `buildTLS` failed `TestGoConventions` with G5; removed.
- Greps empty: key/cert/PEM loaders and `config.json` under `internal/docker`. `tlsconfig.Client` present once; `go-connections` direct in `go.mod`.
- `go test -race ./internal/docker/...`, `./internal/conventiontest/...`, `./apps/kira-studio/internal/flows/dockerflow/...` pass (dockerd up).
- Not verified: optional real-CLI `context use` check (step 6) skipped.
- Stream E follow-up done: SPEC, ARCHITECTURE (open item removed, credentials section, resolution order), v0.2.25 P443 narrowed to claude MCP headers, CLAUDE.md rule line.
