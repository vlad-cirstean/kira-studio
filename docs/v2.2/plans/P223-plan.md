# P223 plan: mobile agents web as a plain-HTTP page on the trusted LAN only

Base: `776abcbc3` (P219-P222 rows), branch `v2.0`. One sequential Sonnet implementer.

## Ask (user's words)

- "the mobile app config is too much, it's so shady to download a self signed cert and allow it etc. So
  let's drop the pwa"
- "ok, then drop http and the pwa" (drop the HTTPS setup and the PWA; transport becomes plain HTTP)
- "no tailscale no nothing. It will only work over my local network. Is there a way to check what
  network it is and simply not work otherwise?"

Remove: PWA (manifest, service worker, `vite-plugin-pwa`/workbox, offline shell, install metas, PWA-only
icons), the local name-constrained CA, leaf issuance and reset, the HTTPS listener, the setup listener
and page (setup URL, setup QR, fingerprint compare), the pane's certificate step.

Keep: pairing and device approval in Kira Space, device cookie auth, `csrfGuard`, rate limits,
idempotency, SSE hub, `mobileterm` broker and WebSocket, backlog and stage writes, every phone screen
and permission.

Add, all three LAN-only controls:

1. Peer check: refuse a peer unless it is private or link-local IPv4 and inside the bound interface's
   subnet.
2. Bind exactly one address, the trusted LAN interface's IPv4. Never `0.0.0.0`, never loopback. Rebind
   on address change (P217 rebind path).
3. "Trust this network" in Settings records subnet, router IP and router MAC. Server runs only while the
   machine is on that network; it stops and starts by itself; the pane says why it is stopped.

Compensating controls for plaintext: a plain warning in the pane, a one-line note on the phone, device
tokens that expire (30 days) plus revoke.

## What exists today (verified on disk)

CodeGraph index (`/home/user/kira-studio/.codegraph`) predates P212: `codegraph_explore` returned
`embedded.Service` and unrelated servers, not `mobileweb`/`bridge/mobile.go`. Those were read directly.

- `internal/mobileweb/certs.go`: `CA`, `LoadOrCreateCA`, `ResetCA`, `IssueLeaf`, `CertHolder`,
  `permittedIPRanges` (includes `100.64.0.0/10`, Tailscale). Package doc comment lives here.
- `setup.go`: setup mux (`/`, `/assets/`, `/kira-space-ca.crt`, `/kira-space-ca.mobileconfig`,
  `/setup-info`), `mobileConfig`.
- `server.go`: `Config{CADir, HTTPSPort, SetupPort, Addrs, AddrPoll, ...}`, `Status{AppURLs, SetupURLs,
  Fingerprint, LeafExpiresAt}`, `Start` (CA, leaf, `tls.Config`, two listeners per IP), `bindIP`,
  `maintain` (sweep, renew leaf daily, poll addresses), `refreshAddrs` (P217 rebind), `renewLeaf`,
  `guard`, `CA()`.
- `bind.go`: `PrivateAddrs` (every up RFC 1918 IPv4 plus `127.0.0.1`), `allowedRemote` (loopback or
  RFC 1918), `mdnsName`, `hostAllowed` (bound IP, `.local`, `localhost`).
- `headers.go`: CSP with `manifest-src`, `worker-src`, `connect-src 'self' wss://<Host>`.
- `auth.go`: cookie `__Host-kira-space`, `Secure: true`, 400 days; `sameOriginRequest` demands
  `https` Origin; `Sec-Fetch-Site` optional.
- `static.go`: registers `.webmanifest` MIME; comment mentions install prompt.
- `pairing.go`: `finishPairing` inserts the row (no expiry).
- Tests: `certs_test.go`, `integration_test.go` (TLS client, `TestIntegration_SetupListenerServesOnlyTheCA`),
  `rebind_test.go` (TLS, 127.0.0.2), `guard_test.go` (`https://` origins), `support_test.go`
  (`newTestServer`, remotes `127.0.0.1:*`).
- `mobileterm/serve.go`: `websocket.Accept(w, r, nil)`; coder/websocket's default origin check compares
  host only, scheme-agnostic. No HTTPS assumption in `mobileterm`.
- `bridge/mobile.go`: `MobileStatus{HTTPSPort, SetupPort, AppURLs, SetupURLs, Fingerprint,
  LeafExpiresAt}`, `mobileCADir()` = `KiraSpaceHome()/mobile`, `SetPorts`, `ResetCertificate`,
  `StartMobileIfEnabled` through `embedded.Service.StartIfEnabled`.
