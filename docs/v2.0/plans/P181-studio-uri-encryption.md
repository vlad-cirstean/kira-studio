# P181: Studio connection URI encrypted at rest

Source: `SPEC.md` row P181. Origin: P170 studio-go S5. The row's **Decided (user)** note governs.
One sequential implementer. Planned against `54922c2`.

User decision (final, not reopened here):

- Store the whole connection URI encrypted, as an opaque value, with the app's existing `Cipher`.
  Query secrets (`password`, `sslpassword`, `tlsCertificateKeyFilePassword`, `proxyPassword`) stay
  inside it. No separate slots for them.
- No migration. Old plaintext rows are out of scope (behavior below: fail loudly, no data loss).
- Default view masks the URI fully. No screen derives display from the URI; the connection name is
  what shows.
- Show decrypts through a Go call, reusing the existing connection password reveal and its gate.
  Save re-encrypts.
- List never returns the plaintext URI.

## Current behavior (read from source at `54922c2`)

### Storage and service

- `connections.uri` is a plaintext `TEXT` column. `ConnectionsRepo` selects it
  (`connectionSelectColumns`) and writes it from `f.URI` in every insert/update
  (`connectionColumns`, `connectionArgs`, `repos/connections.go:14-51`).
- `connections.password` holds a `kira:v3:` ciphertext under `secrets.ScopeConnection`.
  `SecretsRepo` (`repos/secrets.go`) is the only reader; writes ride `InsertWithSecret` /
  `UpdateWithSecret` / `InsertDuplicateWithSecret` (subquery raw copy).
- `Service.Create`/`Update` (`connections/service.go:325-473`) run `stripURIPassword` on a URI-mode
  draft: userinfo password and `password` query pair move to the password column; the rest of the
  URI is stored plaintext. `Validate` (`input.go:128-145`) refuses a URI with a raw `/ ? #` in its
  password (`uriHasAmbiguousPassword`) and any non-empty `sslpassword` /
  `tlscertificatekeyfilepassword` / `proxypassword` pair (`uriHasCredentialQuery`).
- `Start` runs `migrateStoredURIPasswords` (`service.go:170-204`). `List`, `Reorder`, `Duplicate`,
  `emitListChanged` pass rows through `withoutURIPassword`.
- `resolve` (`resolve.go:25`) reads the row plus `Secrets.Get` and re-injects the password into the
  URI. `resolveFromInput` strips then re-injects. `Test` injects the stored password only when
  `destinationUnchanged` (reflect.DeepEqual over `ConnectionFields`, URI included).
- `Reveal(id, confirmed)` (`service.go:582`) runs `localauth.Gated` around `Secrets.Get`; returns
  `RevealResult{Password, Error, Outcome}`, four outcomes. Bridge: `ConnectionsService.Reveal`.

### Leak paths found

