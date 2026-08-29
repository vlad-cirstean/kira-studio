# P55 — Go application services: secrets/Keychain, connections, preconnect, tree, oplog, metrics

> Sequences P52's §4.1/§6/§8.4 against the tree as it stands after P53 and P54. P52 §4–§10 are
> settled and are not reopened here; where this plan departs from P52 it is because reading the
> actual source (or the actual `keybase/go-keychain` module) disproved or refined something, and
> each such case is called out with its evidence. P52 §15: **G1 is the only gate in this migration
> and it has passed at 261.7 MB.** No gate here.

## 0. What this phase is, and what it is not

P52's phasing table (~line 71) assigns P55: *"Go application services: connections,
secrets/Keychain, preconnect, tree, files, oplog, metrics — No [`src/` changes]"*.

Concretely, seven Go packages and one bridge completion:

1. **`internal/logging`** — `src/main/log.ts`'s port. Not in the phasing row's word list, but P54
   §1.6 explicitly assigns it here (*"When P55 ports `src/main/log.ts` into `internal/logging` and
   calls `slog.SetDefault`, every engine line lands in `logs/kira-YYYY-MM-DD.log` with zero change
   to this package"*). Every other package in this phase logs, so it goes first.
2. **`internal/notify`** — a 40-line generic emitter replacing the `Set<handler>` idiom
   `connections.ts`, `preconnect.ts` and `oplog.ts` each hand-roll. §2 D1.
3. **`internal/secrets`** — P52 §6 in full: `keybase/go-keychain`, AES-256-GCM, the `kira:v2:`
   envelope, the per-platform probe, the darwin-only real-Keychain test.
4. **`internal/preconnect`** — `src/main/preconnect.ts`'s port, settle window and sidecar
   semantics preserved exactly.
5. **`internal/connections`** — `src/main/connections.ts`'s port: the full lifecycle service, the
   in-memory state map, the in-flight-connect dedupe, `MarkAllErrored` wired to P54's
   `Host.Subscribe()`/`EventEngineDown`.
6. **`internal/tree`** — `src/main/tree-service.ts`'s port, plus the `model/tree.go` and
   `model/definition.go` structs it is the first consumer of.
7. **`internal/oplog`** — `src/main/oplog.ts`'s port, including the 500-op prune counter and the
   `engine:down` in-flight reconciliation (P54's other named consumer).
8. **`internal/metrics`'s ticker** — the one part of P52 §8.4 that is genuinely unbuilt. §6.
9. **`bridge/connections.go` completed (12 methods) and `bridge/tree.go` added (4 methods)** — the
   direct 1:1 surface of the two services this phase builds. §7 explains why this and no more.

**Not in this phase.**

- **No `src/` change of any kind.** §9 checks this rather than assuming it.
- **`ipc/files.ts` is not ported here — it moves wholly to P56.** §6.2 gives the reasoning and
  hands P56 the exact Wails API surface, read from the module cache for this plan.
- No `bridge/events.go`, no `bridge/stream.go`, no `bridge/files.go`, no `bridge/queries.go`, no
  `bridge/lifecycle.go`, no `SettingsService.Set`, no `OpsService.Cancel`, no menu, no window
  bounds, no security posture — **P56**.
- No `docs/` updates — P52 §14 assigns those to P57.

## 1. What reading the current tree and the real dependency found

### 1.1 `keybase/go-keychain`: pulled, read, and **it meets P52 §6.2's requirement in full**

P52 §6.3 flagged the library choice as *"made from prior knowledge … not from a build in this
session"* and required the P53/P55 implementer to *"pin an exact version, confirm the attribute API
surface against the pulled source under `$GOPATH/pkg/mod`"*, with `99designs/keyring` as the named
fallback if non-synchronizable generic passwords turned out not to be expressible.

**Done for real while writing this plan.** `proxy.golang.org` is reachable from this sandbox;
`go mod download github.com/keybase/go-keychain@latest` resolved to **`v0.0.1`** and the source is
now at `$(go env GOPATH)/pkg/mod/github.com/keybase/go-keychain@v0.0.1`. What the source says:

| P52 §6.2 requires | v0.0.1 provides | Where |
|---|---|---|
| `kSecClassGenericPassword` | `item.SetSecClass(keychain.SecClassGenericPassword)` | `keychain.go:269` |
| service `Kira Studio Safe Storage` | `item.SetService(string)` | `keychain.go:292` |
| account `Kira Studio` | `item.SetAccount(string)` | `keychain.go:323` |
| `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` | `item.SetAccessible(keychain.AccessibleWhenUnlockedThisDeviceOnly)`, mapped to the real `C.kSecAttrAccessibleWhenUnlockedThisDeviceOnly` | `keychain.go:366`, `macos.go:19` |
| `synchronizable = false` | `item.SetSynchronizable(keychain.SynchronizableNo)`, mapped to `C.kCFBooleanFalse` | `keychain.go:357`, `keychain.go:206-211` |
| `SecItemAdd` / `SecItemCopyMatching` / `SecItemDelete` | `AddItem` / `QueryItem` / `DeleteItem` | `keychain.go:416/489/595` |
| arbitrary 32 raw bytes as the item value | `SetData([]byte)` → `BytesToCFData` → `CFDataCreate` | `keychain.go:343`, `corefoundation.go:47/199` |

**Conclusion: `keybase/go-keychain v0.0.1` is confirmed and P52 §6.3's `99designs/keyring` fallback
is not needed.** Pin `github.com/keybase/go-keychain v0.0.1` exactly.

**Six gotchas the source turned up, every one of which would be a bug if guessed:**

1. **`keychain.GetGenericPassword()` must not be used.** Its query (`keychain.go:633`) sets service,
   account, label and accessGroup but **not** `kSecAttrSynchronizable`. Our item is added with
   `SynchronizableNo`, so the query must set it too, or matching depends on the OS's default
   query-time synchronizable semantics. Build the query `Item` by hand and set
   `SetSynchronizable(SynchronizableNo)` on **both** the add and the query.
2. **Not-found is `(nil, nil)`, not an error.** `QueryItemRef` maps `errSecItemNotFound` to
   `(0, nil)` (`keychain.go:475-477`), so `QueryItem` returns an empty slice with a nil error. A
   `if err != nil` check alone treats "no key yet" as success with zero bytes.
3. **`AddItem` does not upsert** — it returns `keychain.ErrorDuplicateItem` (`keychain.go:36`). The
   load-or-create path must handle that by re-querying, not by failing.
4. **`SetString(key, "")` deletes the attribute** (`keychain.go:283-290`). Never pass `""` for
   service or account, and note that `NewGenericPassword(service, account, label, data,
   accessGroup)` is safe to call with `""` for label/accessGroup precisely because of this.
5. **The library exposes no `kSecUseDataProtectionKeychain`** (grepped: zero hits anywhere in the
   module). Items therefore land in the legacy file-based macOS keychain. The library's own comment
   on `SecClassGenericPassword` (`keychain.go:137-146`) reproduces Apple's caveat that
   `kSecAttrAccessible` applies on OS X *"if `kSecAttrSynchronizable` [is] specified"* — which our
   design does specify, explicitly, as `false`. **This does not change the design and needs no
   fallback**, but it is the one attribute whose enforcement cannot be proven from this sandbox, so
   §5.1's darwin-only test reads the item's attributes back and the implementing session records
   what macOS actually returns. The security property that actually matters — a key that does not
   silently reappear on another machine — is delivered either way, and the existing user-facing
   message ("may have been written on a different machine or after a keychain reset") is already
   the correct behaviour for the failure case (P52 §6.4).
6. **On Linux the module still compiles.** `keychain.go`/`corefoundation.go`/`datetime.go` are
   `//go:build darwin`-tagged, but `util.go` has no tag, so `import "github.com/keybase/go-keychain"`
   from a Linux build yields a package containing only `RandomID`/`RandBytes` rather than a
   "build constraints exclude all Go files" error. That is a trap, not a convenience: a reference to
   `keychain.NewItem` from an untagged file would fail on Linux with a confusing *undefined*.
   §4.3 puts the import in a `//go:build darwin` file and nowhere else.

**Dependency hygiene.** `keybase/go-keychain`'s own `go.mod` requires `keybase/dbus`,
`golang.org/x/crypto` and `stretchr/testify`, but only its `secretservice/` subpackage (Linux
D-Bus) needs them. We import the root package only, so `go mod tidy` must **not** add those three
to `shell/go.mod`'s build list. If it does, the implementing session has accidentally imported
`secretservice` — stop and fix, do not vendor a D-Bus client into this app.

### 1.2 `src/main/connections.ts`: what the 409 lines actually contain

Read in full. Every behaviour, and where it lands:

| Behaviour (line) | Go |
|---|---|
| `states` Map + `stateOf` default (`:73`, `:101`) | `map[string]model.ConnectionState` under a `sync.Mutex`; the same synthesised `disconnected` default |
| `emitState`/`emitInvalidated`/`emitListChanged` (`:84`-`:99`) | three `notify.Emitter`s (D1) |
| `resolve()` — read row, decrypt secret, strip `preconnect`/`preconnectSidecar`, inject URI password (`:117`) | `resolve.go`, §4.5 |
| `resolveFromInput()` — id `'test'`, sortOrder 0, empty timestamps (`:139`) | same, verbatim |
| `preconnect.onExit` → best-effort `adapter:disconnect` + an `error` state whose text names exit/signal + stderr tail (`:154`) | §4.5, with the disconnect call moved onto its own goroutine (D6) |
| `doConnect` — `connecting` state, preconnect start, 20 s `adapter:connect`, `arm()` on the sidecar checkbox, the post-`arm()` `error` re-read (`:201`), `connected` state, `dropCached` + invalidate push, and `preconnect.stop` on any failure (`:170`) | `doConnect`, §4.5 |
| `create` — URI-mode `uri` nulling, `stripUriPassword`, **encrypt-before-insert** (P25 D6, `:252`), insert, `secrets.set`, list broadcast (`:236`) | same order, exactly |
| `update` — the three-state password convention (`null` unchanged / `''` clear / non-empty replace) and **secret-before-row** ordering (`:279`) | same |
| `duplicate` — ` copy` suffix, raw column copy (P25 D11) (`:290`) | same |
| `remove` — disconnect if connected/connecting, stop preconnect, delete row (cascades), delete secret, drop state (`:307`) | same |
| `reorder`, `reveal` (catches, never throws — P25 D9), `test` (always stops preconnect in `finally`) (`:319`-`:352`) | same |
| `connect` in-flight dedupe (D11, `:354`) | `map[string]*attempt` + a `done` channel; nine lines, no `golang.org/x/sync` (P52 §4.1) |
| `markAllErrored` (`:396`) | §4.5, subscribed to `EventEngineDown` |
| `shutdown` → `preconnect.stopAll()` (`:405`) | same |

Two things that are **not** there and must not be invented:

- **Nothing in `src/main` consumes `ENGINE_EVENT.connectionState`.** `src/engine/control.ts:61`
  emits it; grepping all of `src/main` for consumers of engine events returns exactly five sites
  (`index.ts:105` `engine:down`; `oplog.ts:33/65/101` `op:start`/`op:end`/`engine:down`) and none of
  them is `connection:state`. The Go connections watcher therefore subscribes for **`engine:down`
  only**.
- There is no auto-reconnect, no retry and no backoff anywhere in this file.

### 1.3 `src/main/secret-cipher.ts`: the strings are the contract

111 lines, and the load-bearing part is four literal strings the connection dialog renders verbatim.
Reproduced here so the Go port does not paraphrase them (§4.3 uses these byte for byte):

- darwin unavailable — `The macOS Keychain is unavailable, so passwords cannot be saved. Everything else about this connection can be.`
- linux unavailable — `No system keychain is available on Linux in this build. Set KIRA_INSECURE_SECRETS=1 for local development, or run on macOS.`
- any other platform — `Credential storage is only supported on macOS in this build.`
- decrypt failure — `The stored credential could not be decrypted (<detail>). It may have been written on a different machine or after a keychain reset — re-enter it to fix this connection.`

`src/shared/domain/secrets.ts` (14 lines) confirms the wire shape is exactly
`{available: bool, backend: 'keychain'|'basic_text'|'unavailable', insecureFallback: bool, reason: string|null}`.
`shell/internal/bridge/connections.go`'s existing `SecretStorageStatus` struct already matches it
field for field and tag for tag — §4.3 **moves** that struct into `internal/secrets`, it does not
change it.

`createSecretCipher()` never throws: an unavailable backend is a valid cipher whose `encrypt`/
`decrypt` throw `SecretStoreError`. `secrets.New()` keeps that signature (no error return).

### 1.4 `src/main/preconnect.ts`: three details a casual port loses

- **`'close'`, not `'exit'`** (`:166`, with its own comment): the exit handler must not run before
  the stderr pipe has finished delivering, or the rejection message loses its tail. The Go analogue
  is P54 §1.2's own lesson — read the stderr pipe to EOF **before** calling `cmd.Wait()`.
- **`stdio: ['ignore', 'pipe', 'pipe']`** pipes stdout and then never reads it, which would block a
  chatty script on a full pipe. Go's `cmd.Stdout = nil` (`/dev/null`) is the same intent without the
  hazard — §4.4 D8 records this as a deliberate, strictly-better difference.
- **`PATH` augmentation** (`:119`) appends `:/usr/local/bin:/opt/homebrew/bin`. In Go this must be
  done by *replacing* the `PATH=` entry in the copied environment, not by appending a second one.

### 1.5 `src/main/oplog.ts`: confirmed, including the prune trigger

`PRUNE_EVERY_OPS = 500` (`:16`); `pruneOps` runs **once at wiring time** (`:28`) and again every
time `completedSincePrune` reaches 500 on an `op:end` (`:90-94`). The `engine:down` handler
(`:101`) drains `inFlight` and finishes each row as `status: 'error'`, `durationMs: Date.now() -
Date.parse(startedAt)`, `error: 'engine process exited'` — the same words P54's `waitAndFail`
already uses for pending calls. `OpsRepo.Append`/`Finish`/`Prune` all exist from P53; this phase
adds no SQL.

### 1.6 `src/main/tree-service.ts`: `safeParse` has no free Go equivalent

The cache-aside logic ports mechanically, but `zod`'s `safeParse` does the load-bearing work at
three points (`:86`, `:114`, `:134`) and **`json.Unmarshal` is not a substitute** — it happily
decodes `{}` into any struct, so a naive port makes the "drop the cached row" path dead code.
§4.6 specifies the explicit checks that replace it, and §5.6 requires a test whose cached payload
fails one of them.

Also confirmed: `model/tree.go` and `model/definition.go` **do not exist**. P53's model package
(`connection, layout, ops, queries, settings, tabs, time, treefilter`) has no tree types because
`MetadataCacheRepo` stores `json.RawMessage` and needed none. `internal/tree` is the first consumer,
so those structs land in this phase.

### 1.7 `src/main/ipc/files.ts`: read, and it does not belong in this phase

54 lines, and every one of them is Electron-`dialog` translation: `dialog.showSaveDialog` /
`showOpenDialog`, `BrowserWindow.fromWebContents(event.sender)` for modal attachment,
`app.getPath('downloads')`, and `basename()`/`stat()` around the result. There is **no application
service behind it** — nothing to put under `internal/`. §6.2 resolves it to P56 and hands P56 the
Wails API it will need.

### 1.8 `internal/metrics` is done except for the timer

`sampler.go` (P52 M1, refined during G1 on real hardware) already does the whole of P52 §8.4's
measurement: the RSS sum, the CPU delta against the previous sample, `MatchingPIDs`, and
`AppProcessSet`'s darwin `responsibility_get_pid_responsible_for_pid` filter. What is missing is
the 5 s cadence (`APP_METRICS_INTERVAL_MS`, `src/main/index.ts:119`) and a place for the process-set
needles to live other than `cmd/g1measure`'s flag defaults. §6.1 scopes that precisely.

## 2. Decisions

**D1 — `internal/notify.Emitter[T]`, one leaf package, replacing three hand-rolled handler sets.**
`connections.ts` has three `Set<handler>` + `on*(cb) => unsubscribe` pairs, `preconnect.ts` has a
fourth, `oplog.ts` needs a fifth and the metrics ticker a sixth. Six copies of add/remove/snapshot/
call-with-a-mutex is worse than one 40-line generic. `Emit` **snapshots the subscriber list under
its own lock and then calls the callbacks unlocked**, so a subscriber that subscribes or
unsubscribes re-entrantly cannot deadlock — the exact class of bug P54's §1.2 found three of.
Callers must likewise never hold their own service mutex across an `Emit`.

This is a deviation from P52 §2.1's file list, which names no such package. Justified on the same
grounds §2.1 gives for `metrics/` and `bridge/events.go`: it replaces an idiom, not a file.

**D2 — `internal/secrets` builds one key, not one item per credential, and the load-or-create round
trip *is* the darwin probe.** P52 §6.5 says *"probe by writing and reading back a canary item at
startup"*. A canary is strictly weaker and leaves litter in the user's Keychain: the real key's
load-or-create already writes and reads back, and it proves the *actual* item the app depends on is
reachable. The contract §6.5 cares about — probed once at startup, never changing for the process's
life, same four status shapes, same reason strings — is preserved exactly. Mechanism differs,
contract does not.

**D3 — the platform probe is injectable so all four status branches are testable on Linux.**
`New()` is a thin wrapper over an unexported `probe(goos, insecureEnv string, load func() ([]byte,
error)) (Status, []byte)`. Without this, three of the four `SecretStorageStatus` shapes P52 §13's
`secrets` row demands coverage of are unreachable from any machine that is not simultaneously
darwin and non-darwin. This is not a mock of the Keychain — the darwin *key source* stays a real
Keychain call, tested for real in §5.1's build-tagged file.

**D4 — the `kira:v2:` envelope is `"kira:v2:" + base64std(nonce ‖ seal)`, nonce 12 bytes, fresh per
encrypt.** `crypto/aes` + `crypto/cipher` + `crypto/rand`, all stdlib — no crypto dependency is
added. A non-enveloped value is an `E_SECRET_STORE` error, never a passthrough (P52 §6.4).

**D5 — every error crossing out of `internal/secrets`, `internal/connections` and `internal/tree` is
an `*ipcerr.Error`.** P54 D5 established this for `enginehost` and the reasoning is identical: the
bridge must not have to re-classify a bare `error`. Codes used: `E_SECRET_STORE`, `E_DISCONNECTED`,
`E_BAD_REQUEST`, `E_ENGINE_DOWN` (from `enginehost`, passed through untouched), `E_INTERNAL`.

**D6 — a callback that can block for seconds never runs on a shared event goroutine.** Two places:
the preconnect exit handler's best-effort `adapter:disconnect` (30 s worst case) runs in its own
goroutine, exactly as `connections.ts:155`'s `void … .catch(() => {})` does; and `MarkAllErrored`'s
`preconnect.Stop` calls run **synchronously on the engine-down watcher goroutine**, because that
goroutine has nothing else to do once the engine is gone and a deterministic shutdown is worth more
there than concurrency.

**D7 — `States()` returns a slice sorted by connection id.** `[...states.values()]` is Map insertion
order in JS; Go map iteration is randomised, so a literal port would hand the renderer a different
order on every call. The renderer keys by `connectionId` and does not depend on order, so sorting is
free, deterministic, and makes the tests assertable.

**D8 — `preconnect` gives the child `/dev/null` for stdout, not a pipe nobody reads.** §1.4.

**D9 — `settleWindow` and `killGrace` are package `var`s, not `const`s.** P54 D10 set this
precedent for `maxDataFrameBytes`. Without it every sidecar test costs 2 s of wall clock; with it,
an internal test file lowers them and the suite stays fast. The production values stay 2 s/2 s.

**D10 — URI password strip/inject is string surgery on the userinfo segment, not `net/url`
re-serialisation.** `stripUriPassword`/`injectUriPassword` (`src/shared/domain/uri.ts:48-70`) are
built on WHATWG `URL`, whose serialisation Go's `net/url` does not reproduce: `net/url`'s
`User.Password()` uses a different percent-encode set than `encodeURIComponent`, and `URL.String()`
normalises scheme/host/path differently. Editing only the userinfo segment (a) keeps the user's own
spelling of their URI in the stored column instead of silently rewriting it, (b) avoids a
double-encoding bug at the one place a password crosses in and out, and (c) is exactly as much
parsing as the job needs. `encodeURIComponent`/`decodeURIComponent` are ported literally — **not**
`url.QueryEscape`/`QueryUnescape`, which map space to `+`. §4.5 gives the algorithm and §5.4 the
parity table.

**D11 — `ipcerr.Disconnected`'s message changes to match `tree-service.ts:77` verbatim.** It
currently produces `"not connected: <name>"`; the TS produces `"<name> is not connected"`, which is
what the user sees today. Grepped for this plan: `ipcerr.Disconnected` has **zero callers** anywhere
under `shell/`, so this is free.

**D12 — engine op names move to an exported `internal/enginehost/ops.go`.** `config.go` currently
holds `configureCacheOp = "cache:configure"` unexported, and P55 adds six more call sites across two
packages. AGENTS.md's P54 finding is explicit that these literals must be read from
`src/shared/protocol/engine-ops.ts` rather than inferred; one exported block, each constant
carrying its TS identifier in a comment, is the way to make that check happen once instead of seven
times. Verified for this plan against `engine-ops.ts:9-19`: `adapter:connect`, `adapter:disconnect`,
`adapter:children`, `adapter:describe`, `adapter:definition`, `adapter:test`, `adapter:cancel`,
`cache:configure`. Event topics, from `:21-25`: `op:start`, `op:end`, `connection:state`.

**D13 — `internal/enginetest`, a non-test package in the `httptest` mould.** Three packages in this
phase (`connections`, `tree`, `oplog`) need a real engine child. A `_test.go` helper cannot be
imported across packages, so the alternatives are three copies of P54's `nodeBin`/`newHost` or one
small shared package taking `testing.TB`. One package, one fixture script, one behaviour table.
P54's own `internal/enginehost/helpers_test.go` is **left exactly as it is** — it is green, it is
private to a package this phase does not otherwise touch, and churning it buys nothing.

**D14 — services are `New()` then `Start()`.** `connections`, `oplog` and the metrics ticker each
subscribe to something and each have a P56-supplied listener. Subscribing inside `New()` would drop
every event arriving before P56's `On…` call. Splitting construction from activation makes the
wiring order explicit in `main.go` and makes every test able to attach its listener before the first
event.

**D15 — the renderer-facing push channels are seams, not emissions.** `connections` exposes
`OnStateChange` / `OnMetadataInvalidated` / `OnListChanged`, `oplog` exposes `OnUpdate`, and the
metrics ticker exposes `OnSample`. **P56's `bridge/events.go` attaches `app.Event.Emit` to all
five.** This is exactly the shape P54 §4.3 used for `Sink`/`AttachStream` and it is not a stub: with
no subscriber, a `notify.Emitter` correctly notifies nobody, which is a complete behaviour, not a
missing one.

## 3. Target tree, file by file

```
shell/internal/logging/
  log.go                NEW   slog file handler, daily-rolling writer, SetDefault
  sweep.go              NEW   the 30-day mtime sweep
  log_test.go           NEW
shell/internal/notify/
  notify.go             NEW   Emitter[T]
  notify_test.go        NEW
shell/internal/secrets/
  cipher.go             NEW   envelope + AES-256-GCM + the probe switch (platform-neutral)
  status.go             NEW   Status, the backend constants, the four literal reason strings
  keyring_darwin.go     NEW   //go:build darwin — the ONLY file importing keybase/go-keychain
  keyring_other.go      NEW   //go:build !darwin
  cipher_test.go        NEW
  keychain_darwin_test.go NEW //go:build darwin — cannot compile or run in this sandbox (§5.1)
shell/internal/preconnect/
  supervisor.go         NEW
  tail.go               NEW   the stderr tail tracker
  signal.go             NEW   Node-compatible signal names
  supervisor_test.go    NEW
  tail_test.go          NEW   package preconnect (internal)
shell/internal/connections/
  service.go            NEW
  input.go              NEW   Input + Validate() (connectionInputSchema's superRefine)
  resolve.go            NEW   ResolvedConfig, resolve(), resolveFromInput()
  uri.go                NEW   stripURIPassword / injectURIPassword / encode+decodeURIComponent
  service_test.go       NEW
  input_test.go         NEW
  uri_test.go            NEW
shell/internal/tree/
  service.go            NEW
  service_test.go       NEW
shell/internal/oplog/
  wire.go               NEW
  wire_test.go          NEW
shell/internal/enginetest/
  enginetest.go         NEW   NodeBin/Host/FixtureScript, testing.TB-based (D13)
  testdata/engine-fixture.mjs  NEW  the one shared tagged-protocol fixture child
shell/internal/metrics/
  ticker.go             NEW   Interval, AnchorNeedles, HelperNeedles, Ticker
  ticker_test.go        NEW
shell/internal/enginehost/
  ops.go                NEW   D12's exported op/event constants
  config.go             UPDATED  uses ops.go's constant
shell/internal/storage/model/
  tree.go               NEW   NodeKind set, PathSegment, NodePath, TreeNode, ObjectMeta + friends,
                              EncodePath/DecodePath, the explicit validators
  definition.go         NEW   ObjectDefinition + friends and its validators
  tree_test.go          NEW
  definition_test.go    NEW
shell/internal/bridge/
  connections.go        REWRITTEN in place — 12 real methods
  tree.go               NEW   4 methods
  ipcerr/errors.go       UPDATED  Disconnected's message (D11) + SecretStore helper
shell/internal/appcore/deps.go   UPDATED  + Connections, + Tree
shell/main.go                    UPDATED  the full startup ordering + shutdown
shell/go.mod / go.sum            UPDATED  + github.com/keybase/go-keychain v0.0.1
shell/cmd/g1measure/main.go      UPDATED  flag defaults read from internal/metrics (§6.1)
```

## 4. Package designs

### 4.1 `internal/logging`

```go
// Init installs a slog handler writing to KIRA_HOME/logs/kira-YYYY-MM-DD.log, and makes it the
// process default — every existing slog.Default() call in storage/repos and enginehost lands there
// with no change to those packages (P54 §1.6).
func Init() error

// Sweep deletes kira-*.log files older than 30 days. Best-effort and total: it never returns an
// error and never blocks startup (log.ts's own contract).
func Sweep()
```

- The writer is a `dailyWriter` that re-resolves the dated filename on every `Write` and reopens on
  a date change — `electron-log`'s `resolvePathFn` is evaluated per write, so the file rolls at
  midnight in a long-running session and must here too. It carries a `now func() time.Time` field so
  the roll is testable.
- File mode `0600`, directory already `0700` from `config.EnsureLayout()`.
- Handler: `slog.NewTextHandler` with `Level: slog.LevelInfo`. Records already carry
  `slog.String("scope", …)` from P53/P54, so no custom handler is needed to preserve the scoping
  `electron-log`'s `.scope()` gave.
- In a dev build (`config.IsDev()`) the writer is `io.MultiWriter(file, os.Stderr)`; in a packaged
  build it is the file only. This is today's shape (`electron-log` writes both, and `log.ts:13`
  silences the console under `NODE_ENV=test`) reduced to the one axis Go has.
- `LogRetentionDays = 30`, a package constant with `log.ts:24`'s comment about deliberately *not*
  reusing `advanced.opLogRetentionDays`.

### 4.2 `internal/notify`

```go
type Emitter[T any] struct { /* zero value is ready to use */ }

// Subscribe registers fn and returns its unsubscribe. Every subscriber receives every value.
func (e *Emitter[T]) Subscribe(fn func(T)) (unsubscribe func())

// Emit snapshots the subscriber set under the lock and calls each callback with the lock released,
// so a callback may subscribe, unsubscribe or emit without deadlocking (D1).
func (e *Emitter[T]) Emit(v T)
```

### 4.3 `internal/secrets`

```go
// status.go
const (
	BackendKeychain    = "keychain"
	BackendBasicText   = "basic_text"
	BackendUnavailable = "unavailable"
)

// Status mirrors src/shared/domain/secrets.ts's secretStorageStatusSchema byte for byte. This is
// the struct bridge/connections.go carried in P52; it moves here, unchanged.
type Status struct {
	Available        bool    `json:"available"`
	Backend          string  `json:"backend"`
	InsecureFallback bool    `json:"insecureFallback"`
	Reason           *string `json:"reason"`
}

// cipher.go
const envelopePrefix = "kira:v2:"

// insecureKeyMaterial is a hardcoded compile-time constant, deliberately (P52 §6.5): the Linux
// development fallback has the same threat model and the same honesty as Chromium's basic_text —
// obfuscation under a key anyone can read, not encryption. A file-backed keyring would look more
// secure than it is and would need a passphrase prompt in a headless container.
const insecureKeyMaterial = "kira-studio:v2:insecure-development-key"

type Cipher struct { /* status Status; aead cipher.AEAD (nil when unavailable) */ }

// New probes once and returns a Cipher whose Status never changes for the life of the process. It
// never fails: an unavailable backend is a valid Cipher whose Encrypt/Decrypt return
// *ipcerr.Error{Code: "E_SECRET_STORE"} — createSecretCipher()'s own contract.
func New() *Cipher

func (c *Cipher) Status() Status
func (c *Cipher) Encrypt(plain string) (string, error)  // satisfies repos.Cipher
func (c *Cipher) Decrypt(stored string) (string, error) // satisfies repos.Cipher

// probe is New's whole platform switch, with the OS-key source injected so every branch is
// testable off its own platform (D3).
func probe(goos, insecureEnv string, loadKey func() ([]byte, error)) (Status, []byte)
```

`probe`'s four branches, each returning the §1.3 string verbatim:

| goos | condition | Status |
|---|---|---|
| `darwin` | `loadKey()` succeeds | `{true, keychain, false, nil}` |
| `darwin` | `loadKey()` fails | `{false, unavailable, false, &darwinReason}` |
| `linux` | `KIRA_INSECURE_SECRETS` non-empty | `{true, basic_text, true, nil}`, key = `sha256(insecureKeyMaterial)` |
| `linux` | unset | `{false, unavailable, false, &linuxReason}` |
| other | — | `{false, unavailable, false, &otherReason}` |

`New()` logs once, mirroring `secret-cipher.ts:78-86`: level `warn` when `InsecureFallback` else
`info`, scope `secrets`, message `secret storage: backend=<b> available=<a>` plus, for the fallback,
` — Linux development fallback (KIRA_INSECURE_SECRETS=1): credentials are obfuscated with a
hardcoded key, not a real keychain`.

`Encrypt`: refuse when unavailable with `ipcerr.SecretStore(*status.Reason)`; else a 12-byte
`crypto/rand` nonce, `aead.Seal(nonce, nonce, plain, nil)`, base64-std, prefixed.

`Decrypt`, in order: no prefix → `ipcerr.SecretStore("The stored credential is not in this app's
kira:v2: envelope format and cannot be decrypted — re-enter it to fix this connection.")` (P52 §6.4
retires the pre-P25 passthrough and asks for an error "naming the problem"; it gives no literal, so
this string is new and is stated as new); unavailable → the same refusal `Encrypt` gives; then
base64-decode / length-check / `aead.Open`, any failure of which returns §1.3's decrypt-failure
message with the underlying detail interpolated.

`keyring_darwin.go` — **the only file in the repo importing `github.com/keybase/go-keychain`**:

```go
//go:build darwin

const (
	keychainService = "Kira Studio Safe Storage" // distinct from the Electron build's own item
	keychainAccount = "Kira Studio"
	keychainLabel   = "Kira Studio Safe Storage"
	keyBytes        = 32
)

// loadOrCreateKey returns the app's single AES-256-GCM key, creating it on first run. This round
// trip is also the darwin availability probe (D2).
func loadOrCreateKey() ([]byte, error) { return loadOrCreateKeyIn(keychainService, keychainAccount) }

// loadOrCreateKeyIn takes the item's identity so keychain_darwin_test.go can exercise the real
// Keychain under a test-only service name without touching the user's real key.
func loadOrCreateKeyIn(service, account string) ([]byte, error)
```

`loadOrCreateKeyIn`'s body, with §1.1's six gotchas each handled explicitly:

1. Build the query by hand — `SetSecClass(SecClassGenericPassword)`, `SetService`, `SetAccount`,
   **`SetSynchronizable(SynchronizableNo)`**, `SetMatchLimit(MatchLimitOne)`, `SetReturnData(true)`.
   Never `GetGenericPassword` (gotcha 1).
2. `QueryItem` → `(nil, nil)` means "no key yet", not an error (gotcha 2).
3. Exactly one result of exactly 32 bytes → return it.
4. Exactly one result of the wrong length → a foreign or corrupt item; `DeleteItem` it and fall
   through to create, rather than failing forever.
5. Create: 32 bytes from `crypto/rand`; an item with class/service/account/label/data plus
   **`SetSynchronizable(SynchronizableNo)`** and
   **`SetAccessible(AccessibleWhenUnlockedThisDeviceOnly)`**; `AddItem`.
6. `AddItem` returning `keychain.ErrorDuplicateItem` (gotcha 3) → re-query once and return that
   result; anything else → wrap and return.

`keyring_other.go` (`//go:build !darwin`) returns a sentinel error. It exists so `cipher.go` has a
symbol to call on every platform without a `runtime.GOOS` guard around an import (gotcha 6).

`ipcerr` gains `func SecretStore(message string) *Error { return New("E_SECRET_STORE", message) }`,
matching `secret-cipher.ts:11`'s code.

### 4.4 `internal/preconnect`

```go
// Kind values match preconnect.ts's PreconnectStart discriminant.
const (KindOneShot = "oneshot"; KindSidecar = "sidecar")

type Start struct{ Kind string }

type Exit struct {
	ConnectionID string
	Code         *int    // nil when the process was killed by a signal
	Signal       string  // "" when it exited normally; otherwise "SIGTERM"-style (signal.go)
	LastStderr   *string
}

type Supervisor struct{ /* entries map[string]*entry; mu; exits notify.Emitter[Exit] */ }

func New() *Supervisor

// Start kills anything already tracked for connectionID, spawns command, and returns once the
// script is judged ready. It returns an error if the script exits non-zero, dies on a signal, or
// fails to spawn before the settle window elapses — the message names the exit code and the last
// stderr line, exactly as preconnect.ts:182 composes it.
func (s *Supervisor) Start(connectionID, command string) (Start, error)

func (s *Supervisor) Arm(connectionID string)     // D7: fires OnExit now if it already died
func (s *Supervisor) Stop(connectionID string)    // idempotent; self-inflicted kills never fire OnExit
func (s *Supervisor) StopAll()
func (s *Supervisor) OnExit(fn func(Exit)) (unsubscribe func())
```

Spawn shape (`supervisor.go`):

```go
cmd := exec.Command("/bin/sh", "-c", command)
cmd.Dir = homeDir()                                  // spawn(..., {cwd: homedir()})
cmd.Stdout = nil                                     // D8
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // detached:true's analogue; pgid == child pid
cmd.Env = withAugmentedPath(os.Environ())            // replaces PATH=, never appends a second one
stderr, _ := cmd.StderrPipe()
```

Lifecycle, mirroring `'close'` semantics (§1.4): one goroutine reads `stderr` to EOF through the
tail tracker; when it returns, `cmd.Wait()` is called **once**, the exit is classified, and the
`exited` channel is closed. `Start` then races that channel against a `time.Timer(settleWindow)`:

- timer first → record the entry, return `{KindSidecar}`.
- exit first, code 0 and no signal → `{KindOneShot}`, log at info in `preconnect.ts:175`'s words.
- exit first, otherwise → an error reading
  `Pre-connect script failed (exit <n>)[: <tail>]` or `Pre-connect script failed (signal SIGTERM)[: <tail>]`.
- spawn failure → `Pre-connect script could not start: <err>`, logged at error.

After settling, an exit is routed by the same three-way `entry.killing` / `entry.armed` /
`entry.dead` test `preconnect.ts:186-203` uses. `Stop` sets `killing`, sends `SIGTERM` to `-pgid`,
escalates to `SIGKILL` after `killGrace`, waits on `exited`, and removes the entry.

`signal.go` maps `syscall.Signal` to Node's own name (`SIGTERM`, `SIGKILL`, `SIGINT`, `SIGHUP`,
`SIGQUIT`, `SIGABRT`, `SIGSEGV`, `SIGPIPE`), falling back to `signal <n>` — `Signal.String()` yields
`terminated`, which would silently change the user-visible message.