- Storage: CA lives on disk (`ca.key`, `ca.crt`), not in SQLite. `mobile_devices` (0021, 0022) has no
  expiry. Settings are key/value rows: `mobile.enabled`, `mobile.httpsPort`, `mobile.setupPort`,
  `mobile.agentInput` (`repos/settings.go` `readMobile`/`upsertMobile`, `model/settings.go`
  `MobileSettings`, `MobilePatch`, `validateMobileSection`). TS mirror:
  `frontend/src/state/settingsDomain.ts` `mobileSettingsSchema`. Next free migration: 0023.
- Desktop UI: `frontend/src/workbench/settings/MobileAccessPane.vue`, `state/mobileAccess.ts`,
  `packages/shared/domain/mobile.ts`, `frontend/src/bridge/index.ts` (`mobileSetPorts`,
  `mobileResetCertificate`), `tests/ui/support/mockRuntime.ts`, `tests/ui/mobile-access.spec.ts`.
  Bindings are generated and gitignored.
- Phone app `frontend/mobile/`: `main.ts` calls `registerSW`; `index.html` has
  `apple-mobile-web-app-*` and `mobile-web-app-capable` metas (standalone mode) and the touch icon;
  `setup.html`, `setup/` (SetupPage, main); `public/` has `pwa-192x192.png`, `pwa-512x512.png`,
  `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`.
- Secure-context APIs in the phone bundle: `crypto.randomUUID` (`state/useAdeWrites.ts`
  `newIntentKey`; undefined on an insecure origin, so every write would throw);
  `window.isSecureContext` (`PairScreen.vue` insecure alert); service worker. `crypto.getRandomValues`
  (`state/auth.ts`) works on insecure origins. `navigator.clipboard` and `crypto.subtle`: none in the
  current `dist-mobile` bundle (`grep -o` count 0). `useRemoteTerminal.ts` picks `wss`/`ws` from
  `location.protocol`.
- Build and tooling: `vite.mobile.config.ts` (`VitePWA`, rolldown inputs `index` + `setup`),
  `tsconfig.mobile.json` (`vite-plugin-pwa/client` types), root `package.json` devDeps
  `@vite-pwa/assets-generator`, `vite-plugin-pwa`, `workbox-window`; `knip.json` entries
  `mobile/setup.html`, `mobile/setup/main.ts`; `scripts/prepare-worktree.sh` skips the build only when
  both `index.html` and `setup.html` exist; `main.go` `//go:embed all:frontend/dist-mobile` (unchanged).
- Playwright: `tests/mobile/pwa.spec.ts` (manifest, service worker, offline shell),
  `support/mockServer.ts` (`.webmanifest` MIME, plain `http://127.0.0.1`, a secure context, so it never
  caught the `randomUUID` dependency).
- `NOTICES.md`: no entry for any PWA package. Nothing to delete there.
- Pre-commit hook runs `bun run lint` and `bun run typecheck` only; pre-push runs Go build and lint.

## Design

### Network identity: new package `apps/kira-space/internal/lannet`

No library covers this. `jackpal/gateway` v1.2.0 (BSD-3) was checked: its darwin path returns the first
gateway of any route in a `NET_RT_DUMP`, not the default route, its interface lookup execs `netstat`,
and it never returns the router MAC. Use `golang.org/x/net/route` (already a direct dependency,
`v0.59.0`) on darwin and the kernel's `/proc` tables on Linux. No Wi-Fi SSID (macOS needs a location
permission for it). No probe traffic either: a UDP send to the router could trigger the macOS 15 Local
Network prompt; reading routing and ARP tables needs no permission on either OS.

Types (`lannet.go`, no build tag):

```go
type Identity struct {
	Subnet     netip.Prefix // masked, e.g. 192.168.1.0/24
	RouterIP   netip.Addr
	RouterMAC  string       // lower-case, colon-separated
}
type Network struct {
	Interface string
	Addr      netip.Prefix // interface address with its prefix length, e.g. 192.168.1.20/24
	Identity  Identity
}
func IsLAN(a netip.Addr) bool // a.Is4() && (a.IsPrivate() || a.IsLinkLocalUnicast())
func Detect() (Network, error)            // for "Trust this network": default route based
func Find(id Identity) (Network, error)   // for running: does the trusted network exist here now
```

