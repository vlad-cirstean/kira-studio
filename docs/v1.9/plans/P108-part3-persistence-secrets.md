# P108 Part 3 — review plan: Studio persistence, secrets and connection lifecycle

Chunk A2, stream A position 2 (pre-plan §5.2). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands one commit per finding. Tree surveyed:
`4149b08`.

Paths are repo-relative. `SI` = `apps/kira-studio/internal`, `SA` = `SI/adapters`, `SF` =
`apps/kira-studio/frontend/src`.

## 0. Method

- **`codegraph_explore`** for discovery: the cipher, keyring and reveal gate (`secrets.Cipher`,
  `localauth.Authorizer`/`Gated`, both reveal callers); `apivars` reveal and `VariablesRepo.Upsert`
  callers; `connections.Service` lifecycle against `preconnect.Supervisor` and
  `adapterhost.Router.Connect`/`Disconnect`; the teardown order in `main.go` `wireLifecycle`.
- **`git grep` of import and call lines** to get exact caller sets (Go's `internal/` rule makes
  import lines authoritative).
- **Frontend read, one hop:** `SF/api/VariableSetView.vue` and `SF/api/state/variables.ts` (the only
  `variablesUpsert` caller), and `SF/state/tabs.ts`'s connection-delete listener. These decide
  whether a repo-level contract gap is reachable.
- **Scratch replicas** in the session scratchpad (never in the tree) where a claim depends on
  runtime behavior: the preconnect pipe-then-`Wait` pattern, `net/url` error text, and
  `stripURIPassword`/`redactURLCredentials` on special-character passwords.

## 1. Own file set

Production files. `_test.go` files are read only where they are the package's own guard.

- **`SI/storage`**: `db.go`. `migrations/{embed.go, 0001..0026 *.sql}`.
  `model/{collections,connection,console,cursor,customscript,definition,grpc,layout,maskrule,mutations,objectstore,ops,queries,resolvedconnection,responsehistory,schema,settings,tabs,tree,treefilter,uriescape,variables,window}.go`.
  `repos/{collections,connections,customscripts,filter_history,filters,grpc_history,history,layout,maintenance,maskkeys,maskrules,metadata_cache,ops,repos,response_history,saved_queries,schema,secrets,settings,tabs,variables,windows}.go`.
  About 7.9k production lines.
- **`SI/secrets`**: `{cipher,scope,status,keyring_darwin,keyring_nocgo_darwin,keyring_other}.go`.
- **`SI/localauth`**: `{localauth,evaluate_darwin,evaluate_other}.go`.
- **`SI/connections`**: `{service,input,resolve,uri}.go`.
- **`SI/preconnect`**: `{supervisor,signal,tail}.go`.
- **`SI/datagrip`**: `{apply,configdir,datasources,errors,jdbc,keychain_darwin,keychain_other,scan}.go`,
  plus `testdata/**`.

About 11.5k production lines plus 6.4k test lines. That matches pre-plan §4's ~18k.

## 2. One hop: callers

- **`storage/model`**, the widest fan-in (679 edges from `SA`). Every `SA/**` adapter
  (`ResolvedConnectionConfig`, `NodePath`, `MutationPlan`/`RowValues`, `PageCursor`, `ObjectMeta`).
  Also `adapterhost`, `SI/bridge` (27 files), `apivars`, `postman`, `maskrules`, `oplog`, `tree`,
  `dbmcp`, `ipcfixture` and `main.go`. Review the model types' own validation (decode guards,
  `Validate`), not every caller's use of them. Adapter-side use belongs to Parts 4-5.
- **`storage/repos`**: `main.go` `openCore`/`wireAdapters` (`repos.New`, `NewSecrets`,
  `NewVariables`, `NewMaskKeys`, `Maintenance.Reclaim`, `SweepOrphans`,
  `Ops.ReconcileInterrupted`). Also the bridge services (`settings`, `layout`, `tabs`, `windows`,
  `variables`, `collections`, `http`, `grpc`, `schema`, `queries`, `filters`), `apivars`,
  `maskrules`, `oplog`, `tree`, `dbmcp`.
- **`secrets.Cipher`**: `repos/{secrets,maskkeys,variables}.go` (the `repos.Cipher` interface),
  `connections.Service` (`Create`/`Update` encrypt directly), `apivars/vars.go`, `main.go`.
- **`localauth`**: `connections.Service.Reveal` and `apivars.Service.reveal` share one `Authorizer`
  instance from `main.go`, so the grace window is shared.
- **`connections.Service`**: `bridge/connections.go` (thin wrappers), `bridge/datagrip.go`
  (`datagripCreator` into `Create`), `tree`, `dbmcp`, `main.go` (`Start`, `Shutdown` in
  `teardown`).