`tail.go` is a literal port of `makeTailTracker` (`preconnect.ts:59-75`), carry logic and
`STDERR_TAIL_MAX = 200` included.

### 4.5 `internal/connections`

```go
// Input is connectionInputSchema's Go shape. It lives here, not in internal/storage/model, so
// P53's D9 invariant — "no password field anywhere in the model package" — stays literally true.
type Input struct {
	model.ConnectionFields
	Password *string `json:"password"`
}

// Validate ports connectionInputSchema's superRefine plus the field constraints zod enforced by
// shape (P52 §4.2: "an explicit guard at the top of the method, returning E_BAD_REQUEST").
func (in Input) Validate() error

type TestResult struct {
	OK            bool    `json:"ok"`
	ServerVersion *string `json:"serverVersion,omitempty"`
	Error         *string `json:"error,omitempty"`
}

type RevealResult struct {
	Password *string `json:"password"`
	Error    *string `json:"error"`
}

type Deps struct {
	Conns      *repos.ConnectionsRepo
	Secrets    *repos.SecretsRepo
	Metadata   *repos.MetadataCacheRepo
	Cipher     *secrets.Cipher
	Host       *enginehost.Host
	Preconnect *preconnect.Supervisor
}

type Service struct{ /* … */ }

func New(d Deps) *Service
func (s *Service) Start()    // D14: subscribes to Preconnect.OnExit and Host.Subscribe()
func (s *Service) Shutdown() // Preconnect.StopAll(), then stops the watcher goroutine

func (s *Service) List() ([]model.ConnectionSummary, error)
func (s *Service) Create(in Input) (model.ConnectionSummary, error)
func (s *Service) Update(id string, in Input) (model.ConnectionSummary, error)
func (s *Service) Duplicate(id string) (model.ConnectionSummary, error)
func (s *Service) Remove(id string) error
func (s *Service) Reorder(ids []string) ([]model.ConnectionSummary, error)
func (s *Service) Reveal(id string) RevealResult          // never errors (P25 D9)
func (s *Service) Test(in Input) TestResult               // never errors
func (s *Service) Connect(id string) (model.ConnectionState, error)
func (s *Service) Disconnect(id string) (model.ConnectionState, error)
func (s *Service) States() []model.ConnectionState        // sorted by id (D7)
func (s *Service) StateOf(id string) model.ConnectionState
func (s *Service) SecretsStatus() secrets.Status
func (s *Service) MarkAllErrored(reason string)

func (s *Service) OnStateChange(fn func(model.ConnectionState)) (unsubscribe func())
func (s *Service) OnMetadataInvalidated(fn func(connectionID string)) (unsubscribe func())
func (s *Service) OnListChanged(fn func([]model.ConnectionSummary)) (unsubscribe func())
```