- `Detect`: default IPv4 route (gateway IP, interface index); interface IPv4 whose prefix contains the
  gateway; router MAC from the ARP table. Errors (typed, `errors.Is`-able, user-facing text):
  `ErrNoRoute` ("No network connection."), `ErrNotLAN` (interface address not private or link-local:
  "This network is not a private local network."), `ErrNoRouterMAC` ("The router is not visible from
  this computer. A VPN may route all traffic, or the network was just joined; try again in a moment.").
- `Find`: does not need the default route, so it works while a VPN owns the default route. Find an up,
  non-loopback interface with an IPv4 address `a` where `netip.PrefixFrom(a, bits).Masked() ==
  id.Subnet`; look up `id.RouterIP` in the ARP table; MAC must equal `id.RouterMAC`. Errors:
  `ErrAway` (subnet on no interface), `ErrOtherRouter` (subnet present, MAC missing or different).
  Several interfaces on the subnet: pick the lowest interface index, deterministic.
- `lannet_linux.go`: `/proc/net/route` (fields `Iface Destination Gateway Flags ... Metric Mask`;
  hex little-endian; default = destination and mask `00000000`, flags `RTF_UP|RTF_GATEWAY`; lowest
  metric wins) and `/proc/net/arp` (`IP address HW type Flags HW address Mask Device`; only flags
  `0x2` complete entries; skip `00:00:00:00:00:00`). Both world-readable. Parsers take an `io.Reader`.
- `lannet_darwin.go`: default route from `route.FetchRIB(syscall.AF_INET, route.RIBTypeRoute, 0)`:
  `RouteMessage` with `RTF_UP|RTF_GATEWAY`, not `RTF_IFSCOPE` (macOS keeps scoped duplicates per
  interface), destination `0.0.0.0` with zero or absent netmask; gateway `*route.Inet4Addr`; interface
  from `rm.Index`. ARP from `route.FetchRIB(syscall.AF_INET, syscall.NET_RT_FLAGS, syscall.RTF_LLINFO)`
  parsed with `route.ParseRIB(route.RIBTypeRoute, b)` (same `rt_msghdr` layout, what `arp -an` reads):
  destination `*route.Inet4Addr`, gateway `*route.LinkAddr` with 6-byte `Addr`. Selection logic in
  plain functions over `[]route.Message` so they compile everywhere the file does.
- `lannet_other.go` (`!linux && !darwin`): both functions return `errors.ErrUnsupported`.
- Unit tests (parsers with several interacting rules qualify): Linux route parse (two defaults, metric,
  down route, non-gateway route, endianness), ARP parse (incomplete entry, zero MAC, device column).
  Darwin: compile check only (`GOOS=darwin GOARCH=arm64 go vet ./apps/kira-space/internal/lannet/`).

### Storage: migration `0023_p223_mobile_lan.sql`

```sql
-- P223: plain HTTP on the trusted LAN. Phones paired over HTTPS hold a Secure __Host- cookie that
-- plain HTTP never sends, so their rows are revoked; device tokens now expire.
ALTER TABLE mobile_devices ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE mobile_devices SET revoked_at = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE revoked_at IS NULL;
CREATE TABLE mobile_trusted_network (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  subnet      TEXT NOT NULL,
  router_ip   TEXT NOT NULL,
  router_mac  TEXT NOT NULL,
  interface   TEXT NOT NULL,
  trusted_at  INTEGER NOT NULL
);
UPDATE settings SET key = 'mobile.port' WHERE key = 'mobile.httpsPort';
DELETE FROM settings WHERE key = 'mobile.setupPort';
```

- `repos/mobiledevices.go`: `ExpiresAt int64` on `MobileDeviceRow`, in `mobileDeviceColumns`, `Insert`,
  `ByID`; `List` projects it. `model.MobileDevice.ExpiresAt int64 json:"expiresAt"`.
- New `repos/mobiletrustednetwork.go`: `MobileTrustedNetworkRepo{DB}` with `Get() (model.TrustedNetwork,
  bool, error)`, `Set(model.TrustedNetwork) error` (upsert id 1), `Clear() error`; registered in
  `repos.go`. `model.TrustedNetwork{Subnet, RouterIP, RouterMAC, Interface string; TrustedAt int64}`
  with json tags. `interface` is display only, never matched (Wi-Fi and Ethernet on one LAN both match).
- Settings: `MobileSettings{Enabled, Port, AgentInput}` (`json:"port"`, default 7790);
  `MobilePatch.Port`; `validateMobileSection` checks `port`; `readMobile`/`upsertMobile` use
  `mobile.port`. TS `settingsDomain.ts`: `port` replaces `httpsPort`/`setupPort`.

### Server: `internal/mobileweb`

Delete `certs.go`, `certs_test.go`, `setup.go`. Move the package doc comment to `server.go`, rewritten:
"serves the phone web app for the ADE agents module over plain HTTP on the trusted LAN interface".

`server.go`:
- `Config`: drop `CADir`, `HTTPSPort`, `SetupPort`, `Addrs`, `AddrPoll`; add `Port int`, `Network
  lannet.Network` (initial binding). Keep the rest.
- `Status{Running bool; AppURL string}`; `AppURL = "http://" + net.JoinHostPort(addr, port) + "/"`.
- Server fields: drop `ca`, `certs`, `bound []net.IP`, `mdns`, `leafExpires`, `tlsConf`, `setupMux`,
  `servers map`; add `net lannet.Network`, `srv *boundServer`, unexported seam `isLAN
  func(netip.Addr) bool` (default `lannet.IsLAN`; tests widen it to loopback).
- `Start`: one `net.Listen("tcp4", JoinHostPort(cfg.Network.Addr.Addr(), Port))`, no TLS, handler
  `s.guard(securityHeaders(s.appMux()))`. Refuse an unspecified, loopback or non-`isLAN` address with
  an error (defence in depth; `lannet` already guarantees it).
- `maintain`: keep the limiter and `touched` sweep; delete the leaf renew and address poll tickers. The
  bridge supervisor owns polling (below), since a stopped server must still notice the trusted network
  coming back.
- `refreshAddrs` becomes `SetNetwork(n lannet.Network)`, same P217 shape: no-op while stopped or when
  `n.Addr` is unchanged; else bind the new address first (failure keeps the old binding, logged, retried
  next poll), swap, close the old server, fire `OnStatusChanged`. Delete `sameIPs`, `renewLeaf`, `CA()`.
- `guard`: `peerAllowed(r.RemoteAddr)` and `hostAllowed(r.Host)` against `s.net` under `s.mu`.

`bind.go` (rename `lan.go`): delete `PrivateAddrs`, `dedupeIPs`, `mdnsName`. `peerAllowed`: parse,
`Unmap`, then `s.isLAN(peer) && s.net.Addr.Masked().Contains(peer)`. `hostAllowed`: Host (port optional)
must equal the bound address exactly; IP literal only, no `localhost`, no `.local` (DD8).

`headers.go`: CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src
'self' data:; connect-src 'self' ws://<Host>; frame-ancestors 'none'; base-uri 'none'; form-action
'none'`. Drop `manifest-src` and `worker-src` (`default-src` covers both). Keep the host regexp.

`auth.go`:
- Cookie `kira-space-device` (a `__Host-` name requires `Secure`, which plain HTTP never sends). `Path=/`,
  no `Domain`, `HttpOnly`, `SameSite=Strict`, `Secure: false`. `MaxAge` = seconds until the row's
  `expires_at`. Comment the trade-off: cookies are not port-scoped, so another HTTP service on the same
  IP would receive it.
- `deviceTTL = 30 * 24 * time.Hour` (DD1). New `verdictExpired` when `row.ExpiresAt <= now` (checked
  after the hash verify, before revoked, same constant-time path). `withDevice`: expired clears the
  cookie, counts as a failed attempt, answers 401 `E_EXPIRED` "device access expired".
- `sameOriginRequest`: Origin scheme must be `http` and host equal `r.Host`. Keep `Sec-Fetch-Site`
  optional (browsers send Fetch Metadata only to trustworthy origins, so on plain HTTP it is absent);
  the Origin check and `SameSite=Strict` remain the two layers.

`pairing.go`: `finishPairing` sets `ExpiresAt = now + deviceTTL`. `handlePair` treats a valid,
unexpired cookie as today.

`static.go`: delete the `init` `.webmanifest` registration and the install-prompt wording.

Tests (`mobileweb`): `newTestServer` and the live server bind `lannet.Network{Addr:
127.0.0.1/8}` and set `isLAN` to accept loopback; plain `http.Client`; origins `http://127.0.0.1:<port>`.
Delete `TestIntegration_SetupListenerServesOnlyTheCA`. Rework `rebind_test.go` to call `SetNetwork`
(127.0.0.1 then 127.0.0.2, both in 127.0.0.0/8): old address refuses, new answers, `OnStatusChanged`
fires. Add to `guard_test.go`: peer outside the bound prefix (403), public peer (403), `https://` Origin
on a write (403), Host `localhost` (403); `auth_test.go`: expired row gives 401 `E_EXPIRED` and clears
the cookie. Keep every other existing test.

`mobileterm`: no code change (verified: no scheme assumption). Run its tests.

### Bridge: supervisor and actions

`bridge/mobile.go` plus new `bridge/mobilenet.go`.

- `MobileStatus`: `Enabled, Running bool; Port int; AppURL string; AgentInput bool; Error string;
  StopReason string` (`""` running or disabled, `notTrusted`, `away`, `otherRouter`, `unavailable`);
  `StopDetail string` (user text); `Current *MobileNetwork` (what `Detect` sees now, nil on error);
  `Trusted *MobileNetwork`. `MobileNetwork{Interface, Address, Subnet, RouterIP, RouterMAC string}`.
- `MobileAccessService` fields: `Detect func() (lannet.Network, error)`, `Find func(lannet.Identity)
  (lannet.Network, error)` (defaults to `lannet`), `Poll time.Duration` (default 10 s, DD5). Private:
  supervisor state under its own mutex (`gate`, `current`, `stop chan`, `kick chan`).
- Supervisor loop `superviseNetwork(stop, kick)`, runs only while `mobile.enabled`. On start, on each
  tick and on `kick`:
  1. trusted := `MobileTrustedNetwork.Get()`; none: stop server, reason `notTrusted`.
  2. `n, err := Find(identity)`; `ErrAway`/`ErrOtherRouter`: stop server, reason `away`/`otherRouter`;
     other error: stop, `unavailable` with `err.Error()`.
  3. Match and stopped: `embedded.SetRunning(true)` with `n` (StartFn reads it from supervisor state).
     A start error (port in use) shows in `Error` and retries next tick.
  4. Match and running: `srv.SetNetwork(n)` (rebind on new DHCP address).
  5. `Current` from `Detect()` each tick for the pane. Emit `ChannelMobileStatus` only when the
     status value changed.
- Lifecycle: `StartMobileIfEnabled` starts the supervisor when enabled (replaces
  `embedded.StartIfEnabled`). `SetEnabled(true)` starts it, `SetEnabled(false)` stops it then the
  server. `StopMobile` stops both. `AttachPush` unchanged.
- New actions: `TrustCurrentNetwork() (MobileStatus, error)`: `Detect()`; error becomes `BadRequest`
  with the typed text; store `TrustedNetwork`; kick; return status. `ForgetNetwork() (MobileStatus,
  error)`: clear row, kick (server stops, `notTrusted`).
- `SetPorts` becomes `SetPort(MobileSetPortArgs{Port int})`; restart when running, as today.
- Delete `ResetCertificate`, `mobileCADir`, `MobileSetPortsArgs`.
- Legacy CA cleanup: `removeLegacyMobileCA()` in `StartMobileIfEnabled` (runs every boot, idempotent):
  remove `KiraSpaceHome()/mobile/ca.key`, `ca.crt`, any `*.tmp`, then the directory if empty; log at
  info when it removed something. The key must not linger: phones that installed the CA would trust any
  leaf it signs for private addresses (DD9).
- Tests (`bridge/mobilenet_test.go`; state machine with interacting rules): fake `Find`/`Detect`, real
  repos on a temp DB. Sequence: enabled with no trust (stopped, `notTrusted`); trust (running, AppURL on
  the fake address); `Find` returns `ErrAway` (stopped, `away`); back (running); same identity, new
  address (AppURL changes, still running); forget (stopped). Fake networks use 127.0.0.x so the real
  server binds; the bridge never needs the `isLAN` seam because peer checks are not exercised here.

`main.go`: no new wiring beyond defaults; keep `//go:embed all:frontend/dist-mobile`. Check
`mobileSvc` construction still compiles.

### Desktop UI

- `packages/shared/domain/mobile.ts`: status schema to the new `MobileStatus` (with
  `mobileNetworkSchema`); `mobileDeviceSchema` gains `expiresAt`.
- `frontend/src/bridge/index.ts`: `mobileSetPort(port)`, `mobileTrustNetwork()`, `mobileForgetNetwork()`;
  delete `mobileSetPorts`, `mobileResetCertificate`. Regenerate bindings (prepare script codegen).
- `state/mobileAccess.ts`: `DEFAULT_STATUS` to the new shape; `setPort`, `trustNetwork`, `forgetNetwork`;
  delete `setPorts`, `resetCertificate`.
- `MobileAccessPane.vue` (Tailwind, shadcn-vue `Alert`, `Button`, `Field`, `Switch`; existing confirm
  store):
  1. Enable switch and description ("A phone on your trusted home network pairs once ...").
  2. Warning, always visible, `Alert variant="warn"`, `data-testid="mobile-access-plaintext-warning"`:
     "The phone talks to Kira Space over plain HTTP. Anyone on the same network can read the board,
     backlog and terminal output it shows, and can copy the phone's access and act as that phone until
     it expires or you revoke it. Turn this on only on a network you control, such as your home Wi-Fi."
  3. Network section `data-testid="mobile-access-network"`: trusted line (subnet, router IP, router MAC,
     interface, date) or "No trusted network."; current line from `status.current`; "Trust this network"
     button (confirm dialog naming subnet and router MAC, text repeats the warning's first sentence;
     disabled when `current` is null or equals trusted); "Forget" button when trusted.
  4. Running: one QR (`MobileQr`) plus the URL. Stopped while enabled: reason text
     `data-testid="mobile-access-stopped-reason"` from `stopDetail` (e.g. "Stopped: this computer is not
     on the trusted network 192.168.1.0/24.").
  5. Agent input switch (unchanged), single Port field and Apply.
  6. Paired phones: active = not revoked and `expiresAt > now`; each row adds "Access expires in
     {formatRelative}". Revoke unchanged.
  Drop: certificate step, setup QR, fingerprint, Reset certificate, setup port, `reachable()` loopback
  filter.
- `tests/ui/support/mockRuntime.ts`: new status default and handlers for `SetPort`,
  `TrustCurrentNetwork`, `ForgetNetwork`; drop `ResetCertificate`.
- `tests/ui/mobile-access.spec.ts` rewrite: warning visible when off and on; enabled without trust
  shows `notTrusted` reason and no QR; Trust, confirm, then QR and `http://192.168.1.20:7790/`;
  status event with `away` shows the reason and hides the QR; Forget; device row shows expiry; expired
  device hidden; port apply. Keep the agent-input test.

### Phone app

- `vite.mobile.config.ts`: remove `VitePWA` import and plugin; rolldown input `index` only.
- `tsconfig.mobile.json`: drop `vite-plugin-pwa/client` from `types`.
- `main.ts`: drop `registerSW`.
- `index.html`: drop `apple-mobile-web-app-capable`, `mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `apple-touch-icon` (DD12).
  Keep viewport, `theme-color`, favicon.
- Delete `setup.html`, `setup/` (both files), `public/pwa-192x192.png`, `public/pwa-512x512.png`,
  `public/maskable-icon-512x512.png`, `public/apple-touch-icon-180x180.png`. Keep `favicon.ico`.
- `state/useAdeWrites.ts` `newIntentKey`: RFC 4122 v4 from `crypto.getRandomValues` (16 bytes, set
  version and variant bits, hex with dashes). Six lines; the requirement no library adds anything to is
  working on an insecure origin, where `crypto.randomUUID` is undefined (DD13). The server already
  parses it with `uuid.Parse`.
- `PairScreen.vue`: delete the `isSecureContext` alert. Add one muted line under the intro: "This
  connection is not encrypted. Use it only on your home network." Copy "It is read-only" is stale since
  P212 Part 2; change to "the computer must approve this phone first".
- `state/auth.ts`: phase `expired` on `E_EXPIRED` (via `onUnauthorized`); `PairScreen` notice "Access
  for this phone expired. Request access again."
- `terminal/useRemoteTerminal.ts`: build the socket URL with `ws://${location.host}` (no `https`
  branch).
- Root `package.json`: remove `@vite-pwa/assets-generator`, `vite-plugin-pwa`, `workbox-window`; `bun
  install` to update `bun.lock`.
- `knip.json`: drop `mobile/setup.html`, `mobile/setup/main.ts` entries.
- `scripts/prepare-worktree.sh`: build-skip check on `index.html` only; comment unchanged otherwise.
- Playwright: delete `tests/mobile/pwa.spec.ts`; `mockServer.ts` drop `.webmanifest`, fix the header
  comment (no service worker), answer `E_EXPIRED` when `state.auth = 'expired'`; `pairing.spec.ts` adds
  the expired notice case.
- New `tests/mobile/insecure-origin.spec.ts`, Chromium only (`test.skip` on WebKit: no host mapping):
  add `launchOptions.args: ['--host-resolver-rules=MAP kira-lan.test 127.0.0.1']` to the
  `mobile-android` project in `playwright.config.ts`; open `http://kira-lan.test:<port>/`; assert
  `window.isSecureContext === false`, no `navigator.serviceWorker.controller`; pair; add a backlog item
  (exercises `newIntentKey` and the `Idempotency-Key` header); open the terminal screen and see the
  scripted `hello` (exercises `ws://`).

### Docs

- `docs/ARCHITECTURE.md` "Mobile agents web": rewrite Transport (one plain-HTTP listener on the trusted
  interface address, peer and Host checks, why no TLS), replace Certificates with "Trusted network"
  (`lannet`, identity = subnet + router IP + router MAC, `Detect` vs `Find`, 10 s supervisor, stop
  reasons, VPN case, MAC spoofing is not prevented: a convenience guard against using it away from
  home, not authentication), Pairing (cookie `kira-space-device`, not Secure, 30-day expiry, legacy rows
  revoked by 0023, cookie not port-scoped), CSP line (`ws://`), Frontend (drop PWA sentence and icons),
  Desktop UI (pane contents), Tests (drop `pwa`, add `insecure-origin`, `lannet`, `mobilenet_test`).
  `vite-plugin-pwa` appears only in that section (line ~4168), not in the Stack table.
- Known open items: rewrite the P212 real-phone item (drop CA install, installed PWA, service worker
  offline, backgrounded PWA; keep soft keyboard, touch drag; add `lannet` on macOS: route and ARP RIB
  parsing compile-checked only, and whether accepting LAN connections raises the macOS Local Network
  prompt; drop the stale "bound addresses stay fixed until toggle or restart"). Add "Mobile traffic is
  plaintext on the LAN (P223)": what a LAN observer can read and do, mitigations (trusted network only,
  30-day expiry, revoke). Delete the P217 "rebind on a real network change" line if present there.