1. `connections.uri` on disk: plaintext minus the userinfo/`password` value. Query secrets the
   refusal misses (and static AWS keys in an SQS/S3 URI's userinfo before stripping) are the S5 gap.
2. `options_json`: `ConnectionDialog.vue` `setUri` copies every parsed query param into
   `draft.options` (`ConnectionDialog.vue:221-232`). Options are stored plaintext and returned by
   `List`. A `?password=` / `?sslpassword=` value lands there verbatim. Same on a URI-to-fields flip
   (`setMode`, `d.options = parsed.params`), which then persists in fields mode.
3. `List`/`Get` responses and the `connections:list-changed` event: carry `uri` (stripped).
4. ipcfixture `SeedConnection` writes through `Repos.Connections.Insert`, bypassing the strip; the
   committed `sqs.fixture.json` / `tests/ipc/sqs/sqs.fixture.ts` show
   `"uri": "sqs://test:test@us-east-1"` in a `connections:list` response.
5. Adapter error text reaches `ConnectionState.Error` (event payload), `TestResult.Error`, and the
   op log on disk. The complete suite's leak check (`testsupport/matrix.go:173`) covers only the
   userinfo password. pgx's `ParseConfigError` redacts userinfo, `password` and `sslpassword`
   (pgconn `redactURLPassword`). redis/sqlite/kafka/clickhouse/mysql/awscfg wrap `url.Parse`
   errors as `Cause` behind a constant `Message`; `adapters.Error.Error()` returns `Message` only.
   Mongo's `mapError` uses the driver's own text.
6. Logs: no `slog` line in `connections`, `adapterhost` or `adapters` prints a URI or a config.
   `mysqlfamily.applyURIOptions` logs unknown query *keys*, never values.
7. Not leaking: `dbmcp.listConnections` exposes id/name/kind/status/permissions only.
   `tree.Service`, `adapterhost.Router.KindOf`, `datagrip` (always `Mode: "fields"`) never read the
   URI. No connection export/backup feature exists.

### Frontend readers of `uri`

- `ConnectionDialog.vue`: `refreshUriNote` derives `host:port / db` from the URI (display — must
  go), `setMode`, `setUri`, the URI `<Input>` (plain text, unmasked).
- `project/menus.ts:141-156` Copy URI: copies `record.uri` for URI mode.
- `state/connections.ts` `openEditDialog`: spreads the summary (incl. `uri`) into the draft.
- No tree row, tab, tooltip, StudioStart or schema surface reads `uri`
  (`state/schemaColumns.ts:58` reads `database`, null in URI mode already).

### Adapters needing `Options` in URI mode

`awscfg.Resolve` reads `cfg.Options["endpoint"]`, `s3.Adapter.Connect` reads `["bucket"]`,
`ParseSSLMode` reads `["sslmode"]` (mongo, redis …). In URI mode these arrive only because the
renderer copied the query into `options` (leak 2). mysqlfamily re-parses the URI query itself.

## Design

### D1. One ciphertext column per secret; new scope

- `connections.uri` holds `kira:v3:` ciphertext under a new `secrets.ScopeConnectionURI =
  "connection-uri"`. P29's rule: one scope per ciphertext column. No schema change (`TEXT`
  nullable already).
- `SecretsRepo` becomes the only reader of `connections.uri`: new `GetURI(id) (*string, error)`
  decrypts it. Its header comment says it owns both columns.
- `ConnectionsRepo` stops selecting `uri` (`connectionSelectColumns`), and drops it from
  `connectionColumns` / `connectionSetColumns` / `connectionArgs` (20 columns). Every summary the
  repo returns therefore has `URI == nil`. That one choke point is what makes List, Get, the
  list-changed event, Create/Update/Duplicate/Reorder returns and ipcfixture's recorded list carry
  no URI. `withoutURIPassword` is deleted.
- Writes take ciphertext the caller produced, like the password today:
  - `type SecretWrite struct { Set bool; Value *string }` in `repos` (`Set=false` leaves the
    column alone, `Set=true` writes `Value`, nil clears).
  - `InsertWithSecret(connID, f, createdAt, secretEnc, uriEnc *string)`.
  - `UpdateWithSecret(connID, f, updatedAt, password, uri SecretWrite)`. Build the `SET` list from
    the two writes rather than four statement copies.
  - `InsertDuplicateWithSecret` copies `uri` by subquery, same as `password` (raw copy; scope is
    per kind, so it authenticates in the new row).
  - `Insert`/`Update` (no secret) keep their signatures and never touch either column.