`Validate()`'s rules, from `connection.ts:99-143`, each returning `ipcerr.BadRequest` with the TS's
own message where one exists:

- `name` trimmed, 1–120 chars.
- `kind`/`color`/`mode` in `model.ValidConnectionKind`/`Color`/`Mode`.
- `port`, when non-nil, in 1–65535.
- `preconnect`, when non-nil, trimmed non-empty and ≤ 2000 chars.
- mode `fields`, kind in `FILE_KINDS` (`sqlite`): `database` trimmed non-empty →
  `A database file is required.`; must start with `/` → `The database file must be an absolute path.`
- mode `fields`, kind not in `AWS_STYLE_KINDS` (`sqs`, `s3`): `host` non-empty → `Host is required.`;
  `port` non-nil → `Port is required.`
- mode `uri`: `uri` trimmed non-empty → `A connection URI is required.`

`FILE_KINDS` and `AWS_STYLE_KINDS` become two small sets in `model/connection.go` beside the
existing `connectionKinds`, since that is where the other enumerations already live.

`resolve.go`:

```go
// ResolvedConfig is engine-ops.ts's ResolvedConnectionConfig. It is declared here rather than in
// internal/storage/model for the same reason the TS declares it in the protocol file rather than
// in domain/connection.ts: it is the one shape that carries a secret, and only the engine channel
// ever sees it. `preconnect`/`preconnectSidecar` are absent by construction (P11 D13).
type ResolvedConfig struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Kind      string         `json:"kind"`
	Color     string         `json:"color"`
	Mode      string         `json:"mode"`
	ReadOnly  bool           `json:"readOnly"`
	Host      *string        `json:"host"`
	Port      *int           `json:"port"`
	Database  *string        `json:"database"`
	Username  *string        `json:"username"`
	URI       *string        `json:"uri"`
	Options   map[string]any `json:"options"`
	SortOrder int            `json:"sortOrder"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
	Password  *string        `json:"password"`
}
```

`resolve(id)` reads the row, reads the secret through `SecretsRepo.Get`, and injects the password
into `URI` when `URI` is non-nil. `resolveFromInput(in)` builds the same shape with
`ID: "test"`, `SortOrder: 0`, `CreatedAt: ""`, `UpdatedAt: ""` — the literals `connections.ts:146`
uses, and the reason `Test`'s preconnect entry is keyed on `"test"`.

`uri.go` (D10):

```go
// stripURIPassword removes the userinfo password from uri and returns it decoded. A string with no
// "://" (or no userinfo) is returned unchanged with a nil password — the same total behaviour
// stripUriPassword's try/catch gives.
func stripURIPassword(uri string) (stripped string, password *string)