- `docs/DEV_ENVIRONMENT.md` mobile section: drop the Icons bullet; Phone bullet becomes: enable, Trust
  this network, scan the QR, approve the code; one line telling users who installed the old "Kira Space
  local CA" profile to remove it (iOS: Settings > General > VPN & Device Management; Android: Settings >
  Security > Encryption & credentials > User credentials). Tests bullet: drop the offline-reload line,
  mention `insecure-origin.spec.ts`.
- `docs/PACKAGING.md`: dist-mobile paragraph unchanged in substance; no PWA files remain (check text).
- `NOTICES.md`: nothing (no PWA entry existed). `lannet` adds no dependency.
- `docs/v2.2/SPEC.md`: P223 status and result section at the end of the phase.

## Commits (each hook-green; never `--no-verify`)

Pre-commit runs lint and typecheck over the whole tree, so the Go API change and the desktop TS that
calls it land together (bindings are regenerated from Go).

1. `feat(lannet): detect and find the trusted LAN by subnet and router MAC` (package, Linux parser
   tests).
2. `refactor(mobile)!: drop the PWA, setup page and secure-context APIs` (phone app, vite and tsconfig,
   deps and `bun.lock`, knip, prepare script, `pwa.spec.ts` removal, mockServer, `PairScreen`,
   `newIntentKey`, `useRemoteTerminal`). The Go setup listener still exists until commit 3 and answers
   404 for the missing `setup.html`; harmless for one commit.