- `model.ConnectionFields.URI` stays: it is the input carrier (`connections.Input` embeds it) and
  keeps the wire key. Its comment states it is always nil on output (repo never reads the column).
  Not moved to `Input`: that would drop the `uri` key from the summary JSON and churn 60+ TS
  fixtures typed `ConnectionSummary` with `uri: null` (several in P176's files).

### D2. URI mode: the URI is the single source of truth

- Create (uri mode): `in.URI` required (nil or blank → `E_BAD_REQUEST` "A connection URI is
  required."). Fold the password: if `in.Password` is non-empty and the URI's userinfo has no
  password, inject it (`injectURIPassword`). Encrypt the result under `ScopeConnectionURI` before
  any write (cipher unavailable → `E_SECRET_STORE`, no row; same as a password today). Password
  column NULL. `Options` stored as `{}`.
- Update (uri mode), `in.URI != nil` (user typed or revealed it):
  - Effective password: `in.Password` if non-nil, else the stored password column (read only when
    the URI has no userinfo password; a read/decrypt failure returns the error, never drops it).
  - Fold as Create. Encrypt. Write `uri`, clear `password` (`SecretWrite{Set: true}`).
  - Why the stored-password fold: editing a fields-mode connection, flipping to URI without
    revealing the password, then saving would otherwise lose the password silently. Same for an
    old row whose password was stripped into the column.
- Update (uri mode), `in.URI == nil`: means "unchanged" (masked, never revealed). Allowed only when
  the stored row is URI mode; otherwise `E_BAD_REQUEST` "A connection URI is required.". A
  non-nil `in.Password` here → `E_BAD_REQUEST` "Change the password inside the URI." (no dialog
  path sends it; refusing beats a silent drop). Both secret columns untouched.
- Update (fields mode): password three-state as today; `uri` cleared (`SecretWrite{Set: true}`).
- Normalize once at the top of Create/Update/Test (`Input.normalized()`): fields mode → `URI =
  nil`; uri mode → `Options = {}`. Removes leak 2 for any caller, and keeps `destinationUnchanged`
  from flagging stale draft leftovers.
- `resolve` (uri mode): `config.URI = Secrets.GetURI(id)` (nil → error "connection %s has no
  stored URI"), `config.Password = nil`, `config.Options = stored options` overlaid by the URI's
  query pairs (new `uriQueryOptions`: split on `&`, `url.QueryUnescape` with raw fallback, last
  value wins — same as `parseConnectionUri`'s `URLSearchParams` loop). Stored options are `{}`
  for new rows; the overlay keeps ipcfixture-seeded rows (endpoint in `options`) working.
  Fields mode unchanged.
- `resolveFromInput`: uri mode folds `in.Password` (no stripping), options from the URI query as
  above.
- `Test(in, existingID)`: uri mode with `in.URI == nil` → needs `existingID` whose row is URI mode
  and `destinationUnchanged` (non-URI fields); then `in.URI = Secrets.GetURI(existingID)`. A read
  failure is a failed `TestResult` carrying the error message (nothing else to test). Fields mode:
  P14/P12 password injection unchanged.
- `destinationUnchanged` callers (Update, Test): when `in.URI != nil` and the stored row is URI
  mode, decrypt the stored URI into the comparison copy; decrypt failure counts as changed. When
  `in.URI == nil` both sides are nil. No change to `zeroExemptFields`.
- Delete: `migrateStoredURIPasswords` and its `Start` call, `withoutURIPassword`,
  `stripQueryPassword`, `stripURIPassword` (replaced by `userinfoPassword(uri) *string`, a thin
  read of `stripUserinfoPassword`'s detection), `uriHasCredentialQuery`.
- Keep `uriHasAmbiguousPassword` in `validateMode`: the fold locates the userinfo with
  `findAuthority`, and a raw `/ ? #` password makes that wrong. Update its comment (reason is now
  the fold, not the plaintext leak).
- `injectURIPassword`, `findAuthority`, `queryRange`, `queryKey` stay (used by fold and
  `uriQueryOptions`).

### D3. Fields mode must not carry a query secret either

`credentialQueryKeys` survives, reduced and repurposed: `secretOptionKeys = password, sslpassword,
tlscertificatekeyfilepassword, proxypassword` (case-insensitive). `validateMode` in fields mode
refuses an `Options` key in that set: `E_BAD_REQUEST` "The \"<key>\" option holds a secret that
fields mode cannot store — use URI mode.". This is the only place a query secret could still reach
plaintext storage (a URI-to-fields flip copies `parsed.params` into `options`). The dialog refuses
the same flip first (D5).

### D4. Reveal returns the URI

- `RevealResult` gains `URI *string \`json:"uri"\``. `Reveal(id, confirmed)` reads the row first
  (missing → error outcome). URI mode: fetch is `Secrets.GetURI`, result in `URI`, gate reason
  `"reveal a saved connection URI."`. Fields mode: unchanged (`Password`, existing reason).
  `localauth.Gated` unchanged (one `*string`); same Authorizer, same 5-minute process-wide grace,
  same four outcomes, same `slog` lines (id only).
- Bridge `ConnectionsService.Reveal` unchanged. Regenerate bindings
  (`wails3 task common:generate:bindings`) for the new field.

### D5. Dialog: masked URI, Show reuses the password reveal

All in `ConnectionDialog.vue`, existing shadcn-vue `Input` + `TooltipIconButton`, Tailwind only.

- The URI `<Input>` mirrors the password field exactly: `:type="showPassword ? 'text' :
  'password'"`, placeholder `Unchanged — click the eye to reveal` while `!revealed`, an eye
  `TooltipIconButton` labelled `Show URI` / `Hide URI` calling `onEyeClick`. `revealed` /
  `showPassword` are shared: only one of the two inputs is on screen at a time. Create mode starts
  `revealed` (free toggle), masked.
- `requestReveal` on `revealed`: set `target.password = result.password` and, when
  `result.uri != null`, `target.uri = result.uri` (`?? null` tolerates a mock without the key).
  Confirm text becomes mode-aware: "Show the saved URI for …" in URI mode.
- Typing in the masked URI field replaces it (`setUri` sets `revealed = true`, like
  `onPasswordInput`). This is also the recovery path for an old plaintext row (D7).
- `setUri` stops copying query params into `draft.options` (D2 derives them in Go).
- `refreshUriNote`, its `onMounted` call and the `@blur` go. `uriNote` stays only for the
  mode-flip messages. Keep the `<p class="uri-note">` element rendered so dialog height does not
  change (`connection-dialog-tabs.spec.ts` `assertUnchanged`).
- `setMode('fields')` while `draft.uri === null` (masked, unrevealed): stay in URI mode, note
  "Show the URI first to switch it to fields.". If `parsed.params` has a `secretOptionKeys` key:
  stay, note "This URI holds a secret parameter (<key>) that fields mode cannot store — staying in
  URI mode.".
- `setMode('uri')`: unchanged (`formatConnectionUri({ ...d, password: null })`; Go folds the
  password, D2).
- `packages/shared/domain/connection.ts`:
  - `connectionSummarySchema` `.extend({ uri: z.null(), … })`: type-level "List never carries a
    URI", the D9 analogue. Only `connections.spec.ts`'s `URI_CONNECTION` fixture needs a change.
  - `connectionInputSchema` superRefine: error only when `uri` is a blank string; `null` passes
    (means unchanged; Go is the authority and rejects null on Create). Comment on `uri`: input
    three-state, never on the way out.
  - Export `SECRET_OPTION_KEYS` (lowercase set) mirroring D3, for the dialog check.
- `bridge/index.ts` `connectionsReveal` return type adds `uri: string | null`.

### D6. Copy URI goes through the same gate

`project/menus.ts` Copy URI: fields mode unchanged (synthesised, passwordless). URI mode: reveal,
then copy on `revealed`. P7's rule: a surface that exposes a secret's value is a reveal.

The four-outcome loop moves out of `ConnectionDialog.vue` into a new
`frontend/src/project/state/connectionReveal.ts`: `revealConnectionSecret(id, name, mode,
isCurrent: () => boolean): Promise<RevealResult | undefined>` (confirm via `useConfirmDialogStore`,
recurse once on `confirmation-required`, re-check `isCurrent` after every await, error through a
returned `{ error }` or callback). Dialog `requestReveal` becomes a thin wrapper passing its
`stillCurrent`; menus passes `() => true` and, on an `error` outcome, rejects its `run` promise
with `new Error(result.error)` — the same channel a `copyText` rejection already takes today (no
new primitive). Not `api/reveal.ts`'s `runReveal`: `project/**` may not import `api/**` (P12 D13
boundary), and its `RevealResult` is the variables shape.

### D7. Old plaintext rows (no migration)

A row written before P181 has a non-enveloped `uri`. `Cipher.Decrypt` already refuses it with
`E_SECRET_STORE`: "The stored credential is not in this app's kira:v3: envelope format — values
saved by an earlier version of Kira Studio cannot be read and must be entered again."
`SecretsRepo.GetURI` wraps it with the id. Effect:

- List/Get: unaffected (repo never reads the column), row stays visible. No data deleted.
- Connect: `error` state with that message. Test (masked): failed result with it. Reveal: `error`
  outcome with it.
- Fix: Edit, type a new URI into the masked field, Save. The fold (D2) re-injects an old stripped
  password from the password column if the new URI has none, then clears that column.

Loud, not silent; nothing is lost. Old plaintext bytes may survive in SQLite free pages/WAL after
that rewrite (no `secure_delete`); accepted: legacy rows are out of scope by decision, and a
global pragma would tax every delete app-wide. New rows never write plaintext.

### D8. Adapter error leak check

`testsupport/matrix.go`: `passwordFromURI` becomes `secretsFromURI(uri) []string` — the userinfo
password plus the value of each `secretOptionKeys` query pair (decoded). The existing
`runMatrixCase` assertion checks each. Every existing uri-mode case picks it up; no new case
(complete suite runs on demand/CI with Docker). A local copy, not an import of
`internal/connections` (same reason as today).

## Leak coverage summary

| Path | Covered by |
|---|---|
| SQLite `uri` column | D1 ciphertext; D7 for old rows |
| `options_json` | D2 normalize (uri mode `{}`), D3 refusal, D5 `setUri` |
| List/Get/event/returns | D1 repo never selects `uri`; D5 `uri: z.null()` |
| Renderer memory | only after Show or typing; `closeDialog` drops the draft |
| Clipboard | D6 gated |
| Adapter errors / op log / state event | pgx redaction; constant messages; D8 check |
| `slog` | no URI or config logged; Reveal logs id only |
| ipcfixture | D1 (seed encrypts, list records `uri: null`) |
| MCP, tree, datagrip | never read it |

## Steps (one commit each, Conventional Commits, in order)

1. **`feat(secrets): connection-uri cipher scope`**
   - `apps/kira-studio/internal/secrets/scope.go`: `ScopeConnectionURI`, `valid()`.
   - `apps/kira-studio/internal/secrets/cipher_test.go`: one freeze line in
     `TestScopeStringsAndEnvelopePrefixAreFrozen`.

2. **`feat(studio): encrypt the whole connection URI at rest`** (Go; must build, vet and test green
   on its own, so service, harness and tests move together)
   - `internal/storage/repos/connections.go`: D1 (select list, column lists, `SecretWrite`,
     insert/update/duplicate signatures).
   - `internal/storage/repos/secrets.go`: `GetURI`, header comment.
   - `internal/storage/model/connection.go`: `URI` comment.
   - `internal/connections/service.go`: D2, D4; delete `migrateStoredURIPasswords`,
     `withoutURIPassword`.
   - `internal/connections/resolve.go`: D2 `resolve`/`resolveFromInput`, `uriQueryOptions`.
   - `internal/connections/input.go`: `Validate` uri rule (blank refused, nil passes), D3,
     `normalized()`, drop `uriHasCredentialQuery` call.
   - `internal/connections/uri.go`: delete `stripURIPassword`, `stripQueryPassword`,
     `credentialQueryKeys`, `uriHasCredentialQuery`; add `userinfoPassword`, `foldPassword`,
     `secretOptionKeys`; update `uriHasAmbiguousPassword` comment.
   - `internal/ipcfixture/harness.go`: `SeedConnection` encrypts `fields.URI` (scope
     `ScopeConnectionURI`) and inserts via `InsertWithSecret`; keep the harness `Cipher` in `App`.
   - `internal/ipcfixture/testdata/sqs.fixture.json`, `tests/ipc/sqs/sqs.fixture.ts`: list
     response `"uri": null`. Regenerate with
     `KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...` if LocalStack
     runs; otherwise edit that one value identically in both files (the sync spec compares them)
     and say so in the result section.
   - Bindings regenerated (`frontend/bindings/**/connections/models.ts`).
   - Tests, per CLAUDE.md bar:
     - Delete: `TestUriPasswordStripAndInject`, `TestStartMigratesQueryPasswordIntoSecretStore`,
       `uri_test.go` `TestStripURIPassword`; rewrite `TestUriModeUpdateHonorsExplicitPasswordClear`
       and `TestUriModeUpdateWithNoPasswordSignalLeavesSecretUnchanged` into the table test below.
     - Update call sites only: `repos/connections_test.go`, `repos/maskrules_test.go`,
       `service_test.go` (`InsertWithSecret`/`UpdateWithSecret` signatures),
       `resolve_test.go` (fold semantics replace strip semantics; keep the two cases).
     - New `TestListNeverCarriesTheURI` (service_test.go): create a URI-mode connection whose URI
       holds userinfo password, `password`, `sslpassword`, `tlsCertificateKeyFilePassword`,
       `proxyPassword`; then Update, Duplicate, Reorder. Assert every returned summary, `List()`
       and every `listChanged` emission has `URI == nil` and options free of those keys; raw
       `SELECT uri, options_json, password` shows `uri` prefixed `kira:v3:` containing none of the
       secret strings, `password` NULL; `Connect` hands the backend the exact original URI. Earns
       its place: one invariant across six exits plus disk.
     - New `TestURIModeUpdateRules` (table): URI unchanged (nil) keeps both columns; fields-mode
       row flipped to URI with `Password nil` folds the stored password and clears the column;
       explicit `Password ""` does not fold; URI with its own userinfo password ignores the
       stored one; nil URI on a fields-mode row and nil URI with a password are refused. Earns its
       place: the three-state URI x three-state password x stored-mode interplay is the data-loss
       risk.
     - New `TestLegacyPlaintextURIFailsLoudly`: raw-SQL a plaintext `uri` on a URI-mode row; `List`
       still returns it (URI nil); `Connect` → `error` state whose message names the envelope;
       `Reveal` → `error` outcome; Update with a new URI fixes it and Connect succeeds.
     - No test for `GetURI` encrypt/decrypt round trip or `uriQueryOptions` alone (below the bar;
       covered through the two tests above).

3. **`feat(studio): masked connection URI with Show`** (frontend)
   - `packages/shared/domain/connection.ts`: D5 schema changes, `SECRET_OPTION_KEYS`.
   - `apps/kira-studio/frontend/src/bridge/index.ts`: `connectionsReveal` type.
   - `apps/kira-studio/frontend/src/project/state/connectionReveal.ts` (new): D6 loop.
   - `apps/kira-studio/frontend/src/project/ConnectionDialog.vue`: D5.
   - `apps/kira-studio/frontend/src/project/menus.ts`: D6 Copy URI (hunk at the `copy-uri` item
     only).
   - `apps/kira-studio/tests/ui/connections.spec.ts`: `URI_CONNECTION.uri = null`; the URI
     section asserts the edit dialog's URI field is empty and masked, Show calls
     `connectionsReveal` (mock `{ outcome: 'revealed', password: null, uri: '…', error: null }`)
     and fills it, Save sends `uri: null` when never shown; Copy URI on the URI row goes through
     `connectionsReveal`. Replace the stale "stored URI is passwordless" comments.
   - `apps/kira-studio/tests/ui/credential-reveal.spec.ts`: one URI-mode `revealed` scenario
     (other outcomes share the loop already covered).
   - `apps/kira-studio/tests/unit/mongo-srv-uri.spec.ts`: untouched (`parseConnectionUri` keeps
     its flip role).

4. **`test(adapters): leak check covers URI query secrets`**
   - `apps/kira-studio/internal/adapters/testsupport/matrix.go`: D8.

5. **`docs: P181 encrypted connection URIs`**
   - `docs/ARCHITECTURE.md`, Storage section, after the P29 scope paragraph: decision note — whole
     URI encrypted under `connection-uri`; `SecretsRepo` owns both ciphertext columns; repo never
     selects `uri`; URI mode is single source of truth (fold, password column cleared); options
     derived from the URI in Go; fields-mode secret-option refusal; no migration and D7 behavior;
     URI mode now needs secret storage (Linux dev: `KIRA_INSECURE_SECRETS=1`), a URI with no
     secret included; Show/Copy URI go through the P14 gate.
   - Same file: the P14 reveal paragraph names the URI as a second thing *Show* reveals; the S3
     paragraph (`static keys … go in \`uri\``) adds "encrypted"; the schema block's `uri` gets
     `-- kira:v3 envelope, connection-uri scope (P181)`.
   - Known open items: no S5 entry exists (grep `sslpassword`, `S5`, `refused` finds none); nothing
     to delete. Add none (D7's free-page remnant is a stated decision, not an open item).
   - `docs/v2.0/plans/P181-studio-uri-encryption.md`: result section.

## Verification

- Per commit: `go build ./... && go vet ./...`, `bun run typecheck`, `bun run lint`,
  `bun run lint:dead`, `bun run lint:go`.
- Once at phase end: `go test -race ./apps/kira-studio/internal/...`, `bun run test:unit`,
  full Playwright Studio `ui` project.
- Real check before accepting, beyond tests: `rg -n 'withoutURIPassword|stripQueryPassword|
  uriHasCredentialQuery|migrateStoredURIPasswords'` returns nothing; `rg -n '\buri\b'
  apps/kira-studio/internal/storage/repos/connections.go` shows only insert/update/duplicate
  binding, never the select list; `rg -n 'GetURI' apps/kira-studio/internal` shows `resolve`,
  `Test`, `Update`, `Reveal` callers.
- Sandbox limits: no OS keychain. Go tests use the `KIRA_INSECURE_SECRETS=1` `basic_text` backend
  (real AES-GCM under a compile-time key; same code path as macOS except key storage).
  `serviceWithUnavailableCipher` covers the refused-write path. LocalAuthentication is faked
  (`fakeAuthorizer`); Playwright mocks `connectionsReveal`. Not verified here: macOS Keychain,
  Touch ID prompt text for the new reason, Docker-backed complete suite (D8) and ipcfixture
  regeneration.

## File ownership and concurrency

| File | Step |
|---|---|
| `apps/kira-studio/internal/secrets/scope.go`, `cipher_test.go` | 1 |
| `apps/kira-studio/internal/storage/repos/connections.go`, `secrets.go`, `connections_test.go`, `maskrules_test.go` | 2 |
| `apps/kira-studio/internal/storage/model/connection.go` | 2 |
| `apps/kira-studio/internal/connections/*.go` | 2 |
| `apps/kira-studio/internal/ipcfixture/harness.go`, `testdata/sqs.fixture.json` | 2 |
| `apps/kira-studio/tests/ipc/sqs/sqs.fixture.ts` | 2 |
| `apps/kira-studio/frontend/bindings/**/connections/*` (generated) | 2 |
| `packages/shared/domain/connection.ts` | 3 |
| `apps/kira-studio/frontend/src/bridge/index.ts` | 3 |
| `apps/kira-studio/frontend/src/project/state/connectionReveal.ts` (new) | 3 |
| `apps/kira-studio/frontend/src/project/ConnectionDialog.vue` | 3 |
| `apps/kira-studio/frontend/src/project/menus.ts` (`copy-uri` item) | 3 |
| `apps/kira-studio/tests/ui/connections.spec.ts`, `credential-reveal.spec.ts` | 3 |
| `apps/kira-studio/internal/adapters/testsupport/matrix.go` | 4 |
| `docs/ARCHITECTURE.md`, this plan | 5 |

- **P176 (Stream B)**: already landed on `v2.0` (`0648f0f`, after this plan's base). Shared file:
  `frontend/src/project/menus.ts` — P176 changed the saved-filter item (~line 437), P181 changes
  the `copy-uri` item (~line 141). Disjoint hunks; rebase merges cleanly. P176's new
  `tests/unit/support/connectionRecord.ts` and its specs use `uri: null`, valid under
  `uri: z.null()`. `docs/ARCHITECTURE.md`: textual only. No ordering dependency.
- **P173 (Stream C)**: Kira Space git only (`apps/kira-space/**`, `packages/git-*`,
  `apps/kira-space-vscode`). No shared file except `docs/ARCHITECTURE.md` (different section).
  No ordering dependency.
- P181 can run in parallel with both. Rebase onto the chapter branch before landing; the only
  expected conflict surface is `docs/ARCHITECTURE.md`, if any.