// injectURIPassword puts password back, encodeURIComponent-encoded. A nil or empty password is a
// no-op.
func injectURIPassword(uri string, password *string) string

func encodeURIComponent(s string) string // escapes everything but A-Za-z0-9 - _ . ! ~ * ' ( )
func decodeURIComponent(s string) string // percent-decoding only; '+' is a literal plus
```

Algorithm: locate `"://"`; the authority runs to the first `/`, `?` or `#` after it; if it contains
`@`, split at the **last** `@`; the userinfo's password is everything after its first `:`. Stripping
rebuilds the authority as `user@host` when the username is non-empty and as `host` when it is not
(WHATWG drops the `@` when both halves are empty). Injecting rebuilds it as
`user:<encoded>@host`. Nothing else in the string is touched.

`doConnect` and the state machine port `connections.ts:170-231` line for line, including the
post-`Arm()` re-read of the state (`:201`) that lets a script which died between `Start()` and
`Arm()` win over the `connected` state, and the `dropCached` + invalidation push on success.

The engine-down watcher:

```go
func (s *Service) watch() {
	events, unsubscribe := s.host.Subscribe()
	defer unsubscribe()
	for evt := range events {
		if evt.Topic == enginehost.EventEngineDown {
			s.MarkAllErrored("engine process exited")
		}
	}
}
```

