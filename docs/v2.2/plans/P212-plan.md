# P212 plan: mobile agents web (read-only ADE PWA served by Kira Space)

SPEC row: "Mobile agents web: local web server in Kira Space serving a read-only mobile-laid-out Vue
agents module; first-load device approval in Kira Space like the git extension pairing; installable
PWA". Stream B of v2.2, worktree `/home/user/kira-v21-G`, branch `v2.1-stream-G`, base `8e7bd7dab`.

Paths repo-relative. `KS` = `apps/kira-space`, `KSF` = `apps/kira-space/frontend`, `ADE` =
`apps/kira-space/frontend/src/ade/v2`, `WB` = `packages/workbench/src`, `TH` = `packages/theme/src`.
Line numbers as of `8e7bd7dab`; re-read before editing.

Discovery ran through `codegraph_explore` against the main checkout's index (same commit; this
worktree has no `.codegraph/`). The implementer executes named changes from this plan and needs no
CodeGraph run. If it must discover something the plan does not name, it runs
`sh scripts/codegraph-setup.sh` in the worktree first and uses `codegraph_explore`.

## 1. Requirement checklist (user's words, expanded)

R1. Local web server inside Kira Space serving a mobile version of the agents (ADE) module.
R2. First load on a phone must be approved in Kira Space, same pattern as git extension pairing.
R3. Vue app, mobile layout, read-only: task board, task detail, stage/step status, session status,
    git status of branches, run/setup logs (the stored session transcripts that exist today).
R4. PWA: manifest, icons, service worker, installable outside the browser.
R5. Device list with revoke, token storage on phone, constant-time compare, rate limiting.
R6. LAN only, bind-address choice, secure context for the PWA.
R7. Enable/disable setting, port config, QR code for pairing.
R8. Live updates; defined offline behaviour.
R9. Tests (Playwright mobile viewport; unit only for complex logic) and docs.

## 2. What exists (discovery findings)

- Git pairing (`KS/internal/gitsock`): `pairing.go` `Broker` = FIFO `notify.PendingQueue`, 120s
  timeout from enqueue, 60s cooldown on Deny per client id, queue cap `maxQueueLen`,
  `notify.OrderedEmitter[PairingSnapshot]`, Approve mints a token via `tokenauth.Mint` keyed by
  request id (`TakeApprovedToken`), Deny purges same-client siblings, `Cancel` on requester
  disconnect, `ExpireOverdue` driven by `Server.expireLoop` (1s ticker), `Shutdown`.
  `handshake.go` `runHandshake`/`finishPairing`: row persisted before the token is sent;
  `verifyClientToken` does a dummy `verifyToken` on a missing row (uniform timing) and treats a
  store error as "close, no verdict" (F10). `token.go` wraps repo-root `internal/tokenauth`
  (32 random bytes, base64url, sha256(salt‖token) at rest, `subtle.ConstantTimeCompare`).
- Git pairing UI: `KSF/src/workbench/GitPairingDialog.vue` (always mounted in `App.vue`, uses
  `WB/util/usePendingDecision.ts`), store `KSF/src/state/gitClients.ts` (`hydrateThenSubscribe`),
  revoke list `KSF/src/workbench/settings/ConnectedEditorsPane.vue`, bridge
  `KS/internal/bridge/gitclients.go` (`GitClientsService`, consumer-side `GitBroker` interface,
  `toWireSnapshot`, `AttachPush` onto `kira:git:pairing`/`kira:git:clients`), table `git_clients`
  (`0001_init.sql`), repo `KS/internal/storage/repos/gitclients.go` (`ByID`, `UpsertOnPair`,
  `TouchLastSeen`, `Revoke`, `List`).
- Frontend transport: every call goes through the `control` object (`KSF/src/bridge/index.ts`),
  built from Wails-generated `@bindings/*` plus `WB/bridge/rpc.ts` (`unwrap`, `on`, `trust`).
  `rpc.ts` imports `/wails/runtime.js`, so nothing that imports `control` can run in a plain
  browser. `packages/api-core` holds the API module's gRPC/curl protocol core; it has no bridge
  abstraction and is not the seam here.
- ADE frontend: read hooks in `ADE/queries.ts` (`useBoard`, `usePrs`, `useSessions`,
  `useWorkflows`, `useLog`, keys `boardKey` etc.) import `control`. Push wiring
  `KSF/src/ade/queries.ts` `installAdeSignals` (pure helpers `mergeRuns`, `appendChunks` inside it).
  Pure derivations with no bridge import: `ADE/board/{status,progress,needsYou,labels,branchGraph,
  stageBlocks,setupStatus,actions,baseMarker}.ts`, `ADE/activity.ts`, `ADE/sessions/sessionView.ts`,
  `ADE/tones.ts`, `ADE/palette.ts`, `ADE/ago.ts`, `ADE/wire.ts`. Small presentational components
  with no bridge import: `AdeActivityIcon.vue`, `AdeChip.vue`, `AdeRepoTag.vue`. `AdeRunLog.vue`
  is presentational except its `useLog` import. `plan/usePlanModel.ts` is too entangled for mobile
  (settings/coderepos/agentSessions stores, board UI store).
- Agent activity store factory `WB/state/createAgentSessionsStore.ts` takes an
  `AgentSessionsControl` interface (no Wails import): reusable on mobile as-is.
- Go read surface `KS/internal/bridge/adetask.go`: `Board`, `Prs`, `Sessions`, `Workflows`,
  `Repos`, `ReadLog` (validated), errors as `ipcerr.Error`. `TaskBoard.Board` also writes derived
  branch facts (`MarkBranchFacts`) and queues conflict checks: cache maintenance, same as a desktop
  window opening; not a user-visible mutation.
- Events: `shell.NewDeferredEmitter` (`internal/shell/wails.go`) is the single `appevent.Emitter`
  every producer uses (`main.go:130`; `bridge.NewEvents`, `wireTracker`, `AdeTaskService.Emit`).
  ADE pushes: `KS/internal/bridge/adewire/channels.go` (`kira:adetask:*`); agent activity:
  `appevent.ChannelAgentSessions`/`ChannelAgentEvent` (`bridge/agentsessions.go`).
