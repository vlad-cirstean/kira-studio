# P25 — the connection auth/config audit, and a two-tier real-container test matrix

> **What this phase is.** P24 found and fixed two real connection bugs, but only in the SQL-family
> adapters. This phase (a) audits every *other* adapter's connect path for the same class of bug —
> a connection parameter whose empty/absent/half-filled state is assembled into a real connect
> attempt in a way that fails as though the credentials were wrong — and (b) designs the test
> infrastructure that would have caught all of them: a **general suite** that stays in the ordinary
> `bun run test:go` loop, and an opt-in **complete suite** that walks the full auth/config
> permutation space per adapter against real containers.
>
> **Four real findings, three genuinely clean adapters.** Mongo, Redis, Kafka and SQS/S3 each carry
> a reproduced bug of exactly P24's shape. ClickHouse and SQLite are clean on this class and are
> reported as such rather than padded with a manufactured finding. Postgres/MySQL/MariaDB were
> re-verified: P24's fixes hold, and now hold one step past `Connect()` too (§1.7).
>
> **Every claim below was verified against the tree at this phase's own base commit** (`d97d241`,
> `feat(connections): hover-for-detail on truncated connection errors`, branch
> `claude/feature-v1-1-p5-onwards-2isfzt`), and every asserted bug was **reproduced against a real
> container** in an isolated worktree — real `mongo:8.3`, `redis:8.10`,
> `clickhouse/clickhouse-server:26.3`, `postgres:17-alpine`, `mysql:8.4`, `mariadb:11.4`,
> `localstack/localstack:4` and a purpose-built SASL_PLAINTEXT `confluentinc/cp-kafka:8.0.7`, all
> pulled via `mirror.gcr.io` per `AGENTS.md`'s Docker section. §1 quotes the exact transcripts.
> Where something could **not** be reproduced here, §1 says so plainly and the claim is withheld
> (§1.5's SCRAM broker, §1.6's SQLite file-permission cases).
>
> **Scope note.** This phase's deliverable is the audit plus the *auth/config* permutation
> infrastructure. Functional coverage (load/write/delete/filter/DDL across the permutation space)
> is explicitly **not** implemented here — §3 designs the harness so a later phase can add it
> without redesigning anything, and §3.4 records the `Caps()` survey that such a phase needs.

---

## 0. Scope and non-scope

**Audited (§1)**: the `Connect`-equivalent path of `apps/kira-studio/internal/adapters/`'s
`clickhouse/`, `mongo/`, `redis/`, `kafka/`, `sqs/`, `s3/`, `sqlite/` (plus `awscfg/`, which
`sqs` and `s3` share), and a re-verification of `postgres/` and `mysqlfamily/`.

**Designed (§2, §3)**: a shared matrix harness in
`apps/kira-studio/internal/adapters/testsupport/`, one `authmatrix_test.go` per adapter package,
an env-var gate, `scripts/test-matrix.sh`, and `.github/workflows/test-matrix.yml`.

**Out of scope, explicitly**:

- **Anything under `apps/kira-studio/frontend/`.** A concurrent phase (the SlickGrid migration)
  owns `frontend/src/views/grid/**` on this same branch. Two findings below (§1.2's `authSource`,
  §1.6's AWS profile field) have a dialog-shaped half; both are named and deliberately deferred to
  their own phase rather than smuggled in here.
- **Functional/capability test scenarios.** §3 designs the seam; it plants none.
- **New SASL mechanisms for Kafka** (§1.5's adjacent note) — a feature, not a bug fix, and
  unreachable without a dialog field.
- **Fields-mode static AWS credentials** (§1.6a) — a deliberate existing design, documented not
  changed.
- **`internal/connections/input.go`'s `Validate()`** — re-read (`:26-77`) and unchanged, for the
  same reason P24 gave: it correctly declines to require `Database` for kinds whose whole purpose
  is browsing a whole server. One small exception is *noted* in §1.6c but left to the adapter side.

---

## 1. Part 1 — the audit

### 1.1 Method

For each adapter: read the real `Connect` implementation and the client/config resolution it calls,
trace every connection field (`Host`, `Port`, `Username`, `Password`, and whatever that store's
"database" analogue actually is — a ClickHouse database, a Mongo database *and authSource*, a Redis
numeric db index, a Kafka broker address, an AWS region and bucket, a SQLite file path) from
`model.ResolvedConnectionConfig` to the bytes the driver puts on the wire, then drive the real
adapter through `adapters.CreateAdapter(kind, deps)` against a real container with each field
deliberately absent, empty, or half-filled — including against purpose-created least-privilege
principals, since (per P24 §1.2) this whole bug class is *invisible* to a fixture's own admin
credentials.

The connect paths, for reference, all follow the same two-step shape — resolve a config, then run
one probe query whose failure is fatal:

| Adapter | Config resolution | Connect probe |
|---|---|---|
| clickhouse | `clickhouse/client.go:59-127` `resolveTarget` | `SELECT version(), currentDatabase(), timezone()` (`clickhouse/adapter.go`) |
| mongo | `mongo/client.go:30-78` `Connect` + `:80-102` `buildURIFromFields` | `admin.buildInfo` (`mongo/adapter.go:52`) |
| redis | `redis/client.go:34-99` `resolveFields` + `:125-163` `get` | `PING` (`redis/client.go:153`) then `INFO server` (`redis/adapter.go:44`) |
| kafka | `kafka/client.go:28-115` `connect` | `Client.Ping` (`:110`) then `kadm.Metadata` |
| sqs | `awscfg/config.go:28-76` `Resolve` → `sqs/client.go:14-24` | `ListQueues` (`sqs/adapter.go`) |
| s3 | `awscfg/config.go:28-76` `Resolve` → `s3/client.go:16-27` | `ListBuckets`, or `HeadBucket` when `options.bucket` is set (`s3/catalog.go:22-49`) |
| sqlite | `sqlite/client.go:24-44` `resolveFilePath` + `:51-60` `assertFileExists` | `SELECT sqlite_version()` (`sqlite/adapter.go`) |

### 1.2 Finding 1 — MongoDB: the `database` field silently doubles as the credential source

**Status: real, reproduced, fields-mode only.**

`mongo/client.go:80-102`'s `buildURIFromFields` assembles a URI whose **path is the database**
(`:97-101`):

```go
db := "/"
if cfg.Database != nil && *cfg.Database != "" {
    db = "/" + url.QueryEscape(*cfg.Database)
}
return fmt.Sprintf("mongodb://%s%s:%d%s", auth, host, port, db)
```

Per the MongoDB connection-string spec, that path component is the *defaultauthdb* — it sets
**`authSource`** as well as the default database. So this app's single "Database" field silently
carries two independent meanings: *which database do I want to browse* and *which database do my
credentials live in*. Those coincide only when the user was created in the application database.

The far more common real-world posture is the opposite: the user is created in `admin`, with roles
scoped to the application database. In fields mode there is **no way to express that at all** —
`cfg.Options` is read for exactly one key in this package, `sslmode` (`mongo/client.go:47`), and
nothing else. `mongo/errors.go:29-32` maps MongoDB's `AuthenticationFailed` (code 18) to `E_AUTH`,
so the user is told, flatly, that their credentials are wrong.

**Reproduced** against real `mongo:8.3` (`testsupport.StartMongo`), with a user created in `admin`
holding `readWrite` on `kira_test` — the shape the fixture's own root user comment already
describes (`testsupport/mongo.go:107-127`):

```
mongo: user in admin, database=kira_test (fields mode, no authSource)
  => CODE=E_AUTH MESSAGE="connection() error occurred during connection handshake: auth error:
     sasl conversation error: unable to authenticate using mechanism \"SCRAM-SHA-1\":
     (AuthenticationFailed) Authentication failed."

mongo: user in admin, database unset (authSource defaults to admin)
  => OK version="MongoDB 8.3.8" details=map[]

mongo: user in admin, database=kira_test, options.authSource=admin
  => CODE=E_AUTH ... (AuthenticationFailed) Authentication failed.        <- options is ignored

mongo uri mode, path=kira_test, no authSource
  => CODE=E_AUTH ... (AuthenticationFailed) Authentication failed.
mongo uri mode, path=kira_test, ?authSource=admin
  => OK version="MongoDB 8.3.8" details=map[database:kira_test]           <- the only path that works
```

Two things that transcript settles, both of which shape the fix:

- **The credentials are correct.** Clearing the `Database` field connects the very same user, which
  is exactly P24's Postgres signature: an absent/mis-defaulted parameter producing a
  credentials-shaped refusal.
- **URI mode already works**, because `*cfg.URI` goes straight into `options.Client().ApplyURI`
  (`mongo/client.go:35-42`) and the driver parses `?authSource=` itself. The bug is
  fields-mode-only.

**Also verified clean, so the fix stays small:** a *read-only* user scoped to one database (created
in that database, so authSource lines up) connects fine and enumerates its tree — the
`admin.buildInfo` probe at `mongo/adapter.go:52` does **not** require any privilege on `admin`,
which was the other hypothesis worth checking:

```
mongo: read-only user scoped to one db (admin.buildInfo probe) => OK version="MongoDB 8.3.8" details=map[database:kira_test]
  Children(root) => err=<nil> nodes=[kira_test]
```

**The fix.** In `buildURIFromFields`, honour an `authSource` option:

```go
// mongo/client.go, buildURIFromFields
db := "/"
if cfg.Database != nil && *cfg.Database != "" {
    db = "/" + url.QueryEscape(*cfg.Database)
}
// P25: the URI path is MongoDB's own *defaultauthdb* — it sets authSource as well as the default
// database. A user created in `admin` with roles on the application database (the most common
// real posture) therefore cannot authenticate in fields mode at all, and fails with a bare
// "Authentication failed" that names nothing the user could act on. authSource has to be
// separately expressible; URI mode already supports it, fields mode did not.
if src, ok := cfg.Options["authSource"].(string); ok && src != "" {
    db += "?authSource=" + url.QueryEscape(src)
}
return fmt.Sprintf("mongodb://%s%s:%d%s", auth, host, port, db)
```

- **Keep the path as-is.** Dropping the database from the path would make fields mode default
  authSource to `admin` — which is MongoDB's own default and the common case — but it would break
  every user whose credentials genuinely live in the application database. This repo's own fixture
  is one such user (`testsupport/mongo.go:117-128` creates `kira` *in* `kira_test`), so this is not
  a hypothetical. Additive, not a behaviour change.
- **Do not silently retry against `admin` on failure.** A second, invisible authentication attempt
  against a different principal store is surprising, and would mask a genuinely wrong password.
- **The dialog half is deferred.** `cfg.Options` reaches the backend only from a parsed URI's query
  string (`ConnectionDialog.vue:133` on the URI→fields toggle, `:161` in URI mode) — there is no
  options editor. So after this fix the reachable paths are URI mode (already working) and
  paste-a-URI-then-toggle-to-fields. A dedicated field belongs with the frontend work this phase
  does not own (§0); the adapter change is still worth landing on its own, because it is what makes
  a dialog field possible later, and because the toggle path is real.

### 1.3 Finding 2 — Redis: the connect probe needs commands a least-privilege ACL user lacks

**Status: real, reproduced, and the most broadly hit of the four.**

Opening a Redis connection in this adapter issues four commands before `Connect` returns, three of
them on the connect path itself:

1. **`CLIENT SETNAME`** — implied by `ClientName: "kira-studio"` (`redis/client.go:142`); go-redis
   issues it on every new connection in the pool.
2. **`PING`** — `client.Ping(ctx)` (`redis/client.go:153`), the eager liveness check.
3. **`INFO server`** — `primary.Info(ctx, "server")` (`redis/adapter.go:44`), whose error is fatal:
   `set.closeAll()` and return (`:45-48`).
4. (`COMMAND`, `redis/client.go:178`, only later and only for a read-only connection's console.)

None of `client|setname`, `ping` or `info` is in Redis's `@read` category, and **`INFO` is in
`@dangerous`**. `redis/errors.go:14`'s `authPrefixRE` matches `NOPERM`, so every one of these
failures is reported as **`E_AUTH`** — indistinguishable, to the user, from a wrong password.

**Reproduced** against real `redis:8.10` (`testsupport.StartRedis`, `--requirepass kira`), creating
ACL users with `ACL SETUSER` over a side connection:

```
redis ACL p25_a [~* +@read]                  => CODE=E_AUTH MESSAGE="NOPERM User p25_a has no permissions to run the 'client|setname' command"
redis ACL p25_b [~* +@read +client|setname]  => CODE=E_AUTH MESSAGE="NOPERM User p25_b has no permissions to run the 'ping' command"
redis ACL p25_c [~* +@read +@connection]     => CODE=E_AUTH MESSAGE="NOPERM User p25_c has no permissions to run the 'info' command"
redis ACL p25_d [~* +@read +@write +@keyspace] => CODE=E_AUTH MESSAGE="NOPERM User p25_d has no permissions to run the 'client|setname' command"
redis ACL p25_e [~* +@all -@dangerous]       => CODE=E_AUTH MESSAGE="NOPERM User p25_e has no permissions to run the 'info' command"
```

The last row is the one that makes this a real bug rather than a curiosity: **`~* +@all
-@dangerous` is the single most commonly recommended ACL for an application user**, and this app
cannot connect with it at all, reporting an auth error.

**The fix**, in three parts of decreasing size:

- **Make the `INFO` probe non-fatal** (`redis/adapter.go:44-48`). The adapter *already* treats an
  unparseable `INFO` as "unknown" — `version := "unknown"` at `:54` is the fallback for a
  regex miss. Extending that to an `INFO` that was refused outright is a three-line change and is
  faithful to the existing intent: the server version is a tooltip detail, not a precondition.
  This alone unblocks `+@all -@dangerous`.

```go
// redis/adapter.go, in Connect
version := "unknown"
// P25: INFO is in Redis's own @dangerous ACL category, so a perfectly ordinary least-privilege
// user (~* +@all -@dangerous) cannot run it. The server version it yields is a tooltip detail —
// refusing the whole connection over it reported NOPERM as E_AUTH and read as a wrong password.
if serverInfo, err := primary.Info(ctx, "server").Result(); err == nil {
    if m := redisVersionRE.FindStringSubmatch(serverInfo); m != nil {
        version = m[1]
    }
} else {
    a.deps.Log("warn", "redis: INFO refused, server version unknown: "+err.Error())
}
```

- **Drop `ClientName`** (`redis/client.go:142`). It only labels the connection in `CLIENT LIST`;
  go-redis offers no "tolerate a failed SETNAME" switch, so removing the option is the
  library-supported way to stop requiring the privilege. This unblocks `+@read`-shaped users.
- **Leave `PING` fatal, deliberately** (`redis/client.go:153`). It is the connection's only real
  proof of liveness, and a principal that cannot `PING` cannot be served meaningfully anyway. Worth
  stating rather than silently keeping.
- **Leave `COMMAND` failing closed** (`redis/client.go:174-187`). It gates only a *read-only*
  connection's console (`redis/console.go:132`), and denying an unverifiable command there is
  correct.

**One adjacent, smaller observation, reported but not fixed:** a non-numeric `database` is silently
treated as index 0, because `strconv.Atoi`'s error is discarded (`redis/client.go:92-96`).
Reproduced: `database="mydb"` → `OK details=map[database:db0]`. An out-of-range index is honest by
contrast (`database="99"` → `E_QUERY "ERR DB index is out of range"`). Silently browsing db0 when
the user asked for something else is worth a validation message eventually, but it is a
mis-*targeting*, not a failed connection, and it is not this bug class — noted here so a later
phase has it recorded, not fixed by P25.

### 1.4 Finding 3 — Kafka: SASL is dropped entirely unless *both* username and password are set

**Status: real, reproduced against a purpose-built SASL broker.**

`kafka/client.go:102-104`:

```go
if username != "" && password != "" {
    opts = append(opts, kgo.SASL(plain.Auth{User: username, Pass: password}.AsMechanism()))
}
```

With only one of the pair present, the `kgo.Opt` list is built with **no SASL mechanism at all**
and the client connects as an anonymous PLAINTEXT peer. Against a broker that requires SASL, the
resulting failure is a transport-level one, not an authentication one — and `kafka/errors.go` has
no reason to classify it as auth, so it surfaces as `E_QUERY`.

**Reproduced** against a single-node KRaft `confluentinc/cp-kafka:8.0.7` whose only client listener
is `SASL_PLAINTEXT`/`PLAIN` with one user (`kira`/`kira`):

```
kafka SASL_PLAINTEXT broker: correct user and password        => OK version="Kafka" details=map[brokers:1 cluster:p25-sasl-cluster]
kafka SASL_PLAINTEXT broker: correct user, wrong password     => CODE=E_AUTH MESSAGE="SASL_AUTHENTICATION_FAILED: SASL Authentication failed.: Authentication failed: Invalid username or password"
kafka SASL_PLAINTEXT broker: username set, password empty string => CODE=E_QUERY MESSAGE="broker closed the connection immediately after a request was issued, which often happens when SASL is required but not provided: is SASL missing?"
kafka SASL_PLAINTEXT broker: username set, password nil       => CODE=E_QUERY MESSAGE="... is SASL missing?"
kafka SASL_PLAINTEXT broker: username nil, password set       => CODE=E_QUERY MESSAGE="... is SASL missing?"
kafka SASL_PLAINTEXT broker: neither set                      => CODE=E_QUERY MESSAGE="... is SASL missing?"
```

The first two rows are the good news and are worth recording: **the whole SASL path works and its
error mapping is correct** — it simply has no test anywhere in the repo (`kafka_test.go` has no
auth case at all, and `testsupport/kafka.go:122-126` builds a `Host`/`Port`-only config against a
PLAINTEXT broker). Rows 3–5 are the bug.

**Why a half-filled pair is a real state, not a typo.** Per `AGENTS.md`'s secrets section, on Linux
without `KIRA_INSECURE_SECRETS` secret storage is *unavailable* — a password-bearing save fails
rather than silently degrading. A Kafka connection can therefore legitimately reach the adapter
with its username present and its password absent, at which point this app silently drops the
credential it was given and reports a non-auth error about the broker.

**The fix.**

```go
// kafka/client.go
// P25: SASL/PLAIN is configured on a non-empty username alone. Requiring both silently dropped
// the whole mechanism when only one was set — the client then connected anonymously and a
// SASL-requiring broker answered with a transport-level refusal (E_QUERY, "is SASL missing?"),
// blaming the broker for a credential this app chose not to send. An empty password now goes to
// the broker and comes back as a real, correctly-coded SASL_AUTHENTICATION_FAILED instead.
if username != "" {
    opts = append(opts, kgo.SASL(plain.Auth{User: username, Pass: password}.AsMechanism()))
} else if password != "" {
    return nil, nil, nil, adapters.New(adapters.CodeAuth,
        "kafka: a password was given with no username — SASL/PLAIN needs both", nil)
}
```

The `else if` matters: a password with no username cannot be used by any mechanism, so failing it
up front as `E_AUTH` is strictly better than connecting anonymously and reporting a broker error.

**Adjacent, named but explicitly not fixed here: only SASL/PLAIN is supported.**
`kafka/client.go:14` imports `github.com/twmb/franz-go/pkg/sasl/plain` and nothing else, so a
broker configured for SCRAM-SHA-256/512, OAUTHBEARER or AWS_MSK_IAM cannot be reached at all.
franz-go ships `pkg/sasl/scram` in the same already-vendored module, so the code cost is small —
but it needs an `options.saslMechanism` and therefore a dialog field to be reachable at all
(§1.2's last bullet), which makes it a *feature* in its own phase, not a P25 bug fix. **I attempted
to characterize the failure against a SCRAM-only broker and could not**: a KRaft broker needs its
SCRAM credentials injected at `kafka-storage format --add-scram` time and the container would not
boot in this sandbox, so no error transcript is asserted for it — only the source fact that one
mechanism is compiled in.

### 1.5 Finding 4 — SQS/S3: fields mode carries no credentials, and its auth mapping is dead

**Status: real, reproduced. Two distinct halves; only the second should be fixed by P25.**

`awscfg/config.go:28-76`'s `Resolve` is the whole of what `sqs` and `s3` share for config. Its two
branches are not symmetric:

- **URI mode** (`:33-51`): `u.User.Username()`/`Password()` become **static credentials** via
  `credentials.NewStaticCredentialsProvider` — but only `if u.User.Username() != "" && hasPassword`
  (`:45`), the same both-or-nothing shape as Kafka's.
- **Fields mode** (`:52-58`): reads `cfg.Database` as the **region** (`:53-55`) and `cfg.Username`
  as a **shared-config profile name** (`:56-58`). **`cfg.Password` is read nowhere in the package.**

**(a) Fields mode has no static-credential path at all.** Its only credential sources are a local
shared-config profile or the ambient default chain. Reproduced with the sandbox's own
proxy-injected `AWS_*` variables cleared, so the SDK chain genuinely finds nothing:

```
s3 fields mode: region only, NO credentials anywhere
  => CODE=E_QUERY MESSAGE="operation error S3: ListBuckets, get identity: get credentials: failed
     to refresh cached credentials, no EC2 IMDS role found, operation error ec2imds: GetMetadata,
     access disabled to EC2 IMDS via client option, or \"AWS_EC2_METADATA_DISABLED\" ..."
```

This is a **deliberate existing design, not a bug**: the dialog labels the field "AWS profile
(optional)" and renders no password field for AWS-style kinds (P24 §2, `isAwsStyle`), so a user
cannot mistakenly type a secret into it. P25 documents it and changes nothing. If fields-mode static
credentials are wanted, that is a dialog + schema change deserving its own phase. What P25 *does*
add is a test that pins the current behaviour, so the discontinuity between the two modes is
visible in the suite rather than only in the source.

**(b) The `E_AUTH` mapping for a bad profile is unreachable — a real bug.** `awscfg/errors.go:48-51`
explicitly maps `awsconfig.SharedConfigProfileNotExistError` to `adapters.CodeAuth`. But `Resolve`
never lets `MapError` see the typed error: it stringifies it through `mapPlainError`
(`config.go:64`), which hardcodes `CodeQuery` (`config.go:78-80`). Reproduced:

```
s3 fields mode: profile that does not exist
  => CODE=E_QUERY MESSAGE="failed to get shared config profile, no-such-profile"
s3 fields mode: access key in User, secret in Password
  => CODE=E_QUERY MESSAGE="failed to get shared config profile, test"
```

**(c) Two configuration failures are also mis-coded.** `a region is required (the "database"
field)` (`config.go:53`) and `could not parse the connection URI` (`config.go:40`) are pre-connect
configuration failures returned as `E_QUERY`. And the region case is reachable from the UI:
`input.go:63-68` skips the `Host`/`Port` requirement for `awsStyleKinds` (`input.go:15`) and never
requires `Database` for them, so an AWS connection can be saved with no region. Reproduced:
`s3 fields mode: no region => CODE=E_QUERY MESSAGE="a region is required (the \"database\" field)"`.

**The fix** — small, entirely inside `awscfg`:

```go
// awscfg/config.go
awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
if err != nil {
    // P25: MapError already classifies SharedConfigProfileNotExistError as E_AUTH — routing this
    // through mapPlainError(err.Error()) threw the typed error away and made that branch dead
    // code, so a nonexistent profile reported E_QUERY.
    return Resolved{}, MapError(err)
}
```

plus giving the two plain configuration failures `adapters.CodeConnect` instead of `CodeQuery`
(a two-line change to `mapPlainError`'s callers, or a second helper — the implementer's call;
`mapPlainError` is used at `:40`, `:53` and `:64` only).

**(d) One untested path worth a test rather than a fix:** `s3/adapter.go:42-49` reads
`cfg.Options["bucket"]` and, when set, scopes the whole tree to that one bucket via `HeadBucket`
instead of `ListBuckets` — written, per `s3/catalog.go:17-21`'s own comment, for "a very common IAM
shape: credentials scoped to exactly one bucket, which commonly deny `s3:ListAllMyBuckets`
outright." **It has no test anywhere.** Verified working, and its failure mode is honest:

```
s3: options.bucket scoped connection        => OK version="Amazon S3"   Children(root) => nodes=[main-bucket]
s3: options.bucket naming a bucket that does not exist
  => CODE=E_QUERY MESSAGE="operation error S3: HeadBucket, https response error StatusCode: 404, ..., NotFound: "
```

That the one code path written specifically for the least-privilege case is the one with zero
coverage is exactly the P24 pattern, even though the path itself turns out to be correct.

### 1.6 Genuinely clean: ClickHouse and SQLite

Both were investigated to the same depth and neither has a bug of this class. Stated plainly, per
`AGENTS.md`'s rule against manufacturing a finding.

**ClickHouse — clean.** `resolveTarget` already defaults the database to ClickHouse's
always-present `default` (`clickhouse/client.go:113`), overriding it only for a non-empty value
(`:117-119`) — the precedent P24's Postgres fix explicitly followed. Verified against real
`clickhouse/clickhouse-server:26.3` with the fixture's *scoped* `kira` user (not its `kira_admin`):

```
clickhouse: database unset (falls back to "default") as the scoped kira user
  => OK version="ClickHouse 26.3.29.7" details=map[database:default timezone:UTC url:...]
  Children(root) => err=<nil> nodes=[default kira_test system]
clickhouse: database=system (no grant) => OK ... details=map[database:system ...]
```

Two edge behaviours were observed and judged **not** bugs, deliberately:

```
clickhouse: username unset, password set => CODE=E_AUTH MESSAGE="DB::Exception: Got an empty user name from X-ClickHouse HTTP headers. (AUTHENTICATION_FAILED)"
clickhouse: username and password both unset => CODE=E_AUTH MESSAGE="DB::Exception: default: Authentication failed: password is incorrect, or there is no user with such name"
```

The first comes from `query.go:86-91` omitting `X-ClickHouse-User` for an empty username while
still sending `X-ClickHouse-Key`. Unlike Kafka's equivalent (§1.4), the server's own message names
the actual problem — "an empty user name" — and `E_AUTH` is the right code, so there is nothing
misleading to fix. The second is honest: no username means the anonymous `default` user, and it
failed as such. ClickHouse's adapter also already carries the privilege spectrum this phase wants
(`testsupport/clickhouse.go:32-38` seeds `kira_admin`, `kira` and `kira_ro`), which is why it has
the least to add in §2.

**SQLite — "auth permutations" genuinely do not apply, and its own dimension is already mostly
covered.** There is no server and no credential: `Connect` resolves a path
(`sqlite/client.go:24-44`), asserts the file exists and is regular (`:51-60`), and opens a DSN
(`:68-80`). `Username`/`Password` are never read. Its real permutation axis is path handling, and
the existing suite already covers the two most important cases — `"connect against a missing file
is E_NOT_FOUND"` (`sqlite_test.go:86`) and `"connect against a garbage (non-database) file is
E_CONNECT, and creates no sidecar"` (`:98`). Two further cases were exercised and both behave
correctly, they simply have no test:

```
sqlite: database points at a directory => CODE=E_CONNECT MESSAGE="\"/tmp/.../001\" is not a regular file"
sqlite: relative path                  => CODE=E_NOT_FOUND MESSAGE="no database file at \"relative.sqlite\""
```

**File-permission permutations are explicitly declined, not merely skipped.** They could not be
reproduced here — this sandbox runs as root, which bypasses file modes entirely, so a `0444` file
opened with `mode=rw` connected successfully and a writable file inside a `0555` directory did too.
Both results are artefacts of the environment, not statements about the adapter, so no claim is
made either way. They are also partly unreachable through the UI, since `input.go:59-61` rejects a
non-absolute path before the adapter is ever asked. §2.9 says what SQLite's matrix therefore is.

### 1.7 Postgres / MySQL / MariaDB — P24's fixes re-verified, and extended one step

Not re-investigated (P24 owns that), but re-run, and pushed one step past `Connect()` since that is
where the §2 matrix wants to end:

```
postgres least-privilege role, database unset (P24's maintenance-db fallback)
  => OK details=map[database:postgres encoding:UTF8]     Children(root) => nodes=[kira_test postgres]
postgres least-privilege role, database = "" (a cleared dialog field)
  => OK details=map[database:postgres encoding:UTF8]     Children(root) => nodes=[kira_test postgres]
postgres least-privilege role, database = kira_test
  => OK details=map[database:kira_test encoding:UTF8]    Children(root) => nodes=[kira_test postgres]

mysql:   least-privilege kira user, no database => OK details=map[charset:utf8mb4 database:]  Children(root) => nodes=[kira_analytics kira_test]
mariadb: least-privilege kira user, no database => OK details=map[charset:utf8mb4 database:]  Children(root) => nodes=[kira_analytics kira_test]
```

Both fixes hold, and both hold for the *tree*, not just the handshake — including P24 §1.5's
second, subtler branch (`Database` present but empty, the cleared-dialog-field shape), which
behaves identically to `nil`.

### 1.8 Audit summary

| Adapter | Verdict |
|---|---|
| clickhouse | **Clean.** Already defaults `database` to `default` — the precedent P24 followed. Two edge behaviours checked and judged correct. |
| mongo | **Bug.** The URI path built from the `database` field is MongoDB's *defaultauthdb*, so fields mode cannot express `authSource`; a user created in `admin` gets a bare `E_AUTH "Authentication failed"`. |
| redis | **Bug.** The connect path requires `CLIENT SETNAME`, `PING` and `INFO`; `INFO` is in `@dangerous`, so `~* +@all -@dangerous` — a standard application ACL — cannot connect, reported as `E_AUTH NOPERM`. |
| kafka | **Bug.** SASL is configured only when username *and* password are both non-empty; a half-filled pair drops the mechanism and reports the broker's transport refusal as `E_QUERY`. Plus: only SASL/PLAIN exists (named, not fixed). |
| sqs / s3 | **Bug (shared, in `awscfg`).** `Resolve` stringifies `LoadDefaultConfig`'s error, making `MapError`'s `SharedConfigProfileNotExistError`→`E_AUTH` branch dead code; two configuration failures are also coded `E_QUERY`. Plus: fields mode carries no static credentials (design, documented), and `options.bucket` has zero coverage. |
| sqlite | **Clean, and "auth permutations" do not apply** — no credentials exist. Path handling is correct; two untested-but-correct cases found; file-permission cases declined as unreproducible here. |
| postgres / mysql / mariadb | **Fixed in P24, re-verified holding**, now also past `Connect()` into `Children()`. |

---

## 2. Part 2 — the two-tier suite

### 2.1 The split, and what actually goes where

The distinction is **cost**, not importance. A container this repo already starts once per test
binary and memoizes (`testsupport/fixture.go`) is nearly free to add a case to; a *permutation
matrix* over roles and config shapes is not, because each case needs its own principal, its own
adapter instance, and its own connect round trip.

**Tier 1 — the general suite.** Basic connectivity sanity, one or two cases per adapter, in the
ordinary `bun run test:go` loop and in `ci.yml`'s existing `container-tests` job. **This tier
already largely exists** and is the right place for it:

| Adapter | Existing general-tier connect coverage |
|---|---|
| postgres | `TestPostgres_ConnectDisconnect` (`:79`), `TestPostgres_AuthFailure` (`:111`), `TestPostgres_ConnectWithNoDatabaseDefaultsToMaintenanceDB` (`:138`) |
| mysqlfamily | `"connect/disconnect, real server version"` (`:135`), `"auth failure"` (`:149`), `"connect with no database"` (`:172`) — each ×2 engines |
| clickhouse | `"connect/disconnect, real server version"` (`:88`), `"auth failure"` (`:102`) |
| mongo | `TestMongo_ConnectDisconnect` (`:99`) — **no auth-failure case at all** |
| redis | `TestRedis_ConnectDisconnect` (`:70`), `TestRedis_Connect_WrongPasswordIsAuthError` (`:90`) |
| kafka | `TestKafka_ConnectDisconnect` (`:105`) — **no auth-failure case at all** |
| sqs | `TestSqs_ConnectDisconnect` (`:66`), `TestSqs_Connect_UnparseableURI` (`:83`) |
| s3 | `TestS3_ConnectDisconnect` (`:77`), `TestS3_Connect_UnparseableURI` (`:99`) |
| sqlite | `"connect/disconnect"` (`:72`), `"missing file is E_NOT_FOUND"` (`:86`), `"garbage file is E_CONNECT"` (`:98`) |

So P25 adds to Tier 1 only what is genuinely cheap and guards a fixed bug — **six new cases**, in
each adapter's own existing `*_test.go` beside the case it belongs next to, exactly as P24 placed
its two:

1. `mongo`: `TestMongo_Connect_AuthFailure` — the missing auth-failure case (wrong password →
   `E_AUTH`). Fills a real Tier-1 gap.
2. `mongo`: `TestMongo_Connect_AuthSourceOption` — a user created in `admin` with roles on
   `kira_test`, connected in fields mode with `Database=kira_test` **and**
   `Options["authSource"]="admin"`; asserts `Connect` succeeds and
   `info.Details["database"] == "kira_test"`. The §1.2 regression test.
3. `redis`: `TestRedis_Connect_LeastPrivilegeAclUser` — `ACL SETUSER` a `~* +@all -@dangerous`
   user, assert `Connect` succeeds and `info.ServerVersion == "Redis unknown"` (the §1.3 regression
   test; asserting the *degraded* version string is what pins the non-fatal `INFO`).
4. `kafka`: `TestKafka_Connect_AuthFailure` — the missing auth-failure case, against the new SASL
   fixture (§2.3): wrong password → `E_AUTH`.
5. `kafka`: `TestKafka_Connect_UsernameWithoutPasswordIsAuthError` — the §1.4 regression test.
6. `s3`: `TestS3_Connect_ProfileNotFoundIsAuthError` — a nonexistent `options`-free fields-mode
   profile → `E_AUTH`. The §1.5b regression test, and it needs no container behaviour LocalStack
   cannot provide (the failure happens before any request is sent).

Tier 1 gains nothing else. Six cases, four of them pinning a bug this phase fixes, is the whole of
what belongs in a suite that runs on every `go test ./...`.

**Tier 2 — the complete suite.** Every case in §2.4–§2.9's matrices, opt-in, not in the PR path.

### 2.2 The gate: an env var, not a build tag

**Recommendation: an environment variable, `KIRA_TEST_MATRIX=1`, checked by one helper in
`testsupport` that `t.Skip`s before any container is touched.**

```go
// testsupport/matrix.go
const matrixEnv = "KIRA_TEST_MATRIX"

// RequireMatrix skips unless the complete suite was explicitly asked for. Checked before
// Start<Kind>, so an ordinary `go test ./...` never starts a container for these cases.
func RequireMatrix(t *testing.T) {
    t.Helper()
    if os.Getenv(matrixEnv) != "1" {
        t.Skip("set " + matrixEnv + "=1 to run the permutation matrix (scripts/test-matrix.sh)")
    }
}
```

Why this over a `//go:build kira_matrix` tag, concretely:

- **A build tag hides the files from `go build ./...` and `go vet ./...`**, so a matrix that nobody
  runs locally silently rots against an adapter refactor and only breaks in the on-demand job. An
  env gate keeps every file compiled and vetted on every ordinary run — the failure mode a tag
  invites is exactly the one worth designing out.
- **The cost the gate has to remove is container startup, not compilation.** `RequireMatrix` runs
  before `testsupport.Start<Kind>(t)`, so an ungated run costs one `os.Getenv` and a skip per case.
- **It matches this repo's own precedents.** `KIRA_IPC_FIXTURES=write` gates fixture regeneration
  inside otherwise-ordinary tests; `KIRA_COMPAT_IMAGE_*` gates the existing on-demand DB
  compatibility matrix (`testsupport/images.go:13-19`). Build tags here are used for
  platform/`cgo` selection and the `server` platform, not for test tiers.

One caveat for the implementer, learned from `scripts/db-compat.sh`'s own comment: **pass
`-count=1`**. Go's result cache keys on the env vars a test actually observed, and a skipped run may
never read the variable at all, so a stale cache entry can report green without running anything.

### 2.3 What gets built: one container per adapter, roles created inside it

**Answer to the "distinct root vs least-privilege containers?" question: no. One container per
adapter, with additional principals created at runtime inside it — with exactly one exception.**

- `testsupport/fixture.go` already starts exactly one container per kind per test binary and
  reuses it, and its doc comment records the ~8s→~50s regression that discovering this the hard way
  cost. A second container per kind roughly doubles the matrix's wall clock for **zero** extra
  fidelity, because every engine here can create additional users at runtime from the admin
  connection the fixture already holds.
- The pattern is already proven twice in-tree: P24's own
  `TestPostgres_ConnectWithNoDatabaseDefaultsToMaintenanceDB` creates a fresh `app_user` role inside
  the shared container (`postgres_test.go:142-158`), and `testsupport/clickhouse.go:99-109` seeds
  three users of differing privilege at fixture time.
- **The one genuine exception is Kafka**, and it is not a preference: SASL is a *listener* property
  fixed at broker boot. A PLAINTEXT broker cannot be made to require SASL at runtime, so §2.7's
  matrix needs a second container. Reproduced as workable in §1.4 — a single-node KRaft cp-kafka
  with `KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=SASL:SASL_PLAINTEXT,...` and a `PlainLoginModule`
  JAAS string. Two things the implementer must not rediscover: the client port has to be bound to a
  **fixed** host port via `HostConfigModifier`/`PortBindings` (Kafka's advertised listener must
  name a port that is known before the container starts, which testcontainers' random mapping is
  not), and it needs `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1` plus the transaction-log equivalents
  for a single node. Lives in a new `testsupport.StartKafkaSasl(t)` with its own memoized fixture
  and `StopKafkaSasl()`, alongside the existing PLAINTEXT one — not replacing it, since every
  existing Kafka test depends on the anonymous broker.

**Three small `testsupport` additions the matrices need**, because today's fixtures do not expose an
admin handle:

| Adapter | Today | Needed |
|---|---|---|
| postgres | `PgFixture.URI` is the superuser's ✓ | nothing |
| mysql / mariadb | `MysqlFixture.URI`/`MariaFixture.URI` are the **scoped `kira` user's** (`mysql.go:105`, `mariadb.go:107`); root's password is the unexported `mysqlRootPassword`/`mariaRootPassword` | export a `RootURI` field (or a `RootDSN()` accessor) so `CREATE USER`/`GRANT` is possible |
| clickhouse | `BaseURL` ✓, but admin creds are unexported (`clickhouse.go:32-33`) | export the admin user/password, or an `AdminStatements(t, sql)` helper wrapping the existing unexported `runClickHouseStatements` |
| mongo | `MongoFixture.RootURI` ✓ | nothing |
| redis | `Host`/`Port` + exported `RedisPassword` ✓ (drives `ACL SETUSER` over a side client — verified in §1.3) | nothing (a small `AclSetUser` helper is optional sugar) |
| kafka | PLAINTEXT only | `StartKafkaSasl` / `StopKafkaSasl` (above) |
| sqs / s3 | LocalStack + static creds ✓ | nothing |
| sqlite | `Path`/`Dir` ✓ | nothing |

**Explicitly declined, with the measurement behind it: an auth-failure permutation for SQS/S3.**
LocalStack does not enforce credentials — verified directly, twice. With the repo's own fixture
configuration, a deliberately bogus access key connects successfully; and with `ENFORCE_IAM=1` set
on a purpose-started `localstack/localstack:4`, it *still* does:

```
localstack ENFORCE_IAM=1, s3: valid localstack credentials => OK version="Amazon S3"
localstack ENFORCE_IAM=1, s3: a bogus access key          => OK version="Amazon S3"
```

So there is no way to exercise a genuine SigV4 rejection or an IAM permission boundary against this
fixture, at any configuration. §2.8's AWS matrix is therefore *client-config* permutations only,
and the auth rows are marked declined rather than left as an unexplained hole. This is the one
matrix row where measuring first changed the answer.

### 2.4 Matrix — postgres

Base fixture: `testsupport.StartPostgres` (superuser `postgres`, database `kira_test`). Principals
created inside it per case, each with its own `t.Cleanup` drop.

| # | Principal | `database` | Mode | Expected |
|---|---|---|---|---|
| 1 | superuser | `kira_test` | fields | connect; `Details[database]=kira_test` — *exists* (`:79`) |
| 2 | superuser | unset | fields | connect; `Details[database]=postgres` |
| 3 | least-privilege role (`CONNECT` on `kira_test`, `USAGE`+`SELECT` on `app`) | `kira_test` | fields | connect; `Children(root)` non-empty |
| 4 | same | unset | fields | connect; `Details[database]=postgres` — **P24's bug**, *exists* (`:138`) |
| 5 | same | `""` | fields | connect; `Details[database]=postgres` — P24 §1.5's second branch, **new** |
| 6 | same | a database it has no `CONNECT` on | fields | fail; assert the code is not `E_AUTH` (it is a permission refusal, and conflating the two is what this whole phase is about) |
| 7 | same | `kira_test` | **uri** | connect — URI mode is untested for every non-AWS adapter (`testsupport/postgres.go:136` is fields-only), **new** |
| 8 | superuser, wrong password | `kira_test` | fields | `E_AUTH` — *exists* (`:111`) |
| 9 | nonexistent role | `kira_test` | fields | `E_AUTH` |
| 10 | least-privilege role, no password given | `kira_test` | fields | `E_AUTH` |

Row 6 is the interesting one and generalizes: **every** engine's matrix asserts that a *permission*
failure and an *authentication* failure get different codes, because P24's two bugs and §1.2–§1.5's
four all presented as the wrong one of those two.

### 2.5 Matrix — mysql and mariadb

Base: `testsupport.StartMysql` / `StartMariadb` (already a scoped `kira` user — one of the few
fixtures that is not an admin). Root needed for `CREATE USER` (§2.3). Run through
`runFamilySuite` so both engines get every row, as `mysqlfamily_test.go:121-134` already does.

| # | Principal | `database` | Mode | Expected |
|---|---|---|---|---|
| 1 | `kira` (scoped) | `kira_test` | fields | connect — *exists* (`:135`) |
| 2 | `kira` | unset | fields | connect; `Details[database]=""` — **P24's bug**, *exists* (`:172`) |
| 3 | `kira` | `""` | fields | connect; `Details[database]=""` — **new** |
| 4 | `root` | unset | fields | connect; `Children(root)` includes the system schemas the scoped user cannot see |
| 5 | a fresh user with `GRANT SELECT ON kira_test.*` only | unset | fields | connect; `Children(root)` = `[kira_test]` only |
| 6 | same | a schema with no grant | fields | fail, not `E_AUTH` |
| 7 | `kira` | `kira_test` | **uri** | connect — **new** |
| 8 | `kira`, wrong password | `kira_test` | fields | `E_AUTH` — *exists* (`:149`) |
| 9 | nonexistent user | — | fields | `E_AUTH` |
| 10 | `kira`, no password | `kira_test` | fields | `E_AUTH` |
| 11 | `kira` | `kira_test` | fields, `options.sslmode=require` | connect — MySQL's fixture already sets this (`mysql.go:102`), MariaDB's does not; asserting both closes an asymmetry |

### 2.6 Matrix — clickhouse, mongo, redis

**ClickHouse.** Least to add: `testsupport/clickhouse.go` already seeds `kira_admin`, `kira` and
`kira_ro`, and `ClickHouseFixture` already exposes `Config` and `ReadOnlyConfig`.

| # | Principal | `database` | Expected |
|---|---|---|---|
| 1 | `kira` | `kira_test` | connect — *exists* (`:88`) |
| 2 | `kira` | unset | connect; `Details[database]=default` — **new** (§1.6's transcript) |
| 3 | `kira_admin` | unset | connect; `Children` includes `system` |
| 4 | `kira_ro` | `kira_test` | connect — `ReadOnlyConfig` exists but only §2.6's own write tests use it; a connect assertion is trivial to add |
| 5 | `kira`, wrong password | `kira_test` | `E_AUTH` — *exists* (`:102`) |
| 6 | username unset, password set | `kira_test` | `E_AUTH` — pins §1.6's "empty user name" behaviour as intended, not accidental |
| 7 | both unset | `kira_test` | `E_AUTH` (anonymous `default`) |
| 8 | `kira` | uri mode | connect — **new** |
| 9 | `kira` | `options.sslmode` = garbage | `E_CONNECT` — `client.go:105-110`'s fail-loudly branch is untested for every adapter that has it |

**MongoDB.** The authSource dimension is what makes this matrix different from every other
adapter's, and it is the one that carried §1.2's bug.

| # | Principal (and where created) | `database` | `options.authSource` | Expected |
|---|---|---|---|---|
| 1 | `kira` in `kira_test` | `kira_test` | — | connect — *exists* (`:99`) |
| 2 | `kira` in `kira_test` | unset | — | fail (`E_AUTH`) — authSource becomes `admin`, where `kira` does not exist. Pins that the coupling is real and understood, in both directions |
| 3 | a user in **`admin`**, roles on `kira_test` | `kira_test` | — | `E_AUTH` — **§1.2's bug, as the pre-fix assertion** |
| 4 | same | `kira_test` | `admin` | connect; `Details[database]=kira_test` — **§1.2's regression test** (also Tier 1) |
| 5 | same | unset | — | connect; `Details` empty |
| 6 | a read-only user in `kira_test` | `kira_test` | — | connect; `Children(root)`=`[kira_test]` (§1.2's clean result) |
| 7 | `kira`, wrong password | `kira_test` | — | `E_AUTH` — **Tier-1 gap, new** |
| 8 | nonexistent user | `kira_test` | — | `E_AUTH` |
| 9 | no credentials at all | `kira_test` | — | `E_AUTH` (the fixture's server has auth enabled, `mongo.go:73-76`) |
| 10 | user in `admin` | uri mode, `?authSource=admin` | — | connect — pins the working workaround (§1.2's transcript) |

**Redis.** Its axes are *ACL shape* and *db index*, and it has no "database name" at all.

| # | Principal | `database` | Expected |
|---|---|---|---|
| 1 | no username, `requirepass` password | `0` | connect — *exists* (`:70`) |
| 2 | same | unset | connect; `Details[database]=db0` — **new** |
| 3 | same | `1` | connect; `Details[database]=db1` (`testsupport/redis.go:21-22` already seeds a secondary db index) |
| 4 | ACL user `~* +@all -@dangerous` | `0` | connect, `ServerVersion="Redis unknown"` — **§1.3's regression test** (also Tier 1) |
| 5 | ACL user `~* +@read` | `0` | connect (post-fix; pre-fix `E_AUTH NOPERM client\|setname`) — **§1.3's second half** |
| 6 | ACL user with no `~*` keyspace grant | `0` | connect, but `Children` fails — permission vs auth again |
| 7 | wrong password | `0` | `E_AUTH` — *exists* (`:90`) |
| 8 | username set, no password | `0` | `E_AUTH NOAUTH` (verified: §1.3's probe set) |
| 9 | no credentials | `0` | `E_AUTH NOAUTH` |
| 10 | correct password | `"mydb"` (non-numeric) | connect at `db0` — pins §1.3's silent fallback as *known*, so a later phase changing it breaks a test on purpose |
| 11 | correct password | `"99"` | `E_QUERY "DB index is out of range"` |
| 12 | correct password | uri mode `redis://:pw@host:port/1` | connect at `db1` — **new** |

### 2.7 Matrix — kafka

Two fixtures: the existing PLAINTEXT broker and the new `StartKafkaSasl` (§2.3). Kafka has no
"database" analogue at all — its axes are *mechanism*, *credentials* and *broker address*.

| # | Broker | Username | Password | Expected |
|---|---|---|---|---|
| 1 | PLAINTEXT | — | — | connect — *exists* (`:105`) |
| 2 | PLAINTEXT | set | set | connect — SASL offered to a broker that does not want it; franz-go's own behaviour, worth pinning |
| 3 | SASL | `kira` | `kira` | connect; `Details[brokers]=1` — **the entire SASL happy path, untested today** |
| 4 | SASL | `kira` | wrong | `E_AUTH` — **Tier-1 gap, new** |
| 5 | SASL | `kira` | `""` | `E_AUTH` post-fix (pre-fix `E_QUERY "is SASL missing?"`) — **§1.4's regression test** |
| 6 | SASL | `kira` | nil | same as 5 |
| 7 | SASL | nil | `kira` | `E_AUTH` post-fix, from the new up-front guard |
| 8 | SASL | — | — | fail; assert only that it fails and is not silently successful (franz-go's message is a transport one and stays `E_QUERY` — correct, since nothing was offered) |
| 9 | PLAINTEXT | — | — | `options.sslmode` = garbage → `E_CONNECT` (`kafka/client.go:79-84`) |
| 10 | unreachable host:port | — | — | `E_CONNECT` within the 10s `connectTimeout` (`kafka/client.go:20`) |

Row 10 generalizes to every adapter and is worth one row each: a bounded, correctly-coded failure
against a dead address is the single most common real connect error and nothing tests it anywhere.

### 2.8 Matrix — sqs and s3

Client-config permutations only, per §2.3's declined auth rows. Both adapters share `awscfg`, so
rows 1–6 belong in **one** table driven from both packages rather than written twice.

| # | Mode | Region (`database`) | Credentials | Expected |
|---|---|---|---|---|
| 1 | uri | in the URI host | key + secret | connect — *exists* (`:66`/`:77`) |
| 2 | uri | in the URI host | key only, no secret | connect via the ambient chain, **not** via the key — pins `config.go:45`'s both-or-nothing as known |
| 3 | uri | — | malformed URI | `E_CONNECT` post-fix (`E_QUERY` today) — *exists as `E_QUERY`* (`:83`/`:99`), so this row *updates* an existing assertion |
| 4 | fields | `us-east-1` | no profile | ambient chain; with the environment cleared, a credentials error — §1.5a's transcript. **Fields mode is entirely untested for both adapters today** (`testsupport/sqs.go:104`, `s3.go:110` are URI-only) |
| 5 | fields | `us-east-1` | `Username` = nonexistent profile | `E_AUTH` post-fix (`E_QUERY` today) — **§1.5b's regression test** (also Tier 1) |
| 6 | fields | unset | any | `E_CONNECT` post-fix (`E_QUERY` today), message `a region is required…` |
| 7 | uri | valid | valid | `options.endpoint` absent → the request goes to real AWS; assert it fails as a connect/auth error rather than hanging. *Or decline* — it depends on outbound network. Implementer's call; if declined, say so in the test's own skip message |
| 8 (s3) | uri | valid | valid | `options.bucket` = `main-bucket` → connect, `Children(root)`=`[main-bucket]` — **§1.5d, the untested least-privilege path** |
| 9 (s3) | uri | valid | valid | `options.bucket` = nonexistent → `E_QUERY` 404 (§1.5d's transcript) |
| 10 (s3) | uri | valid | valid | `options.bucket` unset → `Children(root)` = every seeded bucket — *exists* (`:143`) |

### 2.9 Matrix — sqlite

**Auth permutations do not apply**, for the reason §1.6 gives: there is no server, no credential,
and `Username`/`Password` are never read. Its axis is path handling.

| # | Path | `ReadOnly` | Expected |
|---|---|---|---|
| 1 | the seeded file | false | connect — *exists* (`:72`) |
| 2 | the seeded file | true | connect; DSN carries `mode=ro` (`client.go:73-78`) — *partly exists* via `"read-only connection cannot write"` (`:436`) |
| 3 | a missing file | false | `E_NOT_FOUND` — *exists* (`:86`) |
| 4 | a garbage non-database file | false | `E_CONNECT`, no sidecar created — *exists* (`:98`) |
| 5 | a **directory** | false | `E_CONNECT "…is not a regular file"` (`client.go:56-58`) — **new**, verified in §1.6 |
| 6 | `""` / unset | false | `E_CONNECT "no database file path was given"` (`client.go:40-42`) — **new** |
| 7 | uri mode `sqlite:////abs/path` | false | connect — `client.go:25-34`'s URI branch, with its documented one-leading-slash-short quirk, is **untested**; **new** |
| 8 | uri mode, no path | false | `E_CONNECT "could not parse the connection URI"` (`client.go:31-33`) — **new** |

**Declined**: every file-permission case, per §1.6 — unreproducible as root, and partly unreachable
behind `input.go:59-61`'s absolute-path requirement. Not a gap being left open silently; a
measurement that came back inconclusive and a claim consequently not made.

### 2.10 The runner and the CI wiring

Modelled directly on P16's on-demand compatibility runner, which is this repo's established shape
for exactly this problem — a real-container matrix that must not run on every PR.

**`scripts/test-matrix.sh`**, sourcing `scripts/lib.sh` like `db-compat.sh` does, with the same
proven structure: `--only <kind>`, `--mirror` (AGENTS.md's `mirror.gcr.io` retag workaround),
`--no-pull`; pull every image up front before running anything; run each adapter package with
`KIRA_TEST_MATRIX=1 go test -count=1 -timeout 30m`; **do not** `set -e` across rows, so one failing
adapter still produces a full result table. `db-compat.sh`'s own comments explain each of those
choices and should be followed rather than re-derived.

**`package.json`**: `"test:matrix": "sh scripts/test-matrix.sh"`, beside the existing
`"test:compat"`.

**`.github/workflows/test-matrix.yml`**: `workflow_dispatch` (a `kind` input, defaulting to `all`)
**plus** a nightly `schedule` on the default branch. That is the one deliberate difference from
`db-compat.yml`, which is dispatch-only: the brief asks for this suite to run in CI, and a nightly
schedule gives it real CI coverage without putting ten containers and a role matrix on every pull
request. **`ci.yml` is not edited** — ordinary CI stays byte-identical, exactly as P16 D6 required
of itself. `--mirror` is omitted in the workflow (GitHub runners reach Docker Hub directly).

---

## 3. Part 3 — designing the harness for the functional tests that come later

P25 implements auth/config cases only. But the shape it commits to now decides whether a later
phase can add "load data, write, delete, filter, DDL" scenarios by *adding* to a table, or has to
redesign. Two types, in one new file, do that.

### 3.1 The two types

```go
// testsupport/matrix.go — the complete suite's harness. P25 populates Case; Scenario exists for
// the functional phase that follows and is deliberately unused here beyond a root-Children
// sanity check.

// Principal is one server-side identity a case needs, created inside the adapter's already-running
// shared container (§2.3) and torn down with the test that asked for it.
type Principal struct {
    Name  string
    Setup func(t *testing.T, f any) // f is the adapter's own *XFixture; creates the role/user
}

// Case is one connection configuration plus the connect outcome it must produce.
type Case struct {
    Name      string
    Principal *Principal                                                    // nil = the fixture's own
    Config    func(base model.ResolvedConnectionConfig) model.ResolvedConnectionConfig
    Expect    Outcome
    Then      []Scenario // empty in P25 — the seam §3.2 explains
}

// Outcome is what Connect must do. Exactly one of Connect/FailWith is meaningful.
type Outcome struct {
    Succeed  bool
    FailWith adapters.Code     // asserted exactly, not "some error"
    NotCode  adapters.Code     // for §2.4's row 6: "must fail, but must NOT be E_AUTH"
    Details  map[string]string // asserted as a subset of ConnectInfo.Details
}

// Scenario is one thing to do with a connection that came up. This is the extension point.
type Scenario struct {
    Name     string
    Requires func(adapters.Caps) bool // skip where the adapter does not claim the capability
    Run      func(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig)
}

// RunMatrix drives every case as a subtest: RequireMatrix, Principal.Setup, build the config,
// Connect, assert Outcome, run each Scenario whose Requires passes, Disconnect.
func RunMatrix(t *testing.T, kind string, fixture any, base model.ResolvedConnectionConfig, cases []Case)
```

Each adapter package then gets one thin `authmatrix_test.go` that declares *its own* table and
calls `RunMatrix` — reusing that package's existing `TestMain`, its memoized fixture, and its
`newAdapter`/`seg`/`childNames` helpers rather than re-importing them into a new package:

```go
// adapters/redis/authmatrix_test.go
func TestRedis_AuthMatrix(t *testing.T) {
    testsupport.RequireMatrix(t)
    f := testsupport.StartRedis(t)
    testsupport.RunMatrix(t, "redis", f, f.Config, []testsupport.Case{
        {
            Name:      "least-privilege ACL user (~* +@all -@dangerous)",
            Principal: testsupport.RedisAclUser("p25_ro", "~*", "+@all", "-@dangerous"),
            Config:    func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig { ... },
            Expect:    testsupport.Outcome{Succeed: true},
        },
        // ... §2.6's remaining eleven rows
    })
}
```

Per-adapter tables rather than one central one is the point, not an accident: §2.4–§2.9 showed the
axes genuinely differ (Mongo has authSource, Redis has ACL categories and a numeric index, Kafka
has a mechanism and no database, SQLite has neither), and a single table forcing Postgres's shape
onto all ten is exactly what the brief asked not to build.

### 3.2 Why `Then []Scenario` is the whole extensibility answer

A functional test is not a new *kind* of test here — it is "given this connection came up, do X".
So the extension is: a later phase writes a library of `Scenario` values and references them from
existing `Case` rows. Nothing about `Case`, `Principal`, `Outcome`, `RunMatrix`, the gate, the
runner script or the workflow changes.

What that phase would add, and why each piece already has somewhere to go:

- **A shared scenario library** (`testsupport/scenarios.go`): `ReadFirstPage()`,
  `CountMatchesRead()`, `InsertThenReadBack()`, `UpdateThenReadBack()`, `DeleteThenAbsent()`,
  `FilterNarrowsResult()`, `ExplainReturnsAPlan()`, `DownloadRoundTrips()`. Each is a
  `Scenario` value, written once, reused across every adapter that claims the capability.
- **`Requires func(adapters.Caps) bool` is why the capability survey mattered.** A scenario says
  `Requires: func(c adapters.Caps) bool { return c.Writable && c.CanUpdate }` and is then
  automatically skipped for ClickHouse and Kafka (neither has `CanUpdate`) without anyone
  maintaining a per-adapter allow-list. §3.4 is the table that makes this checkable.
- **The privilege dimension composes for free**, and this is the real payoff: `InsertThenReadBack`
  attached to a *least-privilege* `Case` is a materially different test from the same scenario on an
  admin `Case`, and it is the combination — a capability exercised under a specific real-world
  permission posture — that both P24 bugs and all four of §1's actually lived in. Getting that
  cross product for free from a table is the reason to shape it this way now.
- **Fixture and container lifecycle need no change.** `Principal.Setup` + `t.Cleanup` already
  scopes a role to one case; the container stays memoized per package (`testsupport/fixture.go`).
  A scenario that needs its own *data* creates it the way the existing suites already do — every
  writing test in `mongo_test.go`, `sqs_test.go` and `s3_test.go` creates its own collection/queue
  /object per test rather than mutating a shared seed.
- **A functional scenario needing on-demand-only treatment already has it**, since everything under
  `Then` runs inside the `KIRA_TEST_MATRIX`-gated case. If a *single* expensive scenario later
  needs a further gate, it belongs in `Requires` (a second env check inside it), not in a new tier.

### 3.3 What the harness deliberately does not do

- **No shared "run every scenario against every adapter" driver.** It reads as thorough and is a
  combinatorial trap — the brief's own warning, and `AGENTS.md`'s "measure/build only when it's
  worth it". Scenarios are attached to cases explicitly, one line each, so a table row always
  states the cost it is buying.
- **No abstraction over `model.ResolvedConnectionConfig`.** `Config func(base) base` is a plain
  mutation of the struct the adapters already take. A per-adapter config builder DSL would be a
  second vocabulary for a struct that is already the vocabulary.
- **No new mock or fake layer.** Every case is a real container, per `AGENTS.md`'s
  adapter-conformance carve-out and this repo's existing practice. The two existing in-package
  fakes (`s3/catalog_test.go`'s `prefixLister`, `redis/catalog_test.go`) stay where they are for the
  truncation arithmetic they were built for.
- **No change to the general tier's structure.** §2.1's six new Tier-1 cases are plain test
  functions beside their neighbours, not `RunMatrix` calls. A regression test for a fixed bug should
  read as one, and should not be gated behind an env var.

### 3.4 The capability survey the functional phase needs

Read from each adapter's own `caps.go` at the base commit — the input for `Scenario.Requires`, and
the reason a one-size functional suite cannot work. `T`=Tabular, `D`=Documents, `KV`=KeyValue,
`S`=Stream, `KB`=KeyBrowser.

| Adapter | Shape | SQL | Definition | Describe | Projection | ServerFilter | ExactCount | Pagination | FKs | Ins | Upd | Del | Txn | Cancel | FileXfer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| postgres | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | keyset | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| mysql | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | keyset | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| mariadb | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | keyset | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| sqlite | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | keyset | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| clickhouse | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | offset | — | ✓ | — | — | — | ✓ | — |
| mongo | D | ✓ | ✓ | ✓ | ✓ | ✓ | — | cursor | — | ✓ | ✓ | ✓ | — | ✓ | — |
| redis | KV, KB | ✓ | — | — | — | — | ✓ | cursor | — | ✓ | ✓ | ✓ | — | ✓ | — |
| kafka | S | — | ✓ | — | — | — | ✓ | offsetWindow | — | ✓ | — | — | — | ✓ | — |
| sqs | S | — | ✓ | — | — | — | — | batch | — | ✓ | — | ✓ | — | ✓ | — |
| s3 | KV, KB | — | — | — | — | — | ✓ | token | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |

(`postgres/caps.go`, `mysql/caps.go`, `mariadb/caps.go`, `sqlite/caps.go`, `clickhouse/caps.go`,
`mongo/caps.go`, `redis/caps.go`, `kafka/caps.go`, `sqs/caps.go`, `s3/caps.go`. `mysqlfamily` holds
no `Caps` of its own — `mysqlfamily/adapter.go:41-46` takes one per engine.)

Three things that table settles for a later phase: only five adapters can be asked to `Update`;
only four have `Transactions`; only `s3` has `FileTransfer` at all (and it is the only adapter with
`DownloadObject` coverage today, `s3_test.go:638-780`). A functional suite that assumed a uniform
CRUD surface would be wrong for half the adapters.

---

## 4. Implementation order, for whoever picks this up

Four fixes and one test-infrastructure build. The fixes are genuinely independent of each other
(four different packages), so per `AGENTS.md` they are the rare case where parallel subagents are
defensible — but every one of them needs §2's harness to have a home for its regression test, so
the harness lands first.

1. **`testsupport/matrix.go`** — §3.1's types, `RequireMatrix`, `RunMatrix`. Nothing else compiles
   against it yet.
2. **The three `testsupport` accessors and `StartKafkaSasl`** — §2.3's table. `StartKafkaSasl` is
   the only non-trivial one; §2.3 names both traps.
3. **The four fixes**, each with its Tier-1 regression test from §2.1 landing in the same commit:
   §1.2 mongo `authSource`, §1.3 redis (`INFO` non-fatal + drop `ClientName`), §1.4 kafka SASL,
   §1.5b/c `awscfg` error coding.
4. **The nine `authmatrix_test.go` files** — §2.4–§2.9's tables.
5. **`scripts/test-matrix.sh`, the `package.json` script, `test-matrix.yml`** — §2.10.
6. **Verify once, at the end**, per `AGENTS.md`'s implement-then-test-once rule: `go build`/`go vet`
   `./apps/kira-studio/internal/...`, then `bun run test:go` (which must be *unchanged* in duration
   — if it got slower, the gate is wrong), then `KIRA_TEST_MATRIX=1 sh scripts/test-matrix.sh
   --mirror` for the full matrix. `bun run lint`/`typecheck`/`build` are untouched by this phase
   (no frontend files), but run them anyway to confirm that.

Note for step 3: three of the four fixes change an error **code**, so each will break any existing
test that asserted the old one. §2.8's rows 3 and 6 flag the two known cases
(`TestSqs_Connect_UnparseableURI`, `TestS3_Connect_UnparseableURI` assert `E_QUERY` today); update
the assertion rather than preserving the old code.

---

## 5. Sources

**Reproduced here** (this phase's own isolated worktree, 2026-09-03), all via
`testsupport.Start*` against images pulled through `mirror.gcr.io` per `AGENTS.md`'s Docker
section: `mongo:8.3` (§1.2 — a user created in `admin`, a read-only user scoped to one database,
and the URI-mode `?authSource=admin` control), `redis:8.10` (§1.3 — five ACL shapes via
`ACL SETUSER`, plus non-numeric and out-of-range db indexes),
`confluentinc/cp-kafka:8.0.7` (§1.4 — a purpose-built single-node KRaft SASL_PLAINTEXT/PLAIN
broker on a fixed host port, six credential permutations),
`localstack/localstack:4` (§1.5 — fields vs URI mode, a cleared ambient AWS environment, a
nonexistent profile, `options.bucket` set/unset/nonexistent, and a separately started
`ENFORCE_IAM=1` container that settled §2.3's declined rows),
`clickhouse/clickhouse-server:26.3` (§1.6 — the scoped `kira` user with the database unset, and the
two header edge cases), `postgres:17-alpine` + `mysql:8.4` + `mariadb:11.4` (§1.7 — P24's fixes
re-verified through `Children()`, including the empty-string database branch). Every transcript
quoted above is the verbatim `adapters.Error` `Code`/`Message` or `ConnectInfo` from those runs.
Docker was already running in this container; the probe package used for all of it was deleted
before committing — its findings are this document.

**Not reproduced, and so not asserted**: §1.4's SCRAM-only broker (KRaft SCRAM credentials need
`kafka-storage format --add-scram`; the container would not boot here — only the source fact that
`kafka/client.go:14` imports one mechanism is claimed) and §1.6's SQLite file-permission cases
(this sandbox runs as root, which bypasses file modes, so both observations were environment
artefacts).

**Read directly from source at the base commit** `d97d241`: `internal/adapters/adapter.go` (the
Adapter contract) and `caps.go`; every adapter's `caps.go`, `client.go`, `adapter.go` and
`errors.go` for the ten kinds; `internal/adapters/awscfg/{config,errors}.go`;
`internal/adapters/testsupport/*.go` (all nineteen files, for the fixture/privilege posture in
§2.3); every `internal/adapters/*/*_test.go` (for §2.1's and §2.4–§2.9's *exists* markers);
`internal/connections/input.go`; `internal/ipcfixture/`; `apps/kira-studio/tests/e2e-real/`
(postgres, mariadb, sqlite and multiwindow specs only — confirming `AGENTS.md`'s "spot-checks a
scenario or two per kind"); `frontend/src/project/ConnectionDialog.vue:125-165` (how `options`
is populated, which is what makes §1.2's fix reachable or not); `scripts/db-compat.sh`,
`.github/workflows/{ci,db-compat}.yml` and `package.json` (§2.10's precedent).

**In-repo**: `docs/v1.1/plans/P24-connection-auth-error-display.md`, read in full first — its §1
methodology (reproduce against a real container with a purpose-created least-privilege principal
before asserting anything, because the fixture's own admin credentials hide this entire bug class)
is the method §1.1 follows, and its §1.3.1 read of clickhouse/redis/mongo is what §1.2 and §1.3
extended past `Connect`'s first line. `docs/v1.1/plans/P16-db-compat-suite.md` — the on-demand
real-container suite this phase's §2.10 is modelled on rather than reinvented. `AGENTS.md` — the
adapter-conformance test-bar carve-out (§2.1's six Tier-1 cases), the measure-with-purpose rule
(§2.3's declined AWS rows, the one place a measurement changed the plan), the
implement-then-test-once rule (§4 step 6), and the Docker/secrets sections (§1.4's
`KIRA_INSECURE_SECRETS` argument for why a half-filled credential pair is a real state).
`docs/ARCHITECTURE.md` — the per-engine tree shapes and adapter facts, read before touching any
connect path.