3. `feat(mobileweb)!: plain HTTP on the trusted LAN interface only` (migration 0023, repos, model,
   settings rename, `mobileweb` deletions and rewrites, bridge supervisor and actions, legacy CA removal,
   Go tests, `shared/domain/mobile.ts`, `bridge/index.ts`, `mobileAccess.ts`, `MobileAccessPane.vue`,
   `settingsDomain.ts`, `mockRuntime.ts`, `mobile-access.spec.ts`, phone `E_EXPIRED` handling).
4. `test(mobile): insecure-origin spec and expired pairing` (Playwright config arg, new spec, pairing
   case), plus any fixes the suite run finds as their own `fix:` commits.
5. `docs: P223 plain-HTTP trusted-LAN mobile web` (ARCHITECTURE, DEV_ENVIRONMENT, PACKAGING if touched,
   SPEC result, status Done).

## Verification (once, near the end)

- `go build ./...`; `go vet ./apps/kira-space/...`; `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go vet
  ./apps/kira-space/internal/lannet/`; `go test -race ./apps/kira-space/internal/lannet/
  ./apps/kira-space/internal/mobileweb/ ./apps/kira-space/internal/mobileterm/
  ./apps/kira-space/internal/bridge/ ./apps/kira-space/internal/storage/...`; golangci-lint (0 issues).