- Existing HTTP servers: Studio `dbmcp` (`http.go` `bindHTTP`: loopback, `ReadHeaderTimeout`,
  `IdleTimeout`, `http.NewCrossOriginProtection`, Shutdown grace), Space `adeagent` MCP (loopback,
  per-run bearer tokens via `tokenauth`), `agenthooks` (unix socket). Enable toggle precedent:
  Studio `DbMcpService.SetEnabled` + `embeddedService` (`apps/kira-studio/internal/bridge/embedded.go`).
- Build: `KSF/vite.config.ts` -> `WB/viteAppConfig.ts` `defineAppViteConfig` (Wails aliases,
  `/wails/` external). Studio precedent for a second Vite build in the same frontend package:
  `vite.proto.config.ts`, `tsconfig.proto.json`, `dist-proto`. `KS/main.go:51` embeds
  `all:frontend/dist`; `scripts/prepare-worktree.sh` builds dist so `go build` works.
- Tests: `KS/playwright.config.ts` projects `ui`, `visual` (webkit, static `dist` + mocked
  control via `WB/testing/ui/*`), fixtures `KS/tests/fixtures/ade-v2/` (28 wire fixtures).
- Deps available: `golang.org/x/time` (rate), `golang.org/x/sync` (singleflight), `google/uuid`,
  `@vueuse/core` (`useEventSource`), `@tanstack/vue-query`, `pinia`, `reka-ui`/shadcn-vue in `TH`.

## 3. Decisions (each with the requirement that drives it)

D1. Data path in the browser: HTTP/JSON GET endpoints plus one Server-Sent Events stream, behind
    a transport-agnostic `AdeReader` seam in the ADE frontend. Requirement: the phone has no Wails
    runtime; push is one-way (server to client) for a read-only app. SSE is native
    `EventSource` (auto-reconnect, same-origin cookies sent automatically; a WebSocket would need a
    library and a bidirectional protocol nobody uses). VueUse `useEventSource` wires it.
D2. Route allowlist, GET only, nothing else registered (§4.4). No mutation of ADE, git or
    settings state from the phone. `POST /api/pair` is the only non-GET route and only creates a
    pairing request.
D3. Pairing reuses the git broker: extract `gitsock.Broker` into a generic repo-root
    `internal/pairing.Broker[M]` used by both gitsock and the mobile server. Requirement: same
    semantics (queue, timeout, cooldown, one-click-one-device, token minted at approval) without a
    second copy (`dedup:go` would flag a copy anyway).
D4. Token on the phone: `HttpOnly; Secure; SameSite=Strict; Path=/` cookie named
    `__Host-kira-space`, value `<deviceId>.<token>`, `Max-Age` 400 days. Requirement:
    `EventSource` cannot send an `Authorization` header; an HttpOnly cookie is unreadable by script
    (XSS cannot exfiltrate it) and travels with fetch, SSE and service-worker requests.
    Server stores only salted hash (`tokenauth`), verifies in constant time, dummy-verifies on a
    missing row.