The loop terminates when P54's `waitAndFail` closes the subscriber channel, which it does *after*
publishing `EventEngineDown` (P54 §4.2) — so the goroutine exits on its own and needs no stop
channel. `"engine process exited"` is `src/main/index.ts:105`'s exact string. **No `connection:state`
case** (§1.2).

### 4.6 `internal/tree`, and the model types it needs

`model/tree.go` adds: the 22-value `NodeKind` set and `ValidNodeKind`; `PathSegment`; `NodePath`;
`TreeNode`; `ColumnMeta`; `IndexMeta`; `ForeignKeyMeta`; `ObjectMeta`; and

```go
func EncodePath(segments []PathSegment) string
func DecodePath(connectionID, encoded string) (NodePath, error)
```

`DecodePath` ports `tree.ts:44-56`: `""` → no segments; split on `/`; each segment is
`<kind>:<encodeURIComponent(name)>`; an unknown kind or a missing `:` is an error (the TS throws).
It reuses `internal/connections`' `decodeURIComponent`… which would be an import cycle in the wrong
direction, so the two helpers live in `model` and `internal/connections/uri.go` calls them. State
this in the code: one implementation, in `model/uriescape.go`, used by both.

`model/definition.go` adds `ObjectDefinition`, `ConstraintMeta`, `DocumentSchemaMeta`,
`DefinitionSection` and their validators.

**The explicit checks replacing `safeParse`** (§1.6) — these are the whole reason the drop path is
not dead code:

| Type | Checks |
|---|---|
| `[]TreeNode` | every element's `Kind` in `ValidNodeKind`; `Name` and `Path` non-empty |
| `ObjectMeta` | `Kind` in `ValidNodeKind`; `Path`, `Name`, `QualifiedName` non-empty; `Columns`/`ForeignKeys`/`ReferencedBy`/`Indexes` non-nil (nil → `[]`) |
| `ObjectDefinition` | `Kind` in `ValidNodeKind`; `Language` in `{sql,json}`; `Origin` in `{server,composed}`; **`len(Statements) >= 1`** (zod's `.min(1)`); `Notes`/`Constraints` non-nil; `Sections` nil → `[]` (zod's `.default([])`, which is what keeps a pre-P23 cached definition parsing); each constraint's `Type` in the five-value enum |

Service:

```go
// Connected is the one thing tree needs from the connections service. A one-method interface
// (P54 D14's discipline) keeps tree's tests able to set a connection's state directly instead of
// driving a real connect, while §5.6's last test wires a real *connections.Service through it.
type Connected interface{ StateOf(connectionID string) model.ConnectionState }

type ChildrenResult struct {
	Nodes     []model.TreeNode `json:"nodes"`
	Source    string           `json:"source"`    // "cache" | "server"
	Truncated bool             `json:"truncated"`
}
type DescribeResult struct { Meta model.ObjectMeta `json:"meta"`; Source string `json:"source"` }
type DefinitionResult struct { Definition model.ObjectDefinition `json:"definition"`; Source string `json:"source"` }

func New(conns *repos.ConnectionsRepo, meta *repos.MetadataCacheRepo, host *enginehost.Host, states Connected) *Service

func (s *Service) Children(connectionID, path string, refresh bool) (ChildrenResult, error)
func (s *Service) Describe(connectionID, path string, refresh bool, tabID *string) (DescribeResult, error)
func (s *Service) Definition(connectionID, path string, refresh bool, tabID *string) (DefinitionResult, error)
func (s *Service) Invalidate(connectionID string, path *string) error // nil path -> whole connection
```

`Children` keeps P43 iter2 D22 / iter3 D38 exactly: a truncated listing is **not** cached, **and**
any older row for that path is dropped. `requireConnected` returns `ipcerr.Disconnected(name)` where
`name` is the connection row's `Name` or, if the row is gone, the id (`tree-service.ts:77`) — see
D11 for the message change that makes that string right.

### 4.7 `internal/oplog`

```go
// EventSource is the slice of enginehost.Host oplog consumes. A one-method interface lets the
// reconciliation logic — this package's actual subject — be driven by synthetic events in a
// deterministic test, while §5.7's last test wires a real *enginehost.Host through it.
type EventSource interface{ Subscribe() (<-chan enginehost.Event, func()) }

// pruneEveryOps mirrors oplog.ts's PRUNE_EVERY_OPS.
const pruneEveryOps = 500

type Wiring struct{ /* … */ }

func New(src EventSource, ops *repos.OpsRepo, retentionDays int) *Wiring
func (w *Wiring) Start()  // prunes once (oplog.ts:28), then consumes events on one goroutine
func (w *Wiring) Stop()
func (w *Wiring) OnUpdate(fn func(model.OpRecord)) (unsubscribe func())
```

The consumer goroutine is the **only** reader and writer of `inFlight`, so that map needs no mutex —
state this in a comment so nobody adds one. Handling:

- `op:start` → unmarshal `{opId, connectionId, tabId, kind, startedAt}`; drop silently if it fails
  to unmarshal or `model.ValidOpKind(kind)` is false (`safeParse` → `return`); `Append`; `OnUpdate`
  a `running` record.
- `op:end` → unmarshal `{opId, status, durationMs, rows, command, error}`; drop unless
  `status ∈ {ok, error, cancelled}`; `Finish`; `OnUpdate` a record whose `connectionId`/`tabId`/
  `startedAt`/`kind` come from `inFlight` with `oplog.ts:80-84`'s exact fallbacks
  (`nil`, `nil`, now, `"test"`); increment; at 500, reset and `Prune`.
- `enginehost.EventEngineDown` → drain `inFlight`, `Finish` each as
  `{status: "error", durationMs: now - startedAt, error: "engine process exited"}`. A `startedAt`
  that will not parse yields `durationMs: 0` — JS gives `NaN` there, which is not a number SQLite
  should store, and 0 is the honest value for "we cannot tell".

`Prune` failures are logged at `warn` under scope `oplog` and never returned — `oplog.ts` fires it
with `void`.

## 5. Testing plan

Per P52 §13 and the precedent P53 §5 / P54 §5 set: `go test ./...`, standard-library `testing`,
table-driven, `go-cmp` for struct diffs, tests beside the code, `package foo_test` except where an
unexported symbol is the subject, real dependencies over mocks. Storage-touching tests go through
`storage.Open()` in a `t.TempDir()` `KIRA_HOME` (P53's `newRepos` harness pattern); engine-touching
tests spawn the real vendored Node against `internal/enginetest`'s fixture (P54's pattern, via D13).

P52 §13's `secrets`, `preconnect`, `connections`, `tree` and `oplog` rows are the acceptance
criteria; every item in all five is named below.

**The shared harness — `internal/enginetest`** (D13):

```go
func NodeBin(t testing.TB) string  // shell/runtime/node/bin/node, else $KIRA_TEST_NODE, else
                                   // exec.LookPath("node"); Fatalf naming scripts/vendor-node.sh.
                                   // Fails, never skips (P52 §13).
func Host(t testing.TB) *enginehost.Host        // the shared fixture, t.Cleanup -> Stop()
func HostWith(t testing.TB, script string) *enginehost.Host
```

**The shared fixture** — `internal/enginetest/testdata/engine-fixture.mjs`, same tagged framer as
P54's, answering on whichever tag the request arrived on:

| op | Behaviour |
|---|---|
| `adapter:connect` | `{serverVersion:"fixture 1.0", caps:{…}}`; `config.name` prefixed `fail-` → `ok:false {code:"E_CONNECT", message:"synthetic connect failure"}`; prefixed `slow-` → never answers |
| `adapter:disconnect` | `{}` |
| `adapter:test` | `{ok:true, serverVersion:"fixture 1.0"}`; `fail-` → `ok:false` |
| `adapter:children` | `{nodes:[…]}` derived from `payload.path.segments`; last segment named `trunc-*` → `{nodes:[…], truncated:true}` |
| `adapter:describe` | `{meta:{…}}` echoing the path; segment named `badkind-*` → a meta whose `kind` is `"nonsense"` |
| `adapter:definition` | `{definition:{…}}`; segment named `nostmt-*` → a definition with `statements: []` |
| `adapter:cancel`, `cache:configure` | `{}` |
| `fixture:emit-op-start` / `fixture:emit-op-end` | emits the payload as a tag-0 `op:start`/`op:end` PortEvent, answers `{}` |
| `fixture:crash` | `process.exit(3)` without answering |

### 5.1 `internal/secrets` — P52 §13's `secrets` row

`cipher_test.go` (`package secrets`, the probe is unexported):

| Test | Asserts | §13 item |
|---|---|---|
| `TestProbeStatusShapes` | Table over `(goos, insecureEnv, loadKey outcome)` covering darwin-ok, darwin-fail, linux+env, linux-no-env, `windows` — each `Status` compared with `go-cmp` against the literal, including the exact `reason` strings of §1.3 | the three `SecretStorageStatus` shapes |
| `TestEncryptDecryptRoundTrip` | Table: `""`, ASCII, `"pässwörd 🔐"`, 4 KiB — each round-trips; every ciphertext carries the `kira:v2:` prefix; encrypting the same plaintext twice yields different envelopes (fresh nonce) | round trip |
| `TestTamperDetectionFailsAuthentication` | Table over flipping a byte in the nonce, in the ciphertext, and in the tag; and truncating the body — each returns `E_SECRET_STORE` with §1.3's decrypt-failure sentence | tamper detection |
| `TestRejectsNonEnvelopedValue` | `"hunter2"`, `""`, `"kira:v1:AAAA"` all fail with `E_SECRET_STORE` naming the envelope — P52 §6.4's retired passthrough | rejection of a non-enveloped value |
| `TestUnavailableBackendRefuses` | The linux-no-env cipher: `Encrypt` and `Decrypt` both return `E_SECRET_STORE` carrying `status.Reason` verbatim | refusal when the backend is unavailable |
| `TestErrorsAreStructured` | Every error path above type-asserts to `*ipcerr.Error` with `Code == "E_SECRET_STORE"` and an `Error()` that is valid JSON with no `[CODE] ` prefix | P52 §5.3 regression guard |
| `TestSatisfiesReposCipher` | `var _ repos.Cipher = (*secrets.Cipher)(nil)` and one real `SecretsRepo` `Set`/`Get` round trip over a real SQLite db | — |

`keychain_darwin_test.go` (`//go:build darwin`), `TestRealKeychainRoundTrip` — P52 §6.5's recovered
coverage and the one thing this migration makes strictly better (P52 §11):

- Uses service `Kira Studio Safe Storage (test)` / account `Kira Studio (test)` through
  `loadOrCreateKeyIn`, with a `t.Cleanup` that `DeleteItem`s it — **the user's real key is never
  touched**.
- Asserts: first call returns 32 bytes; a second call returns the *same* 32 bytes (create-then-load);
  a `Cipher` built on the returned key round-trips; deleting the item and calling again yields a
  *different* key.
- Queries the item back with `SetReturnAttributes(true)` and records the service/account/label that
  come back, and logs (via `t.Logf`) what the OS reports — §1.1 gotcha 5's open question about
  whether the legacy keychain honours `kSecAttrAccessible` for a non-synchronizable item.
- **This test cannot be compiled or run in this Linux sandbox.** It is excluded by build tag, which
  is the honest form P52 §13 mandates ("a runtime skip that silently passes on Linux is not"). It
  runs on the Apple Silicon machine P51 part 4 and P52 G1 used. §8 makes that an explicit acceptance
  criterion with a named fallback.

### 5.2 `internal/logging` and `internal/notify`

`log_test.go`: `Init()` creates `logs/kira-<today>.log` at mode `0600` under a `t.TempDir()`
`KIRA_HOME`; a record logged through `slog.Default()` with a `scope` attr appears in it; the
`dailyWriter` rolls to a new filename when its injected clock crosses midnight and leaves the old
file intact; `Sweep()` deletes a file whose mtime is 31 days old, keeps one 29 days old, ignores
`notes.txt` and `kira-old.txt`, and returns silently when the directory does not exist.

