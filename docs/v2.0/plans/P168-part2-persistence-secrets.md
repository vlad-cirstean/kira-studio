# P168 Part 2: review plan, Studio persistence, secrets and connection lifecycle

Chunk A1, Stream A position 1 of 12, phase 1 (pre-plan `P168-prep-plan.md` §5.1). One Opus
reviewer runs this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§7).
Tree surveyed: `07036af` (`p168-stream-a`). `v2.0` tip `eac9db0` adds one Space test file only;
no Part 2 file differs.

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SA` = `SI/adapters`, `SF` =
`apps/kira-studio/frontend/src`. Line numbers below are as of `07036af`; re-read before citing.

SPEC row names this file `P168-part2-persistence.md`; the orchestrator named it
`P168-part2-persistence-secrets.md`. Same plan, this name wins.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  before any Read/Grep on a symbol, call-path or blast-radius question. The orchestrator greps
  the run's tool log for real calls. Index: run `sh scripts/codegraph-setup.sh` in the worktree
  if `.codegraph/` is missing. Seeds: `secrets.Cipher` `Encrypt`/`Decrypt`/`probe`;
  `localauth.Authorizer.Authorize`, `Gated`; `connections.Service`
  `Connect`/`attemptConnect`/`finalizeAbortedAttempt`/`Disconnect`/`Remove`/`Update`/`Test`/
  `Reveal`/`Shutdown`/`onPreconnectExit`; `preconnect.Supervisor`
  `Start`/`Arm`/`Stop`/`StopAll`/`killEntry`/`awaitExit`; `repos.VariablesRepo.Upsert`;
  `SettingsRepo.Set`, `LayoutRepo.Set`; `datagrip.Scan`/`Apply`/`ParseProject`; `main.go`
  `openCore`, `wireAdapters`, `wireLifecycle`.
- **CodeGraph over-links TS names and same-named Go methods across apps** (Space `repos.New`,
  `Settings.Set` showed up in Studio queries). Confirm every cross-package claim with `git grep`
  of import lines. Go's `internal/` rule makes import lines authoritative.
- **Scratch replicas** in the session scratchpad, never the tree, where a claim turns on runtime
  behavior (process-group exit vs pipe EOF, `net/url` error text, migration replay on a fresh DB).
- **Checks:** `go vet ./apps/kira-studio/internal/...` and
  `go test ./apps/kira-studio/internal/{storage,secrets,localauth,connections,preconnect,datagrip}/...`.
  If missing deps or bindings fail them: `bun install --frozen-lockfile` and `bun run setup`
  (or `scripts/prepare-worktree.sh`; `docs/DEV_ENVIRONMENT.md`). A red check is a finding.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `07036af`. Every Part's file count and code-line count matches
`f40cd35` exactly (Part 2: 145 files, 19,684 lines, 7,872 tests; streams A 254,084, B 182,094;
2,868 owned, 0 orphans). Only drift: `docs` excluded 472 to 474 and tracked 3,493 to 3,495, from
`P166-code-review.md` and `P168-prep-plan.md` landing. Neither is owned. **No ownership drift.**

P166-scope churn in Part 2 (`743af03..07036af`): 5 lines, all `storage/model/settings.go`
(P160's response-size default). History in this clone is shallow (58 commits), so churn since
P108 cannot be computed; review the whole chunk, not a diff.

## 2. Own file set (145 files)

71 production `.go`, 41 `_test.go`, 29 `.sql`, 4 testdata `.xml`. 11,812 production lines,
7,872 test lines.

- **`SI/storage`** (59): `db.go` (`OpenAt` over `appstorage.OpenAt`). `dsn_test.go`.
- **`SI/storage/migrations`** (685): `embed.go` (`names` list, 29 steps), `0001_init.sql` ..
  `0029_p127_drop_agent_hooks_settings.sql`. Four `migrate_*_test.go`.
- **`SI/storage/model`** (2,000): `collections, connection, console, cursor, customscript,
  definition, grpc, layout, maskrule, mutations, objectstore, ops, queries, resolvedconnection,
  responsehistory, schema, settings, tabs, tree, treefilter, uriescape, variables, window`.
- **`SI/storage/repos`** (5,347): `collections, connections, customscripts, filter_history,
  filters, grpc_history, history, layout, maintenance, maskkeys, maskrules, metadata_cache, ops,
  repos, response_history, saved_queries, schema, secrets, settings, tabs, variables, windows`.
- **`SI/secrets`** (372): `cipher, scope, status, keyring_darwin, keyring_nocgo_darwin,
  keyring_other`.
- **`SI/localauth`** (308): `localauth, evaluate_darwin, evaluate_other`.
- **`SI/connections`** (1,246): `service, input, resolve, uri`.
- **`SI/preconnect`** (529): `supervisor, signal, tail`.
- **`SI/datagrip`** (1,266): `apply, configdir, datasources, errors, jdbc, keychain_darwin,
  keychain_other, scan`, plus `testdata/**`.

`_test.go` files are read where they are the package's only guard of a claim.

## 3. One hop: callers (git grep of import lines, production files)

- **`storage/model`**, widest fan-in: every `SA/**` engine package plus `SA/{adapter,
  relationalpage,rowops,sqlmutate,sqltext,tree}.go` and 13 `SA/testsupport` files;
  `adapterhost/{data,router,wire}.go`; 21 `bridge` files; `dbmcp/{access,explain,permissions,
  render,server,tools}.go`; `enginecache/pages.go`; `ipcfixture/{frozen,harness}.go`;
  `maskrules/service.go`; `oplog/wire.go`; `postman/{aliases,body,collection,parse,write}.go`;
  `tree/service.go`; `main.go`. Review the model types' own validation and decode guards, not
  each caller's use. Adapter-side use belongs to Parts 3-4.
- **`storage/repos`**: `apivars/vars.go`, `appcore/deps.go` (the bridge reaches repos only
  through `appcore.Deps`), `connections/{resolve,service}.go`, `ipcfixture/harness.go`,
  `maskrules/service.go`, `oplog/wire.go` (`ReconcileInterrupted`, `Prune`), `tree/service.go`,
  `main.go` (`openCore`: `repos.New`, `NewSecrets`, `NewVariables`, `NewMaskKeys`;
  `wireAdapters`: `SweepOrphans` x2, `Maintenance.Reclaim`; `wireLifecycle`: close order).
- **`storage`**: `main.go` `openCore`, `ipcfixture/harness.go`.
- **`secrets`**: `repos/{secrets,maskkeys,variables}.go` (the `repos.Cipher` interface),
  `connections/service.go` (`Create`/`Update` encrypt directly), `apivars/vars.go`,
  `ipcfixture/harness.go`, `main.go`.
- **`localauth`**: `connections/service.go` (`Reveal`), `apivars/{vars,reveal}.go`, `main.go`.
  One `*Authorizer` from `openCore` feeds both: the grace window is shared.
- **`connections`**: `bridge/connections.go`, `bridge/datagrip.go` (`datagripCreator` into
  `Create`), `adapterhost/router.go` (implements `connections.Backend`, returns
  `connections.ConnectResult`), `appcore/deps.go`, `ipcfixture/harness.go`, `main.go` (`Start`;
  `Shutdown` in `teardown`, after DB MCP stop).
- **`preconnect`**: `connections/service.go` only, plus `ipcfixture/harness.go` and `main.go`
  construction.
- **`datagrip`**: `bridge/datagrip.go` (`Scan`, `Import` into `Apply`).
- **Frontend, read only to decide reachability:** `SF/api/state/variables.ts` (sole
  `variablesUpsert` caller), `SF/state/{connections,tabs}.ts` (`onConnectionsChanged`),
  `SF/state/datagripImport.ts`, `SF/project/state/tree.ts`.

## 4. One hop: callees

- Root `internal/{appsettings,appstorage,sqlitex,kiratime,ipcerr,notify,jsonx}` (Part 8, later;
  unreviewed in this stream, read as callee). `appstorage.UpdateLeaves`/`UpsertLeafList` and
  `sqlitex.LoadMigrations` decide Part 2 correctness; read them.
- `SI/config` (`EnsureLayoutAt`, `DbPathAt`; Part 6). `SI/httpclient` (from
  `model/responsehistory.go`, `repos/response_history.go`) and `SI/postman` (from
  `repos/{collections,variables}.go`): Part 7.
- `adapterhost.Router` through `connections.Backend` (`Connect`, `Test`, `Disconnect`,
  `SetThrottle`, `takeLiveAdapterForTeardown`, `disconnectTimeout` 10 s). No direct `SA` registry
  import from `connections` at this tree; the pre-plan's "adapter registry" callee is reached
  only via the router.
- OS: macOS Keychain (`keybase/go-keychain`, `secrets` and `datagrip`),
  `LocalAuthentication.framework` (cgo shim), `/bin/sh -c` with `Setpgid`, the JetBrains config
  root, `os.UserHomeDir`.

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk owns
every at-rest secret and the reveal gate.

### 5.1 Crypto and secrets

- Nonce generation, AAD binding per `Scope`, and any path that copies ciphertext across scopes
  (connection `Duplicate`, variable history re-seal, mask key not copied on duplicate).
- Key-length invariant on every keychain load path: `New` panics on a bad length. A keychain item
  of wrong length (hand-edited, other app) must not crash startup.
- `probe` platform switch: `KIRA_INSECURE_SECRETS` parsing, darwin no-cgo stub, Linux without the
  env, keychain denied versus missing item versus locked keychain.
- `Status.Reason` nil dereference: `Encrypt`/`Decrypt` read `*c.status.Reason` when unavailable.
  Confirm every unavailable path sets it.
- Plaintext outside the cipher: any write of a credential outside `password`/`secret_value`/
  `mask_correlation_key`. URI-mode userinfo strip with unencoded `/ ? # @ :` in the password,
  `password=` query params, datagrip `SkipDetail`/`ReportRow.Error` crossing the bridge.
- Secret leakage into `slog` and `ipcerr` text on reveal, resolve, decrypt, connect, Test, and
  `Update`'s reconnect warning. `net/url` errors echo the raw URL.

### 5.2 Reveal gate (`localauth`)

- `Authorize` releases the mutex between the grace check and `evaluate`: two concurrent reveals
  both prompt. Decide whether that is a real defect (double OS prompt) or acceptable.
- `confirmed` honored only when OS auth is unavailable; grace not recorded on that path.
- Grace shared across connection and variable reveals; clock moving backwards.
- Darwin shim timeout, cancel and unavailable outcomes; error mapping in `Gated`.

### 5.3 Migrations

- `names` order and version numbers against files; a file present but not listed, or listed and
  absent.
- Columns each `model`/`repos` query reads against the schema after step 29. Drop migrations
  (0025, 0026, 0028, 0029) leaving rows a reader still decodes, or readers of dropped tables.
- `0029` deletes two `claudeCode.*` leaves; `ClaudeCodeSettings` keeps `keepAwakeWithAgents`.
  Confirm the leaf set in `repos/settings.go` matches what survives.
- Schema-too-new path: `*sqlitex.SchemaTooNewError` must reach `startupfail` unwrapped.
- FK cascades on connection delete: tabs, mask rules, filters, filter history, metadata cache,
  saved queries, op log, response/gRPC history.

### 5.4 Storage repos

- Secret contracts at the repo boundary. A secret's list projection is `""`; no update path may
  read `""` as "replace with empty". `VariablesRepo.Upsert` against `SF/api/state/variables.ts`;
  bulk path `HasValue`; history purge on a plain-to-secret flip; `variableHistoryLimit` trim.
- Settings and layout leaf round trips: every patched leaf written and read back,
  `UpdateLeaves` transaction scope, P160's response-size default, unknown stored leaves.
- Per-scope and byte-budget caps (`history.go`, `response_history.go`, `grpc_history.go`,
  `ops.go`): byte truncation at a UTF-8 boundary, cap math overflow, trim inside the same
  transaction as the insert.
- `SweepOrphans` (`tab_id NOT IN (SELECT id FROM tabs)`): NULL `tab_id` rows, and a sweep running
  before tabs are restored.
- Dense `sort_order` reindex after delete and reorder (connections, environments, variables,
  custom scripts); reorder with a stale or partial id list.
- `MaskRulesRepo.Upsert` case-insensitive conflict against `findExisting`; `MaskKeysRepo
  .EnsureKey` race (two first-time callers mint two keys).
- `Maintenance.Reclaim` on a pre-P23 file; prepared statements (`OpsRepo.insert/update`) closed
  before `db.Close`.
- Wrapped `sql.ErrNoRows` consistency on update/remove of an unknown id.

### 5.5 Connection lifecycle (`connections`)

- Disconnect/Remove/Update/Shutdown while a Connect is in flight, including the preconnect
  settle window; `cancelInFlight` then `finalizeAbortedAttempt` leaving no state, sidecar or live
  adapter for a removed id.
- `Update` reads `StateOf` twice and skips reconnect when status is `connecting`: an in-flight
  Connect then finishes against the old destination or old `ReadOnly`.
- `Update` reconnect is synchronous on the bridge goroutine; Connect failure is only logged.
- `destinationUnchanged`: denylist matches its stated property (every new field gated), and
  `zeroExemptFields` exempts only fields that cannot redirect the stored password on `Test`.
- Password three-state (`nil`/`""`/value) through `Create`, `Update` (URI and form mode),
  `Duplicate`, datagrip `Create`.
- `Remove` ordering: `Conns.Delete` then `Secrets.Delete` (the second is a no-op on a deleted
  row; confirm it never errors). `Preconnect.Stop` after `Backend.Disconnect`.
- `onPreconnectExit` for an id already disconnected or removed: an `error` state emitted for a
  connection no longer there, or overwriting `disconnected`.
- `resolve.go`: URI building and percent-encoding, `uri.go` strip/redact on every special
  character, IPv6 hosts, empty user with password.
- Emitter ordering: `stateChanged` and `listChanged` from concurrent goroutines.

### 5.6 Preconnect (`preconnect`)

- Every wait bounded: `killEntry` (SIGTERM, `killGrace`, SIGKILL), `StopAll` on quit, `Test`'s
  deferred `Stop`, `cmd.WaitDelay` when a descendant leaves the process group.
- `Start` kills the existing entry, then spawns: two concurrent `Start` calls for one id can both
  spawn and one entry is lost (untracked process).
- One-shot versus sidecar classification at exactly the settle window; exit after `Arm` versus
  before; pid reuse on signal to a reaped group.
- `tail.go` stderr ring: partial lines, very long lines, non-UTF-8, secrets echoed by scripts.
- `withAugmentedPath` duplicates or ordering; `os.UserHomeDir` failure.

### 5.7 DataGrip import (`datagrip`)

- Malformed or oversized XML (bounded reads), missing `dataSources.local.xml`, `.idea`-direct
  picks, path macro expansion (`$PROJECT_DIR$`, `$USER_HOME$`, unknown macros).
- JDBC URL parsing per engine: IPv6, missing port, query params, URL-encoded parts, unsupported
  drivers, `sqlite` file paths relative to the project.
- Password-free preview; one Keychain lookup per selected row; `KEEPASS`/`DO_NOT_STORE`/
  `MEMORY_ONLY` outcomes; first config-dir candidate choice when several IDE versions exist.
- Re-parse on `Apply` versus a changed file between Scan and Apply (uuid gone, row changed).
- Name truncation on multi-byte names.

## 6. Watch items (pre-plan §5.1) and known coverage

- Watch: migration order against `model`; settings leaf-key round trips; shared reveal grace;
  keychain fallbacks per platform; datagrip malformed XML and JDBC URLs; preconnect tail and
  signal races. All folded into §5.
- **P166 (`docs/v2.0/plans/P166-code-review.md`, still on disk at `07036af` and `v2.0`).** Its
  scope barely touches this chunk. F9 cites `SI/storage/model/settings.go:84` as the correct side
  of a stale TS comment (`SF/state/settingsDomain.ts`, Part 13); skip it. No other P166 finding
  names a Part 2 file. Before starting, check `docs/v2.0/plans/P16{6,7}-code-review.md` again:
  any finding still listed there on a Part 2 file is skipped (that chain fixes it).
- P108 Part 3's fixes (preconnect F1 `WaitDelay`, connections F4 in-flight cancel, variables F2
  split) are in code. Verify they hold; do not re-report them as new.

## 7. Rubric and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario, and a proposed fix. Mark a finding that needs a real design decision
  as such; the fixer turns it into its own `SPEC.md` phase.
- Writes `docs/v2.0/plans/P168-part2-findings.md`: base commit, HEAD reviewed, checks run and
  results, findings, then coverage (reviewed, skimmed, not reached). A chunk with nothing real
  says so; never manufacture a finding.
- Commits the findings file alone (`docs(v2.0): P168 Part 2 findings`), normal commit, hooks
  green, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 2`, under
  pre-plan §3.3 edit scope. It deletes the findings file when done. Chunk lands per pre-plan §3.4
  before Part 3's plan starts.

## 8. Out of scope

- Adapter-side use of `model` types, including `SA/sqlmutate.go` key validation (Parts 3-4).
- Bridge wrappers beyond reachability (Part 6); `apivars`/`postman`/`httpclient` internals
  (Part 7); root `internal/*` defects (Part 8: record in findings as a callee note only if it
  breaks a Part 2 contract).
- Studio `shared/domain` TS mirrors and frontend stores (Parts 5, 13). A fix needing them lands
  under pre-plan §3.3, in Stream A.
- Generated code, docs, excluded files (pre-plan §6).