- `bun run typecheck`, `bun run lint`, `bun run lint:dead`.
- `bun run build:space-mobile`, then: `ls apps/kira-space/frontend/dist-mobile` shows only
  `index.html`, `favicon.ico`, `assets/`; for each of `randomUUID`, `serviceWorker`, `crypto.subtle`,
  `navigator.clipboard`, `isSecureContext`, `workbox`: `cat dist-mobile/assets/*.js | grep -o <term> |
  wc -l` is 0. Any non-zero hit from a third-party bundle gets named in the result with why it is
  unreachable, never ignored.
- `bun run test:ui:space-mobile` (both projects); `bun run test:ui:space -- mobile-access
  ade-tui-takeover`.
- Live check on this machine: build with `-tags server`, enable, Trust, `curl -s -o /dev/null -w
  '%{http_code}' http://<lan-ip>:7790/` is 200; same from `127.0.0.1` refuses to connect; a request with
  `Host: evil.test` is 403.
- Leftover greps, each must print nothing (history under `docs/v*` excluded):
  - `git grep -n -i -E "workbox|serviceworker|service worker|webmanifest|manifest-src|worker-src|vite-plugin-pwa|virtual:pwa|pwa-assets|registerSW|apple-mobile-web-app|mobile-web-app-capable|maskable" -- . ':!docs/v*' ':!bun.lock'`
  - `git grep -n -E "crypto/tls|crypto/x509|IssueLeaf|LoadOrCreateCA|ResetCA|CertHolder|mobileCADir|ResetCertificate|resetCertificate|kira-space-ca|mobileconfig|setup-info|setupPort|SetupPort|setupUrls|httpsPort|HTTPSPort|LeafExpires|leafExpires|__Host-kira|PrivateAddrs|mdnsName" -- apps packages scripts knip.json package.json`
  - `git grep -n -i -E "certificate|fingerprint|https:|wss|isSecureContext|randomUUID|setup\.html" -- apps/kira-space/internal/mobileweb apps/kira-space/internal/mobileterm 'apps/kira-space/internal/bridge/mobile*.go' apps/kira-space/frontend/mobile apps/kira-space/frontend/src/workbench/settings/MobileAccessPane.vue apps/kira-space/frontend/src/state/mobileAccess.ts packages/shared/domain/mobile.ts apps/kira-space/tests/mobile apps/kira-space/tests/ui/mobile-access.spec.ts`
  - `git grep -n -E "\bCA\b|100\.64|[Tt]ailscale" -- apps/kira-space docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md` (expect no mobile hit; any unrelated hit is listed in the result).
  - `ls apps/kira-space/frontend/mobile/public` prints only `favicon.ico`.