- **`preconnect.Supervisor`**: `connections.Service` only (`Start`/`Stop`/`Arm`/`StopAll`/`OnExit`).
- **`datagrip`**: `bridge/datagrip.go` (`Scan`, `Apply`).
- **Frontend contract, read only:** `SF/api/VariableSetView.vue` `commitDraft`/`onBlur` into
  `variablesUpsert`, and `SF/state/tabs.ts` `onConnectionsChanged`.

## 3. One hop: callees

- `internal/{appsettings,appstorage,sqlitex,kiratime,ipcerr,notify,jsonx}` (A1, closed; treated as
  settled).
- `adapterhost.Router` via `connections.Backend` (`Connect` runs on `context.Background()`,
  `Disconnect` is a no-op with no live adapter), `SA` `CreateAdapter`/live-adapter map.
- `apivars` (reveal), `postman` (`ShedOrigin`, `Tree`, `Variable`), `httpclient` (history types).
- OS: macOS Keychain (`keybase/go-keychain`), `LocalAuthentication.framework` (cgo), `/bin/sh`
  with process groups, and the JetBrains config directory.

## 4. Edge cases to weight

Security first. This chunk owns every at-rest secret and the reveal gate.

- **Encryption at rest.** Check AES-GCM nonce generation and AAD scope binding per column, and
  whether any copy path moves ciphertext across scopes. Duplicate is a raw copy by design. History is
  re-sealed. Check the key-length invariant on every keychain load path (`New` panics on a bad
  length). Check the insecure Linux fallback's env parsing.
- **Plaintext that escapes the cipher.** Look for any write path that stores a credential outside
  `password`/`secret_value`/`mask_correlation_key`. Cover the URI-mode userinfo strip with
  unencoded `/ ? # @ :` in the password. Check query-string `password=` params. Check datagrip
  skip/error strings (`SkipDetail`, `ReportRow.Error`), which cross the bridge.
- **Secret leakage into logs and errors.** Check `slog` lines and `ipcerr` messages on the reveal,
  resolve, decrypt and connect paths. Check `net/url` error text that echoes the raw URL.
- **Reveal gate.** Check `confirmed` honored only when OS auth is unavailable, the grace window
  shared across both reveal kinds, concurrent `Authorize` calls, and the timeout/unavailable paths
  of the darwin shim.
- **Secret contracts at the repo boundary.** A secret's list projection is `""`. Any update path
  that writes the draft value back must not treat `""` as "replace with empty". Check
  `VariablesRepo.Upsert` against the only frontend caller. Check the bulk path's `HasValue`
  handling. Check history purge on a plain-to-secret flip.
- **Password injection on Test.** `destinationUnchanged` must gate every field that changes where
  the password goes. Check that its implementation matches its stated denylist property.
- **Connection lifecycle races.** Check Disconnect/Remove/Update while a Connect is in flight
  (including the 2 s preconnect settle window), sidecar exit racing `Arm`, Connect dedupe, and
  state left behind for a removed id.
- **Preconnect process lifecycle.** Check every wait for boundedness (`killEntry`, `StopAll` on
  the quit path, `Test`'s deferred `Stop`). Check stderr-pipe EOF against process exit when a
  descendant leaves the process group. Check pid reuse and the one-shot/sidecar classification.
- **Persistence correctness.** Check the migration order against `model` columns, and FK
  cascades on connection delete (tabs, mask rules, filters, metadata). Check P107 I2-1's
  leaf-table consolidation (every settings/layout leaf still round-trips). Check the per-scope and
  byte-budget caps, byte truncation of text at the cap, and the dense sort-order reindex after
  deletes.
- **Datagrip import.** Check path macro expansion, `.idea`-direct picks, bounded XML reads,
  password-free preview, and a single Keychain lookup per selected row.

## 5. Watch items (pre-plan §5.2)

- P107 I2-1 leaf-table repos: `SettingsRepo.Set` upsert chain and `LayoutRepo.Set`
  read-merge-write inside one transaction.
- P103 Part 4 settings split: `model.Settings` over `appsettings.{Appearance,Git,AdvancedCore}`.
- Migrations ordering against `model` (26 steps, `embed.go` names list).
- One shared `authorizer` for connection-password and variable reveals.

## 6. Out of scope

- Adapter-side use of `model` types, including mutation key validation in `SA/sqlmutate.go`.
  That belongs to Parts 4-5.
- The Studio-only `shared/domain` TS mirrors (Part 12). Frontend files are read here only to decide
  reachability. A fix that needs them lands under pre-plan §3.3, in stream A.
- Generated code, and P110's `--color-muted` collision.