`notify_test.go`: two subscribers both receive every emission; unsubscribing one leaves the other
working; unsubscribing twice is a no-op; a callback that calls `Subscribe` re-entrantly does not
deadlock (D1's whole point); the zero-value `Emitter` is usable; `go test -race` with concurrent
`Subscribe`/`Emit` is clean.

### 5.3 `internal/preconnect` — P52 §13's `preconnect` row

Real `/bin/sh` throughout; `settleWindow`/`killGrace` lowered by `supervisor_internal_test.go` (D9).

| Test | Asserts | §13 item |
|---|---|---|
| `TestOneShotExitZero` | `true` returns `{KindOneShot}` well inside the settle window | one-shot exit 0 |
| `TestSidecarSettles` | `sleep 30` returns `{KindSidecar}` after the settle window; the process is alive; `Stop` kills it | sidecar settle |
| `TestFailureBeforeSettleCarriesStderrTail` | Table: `echo boom >&2; exit 3` → `Pre-connect script failed (exit 3): boom`; a script killing itself → `(signal SIGTERM)`; a multi-line stderr → only the last non-blank line | failure before settle carrying the stderr tail |
| `TestDiedBetweenStartAndArm` | A script alive past the settle window but dead before `Arm` → `Arm` fires `OnExit` synchronously with the right code and tail | death between `start()` and `arm()` |
| `TestArmedExitFiresOnExit` | An armed sidecar that dies later fires `OnExit` once | — |
| `TestSelfInflictedKillDoesNotFireOnExit` | `Stop` on an armed sidecar produces no `OnExit` within 1 s; likewise a `Start` superseding a previous entry | self-inflicted kills not firing `onExit` |
| `TestSigtermEscalatesToSigkill` | A script trapping and ignoring `SIGTERM` is gone after `killGrace`, and `Stop` returns | SIGTERM→SIGKILL escalation |
| `TestProcessGroupKillReachesGrandchild` | `sleep 300 & sleep 300` — after `Stop`, `syscall.Kill(-pgid, 0)` returns `ESRCH` | process-group kill reaching a grandchild |
| `TestPathIsAugmented` | `echo $PATH >&2; exit 1` — the tail ends with `:/usr/local/bin:/opt/homebrew/bin` and contains exactly one `PATH` value | §1.4 |
| `TestCwdIsHome` | `pwd >&2; exit 1` — the tail equals the user's home directory | — |
| `TestStopAll` | Three sidecars, `StopAll`, all three gone, no `OnExit` | — |
| `TestSpawnFailureMessage` | A command `/bin/sh` cannot run at all still produces a legible `Start` error rather than hanging until the settle window | — |
| `TestTailTracker` (`package preconnect`) | Table over chunk sequences: a line split across chunks; several lines in one chunk; a chunk ending in `\n` followed by new content (the bug the `carry`/`last` split exists for); blank lines ignored; >200 chars truncated | — |

### 5.4 `internal/connections` — P52 §13's `connections` row

`uri_test.go` (`package connections`, the helpers are unexported) is a parity table against the TS,
each case naming the input and the WHATWG result it must match:

`postgresql://u:p@h:5432/db` → `postgresql://u@h:5432/db` + `p`; `postgresql://u@h/db` →
unchanged + nil; `postgresql://:p@h/db` → `postgresql://h/db` + `p` (both userinfo halves empty ⇒
the `@` goes); `postgres://u:p%40x@h/db` → password `p@x` (decoded); a password containing `@` and
`:` survives an inject→strip round trip; `not a uri` → unchanged + nil; a URI with `?a=b#f` keeps
its query and fragment untouched; `injectURIPassword(u, nil)` is the identity.

`input_test.go`: a table with one row per `Validate` rule, each asserting the exact
`ipcerr.BadRequest` message.

`service_test.go` (`package connections_test`, real SQLite + `enginetest.Host`):

| Test | Asserts | §13 item |
|---|---|---|
| `TestCreateUpdateDuplicateDelete` | Round trips through real repos; `List` never returns a password; a duplicate's name gains ` copy`; delete cascades (a seeded `metadata_cache` row is gone) | create/update/duplicate/delete |
| `TestPasswordThreeStateConvention` | Table: `nil` leaves the stored secret untouched; `""` clears it; `"new"` replaces it — read back through `SecretsRepo.Get` | the three-state password convention |
| `TestUriPasswordStripAndInject` | Creating in `uri` mode with an embedded password stores a passwordless `uri` and a decryptable secret; `resolve` puts it back for the engine payload | URI password strip/inject |
| `TestCreateValidatesSecretBeforeWriting` | With an unavailable cipher, `Create` with a password returns `E_SECRET_STORE` and **no row exists**; with `nil` password it succeeds | the "validate the secret can be encrypted before writing anything" ordering (P25 D6) |
| `TestUpdateWritesSecretBeforeRow` | With an unavailable cipher, `Update` with a password leaves every other field unchanged | P25 D6's other half |
| `TestConnectSuccessPath` | `connecting` then `connected` observed through `OnStateChange`; `serverVersion`/`caps` from the fixture; `OnMetadataInvalidated` fires; the seeded cache row for that connection is gone | — |
| `TestConnectFailurePathStopsPreconnect` | A `fail-` connection with a sidecar preconnect ends `error` and the sidecar process is dead | — |
| `TestInFlightConnectDedupe` | 8 concurrent `Connect(id)` against the fixture's `slow-`-then-released connection produce exactly **one** engine `adapter:connect` and one preconnect spawn; all 8 get the same state | in-flight connect dedupe (D11) |
| `TestSidecarCheckboxArms` | `preconnectSidecar: true` on a script that exits right after the settle window flips the connection to `error` via the `Arm` path even though `adapter:connect` succeeded (D7) | — |
| `TestMarkAllErrored` | Two connected connections + one disconnected: the two flip to `error` with the given reason, the third is untouched, and both sidecars are killed | `markAllErrored` |
| `TestEngineDownMarksAllErrored` | Against a **real** `enginehost.Host`, `fixture:crash` produces `error` states carrying `engine process exited` within 2 s — P54's `EventEngineDown` reaching its first real consumer | `markAllErrored` |
| `TestStatesAreSorted` | Three connections connected in a scrambled order come back id-sorted from `States()` on repeated calls (D7) | — |
| `TestRevealNeverThrows` | A row whose stored value is `"garbage"` returns `{Password: nil, Error: <the decrypt message>}` rather than an error (P25 D9) | — |
| `TestTestAlwaysStopsPreconnect` | Both the `ok` and the `fail-` path leave no process tracked under the `"test"` key | — |
| `TestListChangedBroadcast` | Each of create/update/duplicate/delete/reorder fires `OnListChanged` exactly once with the authoritative list | — |

### 5.5 `model/tree.go` and `model/definition.go`

`tree_test.go`: `EncodePath`/`DecodePath` round trip over a table including a name containing `/`,
`:`, a space and a non-ASCII character; `DecodePath("")` yields zero segments;
`DecodePath("bogus:x")` and `DecodePath("table")` both error. `definition_test.go`: the validator
table — a definition with `statements: []` is rejected; one with `sections: null` comes back with
`[]`; unknown `language`/`origin`/constraint `type` are rejected.

### 5.6 `internal/tree` — P52 §13's `tree` row

`service_test.go` (`package tree_test`, real SQLite + `enginetest.Host`, a `fakeStates` implementing
`Connected`):

| Test | Asserts | §13 item |
|---|---|---|
| `TestChildrenCacheMissThenHit` | First call `source: "server"` and writes the cache row; second call `source: "cache"` with identical nodes and **no** engine call (the fixture's request counter) | cache hit, cache miss |
| `TestRefreshBypassesCache` | `refresh: true` calls the engine even with a warm row | refresh bypass |
| `TestSchemaMismatchDropsRow` | A hand-written cache row of `[{"kind":"nonsense"}]` produces a `source: "server"` result **and** the bad row is gone — the test §1.6 says a naive `json.Unmarshal` port would make vacuous | schema-mismatch drop |
| `TestTruncatedListingNotCached` | A `trunc-` path returns `truncated: true` and writes nothing | P43 iter2 D22 |
| `TestTruncatedRefreshDropsOlderCompleteRow` | Seed a complete row, refresh into a truncated answer, assert the row is gone and the next ordinary load goes to the server | P43 iter3 D38 |
| `TestDescribeAndDefinitionCacheAside` | Both round-trip and both drop on their own validator failures (`badkind-`, `nostmt-`) | — |
| `TestDisconnectedError` | A `disconnected` connection yields `*ipcerr.Error{Code: "E_DISCONNECTED"}` whose message is `<name> is not connected` (D11), and no engine call is made | `E_DISCONNECTED` when not connected |
| `TestInvalidate` | Path given drops one row; path omitted drops every row for the connection | — |
| `TestRealConnectionsServiceSatisfiesConnected` | `var _ tree.Connected = (*connections.Service)(nil)` plus one end-to-end connect-then-children against the real service and a real host | D13's "one real wiring" rule |

### 5.7 `internal/oplog` — P52 §13's `oplog` row

`wire_test.go` (`package oplog_test`, real SQLite, a `fakeSource` implementing `EventSource`):

| Test | Asserts | §13 item |
|---|---|---|
| `TestStartEndRowLifecycle` | `op:start` writes a `running` row and emits a `running` record; `op:end` finishes it and emits the terminal one, carrying the started row's `connectionId`/`tabId`/`kind` | start/end row lifecycle |
| `TestUnknownOpEndUsesFallbacks` | An `op:end` with no matching `op:start` emits `{connectionId: nil, tabId: nil, kind: "test"}` (`oplog.ts:80-84`) | — |
| `TestMalformedEventsAreDropped` | Table: unparseable JSON, an unknown `kind`, an unknown `status` — each writes nothing and emits nothing | — |
| `TestPruneRunsAtStartAndEvery500` | `Prune` observed once at `Start`; a counter of `op:end`s reaching 500 triggers a second (seeded rows older than the retention cut are gone; row 501 does not trigger a third) | the 500-op prune trigger |
| `TestEngineDownReconcilesInFlight` | Three `op:start`s, then `EventEngineDown`: all three rows read back `status: "error"`, `error: "engine process exited"`, a non-negative `durationMs`; a fourth already-finished row is untouched; the goroutine exits when the channel closes | in-flight reconciliation on `engine:down` |
| `TestUnparseableStartedAtGivesZeroDuration` | A `startedAt` of `"not a date"` reconciles with `durationMs: 0`, not a garbage value | §4.7 |
| `TestRealHostEngineDown` | Against a **real** `enginehost.Host`: `fixture:emit-op-start`, then `fixture:crash`, and the row is reconciled within 2 s | P54's second named consumer, for real |

### 5.8 `internal/metrics` and the bridge

`ticker_test.go`: an injected `pids` func and a 20 ms interval produce ≥3 samples in 100 ms; `Stop`
stops them; a `pids` error is logged and does **not** stop the ticker; two `OnSample` subscribers
each receive every sample; `Stop` is idempotent.

`bridge/connections_test.go` and `bridge/tree_test.go` (P52 §13's `bridge` row, "one representative
service method per service"): `ConnectionsService.List()` over a seeded db; `Create` with an invalid
input returns `*ipcerr.Error{E_BAD_REQUEST}` with the superRefine message; `SecretsStatus()` returns
the cipher's status with the exact four JSON keys; `TreeService.Children` with an empty
`connectionId` returns `E_BAD_REQUEST`.

## 6. The two rows this plan resolves rather than implements

### 6.1 Metrics: P55 adds the timer and the needles, **P56 emits**

P52 §8.4's design is already built (§1.8). What is genuinely missing splits cleanly:

| Piece | Phase | Why |
|---|---|---|
| `Sampler`, RSS sum, CPU delta, `MatchingPIDs`, `AppProcessSet` | **done** (P52 M1 / G1) | — |
| The 5 s cadence, `Interval`, `AnchorNeedles`/`HelperNeedles`, `OnSample` | **P55** (§4, `ticker.go`) | It is the rest of §8.4's own sentence, it is self-contained and testable with an injected pid source, and it puts the process-set needles somewhere both `main.go` and `cmd/g1measure` can read one definition of instead of duplicating `g1measure`'s flag defaults |
| `app.Event.Emit("kira:app:metrics", sample)` | **P56** | It needs `bridge/events.go`, which is P56's row: *"the bridge (61 channels)"*, and P52 §7.1 puts all 17 push channels there |
| Stopping the ticker on quit (`clearInterval(metricsTimer)`, `index.ts:156`) | **P56** | It belongs inside `Lifecycle.RequestQuit`'s shutdown sequence (P52 §8.3), which does not exist yet |

So: **P55's metrics work is `ticker.go` and nothing else**, and `main.go` starts the ticker with no
subscriber, which is a complete behaviour (D15), not a stub.

### 6.2 Files: the whole row moves to **P56**

`src/main/ipc/files.ts` has no application-service layer (§1.7) — it is 54 lines of Electron-dialog
translation. Three reasons it belongs with the bridge, not here:

1. **There is nothing to put under `internal/`.** Every line is either a dialog call, a window
   lookup for modal attachment, or `basename`/`stat` around the result. Manufacturing an
   `internal/files` package to hold two `os.Stat` calls would be scope invented to satisfy a
   one-word cell in a phasing table.
2. **It needs the `*application.App` and a window handle.** Wails' dialogs are reached through
   `app.Dialog.SaveFile()` / `app.Dialog.OpenFile()` and made modal with `.AttachToWindow(window)`.
   Window ownership is P56's row ("native shell parity (window/menu/security/lifecycle)").
3. **P52 §4.2 already files it under the bridge**, in the `src/main/ipc/* → shell/internal/bridge/*`
   table, alongside the eleven other handler modules P56 owns.

**What P56 inherits, read from `wails/v3@v3.0.0-beta.15` for this plan so P56 does not have to
rediscover it** (`pkg/application/dialog_manager.go:16-36`, `pkg/application/dialogs.go:212-494`):

- `app.Dialog.SaveFile() *SaveFileDialogStruct` with `SetFilename`, `SetDirectory`,
  `AttachToWindow(Window)`, `AddFilter(displayName, pattern string)`,
  `PromptForSingleSelection() (string, error)`.
- `app.Dialog.OpenFile() *OpenFileDialogStruct` with `CanChooseFiles`, `SetTitle`, `AddFilter`,
  `SetDirectory`, `AttachToWindow`, `PromptForSingleSelection`/`PromptForMultipleSelection`.
- **Two translations P56 owes:** Electron's `filters: [{name, extensions: []}]` becomes one
  `AddFilter(name, "*.ext;*.ext2")`-style pattern per entry, not an extension list; and
  `app.getPath('downloads')` has no Wails analogue, so `filepath.Join(os.UserHomeDir(), "Downloads")`
  is the substitute for `SetDirectory`.
- **The `basename()` guard on an S3 key containing `/` must survive** — P52 §4.2 already flags it as
  a real bug fix, not boilerplate.

## 7. Where the bridge boundary sits, and why it moved

P54 §7 said *"P56 owns the other 52 bridge methods"*. This plan narrows that by **16 methods**, and
states the rule that draws the line: **a phase ships the bridge surface of the services it builds,
and nothing else.**

| Bridge work | Phase | Reason |
|---|---|---|
| `ConnectionsService` — all 12 methods | **P55** | `States()` and `SecretsStatus()` are stubs *today*, with comments naming P55. Building the full state machine and leaving `States()` returning `[]model.ConnectionState{}` behind it is precisely the half-state `AGENTS.md` rules out. Once those two are real, the other ten are the same service's own surface and cost nothing extra |
| `TreeService` — `Children`/`Describe`/`Definition`/`Invalidate` | **P55** | Same rule: `internal/tree` exists in this phase or it does not |
| `bridge/events.go` (17 push channels), `bridge/stream.go`, `bridge/files.go`, `bridge/queries.go`, `bridge/lifecycle.go`, `SettingsService.Set` + its cache re-push (P54 D11), `OpsService.Cancel` | **P56** | None of them has a P55 service behind it. `OpsService.Cancel` in particular is a bare `host.Call(OpCancel, …)` passthrough with nothing in `internal/oplog` to build on |

`main.go`'s `Services:` list gains `bridge.TreeService`. **`wails3 generate bindings -b -i -ts` must
be re-run from `shell/` before the next `bun run build:wails`** — `ConnectionsService`'s method set
changes and `TreeService` is new, and AGENTS.md's P53 finding is explicit that a missing generated
binding is a hard Vite resolve failure, not a stale-types warning.

`appcore.Deps` gains exactly two fields:

```go
type Deps struct {
	DB          *sql.DB
	EngineHost  *enginehost.Host
	NodeVersion string
	StartedAt   int64
	Repos       *repos.Repos
	Connections *connections.Service
	Tree        *tree.Service
}
```

P52 §4.2's `deps.ts` row also lists `Secrets`, `Log` and `Events`. None is added: the cipher reaches
the bridge through `Connections.SecretsStatus()` exactly as `ipc/connections.ts:44` does today;
logging is `slog.Default()` (P53's seam, now backed by `internal/logging`); and `Events` is P56's
`bridge/events.go`. `*repos.SecretsRepo` stays inside `internal/connections`, which is the only
thing that should ever hold it (P1 D8).

`main.go`'s startup order, mirroring `src/main/index.ts` (P52 §4.1) with the
`upgradeLegacySecrets` step **deleted, not ported** (P52 §6.4):

```
config.EnsureLayout() → logging.Init() → logging.Sweep() → storage.Open() (migrates)
  → secrets.New() → repos.New() + repos.NewSecrets(db, cipher) → Settings.GetAll()
  → enginehost.Start(--max-old-space-size) → preconnect.New()
  → connections.New(...).Start() → tree.New(...)
  → enginehost.PushCacheConfig → oplog.New(...).Start() → metrics ticker Start()
  → appcore.Deps → application.New(Services) → window
```

`OnShutdown` runs, in order: `metricsTicker.Stop()`, `oplog.Stop()`, `connections.Shutdown()`,
`host.Stop()`, `repos.Close()`, `db.Close()`. The quit-flush handshake around it is P56 (§8.3).

Note there is no `app.whenReady()` analogue to wait for before probing the Keychain — P52 §6.5
already records that the Electron-specific constraint (electron/electron#45328) has none.

## 8. Scope boundary

**Zero `src/` changes.** Checked, not assumed. Every TS file this phase reads is a *source of truth*
being ported, not a target:

- `src/main/connections.ts`, `secret-cipher.ts`, `preconnect.ts`, `tree-service.ts`, `oplog.ts`,
  `log.ts`, `index.ts`, `ipc/connections.ts`, `ipc/tree.ts` — **read only**. They keep running the
  Electron app unchanged through the coexistence window; P57 deletes `src/main`.
- `src/shared/domain/secrets.ts`, `connection.ts`, `tree.ts`, `definition.ts`, `uri.ts`,
  `src/shared/protocol/engine-ops.ts` — **read only**, for the literal strings and enum values D12
  requires be read rather than inferred.
- `src/main/ipc/files.ts` — **read only, and out of scope** (§6.2). It does *not* turn out to need a
  `src/` touch; the surprise, if any, is the opposite direction — it needs less than the phasing
  table implies.
- No `tests/` change, no `scripts/` change, no `package.json` change (no new script, no new npm
  dependency).

**One new Go dependency:** `github.com/keybase/go-keychain v0.0.1`, pinned exactly, imported from
one build-tagged file. `go.sum` gains it. §1.1's dependency-hygiene note applies.

**`cmd/g1measure/main.go`** changes only to read its flag defaults from `internal/metrics`'s
exported needle slices instead of duplicating them as string literals. The tool's behaviour is
unchanged; this is the one place a shared constant genuinely removes a drift risk (P52 §15 records
that a bad needle match was one of the three real bugs found getting G1 measured).

**No gate.** P52 §15: G1 was the only gate and it passed at 261.7 MB against a ≤ 300 MB threshold.

## 9. Sequencing

Seven milestones, each ending at a green `go build ./internal/...` and `go test ./internal/...`.

- **M0 — `internal/logging` + `internal/notify`.** Both leaves, both needed by everything after.
  `main.go` calls `logging.Init()`/`Sweep()`. Ends with engine and repo log lines actually landing in
  `logs/kira-YYYY-MM-DD.log`, which is P54 §1.6's promise coming due with zero change to
  `enginehost` or `repos`.
- **M1 — `internal/secrets`.** `go.mod` gains `keybase/go-keychain v0.0.1`; `cipher.go`,
  `status.go`, `keyring_darwin.go`, `keyring_other.go`; `ipcerr.SecretStore`; the
  `SecretStorageStatus` struct moves out of `bridge/connections.go`. First, because `connections`
  cannot be built without a real `repos.Cipher`.
- **M2 — `internal/preconnect`.** Independent of M1; second because `connections` needs it and
  because its tests are the slowest to get right.
- **M3 — `internal/enginetest` + the shared fixture, `internal/enginehost/ops.go` (D12), then
  `internal/connections`, then `bridge/connections.go`'s 12 real methods.** The largest milestone;
  `enginetest` lands first inside it because M3, M4 and M5 all consume it.
- **M4 — `model/tree.go`, `model/definition.go`, `model/uriescape.go`, then `internal/tree` and
  `bridge/tree.go`.**
- **M5 — `internal/oplog`.** Independent of M3/M4; last of the services because it is the smallest
  and its `engine:down` test reuses M3's fixture.
- **M6 — `internal/metrics/ticker.go`, `cmd/g1measure`'s defaults, `appcore.Deps`, and `main.go`'s
  full startup ordering and shutdown sequence.** Finish with `gofmt -l shell` (empty),
  `go vet ./...`, `bun run test:go`, `wails3 generate bindings -b -i -ts`, `bun run build:wails`, and
  a boot of the real app.

M1 before M3 is the only hard ordering constraint; M2, M4 and M5 could be reordered freely, and M0
is first only because it is cheap and makes every later milestone's failures legible.

## 10. Acceptance criteria

1. `bun run test:go` is green, and every item in P52 §13's `secrets`, `preconnect`, `connections`,
   `tree` and `oplog` rows has a named test in §5.
2. `bridge/connections.go` has twelve real methods and contains no "lands in P55" comment;
   `States()` reflects the live state map and `SecretsStatus()` reports the real cipher's probe.
   `grep -rn "P55" shell/` returns nothing but historical references in doc comments.
3. `shell/go.mod` gains exactly one direct dependency, `github.com/keybase/go-keychain v0.0.1`, and
   `go mod tidy` adds **no** `keybase/dbus`, `golang.org/x/crypto` or `stretchr/testify` to the build
   list (§1.1).
4. **The darwin-only surface compiles and its test passes on real macOS.** `internal/secrets/
   keyring_darwin.go` and `keychain_darwin_test.go` are excluded by build tag on Linux, so
   `go build ./...` and `go vet ./...` in this sandbox **do not check them at all** — this is stated
   plainly rather than hoped past. The implementing session must run
   `go test ./internal/secrets -run TestRealKeychainRoundTrip -v` on the Apple Silicon machine P51
   part 4 / P52 G1 used, and record the result (including what attributes the queried item reports,
   §1.1 gotcha 5) in the commit message. **If that machine is not available in the session**, the
   session must say so explicitly in the commit message rather than implying the file was verified,
   and P56's plan inherits the check as its first item.
5. `git diff --name-only` shows **zero** changes under `src/`, `tests/` and `scripts/`, and no
   `package.json` change.
6. `gofmt -l shell` is empty; `go vet ./...` is clean; `bun run lint` and `bun run typecheck:node`
   pass (both should be no-ops for this phase, which is itself the check that criterion 5 held).
7. `wails3 generate bindings -b -i -ts` regenerated, `bun run build:wails` succeeds, and the Wails
   app boots: the connections panel lists real rows, `connectionsStates` answers, the connection
   dialog shows the real secret-storage status for the platform, and a connect attempt against the
   real engine produces `connecting` → `connected`/`error` with an op-log row to match.
8. The Electron app still builds and runs (`bun run build`) — the coexistence rule.
9. `AGENTS.md` gains a **"P55 implementation findings"** entry on the same pattern as P52/P53/P54's.
   Three things are already worth writing down before implementation starts and should be confirmed
   or corrected there: `keybase/go-keychain v0.0.1`'s six gotchas (§1.1), that the darwin secrets
   file cannot be compiled or vetted from the Linux sandbox at all (criterion 4), and that
   `KIRA_INSECURE_SECRETS` now selects a Go AES-256-GCM path under a hardcoded key rather than
   Electron's `basic_text` — the existing AGENTS.md "Secrets / `KIRA_INSECURE_SECRETS`" section
   describes the Electron build and stays true for it, but now needs a sentence saying the Wails
   build honours the same variable through its own implementation.

## 11. Environment notes for the implementing session

- **A fresh container has none of the toolchain** (AGENTS.md, P52 findings). This phase is almost
  entirely `./internal/...` work: `go build ./internal/...` and `go test ./internal/...` need only
  the Go toolchain plus cgo for `mattn/go-sqlite3`'s amalgamation. A bare `go build ./...`
  additionally compiles the root `main` package, which imports Wails and needs
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`, and `wails3` itself needs
  `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` with
  `export PATH=$PATH:$(go env GOPATH)/bin`.
- **The `keybase/go-keychain` source is already in the module cache** at
  `$(go env GOPATH)/pkg/mod/github.com/keybase/go-keychain@v0.0.1` after
  `go mod download github.com/keybase/go-keychain@v0.0.1`. Read it there —
  `wails.io`/`v3.wails.io` are 403-blocked and there is no docs site for this library worth
  preferring to its own 700 lines.
- **`internal/secrets`' Linux test loop is real and complete for four of the five probe branches**
  (D3); only the darwin key source is unreachable here. Do not add a `runtime.GOOS` skip to paper
  over it — P52 §13 rejects exactly that.
- The engine fixture needs a real Node. `internal/enginetest.NodeBin` prefers
  `shell/runtime/node/bin/node` (from `scripts/vendor-node.sh`), then `$KIRA_TEST_NODE`, then
  `exec.LookPath("node")`, and **fails rather than skips** — same rule P54 set.
- `preconnect`'s tests spawn real processes and send real signals. `go test -race ./internal/...`
  should be run at least once for `preconnect`, `connections` and `notify`, which are the three
  packages in this phase with real concurrency.