- `test:visual:space`: Settings dialog snapshots change again. Not regenerated here (sandbox fonts);
  say so in the result.

## Deferred decisions (bold = default the implementer applies)

- DD1 Device token lifetime: **30 days fixed from pairing, re-pair after**. Alternatives: 7 days; 90
  days; sliding expiry renewed on use (keeps a sniffed token alive while used, so not default).
- DD2 Phones paired before P223: **revoked by migration 0023** (their Secure `__Host-` cookie never
  travels over plain HTTP). Alternative: leave rows, they simply fail auth.
- DD3 **One trusted network**, replaced by a new Trust. Alternative: a list.
- DD4 Identity: **subnet + router IP + router MAC; interface name display only**. Alternative: add the
  interface name (blocks Wi-Fi/Ethernet switching on the same LAN).
- DD5 Supervisor poll: **10 s**. Alternative: 30 s; a netlink/route-socket subscription (two
  platform-specific watchers for a few seconds' gain).
- DD6 Ports: **one port, `mobile.port`, default 7790**; setup port gone.
- DD7 **IPv4 only**, as today.
- DD8 App URL and Host check: **bound IP only**; `.local` name and `localhost` dropped.
- DD9 Old CA files: **deleted at every boot when present**; docs tell users to remove the profile from
  phones. Alternative: also a one-time pane notice.
- DD10 Router not in the ARP table: **report `otherRouter`/`ErrNoRouterMAC` and retry next poll, send
  no probe traffic** (a UDP nudge could raise the macOS Local Network prompt).
- DD11 Plaintext warning: **always visible in the pane, one line on the phone pair screen**.
- DD12 iOS home-screen metas and touch icon: **dropped** (standalone mode is the PWA behaviour the user
  dropped). Alternative: keep the touch icon for a plain bookmark.
- DD13 Idempotency key: **six-line v4 from `getRandomValues`**. Alternative: add the `uuid` package.
- DD14 VPN owning the default route: **`Find` ignores the default route, so a trusted LAN still matches
  with a VPN up; Trust needs the default route on the LAN**.

## Out of scope

IPv6; a TLS option; Tailscale or any remote access; mDNS advertisement; changing `mobileterm`, the ADE
write routes, idempotency or rate-limit numbers; regenerating visual baselines.