D5. Transport security: HTTPS with a Kira Space-owned local CA, trusted once per phone. Research:
    - Service workers and PWA install need a secure context. `http://localhost` is exempt; a phone
      on `http://192.168.x.y` is not: no service worker, Chrome offers no install, iOS gives a
      plain bookmark with no offline shell. HTTP-only fails R4.
    - Self-signed leaf without trust: browsers warn; Chrome refuses service-worker registration on
      certificate-error origins even after click-through. Fails R4.
    - Local CA (mkcert's model, done in-process with stdlib `crypto/x509`): user installs the CA on
      the phone once (iOS: profile install, then Certificate Trust Settings; Android: Settings >
      Security > Install CA certificate; Chrome on Android honours user CAs). Origin becomes
      secure, service worker and install work. Risk of a trusted root is bounded with X.509 name
      constraints (permitted IP ranges 10/8, 172.16/12, 192.168/16, 127/8, 100.64/10; permitted
      DNS `.local`; critical), honoured by iOS and Chrome. mkcert itself is declined: it is a CLI
      that installs into the local machine's trust stores; the requirement is in-process issuing
      and phone-side trust, which stdlib covers.
    - Tailscale (`tailscale cert`, real Let's Encrypt cert for `*.ts.net`): excellent off-LAN, but
      needs an account, MagicDNS and HTTPS enabled; not a default. CA constraints already permit
      100.64/10, so a later opt-in needs no phone re-trust (Deferred decision 5).
    - Public tunnels (Cloudflare and similar): rejected, exposes the server beyond the LAN (R6).
    Recommendation: local CA as the only P212 mode. iOS limits honoured: leaf validity 397 days
    (<= 825 required), ECDSA P-256, EKU serverAuth, SAN IPs plus `<hostname>.local`. CA validity 10
    years. Leaf re-issued in memory at every start and whenever the bound IP set changes; the CA
    does not change, so the phone never re-trusts unless the user resets the CA.
D6. Two listeners: HTTPS app port (default 7790) and plain HTTP setup port (default 7791) that
    serves only the setup page and the public CA certificate (nothing secret, no API). Requirement:
    the phone must fetch the CA before HTTPS can be trusted.
D7. Bind addresses: every up interface's private IPv4 (RFC 1918) plus `127.0.0.1`, one listener
    per address. Never `0.0.0.0`, never a public address. Middleware rejects a remote address
    outside RFC 1918/loopback and a `Host` header not matching a bound IP or `<hostname>.local`
    (DNS-rebinding guard). IPv6 out (documented). Requirement: R6.
D8. Pairing match code: the phone generates a random 4-digit code, shows it, and sends it; the
    approval dialog in Kira Space shows the same code, the remote IP and the claimed label.
    Requirement: the user must be able to tell their phone's request from another LAN device's.
    Cooldown and sibling purge key on the remote IP, not a client-chosen id, so a fresh id cannot
    bypass a Deny cooldown.
D9. Rate limiting with `golang.org/x/time/rate`, per remote IP, bounded map with idle eviction:
    pairing 1 per 10s burst 3; failed auth 1 per minute burst 10 (exhausted: 429 for every `/api`
    request from that IP); authenticated reads 20/s burst 40 per device. `singleflight`
    (`golang.org/x/sync/singleflight`) coalesces concurrent `Board`/`Prs` fetches (each does git
    work per repo). Requirement: R5, and protecting the git engine from N phones refetching.
D10. Mobile build: a second Vite build in the same `KSF` package, Studio's proto precedent:
    `KSF/mobile/` source, `KSF/vite.mobile.config.ts`, `KSF/tsconfig.mobile.json`, output
    `KSF/dist-mobile`, embedded by `KS/main.go` (`//go:embed all:frontend/dist-mobile`, Go embed
    cannot escape the package dir) and handed to the server as `fs.FS`. The mobile config has no
    `@bindings` alias and does not externalize `/wails/`, so any accidental import of `control` or
    `rpc.ts` fails the build: that is the enforcement, no extra lint script.
D11. Reuse: pure ADE modules and three presentational components are imported directly;
    `AdeRunLog.vue` becomes reusable via the reader seam; mobile layout components are new and
    mobile-specific (desktop components are dense, hover/tooltip and mutation driven). Styling:
    Tailwind utilities, shadcn-vue primitives from `TH`, VueUse, one Pinia store per concern,
    TanStack Query for every server read.
D12. Routing: `vue-router` 5.4.0 (MIT), `createWebHistory`, server SPA fallback. Requirement:
    phone back button and deep links in an installed PWA; hand-rolling a router is infrastructure.
D13. PWA: `vite-plugin-pwa` 2.0.0 (MIT, peer `vite ^8`, Workbox MIT) with `generateSW`,
    `registerType: 'autoUpdate'`, precache of the shell only; `/api/*` is `NetworkOnly` and never
    cached (stale task state misleads, and data stays off the phone's disk). Icons generated once
    from `KS/build/appicon.png` with `@vite-pwa/assets-generator` 2.0.0 (MIT, dev-only, run by
    hand) and committed.
D14. QR code: `uqr` 0.1.3 (MIT, zero deps, renders SVG) in the desktop settings pane. Requirement:
    R7; encoding QR is a library job.
D15. Settings: leaves `mobile.enabled` (default false), `mobile.httpsPort` (7790),
    `mobile.setupPort` (7791). Changed only through `MobileAccessService` instant actions (dbmcp
    `SetEnabled` precedent), which restart the server when running.
D16. Live updates: an `appevent.Emitter` tap feeds an in-process hub; allowlisted channels only
    (§4.6). On every SSE reconnect the client invalidates every ADE query (events may have been
    missed). Offline: service worker serves the shell; the app shows "Kira Space unreachable" and
    retries; no data is shown offline (Deferred decision 6).
D17. TUI terminal output is never exposed (it is a live PTY stream, not a stored transcript, and
    can hold anything typed). Headless runs' stored logs are the available transcripts (R3).

## 4. Go design

### 4.1 `internal/pairing` (new, repo root) — extracted from gitsock

- `pairing.go`: `Broker[M any]`, `Config{Timeout, Cooldown time.Duration; MaxQueue int; Now
  func() time.Time}`, `Request[M]{RequestID, ClientID string; Meta M; EnqueuedAt, ExpiresAt
  time.Time}`, `Snapshot[M]{Pending *Request[M]; Queued int}`, `Outcome` (`Approved`, `Denied`,
  `TimedOut`, `Aborted`), `ActionResult` (`Resolved`, `AlreadyResolved`, `Expired`),
  `ApprovedToken{Plain string; Hash, Salt []byte}`. Methods carried over verbatim in behaviour:
  `Subscribe`, `Pending`, `InCooldown`, `Request(clientID string, meta M, onEnqueued
  func(Request[M])) Outcome`, `Approve`, `Deny`, `Cancel`, `TakeApprovedToken`, `ExpireOverdue`,
  `Shutdown`. Add `RunExpiry(stop <-chan struct{}, every time.Duration)` (gitsock's `expireLoop`
  body) so both callers share it.
- Move `KS/internal/gitsock/pairing_test.go` to `internal/pairing/pairing_test.go`, adapted to
  the generic type. Keep every existing case.
- gitsock: `type PairingMeta struct{ Label string; Peer Peer }`; aliases
  `type PairingRequest = pairing.Request[PairingMeta]`, `PairingSnapshot =
  pairing.Snapshot[PairingMeta]`, `Broker = pairing.Broker[PairingMeta]`, outcome/result constant
  aliases. `NewBroker(now)` wraps `pairing.NewBroker` with gitsock's own 120s/60s/`maxQueueLen`.
  `handshake.go` and `server.go` switch to `RunExpiry`. `bridge/gitclients.go` `toWireSnapshot`
  reads `Meta.Label`, `Meta.Peer.PID`, `Meta.Peer.Exe`. Wire shape unchanged.
- Verify: `go test -race ./internal/pairing/... ./apps/kira-space/internal/gitsock/...
  ./apps/kira-space/internal/bridge/...`.

### 4.2 Storage

- Migration `KS/internal/storage/migrations/0021_p212_mobile_devices.sql` + `embed.go` entry
  `{Version: 21, Name: "p212_mobile_devices"}`:
  `mobile_devices(id TEXT PRIMARY KEY, label TEXT NOT NULL, user_agent TEXT NOT NULL, token_hash
  BLOB NOT NULL, token_salt BLOB NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT
  NULL, last_ip TEXT NOT NULL, revoked_at INTEGER)`.
- `KS/internal/storage/model/mobiledevice.go`: `MobileDevice` public projection (no hash/salt
  fields, same rule as `model.GitClient`): `id, label, userAgent, createdAt, lastSeenAt, lastIp,
  revokedAt`.
- `KS/internal/storage/repos/mobiledevices.go`: `MobileDevicesRepo` with `ByID`, `Insert`,
  `TouchLastSeen(id, now, ip)`, `Revoke(id, now)`, `List` (mirror `GitClientsRepo`), registered in
  `repos.Repos`.
- Settings: `model.MobileSettings{Enabled bool; HTTPSPort, SetupPort int}`, defaults false/7790/
  7791, `MobilePatch` with validation (1024..65535, the two ports distinct), read/upsert in
  `repos/settings.go` (`readMobile`, `upsertMobile`), TS mirror in `KSF/src/state/settingsDomain.ts`
  (`mobileSettingsSchema`, defaults, patch).

### 4.3 `KS/internal/mobileweb` (new) — the second transport

Transport over the same bound services, so it sits at bridge level: add `"internal/mobileweb"` to
`packagesExemptFromBridgeCheck` in `KS/internal/layering_test.go` with a one-line reason.

Files and responsibilities:
- `certs.go`: `LoadOrCreateCA(dir string) (*CA, error)` (ECDSA P-256, 10 years, name constraints
  per D5, `ca.key` 0600 + `ca.crt` in `<KiraSpaceHome>/mobile/`, dir 0700); `(*CA).IssueLeaf(ips
  []net.IP, dnsNames []string, now time.Time) (*tls.Certificate, error)` (397 days, serverAuth,
  random 128-bit serial); `(*CA).Fingerprint() string` (SHA-256 of DER, colon hex);
  `ResetCA(dir)` deletes and recreates. Leaf kept in an `atomic.Pointer[tls.Certificate]`, served
  via `tls.Config.GetCertificate`, `MinVersion: tls.VersionTLS12`.
- `bind.go`: `PrivateAddrs() ([]net.IP, error)` (up interfaces, IPv4, RFC 1918) plus loopback;
  `allowedRemote(ip)`; `hostAllowed(host string, bound []net.IP, mdnsName string, port int)`.
- `ratelimit.go`: `limiterSet` keyed by string (IP or device id), `rate.Limiter` per key,
  `maxKeys` 1024, idle eviction sweep every minute (10 min idle).
- `auth.go`: cookie name `__Host-kira-space`; `parseCookie`, `(*Server).authenticate(r)`
  returning device or a verdict (`ok`, `invalid`, `revoked`, `storeError`); dummy hash/salt
  verify on missing row (gitsock D6 posture); store error -> 503 (F10 posture, never a revoke);
  last-seen touch throttled to once per minute per device in memory.
- `pairing.go`: `MobileMeta{Label, Code, RemoteIP, UserAgent string}`; broker
  `pairing.NewBroker[MobileMeta](pairing.Config{Timeout: 120s, Cooldown: 60s, MaxQueue: 8})`;
  `handlePair`: Origin must equal the request's own scheme+host, `Sec-Fetch-Site` if present must
  be `same-origin`; body `http.MaxBytesReader` 4 KiB, JSON `{label, code}`, label clamped to 64
  bytes (gitsock `clampLabel` rule), code `^[0-9]{4}$`; a valid existing cookie returns 200 with
  that device (no new request); `Request(remoteIP, meta, onEnqueued)` where `onEnqueued` captures
  the id and `context.AfterFunc(r.Context(), func(){ broker.Cancel(id) })`; Approved:
  `TakeApprovedToken`, insert row first, then set cookie, 200 `{deviceId, label}`, notify devices
  changed; Denied/TimedOut: 403 `{code: "E_PAIRING_DENIED", message, reason}`; Aborted: 503.
  Per-route write deadline 135s via `http.ResponseController`.
- `routes.go`: `(*Server).mux()` registers exactly the §4.4 patterns with Go 1.22 method patterns
  (`"GET /api/ade/board"`); every handler wraps the reader call with a 30s write deadline;
  `ipcerr` code -> status (`E_BAD_REQUEST` 400, `E_NOT_FOUND` 404, others 500), body `{code,
  message}` (same shape `rpc.ts` `unwrap` parses). `Cache-Control: no-store` on `/api/*`.
- `events.go`: `Hub` with `Publish(name string, data any)` (marshals once, drops channels outside
  the allowlist), `Subscribe(deviceID) (<-chan []byte, cancel)`, buffer 256 per subscriber, full
  buffer closes that subscriber, `DisconnectDevice(id)`, caps 4 streams per device and 32 total.
  `handleEvents`: `text/event-stream`, `retry: 3000`, `event: ready` first, `event: <channel>` /
  `data: <json>` per message, `: ping` every 25s, ends on client gone, revoke or server close.
- `static.go`: serves the embedded `dist-mobile` FS: exact file if present, else `index.html` for
  navigations (`Accept: text/html`), 404 otherwise. `assets/*` `Cache-Control: public,
  max-age=31536000, immutable`; `index.html`, `sw.js`, `manifest.webmanifest`: `no-cache`. Static
  files need no auth (no data in the shell; install and the pairing screen need them).
- `headers.go`: on every response: CSP `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src
  'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`.
- `setup.go`: setup listener handler: `GET /` -> `setup.html` from `dist-mobile`, its assets,
  `GET /kira-space-ca.crt` (DER, `application/x-x509-ca-cert`), `GET /kira-space-ca.mobileconfig`
  (unsigned iOS profile, `com.apple.security.root` payload, `text/template`,
  `application/x-apple-aspen-config`), `GET /setup-info` `{fingerprint, appUrls[]}`. Same remote,
  Host and rate guards; no cookie, no API.
- `server.go`: `Config{Reader Reader; AgentSessions func() any; Devices DeviceStore; Hub *Hub;
  Assets fs.FS; HomeDir string; HTTPSPort, SetupPort int; Now func() time.Time}`; `Start() error`
  (load CA, enumerate addresses, issue leaf, bind every address on both ports; any bind failure
  closes what opened and returns an actionable error), `Close() error` (broker `Shutdown` first so
  a parked pair request returns, then `http.Server.Shutdown` with 5s grace then `Close`, dbmcp
  `closeHTTP` order), `Status() Status{Running bool; Error string; AppURLs, SetupURLs []string;
  Fingerprint string; LeafExpiresAt int64}`, `Broker()`, `Revoke(id)` (store revoke +
  `Hub.DisconnectDevice`). `http.Server`: `ReadHeaderTimeout` 10s, `IdleTimeout` 120s,
  `MaxHeaderBytes` 16 KiB, no global `WriteTimeout` (SSE and pairing long-poll; per-route
  deadlines instead).
- `reader.go`: consumer-side `Reader` interface (`Board`, `Prs`, `Sessions`, `Workflows`, `Repos`,
  `ReadLog` with `*bridge.AdeTaskService` signatures) so tests use a fake; `DeviceStore` interface
  over `MobileDevicesRepo`. `singleflight.Group` around `Board` and `Prs`.
- `GET /api/ade/repos` projects `ReposResult` to `{repos: [{codeRepoId, name, nickname}]}`: the
  phone needs names only, not prepare scripts or paths.

### 4.4 Route allowlist (complete; a test asserts nothing else is registered)

App port (HTTPS):
- `POST /api/pair` (unauthenticated, pairing rate limit)
- `GET /api/me` -> `{deviceId, label}`
- `GET /api/events` (SSE)
- `GET /api/ade/board`, `GET /api/ade/prs`, `GET /api/ade/sessions`, `GET /api/ade/workflows`,
  `GET /api/ade/repos`
- `GET /api/ade/log?kind=run|setup&id=<id>&afterSeq=<n>` (validated by `AdeTaskService.ReadLog`)
- `GET /api/agent/sessions` (`{sessions: [{terminalId, cwd}]}`, from `TerminalService.AgentSessions`)
- `GET /` and static files (§4.3 `static.go`)
Setup port (HTTP): `GET /`, setup assets, `GET /kira-space-ca.crt`, `GET
/kira-space-ca.mobileconfig`, `GET /setup-info`.
Backlog, workflow YAML, repo config, git refresh and every write stay out.

### 4.5 Bridge and wiring

- `internal/appevent/tap.go`: `NewTap(inner Emitter, onEmit func(name string, data any)) Emitter`;
  `Emit` calls inner then `onEmit`; `EmitTo`/`EmitFocused` pass through only (window-addressed
  events never reach phones).
- `KS/main.go`: right after `shell.NewDeferredEmitter()` create `mobileHub :=
  mobileweb.NewHub()` and wrap `emitter = appevent.NewTap(rawEmitter, mobileHub.Publish)` so every
  producer below gets the tap. Add `//go:embed all:frontend/dist-mobile` `mobileAssets`, `fs.Sub`
  to the dir. Construct `bridge.NewMobileAccessService(...)`, register it with
  `application.NewService`, call `StartMobileIfEnabled` after the app is built, `StopMobile` in
  teardown before DB close (dbmcp `StartDbMcpIfEnabled`/`StopDbMcp` precedent).
- `KS/internal/bridge/mobile.go`: `MobileAccessService` reuses Studio's settings-gated lifecycle.
  Space has no copy of it, so move `apps/kira-studio/internal/bridge/embedded.go`'s
  `embeddedService` to repo-root `internal/embedded` (exported `Service[S, ST]`, same behaviour);
  Studio's only caller, `bridge/dbmcp.go`, switches to it. Bound methods: `Status() MobileStatus`, `SetEnabled(MobileSetEnabledArgs)
  (MobileStatus, error)`, `SetPorts(MobileSetPortsArgs) (MobileStatus, error)`, `ResetCertificate()
  (MobileStatus, error)`, `Devices() ([]model.MobileDevice, error)`, `Revoke(MobileIDArgs) error`,
  `PendingPairing() MobilePairingSnapshot`, `ApprovePairing(MobileIDArgs)
  MobilePairingActionResult`, `DenyPairing(MobileIDArgs) MobilePairingActionResult`.
  `AttachPush()` emits `kira:mobile:pairing` (snapshot), `kira:mobile:devices` (list),
  `kira:mobile:status`. The broker lives for the app's lifetime (outside the server) so the desktop
  subscription survives restarts of the listener. Channel constants in `bridge/events.go` and
  `packages/shared/protocol/events` `CHANNEL`.
- Wire projections in `packages/shared/domain/mobile.ts` (zod schemas like `domain/git.ts`):
  `MobileDevice`, `MobileStatus`, `MobilePairingRequest{requestId, label, code, remoteIp,
  userAgent, expiresAtMs}`, `MobilePairingSnapshot`.
- Regenerate bindings (`scripts/setup.sh` path) after the bound surface changes.

### 4.6 SSE channel allowlist

`kira:adetask:board`, `kira:adetask:workflows`, `kira:adetask:repos`, `kira:adetask:runs`,
`kira:adetask:log`, `kira:adetask:sessions`, `kira:agent:sessions`/agent event (the
`appevent.ChannelAgentSessions`/`ChannelAgentEvent` constants). Everything else, terminal data
included, is dropped in `Hub.Publish`.

## 5. Frontend design

### 5.1 Shared refactors (desktop keeps behaviour; mobile reuses)

- `WB/bridge/codedError.ts`: `toCodedError(err: unknown): Error & {code, details}` extracted from
  `rpc.ts` `unwrap` (no Wails import); `unwrap` calls it. Mobile HTTP client uses it on non-2xx
  bodies.
- `ADE/reader.ts`: `interface AdeReader { board(); prs(); sessions(); workflows(); readLog(args) }`
  (wire types) and `adeReaderKey: InjectionKey<AdeReader>`; `useAdeReader()` injects and throws a
  clear error when missing.
- `ADE/readQueries.ts`: query keys (moved from `queries.ts`) and `useBoard`, `usePrs`,
  `useSessions`, `useWorkflows`, `useLog` reading through `useAdeReader()`. `ADE/queries.ts`
  re-exports them (call sites unchanged) and keeps every mutation.
- `ADE/pushMerge.ts`: `mergeRuns`, `appendChunks` moved out of `KSF/src/ade/queries.ts`.
- `KSF/src/ade/readSignals.ts`: `installAdeReadSignals(queryClient, source: AdeSignalSource)`
  with `source = {onBoard, onWorkflows, onRepos?, onSessions, onRuns, onLog}`; holds the
  invalidation and merge logic for those six. Desktop `installAdeSignals` calls it with `control`
  and keeps its desktop-only extras (backlog, open-session, review agent prefix, credential,
  turnWatch).
- `KSF/src/main.ts`: `app.provide(adeReaderKey, controlAdeReader)` where `controlAdeReader`
  (`KSF/src/bridge/adeReader.ts`) maps to `control.adeTask*`.
- `ADE/panel/AdeRunLog.vue` imports `useLog` from `readQueries` (no other change).
- `KSF/src/workbench/PairingRequestDialog.vue`: presentational dialog extracted from
  `GitPairingDialog.vue` (title, body slot, expires countdown via `usePendingDecision`, queue
  count, Deny/Approve, `data-testid` prefix prop). `GitPairingDialog.vue` becomes a thin user of
  it; its existing test ids stay.

### 5.2 Desktop: Mobile access

- Store `KSF/src/state/mobileAccess.ts` (one concern: mobile access): `status`, `devices`,
  `pending`, `queued`; `hydrateMobileAccess` (`hydrateThenSubscribe` x3), `setEnabled`,
  `setPorts`, `resetCertificate`, `revoke`, `approve`, `deny`. Hydrated in `main.ts` next to
  `gitClientsStore`.
- `KSF/src/workbench/MobilePairingDialog.vue` (always mounted in `App.vue`): "Phone wants to view
  Agents", label (client-claimed), match code (large, `font-data`), remote IP, user agent,
  countdown. Approve grants read-only access to the agents board.
- `KSF/src/workbench/settings/MobileAccessPane.vue`, added to `SettingsDialog.vue`: Switch
  enable; port fields (`NumberStepperInput`) with Apply; status line and error; step 1 QR (setup
  URL, `uqr` `renderSVG`) with CA fingerprint and Reset certificate (ConfirmDialog, danger); step
  2 QR (app URL); one QR per bound address, private addresses first, loopback hidden; device list
  (label, last seen via `useTimeAgo`, last IP) with Revoke (ConfirmDialog), active rows only.

### 5.3 Mobile app (`KSF/mobile/`)

Build: `KSF/vite.mobile.config.ts` (root `mobile/`, `base: '/'`, plugins vue, tailwindcss,
`VitePWA`; aliases `@`, `@shared`, `@theme`, `@workbench`, `@ade` -> `src/ade/v2`; inputs
`mobile/index.html` and `mobile/setup.html`; `outDir ../dist-mobile`, `emptyOutDir: true`).
`KSF/tsconfig.mobile.json` (includes `mobile/**`). `KSF/package.json` scripts `build:mobile`,
`build:mobile:test`; deps `vue-router@5.4.0`, `uqr@0.1.3`; devDeps `vite-plugin-pwa@2.0.0`,
`@vite-pwa/assets-generator@2.0.0`, `workbox-window@<peer-pinned>` (exact versions, repo rule).

Structure:
- `mobile/index.html`: `viewport` with `viewport-fit=cover`, `theme-color`, `apple-mobile-web-app-
  capable`, `apple-touch-icon`, same CSP as §4.3, `class="dark"`.
- `mobile/main.ts`: own `QueryClient` (`staleTime: Infinity`, `retry: 1`, `refetchOnWindowFocus:
  true`, `refetchOnReconnect: true`), Pinia, router, `app.provide(adeReaderKey, httpAdeReader)`,
  agent sessions store from `createAgentSessionsStore(httpAgentControl)`, `installAdeReadSignals`
  with the SSE source, service worker registration (`virtual:pwa-register`).
- `mobile/styles.css`: `@theme/tokens.css`, `@theme/tailwind-core.css`, `@theme/primitives.css`,
  `@source` over `mobile/` and the reused `src/ade/v2` files; dark variant as `WB/workbench.css`.
- `mobile/api/http.ts`: `getJson<T>(path, params?)` via `fetch` (`credentials: 'same-origin'`),
  non-2xx -> `toCodedError`; 401 -> `useAuthStore().onUnauthorized()`.
- `mobile/api/adeReader.ts`: `httpAdeReader: AdeReader` over §4.4 routes.
- `mobile/api/events.ts`: `useServerEvents()` on VueUse `useEventSource('/api/events', [channels],
  { autoReconnect: { retries: -1, delay: 3000 } })`; exposes `status` (`live`, `reconnecting`,
  `offline`), per-channel `on(channel, cb)`; on every `open` after the first, invalidates
  `['adetask']`; on error probes `GET /api/me` to tell revoke (401) from network loss.
- `mobile/api/agentControl.ts`: `AgentSessionsControl` over `GET /api/agent/sessions` + SSE.
- `mobile/state/auth.ts` (one concern: pairing/auth): `state` (`checking`, `unpaired`,
  `requesting`, `denied`, `timedOut`, `revoked`, `paired`, `unreachable`), `code`, `label`;
  `check()` (`GET /api/me`), `requestAccess(label)` (4-digit code from
  `crypto.getRandomValues`, `POST /api/pair`, long-poll), `onUnauthorized()`.
- `mobile/router.ts`: `/` board, `/task/:id`, `/log/:kind/:id`, `/sessions`, `/pair`; guard sends
  to `/pair` unless `auth.state === 'paired'`.
- Screens (`mobile/screens/`), all `<script setup lang="ts">`, Tailwind, shadcn-vue (`Button`,
  `Badge`, `Tabs`, `Alert`, `Empty`, `Separator`) from `TH`:
  - `PairScreen.vue`: device label input (default from `navigator.userAgentData`/UA platform),
    Request access, the match code while waiting ("Check this code in Kira Space: 4831"), states
    denied/timed out/revoked/unreachable with retry; note when not in a secure context (HTTP
    origin) linking the setup page.
  - `BoardScreen.vue`: Needs-you list (`buildNeedsYou`) then live tasks grouped by
    `deriveStatus`, each a `MobileTaskCard.vue` (title via `taskTitle`, colour via `taskColor`,
    status chip, current stage + step progress via `buildTaskProgress`, repo tags, running
    session `AdeActivityIcon`). Pull-down is not built; a header refresh button refetches queries
    (GET only).
  - `TaskScreen.vue`: header, stages via `buildStageBlocks` with step state and run links,
    branches (`MobileBranchRow.vue`: name, repo tag, ahead/behind, upstream ahead/behind, dirty
    count, `conflictsIfRebased`/`conflictCheck`, `integrationChips`, merged, PR from `usePrs`,
    worktree setup state via `setupStatus`), sessions for the task via `sessionView`.
  - `LogScreen.vue`: full-height `AdeRunLog` (`maxHeight` = viewport), live via the log push.
  - `SessionsScreen.vue`: every session, `byRunningOrder`, activity via `withTuiActivity`.
  - `AppShell.vue`: top bar (title, connection dot from `useServerEvents().status`), bottom tab bar
    (Board, Sessions), safe-area padding, offline banner (`useOnline` from VueUse).
- `mobile/setup.html` + `mobile/setup/SetupPage.vue`: per-platform steps (iOS profile install +
  Certificate Trust Settings; Android install CA certificate), download links, fingerprint from
  `/setup-info` to compare with the desktop pane, "Open Kira Space" links to `appUrls`.
- PWA (`VitePWA` options): manifest `name` "Kira Space Agents", `short_name` "Agents", `display:
  standalone`, `start_url: '/'`, `scope: '/'`, dark `theme_color`/`background_color` from tokens,
  icons 192/512/maskable 512 + apple-touch 180 in `mobile/public/`; workbox `navigateFallback:
  'index.html'`, `navigateFallbackDenylist: [/^\/api\//]`, runtime caching `/api/` `NetworkOnly`,
  `cleanupOutdatedCaches: true`. The setup entry is excluded from the precache.

## 6. Build, scripts, packaging

- `.gitignore` (`KS/.gitignore`): `frontend/dist-mobile`.
- Root `package.json`: `build:space-mobile`, `build:test:space-mobile`, `typecheck:space-mobile`
  (`vue-tsc --noEmit -p apps/kira-space/frontend/tsconfig.mobile.json`, added to `typecheck`'s
  parallel list), `test:ui:space-mobile` (build then `playwright test --project=mobile-ios
  --project=mobile-android`).
- `KS/build/Taskfile.yml` `build:frontend`: also `bun run build:mobile` so packaged builds embed it.
- `scripts/prepare-worktree.sh` step 5: also build `frontend/dist-mobile` when empty.
- `knip.json`: add the mobile entry points if knip reports them unused.

## 7. Tests

Go (only where logic is genuinely hard):
- `internal/pairing`: moved broker suite (concurrency, ordering, cooldown, expiry).
- `mobileweb/certs_test.go`: CA constraints present and critical, leaf SANs, EKU, validity <= 397
  days, leaf verifies against CA pool, a leaf for a public IP fails verification under the
  constraints, reissue on IP-set change.
- `mobileweb/routes_test.go`: walks the mux with every method x path in a table; only §4.4 pairs
  succeed (others 404/405); `Cache-Control: no-store` on `/api`; security headers present.
- `mobileweb/auth_test.go`: valid, wrong token, unknown device (dummy path runs), revoked (cookie
  cleared), store error -> 503 not 401, failed-auth limiter -> 429.
- `mobileweb/guard_test.go`: public remote address refused; foreign `Host` refused.
- `mobileweb/events_test.go`: allowlist filter, fan-out, slow subscriber dropped without blocking
  publishers, `DisconnectDevice` ends that device's streams only, per-device cap (concurrency).
- `mobileweb/integration_test.go`: real TLS listener on 127.0.0.1 with the issued leaf, client
  trusting the CA: `POST /api/pair` parks, broker `Approve`, cookie set, row inserted before the
  response, `GET /api/ade/board` 200 via fake reader, SSE receives a published board event,
  `Revoke` -> 401 and stream closed; pair request cancelled when the client disconnects.
- `go test -race` on `internal/pairing`, `internal/embedded`, `KS/internal/mobileweb`,
  `KS/internal/gitsock`, `KS/internal/bridge`, `KS/internal` (layering), Studio `internal/bridge`.

Playwright:
- `KS/playwright.config.ts`: projects `mobile-ios` (`devices['iPhone 15']`, webkit) and
  `mobile-android` (`devices['Pixel 7']`, chromium), `testDir: ./tests/mobile`, static server for
  `frontend/dist-mobile` on `http://127.0.0.1:<port>` (localhost is a secure context, so the
  service worker registers), API mocked with `page.route('**/api/**')` from
  `tests/fixtures/ade-v2/*` (`tests/mobile/support/mockApi.ts`), SSE mocked by fulfilling
  `/api/events` with a `text/event-stream` body of scripted events.
- `tests/mobile/pairing.spec.ts`: unpaired shows PairScreen with a 4-digit code; approve (mock
  200 + `/api/me` 200) lands on the board; deny and timeout states; 401 on a read returns to
  PairScreen as revoked.
- `tests/mobile/board.spec.ts`: board renders fixture tasks and needs-you; tap task -> stages,
  branches with ahead/behind and conflict chip, sessions; open a run log -> lines; a board event
  triggers a refetch; no horizontal overflow at 360 px (`scrollWidth <= clientWidth`); no element
  issues a non-GET request except `/api/pair` (route spy).
- `tests/mobile/pwa.spec.ts`: manifest link resolves and parses with required fields and icons;
  service worker reaches `activated`; with `context.setOffline(true)` a reload still renders the
  shell and the unreachable state.
- Desktop `KS/tests/ui/mobile-access.spec.ts` (mock runtime): pane toggles enable, shows QR and
  URLs, lists devices, revoke confirms; pending pairing pushes `MobilePairingDialog` with code and
  IP; approve/deny call the bound methods. Existing `GitPairingDialog` test ids keep passing.
- No bun unit tests: no new logic past the bar (the reader seam and signal split are wiring).

Manual, once at phase end, recorded in the SPEC result: real phone on the same Wi-Fi (iOS Safari
and Android Chrome): setup page, CA trust, pairing approve, board, log, install to home screen,
offline launch. The sandbox has no phone: if no real-device run is possible, the result says so
and `docs/ARCHITECTURE.md` "Known open items" records it.

## 8. Docs

- `docs/ARCHITECTURE.md`: new section "Mobile agents web (P212, Kira Space)" after the ADE
  section: transport (HTTPS + setup HTTP, bind rules, guards), pairing (generic broker, match code,
  cookie), route and SSE allowlists, CA and name constraints, build (`dist-mobile`, reader seam),
  PWA caching policy, tests. Update "Git module ... Transport" to point at `internal/pairing`.
  Known open items: IPv6 not served; bound addresses fixed until toggle or restart; iOS
  standalone app may hold its own cookie jar (pair again inside the installed app); no real-phone
  coverage in CI.
- `docs/DEV_ENVIRONMENT.md`: building `dist-mobile`, running the mobile Playwright projects, trying
  it on a phone (setup port, CA trust), resetting the CA.
- `docs/v2.2/SPEC.md`: P212 status and result section at phase end.

## 9. Commit order (one sequential implementer; fast checks per commit, Playwright once at end)

1. `refactor(pairing): extract generic pairing broker from gitsock` — §4.1.
2. `refactor(bridge): share embedded service lifecycle across apps` — `internal/embedded`, Studio
   callers repointed.
3. `refactor(space-ui): extract PairingRequestDialog from GitPairingDialog` — §5.1 last bullet.
4. `refactor(ade-ui): transport-agnostic ADE read layer` — `codedError.ts`, `reader.ts`,
   `readQueries.ts`, `pushMerge.ts`, `readSignals.ts`, `adeReader.ts`, `main.ts` provide.
5. `feat(storage): mobile devices table and mobile settings` — §4.2 (Go + TS settings).
6. `feat(mobileweb): local CA and leaf issuance` — `certs.go` + test.
7. `feat(mobileweb): read-only HTTPS server with pairing, auth and SSE` — rest of §4.3, tests.
8. `feat(space): wire mobile access service and event tap` — §4.5, layering exemption, bindings.
9. `feat(space-ui): mobile access settings pane and pairing dialog` — §5.2, `uqr`.
10. `feat(mobile): mobile app scaffold, pairing flow and build embedding` — §5.3 build, api,
    auth, router, PairScreen, setup page, §6 scripts, `main.go` embed.
11. `feat(mobile): board, task, log and sessions screens` — §5.3 screens.
12. `feat(mobile): installable PWA with offline shell` — VitePWA, icons, offline banner.
13. `test(mobile): Playwright mobile projects and desktop mobile-access spec` — §7 Playwright.
14. Fix commits for whatever the end-of-phase runs find (`bun run test:ui:space`,
    `test:ui:space-mobile`, `test:visual:space`, scoped `go test -race`, `lint:all`).
15. `docs: P212 mobile agents web` — §8.

Every commit passes the pre-commit hook (`bun run lint`, `bun run typecheck`) without
`--no-verify`.

## 10. Stream B overlap notes (Stream A runs P210/P211 concurrently)

P212 files shared with possible Stream A edits; keep each edit small and additive so a rebase
conflict stays mechanical: `KS/main.go`, `KS/internal/storage/migrations/embed.go` (P212 takes
version 21; if Stream A lands a Space migration 21 first, renumber P212's at rebase),
`KS/internal/storage/model/settings.go`, `KS/internal/storage/repos/settings.go`,
`KSF/src/state/settingsDomain.ts`, `KSF/src/workbench/SettingsDialog.vue`, `KSF/src/main.ts`,
`KSF/src/App.vue`, `KSF/package.json`, root `package.json`, `bun.lock`,
`KS/playwright.config.ts`, `scripts/prepare-worktree.sh`, `docs/ARCHITECTURE.md`,
`docs/DEV_ENVIRONMENT.md`, `docs/v2.2/SPEC.md`. Memory has its own store (`internal/memory`), so a
Space migration from Stream A is not expected.

## 11. Deferred decisions (user's call; recommended default in bold, plan implements the default)

1. HTTPS mode: **built-in local CA, one-time trust per phone** / HTTP only (no service worker, no
   install: fails R4) / bring-your-own certificate (for example `tailscale cert`) as a later phase.
2. Default ports: **7790 HTTPS, 7791 setup**.
3. Feature default: **off until enabled in Settings**.
4. Device token lifetime: **no expiry, manual revoke, last-seen shown (git-client parity)** / idle
   expiry after 30 days.
5. Tailscale/CGNAT (100.64/10) binding: **not in P212** (CA already permits it; a later opt-in
   needs no re-trust).
6. Offline data: **shell only, no cached task data on the phone** / persist the last board to
   IndexedDB.
7. Backlog on the phone: **left out** (not in the requested list) / add a read-only backlog list.
8. PR info on the phone (uses `gh` per repo): **shown, read-only**.
9. Pairing match code: **phone-generated 4-digit code shown on both screens**.

## 12. Orchestrator verification (before accepting the implementation)

- `grep -rn "mux.Handle\|HandleFunc" apps/kira-space/internal/mobileweb` matches §4.4 only; no
  `POST|PUT|PATCH|DELETE` pattern except `POST /api/pair`.
- `grep -rn "internal/pairing" apps/kira-space/internal/gitsock` (gitsock really uses the shared
  broker) and `pairing.go` no longer holds a broker body in gitsock.
- `grep -rn "useAdeReader\|adeReaderKey" apps/kira-space/frontend/mobile apps/kira-space/frontend/src`
  (both apps provide it); `grep -rn "/wails/\|@bindings\|bridge/control" apps/kira-space/frontend/mobile`
  returns nothing.
- `grep -rn "VitePWA\|useEventSource\|createRouter\|renderSVG" apps/kira-space/frontend` shows real
  callers; `dist-mobile/sw.js` and `manifest.webmanifest` exist after `build:mobile`.
- `go test -race` scope of §7 green; `bun run test:ui:space-mobile` and `test:ui:space` green.
- SPEC result states whether a real phone was used.
