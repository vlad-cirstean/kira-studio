# P29 — binding every stored ciphertext to the kind of secret it is

> **What this phase is.** `docs/v1.2/SPEC.md`'s **P29** row: close P21 round 2 architecture/security
> finding 10 by giving AES-256-GCM an **AAD bound to the secret's kind** — a scope string threaded
> through every `Cipher.Encrypt`/`Decrypt` call site — and bumping the envelope prefix from
> `kira:v2:` to `kira:v3:`.
>
> **This phase was numbered P28 until `fa3d35be`.** A separate agent's "Api/Studio polish, lifecycle
> and menu bar" batch reached implementation first under that number, so the AAD phase is **P29**
> and every reference here uses P29. Four unrelated strings survive the renumber and must **not** be
> touched: `internal/connections/service.go:44, 363, 469, 616` each cite `P28 §5.5` — that is
> **v1's** P28 (`ThrottlePerSec`, and its place on `destinationUnchanged`'s exception list), a
> different chapter's phase that happens to share the number. Leave all four exactly as they are; a
> global `P28 → P29` sweep over Go source would corrupt them.
>
> **Base commit.** `fa3d35be` on `claude/feature-v1-3-headless-git` ("docs(v1.2): renumber the AAD
> phase P28 -> P29"). Every `file:line` citation below was read at that commit; `fa3d35be`'s only
> change over `a8080ed1` is inside `docs/v1.2/SPEC.md`, so every Go line number here is equally valid
> at either.
>
> **Baseline, measured in this container at `fa3d35be`.** `go build ./apps/kira-studio/...` clean;
> `go test -count=1` green for `internal/secrets` (0.003 s), `internal/storage/repos` (3.5 s) and
> `internal/apivars` (0.040 s). Neither `internal/connections` nor `internal/bridge` pulls
> testcontainers (`rg -l testcontainers` over both returns nothing), so the whole of this phase's
> verification runs in seconds on this Linux box.
>
> **The non-negotiable.** *There is no backward compatibility of any kind.* No migration, no
> dual-read, no upgrade routine, no grace period. The moment `kira:v3:` ships, every stored
> `kira:v2:` connection password and API-variable secret is unreadable and must be re-entered once —
> exactly the treatment `kira:v1:` already gets today. §2 D3 states why this is the decision that
> keeps the phase small, in the same voice `cipher.go:73-88`'s existing comment used to explain why
> the migration-preserving version of this fix was deferred.
>
> **No UI surface at all.** Not one `.ts`, `.vue`, `.css` or Playwright spec changes. §5 is therefore
> almost entirely Tier 1 — provable by `go test` in this container.

---

## 0. Scope

### 0.1 The one sentence this phase implements

`Cipher.Encrypt`/`Decrypt` take the **kind** of secret they are handling, that kind becomes
AES-GCM's additional authenticated data, and the envelope prefix bumps to `kira:v3:` so nothing
written before this phase is even offered to `Open`.

### 0.2 The items this document owns

| # | Item |
|---|---|
| A | `secrets.Scope` — a closed, validated set of three constants (D1), and the AAD derived from it (D2) |
| B | `envelopePrefix` `kira:v2:` → `kira:v3:`, with **no** dual-read path (D3) |
| C | `Seal`/`Open`'s `nil` AAD replaced by the scope's AAD in both directions (D2) |
| D | `repos.Cipher`'s interface and all **9** existing production call sites re-pointed at the new signatures (D4, §3) |
| E | `VariablesRepo.recordHistory`'s live→history **raw ciphertext copy**, which the P29 row does not mention and which the two distinct variable scopes break (F5, D5) — the one non-mechanical edit in the phase |
| F | The wrong-envelope user-facing sentence, which after the bump names the wrong format and is now the **first thing every existing user sees** (F7, D6) |
| G | Test coverage: the cross-scope refusal matrix, the v1/v2 refusal, the unknown-scope refusal, and the two cross-kind attacks executed against the app's own tables (§4) |
| H | `docs/ARCHITECTURE.md` and the five stale `kira:v2:` comments in Go (§3.7) |

### 0.3 Corrections this investigation makes to the P29 row's own premises

The row is accurate about the design. It is wrong about the code in four places, each of which would
send an implementer looking for something that is not there.

1. **"`internal/connections/service.go`'s two Encrypt sites for Create and Duplicate."** They are
   **Create and Update**. `service.go:259` sits in `Create` (227), `service.go:327` sits in `Update`
   (277). `Duplicate` (`service.go:373`) **never touches the cipher at all** — it calls
   `Conns.InsertDuplicateWithSecret` (`service.go:389`), whose scalar-subquery copy is precisely the
   cipher-free path the row elsewhere insists must keep working. There is no "Duplicate encrypt
   site" to scope.
2. **"`internal/storage/repos/variables.go`'s four Encrypt/Decrypt sites."** There are **five**: one
   `Encrypt` (`variables.go:510`, `encryptFor`) and four `Decrypt` (`:530` `valueChanged`, `:916`
   `RevealValue`, `:940` `RevealHistoryValue`, `:992` `mergeSecrets`). D5 adds a **sixth**.
3. **The row names two raw ciphertext copies that must keep working and misses a third.**
   `InsertDuplicateWithSecret` and `DuplicateEnvironment` are both same-kind and are fine, exactly as
   the row says. `VariablesRepo.recordHistory` (`variables.go:541-556`) is a **third** raw ciphertext
   copy — and under the row's own suggested scopes it is **cross-kind**: it writes a live
   `api_variables.secret_value` blob verbatim into `api_variable_history.secret_value`. Shipping the
   row as literally written would make every history row created after this phase permanently
   unreadable. F5/D5.
4. **`cipher.go:82-83` names the copy sites as "`ConnectionsRepo.Duplicate`,
   `VariablesRepo.DuplicateEnvironment`" and calls the pattern `SecretStore.copy()`.** The Go method
   is `ConnectionsRepo.InsertDuplicateWithSecret`, and there is no `copy()` anywhere in the Go tree —
   the name survives from the deleted TypeScript `SecretStore`. Cosmetic; the whole comment is
   rewritten anyway (D7).

### 0.4 Not in scope

- **No migration, no dual-read, no `kira:v2:` compatibility shim.** D3.
- **No row-scoped or column-scoped AAD.** Kind-scoped is the deliberate choice, for the reason the
  row gives: anything narrower breaks the duplication paths outright. §6.
- **No re-key, no keychain-item rename, no change to `probe`/`Status`/the backend vocabulary.**
  `internal/secrets/status.go` changes by exactly one word in a package comment (§3.7).
- **No change to who is allowed to reveal what.** `localauth`'s gate, the 5-minute grace, the
  `RevealResult` vocabulary, `apivars.Service.Reveal`/`RevealHistory` — all untouched.
- **No TypeScript, Vue, CSS, Playwright or VS Code work.** §5.1 is the whole of the verification.
- **`decryptFailure`'s sentence is left verbatim** — its "fix this connection" tail is equally wrong
  for a variable, but that wart predates this phase and changing it is a copy decision, not a
  correctness one. §8.3 flags it rather than settling it quietly.

---

## 1. Findings

Every claim here was read at `fa3d35be` and is cited to a file and line.

### F1 — The complete inventory of `Encrypt`/`Decrypt` call sites

`rg -n '\.Encrypt\(|\.Decrypt\(' --type go apps/kira-studio` returns **13** call sites plus the two
definitions. Nine are production, four are tests, and there is exactly one non-`secrets`
implementation of the interface.

**Production Encrypt (4):**

| # | Site | Reads/writes | Scope (D4) |
|---|---|---|---|
| E1 | `repos/secrets.go:49` — `SecretsRepo.Set` | `connections.password` | `ScopeConnection` |
| E2 | `connections/service.go:259` — `Service.Create` | `connections.password`, via `InsertWithSecret` | `ScopeConnection` |
| E3 | `connections/service.go:327` — `Service.Update` | `connections.password`, via `UpdateWithSecret` | `ScopeConnection` |
| E4 | `repos/variables.go:510` — `encryptFor` | `api_variables.secret_value` | `ScopeVariable` |

**Production Decrypt (5):**

| # | Site | Reads | Scope (D4) |
|---|---|---|---|
| D1 | `repos/secrets.go:39` — `SecretsRepo.Get` | `connections.password` | `ScopeConnection` |
| D2 | `repos/variables.go:530` — `valueChanged` | `api_variables.secret_value` | `ScopeVariable` |
| D3 | `repos/variables.go:916` — `RevealValue` | `api_variables.secret_value` | `ScopeVariable` |
| D4 | `repos/variables.go:940` — `RevealHistoryValue` | **`api_variable_history.secret_value`** | `ScopeVariableHistory` |
| D5 | `repos/variables.go:992` — `mergeSecrets` (under `SecretsFor`) | `api_variables.secret_value` | `ScopeVariable` |

**Tests (4 calls, 2 files):** `secrets/cipher_test.go:84,88,95,106,132` (five calls across two
tests) and `secrets/keychain_darwin_test.go:63,67` — the latter behind `//go:build darwin && cgo`,
so it does **not** compile in this container and is Tier 2 (§5.2).

**The one other implementation of `repos.Cipher`:** `bridge/collections_import_atomicity_test.go:33-36`'s
`failingCipher`, whose two methods must move to the new signatures or `repos.NewVariables(db.DB,
failingCipher{})` (`:61`) stops compiling.

`internal/apivars/vars.go:32`'s `Deps.Cipher *secrets.Cipher` is carried "for parity with New's own
signature" (its own comment, `:27-29`) and is **never called** — no change.

### F2 — The AAD is `nil` in both directions today, and that is the entire gap

`cipher.go:97` — `sealed := c.aead.Seal(nonce, nonce, []byte(plain), nil)`
`cipher.go:121` — `plain, err := c.aead.Open(nil, nonce, sealed, nil)`

Those two `nil`s are the whole of P21 round 2 finding 10. `cipher.go:73-88`'s comment already names
the risk, names the attack (`connections.password` blob moved into an `api_variables.secret_value`
row, revealed through the lower-friction variables gate), names the fix ("binding to a *scope*
string (`"connection"` vs `"variable"` vs `"variable-history"`) passed in by every caller"), and
names the reason it was deferred ("a real but separate change from this pass's bug fixes"). This
phase is that change; the comment is what it is measured against.

### F3 — The `kira:v1:` precedent is exactly the treatment `kira:v2:` now gets

`cipher.go:103-107`: `Decrypt` refuses anything without the current prefix **before** it looks at
availability, at base64, or at the key —

```go
if !strings.HasPrefix(stored, envelopePrefix) {
    return "", ipcerr.SecretStore("The stored credential is not in this app's kira:v2: envelope format and cannot be decrypted — re-enter it to fix this connection.")
}
```

A `kira:v1:` value has hit that branch since P52 §6.4 and has never had a migration. Bumping the
constant to `kira:v3:` puts every `kira:v2:` value on the same branch, with no code change beyond
the constant — which is the whole reason D3 is cheap.

### F4 — The two duplication paths the row protects genuinely never touch the cipher, and are already tested

- `ConnectionsRepo.InsertDuplicateWithSecret` (`repos/connections.go:280-322`): the new row and its
  password are one `INSERT`, the password supplied by
  `(SELECT password FROM connections WHERE id = ?)` (`:302`). Connection → connection: same
  `ScopeConnection`, so the copied blob authenticates on the new row unchanged.
- `VariablesRepo.DuplicateEnvironment` (`repos/variables.go:134-...`): reads `secret_value` into a Go
  `sql.NullString` (`:189`) and re-inserts it verbatim (`:202-205`) — into `api_variables` again.
  Variable → variable: same `ScopeVariable`.

Both properties are already asserted, and **both tests pass unchanged after this phase**, which is
how the row's "must keep working exactly as-is" requirement gets proved for free:
`repos/variables_test.go:463` `TestDuplicateEnvironmentCopiesCiphertextVerbatimNoHistoryNeverActive`
(byte-compares the source and copy ciphertexts at `:537-546`) and `:570`
`TestApplyBulkLeavesAnUntouchedSecretByteIdentical`.

### F5 — There is a **third** raw ciphertext copy, and it is cross-kind

`VariablesRepo.recordHistory` (`repos/variables.go:541-556`):

```go
value := oldPlain
var secretValue *string
if oldSecret {
    value = ""
    if oldSecretValue.Valid {
        secretValue = &oldSecretValue.String   // ← the live row's ciphertext, verbatim
    }
}
if _, err := tx.Exec(
    `INSERT INTO api_variable_history (id, variable_id, value, is_secret, secret_value, recorded_at) ...`,
```

That blob is later read back by `RevealHistoryValue` (`:940`), which under D4 decrypts with
`ScopeVariableHistory` while `encryptFor` sealed it with `ScopeVariable`. **Every history row
written after this phase would fail to authenticate** — a silent, permanent data loss that no
existing test would catch (see F6).

The fix is available for free: `recordHistory` is called from three sites and **all three already
hold the decrypted plaintext**, because `valueChanged` (`:523-536`) decrypts it and the callers only
proceed when its `ok` return is true —

- `:452-454` (`Upsert`): `if changed, oldPlain, oldPlainOK := r.valueChanged(...); changed && oldPlainOK { r.recordHistory(tx, id, oldPlain, oldSecret, oldSecretValue, now) }`
- `:745-747` (`ApplyBulk`, secret branch): same guard, `oldSecret` hard-coded `true`
- `:780-782` (`ApplyBulk`, plain branch): same guard, `oldSecret` hard-coded `false` — no ciphertext involved

So `recordHistory` can re-encrypt `oldPlain` under `ScopeVariableHistory` instead of copying, and
drop its now-unused `oldSecretValue` parameter entirely. D5.

### F6 — `RevealHistoryValue` has **no test coverage whatsoever**

`rg -n 'RevealHistoryValue' --type go apps/kira-studio` matches only its definition
(`repos/variables.go:925`) and its one caller (`apivars/reveal.go:48`). `RevealValue` has four test
call sites (`variables_test.go:258,355,549,639`); its history sibling has zero. The history tests
that do exist (`:114`, `:187`, `:613`) only ever call `r.History(...)`, whose projection
(`variables.go:867`) selects `id, variable_id, value, is_secret, recorded_at` — **never
`secret_value`** — so nothing in the suite ever decrypts a history row. F5's breakage would ship
green. §4.2's new test closes both the coverage gap and the risk in one.

### F7 — The wrong-envelope sentence becomes the phase's front door, and it is wrong twice

After the bump, `cipher.go:106`'s sentence is what **every existing user sees on first run**, for
**every** stored secret. It is wrong in two ways:

1. It says the value "is not in this app's `kira:v2:` envelope format" while rejecting a value that
   is *exactly* in `kira:v2:` format. The prefix is now `kira:v3:`.
2. It ends "re-enter it to fix this **connection**", but it is reached from the variables paths too.
   `apivars/reveal.go:67-71` puts `err.Error()` straight into `RevealResult.Error` with no
   unwrapping, so a user revealing a variable sees the whole wrapped string —
   `repos/variables: decrypt <uuid>: The stored credential is not in this app's kira:v2: envelope
   format … re-enter it to fix this connection.` (`connections.Service.Reveal` is better behaved:
   `errorMessage` (`service.go:175-181`) unwraps to `ipcerr.Error.Message`.)

**The message change is contained to Go.** `rg -n 're-enter it|envelope format'` over `apps/`,
`packages/` and `tests/` finds no TypeScript, Vue or Playwright assertion on either sentence; the
only UI-side match, `apps/kira-studio/tests/ui/secrets.spec.ts:113`, mocks an `E_SECRET_STORE` with
its own invented message. Nothing renders the string but a generic error surface.

### F8 — Nothing structural blocks `repos` importing `internal/secrets`

`internal/layering_test.go` forbids exactly one edge — any package under `internal/` depending on
`internal/bridge` (`:81-83`). It says nothing about domain-to-domain imports, and
`internal/storage/repos` already imports a sibling domain package (`internal/postman`, for
`postman.Variable` at `variables.go:1146`). `internal/secrets` imports only `crypto/*`,
`encoding/base64`, `log/slog`, `os`, `runtime`, `strings` and `internal/ipcerr` — no cycle back into
`repos`, and no new `internal/bridge` reachability. `repos_test` already imports `secrets` directly
(`variables_test.go:10`, and `newVariablesRepo` at `:22-28` builds a real `secrets.New()` under
`KIRA_INSECURE_SECRETS=1`). D1 therefore adds a legal, one-way edge.

### F9 — Every stale `kira:v2:` string in the tree

Outside `docs/v1/`, `docs/v1.1/` and `docs/v1.2/plans/` (historical records, left alone), the live
mentions are: `secrets/status.go:2` (package doc), `secrets/cipher.go:18,19,21,76,106`,
`repos/secrets.go:8`, `repos/variables.go:122`, and `docs/ARCHITECTURE.md:448,462,463`. Nine
non-historical sites. §3.7.

### F10 — `ipcerr.SecretStore` is a plain `E_SECRET_STORE` constructor with no structure to extend

`ipcerr/errors.go:43`: `func SecretStore(message string) *Error { return New("E_SECRET_STORE", message) }`.
There is no code field, no cause enum, nothing that could carry "this is a v2 value" separately from
the prose. So the sentence *is* the contract, which is why D6 treats its wording as production code
and not as copy polish.

---

## 2. Decisions

### D1 — The scope is a **named string type with a closed, validated set of constants**, declared in `internal/secrets`

```go
// apps/kira-studio/internal/secrets/scope.go  (new file)
package secrets

// Scope is the kind of secret a ciphertext was sealed for. It is AES-GCM's additional
// authenticated data (P29), which is what makes a ciphertext refuse to decrypt anywhere but the
// kind of column it was written for — P21 round 2 architecture/security finding 10.
//
// These three strings are a storage format, not a label: changing one orphans every secret already
// stored under it, exactly the way changing envelopePrefix does. scope_test.go freezes them.
type Scope string

const (
	ScopeConnection      Scope = "connection"
	ScopeVariable        Scope = "variable"
	ScopeVariableHistory Scope = "variable-history"
)

func (s Scope) valid() bool {
	switch s {
	case ScopeConnection, ScopeVariable, ScopeVariableHistory:
		return true
	}
	return false
}
```

**Why a named type rather than a bare `string`.** It makes the two-argument call self-documenting and
makes an argument swap (`Encrypt(plain, scope)`) a compile error rather than a value silently sealed
under the wrong AAD. **Why the constants are not enough on their own**, and why `valid()` exists: Go
converts an untyped string constant to `Scope` implicitly, so `c.Encrypt("connections", plain)`
compiles cleanly today and produces a secret nothing can ever read back. The type prevents the
*mechanical* error; only the runtime check prevents the *typing* one. D2 makes both `Encrypt` and
`Decrypt` reject an unknown scope before doing any crypto, so a typo is a loud `E_SECRET_STORE` at
the first test that exercises the path — never an unreadable row on a user's disk. §8.1 flags the
whole question for a human anyway, since it is cheap now and awkward after the call sites land.

**Why `internal/secrets` and not a new leaf package.** A four-line `internal/secretscope` package
would keep `repos` free of a `secrets` import, but F8 shows that import is legal, acyclic and
already precedented (`repos` → `postman`), and the scope strings are meaningless away from the
cipher that consumes them. One new file in the package that owns the format beats one new package.

### D2 — The AAD is the scope **qualified by the envelope prefix**, and an unknown scope is refused before any crypto

```go
func (s Scope) aad() []byte { return []byte(envelopePrefix + string(s)) }
```

→ `"kira:v3:connection"`, `"kira:v3:variable"`, `"kira:v3:variable-history"`.

Including the prefix costs nothing and buys domain separation across format versions: if a future
`kira:v4:` ever runs under the same key, a v3 ciphertext will not authenticate as v4 even where both
use the same scope. It also means a prefix bump invalidates old data through *two* independent
mechanisms rather than one, which is the intent of a prefix bump.

Both directions get the same guard, before the availability check and before the prefix check:

```go
if !scope.valid() {
	return "", ipcerr.SecretStore(fmt.Sprintf("internal error: %q is not a known secret scope", scope))
}
```

This is a programmer error, not a user condition — but `E_SECRET_STORE` is the only code this seam
has (F10), and refusing loudly is strictly better than sealing something unreadable.

### D3 — `kira:v3:`, and **no** compatibility path of any kind

`const envelopePrefix = "kira:v3:"`. That single constant is the entire migration story.

**Why this is what keeps the phase small — stated plainly, the way `cipher.go`'s deferred-decision
comment stated the opposite.** A version of this fix that preserved existing data needs, at minimum:
a second `aead.Open` attempt with `nil` AAD when the v3 open fails; a way to tell "this is a v2 value
that needs re-sealing" from "this is a v3 value that was moved between columns" — which is the exact
distinction the AAD exists to make, so the compatibility path reopens the hole it is meant to close
for as long as it lives; a re-encrypt-on-read write path inside repos that are currently pure readers
(`RevealValue`, `mergeSecrets`, `SecretsRepo.Get`) and would need transactions and a `*sql.DB` they
do not all take; a decision about what to do when the cipher is available for reading but the row is
not writable; and a removal date, plus the discipline to actually remove it. That is a phase of its
own, and it is exactly the "closing this properly … is a real but separate change" that
`cipher.go:73-88` used to defer this fix in the first place.

Dropping it is safe here for one specific, checkable reason, not as a general principle: **the app
has not shipped.** `docs/ARCHITECTURE.md`'s own keychain-rename paragraph already leans on the same
fact — *"The app has not shipped, so there is no installed base to orphan … this is the last time the
name can change for free."* The cost is bounded and one-time: on first run after this phase, every
saved connection password and every API-variable secret reports "re-enter it", the user re-enters
each once, and every subsequent run is normal. `kira:v1:` values have behaved exactly this way since
P52 §6.4 with no complaint mechanism and no migration.

**What must not be built:** no `isEnveloped` helper, no `upgradeLegacySecrets` revival, no
`decryptAnyVersion`, no "try v2 then v3", no startup sweep, no settings toggle, no `--allow-v2` flag.
§4.1's `TestDecryptRefusesAnOlderEnvelopeEvenWithTheRightKey` is the guard that keeps one from being
added later by accident.

### D4 — Signatures, and the scope every call site passes

```go
func (c *Cipher) Encrypt(scope Scope, plain string) (string, error)
func (c *Cipher) Decrypt(scope Scope, stored string) (string, error)
```

Scope first: it reads as "encrypt, in this scope, this value", and it puts the argument a reviewer
must check at the front of every call. The `repos.Cipher` interface mirrors it exactly
(`Encrypt(scope secrets.Scope, plain string) (string, error)`, likewise `Decrypt`).

| Call site | Column it round-trips | Scope | Why |
|---|---|---|---|
| `repos/secrets.go:49` `Set` | `connections.password` | `ScopeConnection` | |
| `repos/secrets.go:39` `Get` | `connections.password` | `ScopeConnection` | must match `Set` and both `service.go` writers, or every reveal breaks |
| `connections/service.go:259` `Create` | `connections.password` | `ScopeConnection` | |
| `connections/service.go:327` `Update` | `connections.password` | `ScopeConnection` | not `Duplicate` — §0.3(1) |
| `repos/variables.go:510` `encryptFor` | `api_variables.secret_value` | `ScopeVariable` | the only writer of that column |
| `repos/variables.go:530` `valueChanged` | `api_variables.secret_value` | `ScopeVariable` | |
| `repos/variables.go:916` `RevealValue` | `api_variables.secret_value` | `ScopeVariable` | |
| `repos/variables.go:992` `mergeSecrets` | `api_variables.secret_value` | `ScopeVariable` | |
| `repos/variables.go:940` `RevealHistoryValue` | `api_variable_history.secret_value` | **`ScopeVariableHistory`** | the only reader of that column |
| `repos/variables.go` `recordHistory` (**new**, D5) | `api_variable_history.secret_value` | **`ScopeVariableHistory`** | the only writer of that column |

The rule that generates this table, and the one an implementer should apply to any site this plan
missed: **the scope is the column the ciphertext lives in, and every reader and writer of one column
uses one scope.** Three columns, three scopes.

### D5 — `recordHistory` **re-encrypts** under `ScopeVariableHistory` instead of copying the live ciphertext

The fix F5 sets up. `recordHistory` loses its `oldSecretValue sql.NullString` parameter (it becomes
unused) and gains one `Encrypt`:

```go
func (r *VariablesRepo) recordHistory(tx *sql.Tx, variableID, oldPlain string, oldSecret bool, now string) error {
	value := oldPlain
	var secretValue *string
	if oldSecret {
		value = ""
		// P29: api_variable_history.secret_value is its own scope, so the value being replaced is
		// re-sealed under ScopeVariableHistory rather than copied across from api_variables — a
		// verbatim copy would be a ciphertext sealed for one column sitting in another, which is
		// exactly what this phase's AAD refuses. Every caller reaches here only through
		// valueChanged's ok return, so oldPlain is a real, already-decrypted plaintext and this
		// Encrypt cannot fail for an unavailable cipher.
		enc, err := r.cipher.Encrypt(secrets.ScopeVariableHistory, oldPlain)
		if err != nil {
			return fmt.Errorf("repos/variables: encrypt history value: %w", err)
		}
		secretValue = &enc
	}
	...
}
```

All three call sites (`:452-454`, `:745-747`, `:780-782`) drop their `oldSecretValue`/`er.secretValue`
argument.

**Why this and not "give history the same `ScopeVariable`".** Collapsing to two scopes would avoid
the re-encrypt, but it would hand back part of what the phase is for: `api_variable_history` is
reachable through its own IPC method (`apivars.Service.RevealHistory`) and its rows are far more
numerous and far less visible than the live variable list, which makes it the better hiding place of
the two for a swapped ciphertext. The SPEC row names three scopes on purpose. §8.2 flags the call.

**Why the new failure mode is acceptable.** `recordHistory` could not previously fail on the cipher;
now it can, and inside a transaction, so a failure rolls the whole `Upsert`/`ApplyBulk` back. But
every path into it has just *succeeded* at a `Decrypt` two statements earlier, which proves the
cipher is available; the only residual failure is `rand.Read`, i.e. the machine's CSPRNG. Failing the
edit loudly beats writing a history row nobody can read.

**Behavioural note for the implementer:** the history row's ciphertext is now a *fresh* seal, so it
is no longer byte-equal to the live row's. Nothing asserts that today (F6), and nothing should start
to — the two blobs are deliberately different now.

### D6 — The wrong-envelope sentence is rewritten; `decryptFailure`'s is not

```go
return "", ipcerr.SecretStore("The stored credential is not in this app's kira:v3: envelope format — values saved by an earlier version of Kira Studio cannot be read and must be entered again.")
```

It states what is true (an older format, unreadable), it stops naming the format it is rejecting as
the format it wants, and it drops "this connection" because after this phase the same sentence is
what a variable reveal shows too (F7). It deliberately does **not** apologise, offer a migration, or
mention AAD — a user does not need the cryptography, only the action.

`decryptFailure`'s sentence (`cipher.go:128-133`) stays **verbatim**. It is the message an AAD
mismatch produces, and "may have been written on a different machine or after a keychain reset —
re-enter it" is honest for that case without narrating an attack back at whoever triggered it.
`docs/ARCHITECTURE.md` explicitly records that sentence as deliberately kept; §8.3 flags its
"this connection" tail rather than changing it here.

### D7 — `cipher.go:73-88`'s deferred-decision comment is replaced by the decision it deferred

The comment currently explains why finding 10 is *not* fixed. Leaving it would be a live lie in the
one file a reader checks first. It is replaced with a comment of similar length recording: what the
AAD binds and why kind and not row (the duplication paths, named correctly per §0.3(4)); that
`recordHistory` re-seals rather than copies, and why the other two copies do not need to; and that
`kira:v2:`/`kira:v1:` are refused with no migration by explicit decision, with a pointer to this
document.

### D8 — `Status`, `probe`, backends, keychain, key material: unchanged

`insecureKeyMaterial` keeps its `kira-studio:v2:` string. It is a key-derivation input, not an
envelope, and changing it would rotate the Linux development key for no reason — a second,
independent way to make every stored secret unreadable, which is not what the phase is buying.

---

## 3. File-by-file implementation plan

### 3.1 `apps/kira-studio/internal/secrets/scope.go` — **new**

D1 verbatim: the `Scope` type, three constants, `valid()`, `aad()`. Package-level doc comment
explaining that these strings are a storage format.

### 3.2 `apps/kira-studio/internal/secrets/cipher.go`

- `:18-21` — `envelopePrefix` becomes `"kira:v3:"`; its comment gains the P29 sentence (the AAD
  changed, so a v2 blob would fail to authenticate anyway; the prefix makes that failure a clear
  message instead of a tag mismatch) and keeps the P52 §6.4 history.
- `:73-88` — comment replaced per D7.
- `:89` — `func (c *Cipher) Encrypt(scope Scope, plain string) (string, error)`; add the `valid()`
  guard first; `:97` becomes `c.aead.Seal(nonce, nonce, []byte(plain), scope.aad())`.
- `:102` — `func (c *Cipher) Decrypt(scope Scope, stored string) (string, error)`; `valid()` guard
  first, then the existing prefix guard with D6's new sentence at `:106`; `:121` becomes
  `c.aead.Open(nil, nonce, sealed, scope.aad())`.
- `:128-133` `decryptFailure` — untouched.

### 3.3 `apps/kira-studio/internal/storage/repos/secrets.go`

- Add the `internal/secrets` import (F8).
- `:12-15` — interface becomes `Encrypt(scope secrets.Scope, plain string)` / `Decrypt(scope
  secrets.Scope, stored string)`; `:8`'s `kira:v2:` → `kira:v3:`, plus one sentence that the scope
  argument is the column's kind.
- `:39` — `r.cipher.Decrypt(secrets.ScopeConnection, stored.String)`.
- `:49` — `r.cipher.Encrypt(secrets.ScopeConnection, *secret)`.
- `Delete` (`:61`) untouched.

### 3.4 `apps/kira-studio/internal/storage/repos/variables.go`

- Add the `internal/secrets` import.
- `:122` — comment's `kira:v2:` → `kira:v3:`.
- `:510` (`encryptFor`) — `ScopeVariable`.
- `:530` (`valueChanged`) — `ScopeVariable`.
- `:538-556` (`recordHistory`) — D5: drop the `oldSecretValue` parameter, re-encrypt under
  `ScopeVariableHistory`, new comment.
- `:452-454`, `:745-747`, `:780-782` — the three `recordHistory` calls lose their ciphertext
  argument.
- `:916` (`RevealValue`) — `ScopeVariable`.
- `:940` (`RevealHistoryValue`) — `ScopeVariableHistory`.
- `:992` (`mergeSecrets`) — `ScopeVariable`.
- `DuplicateEnvironment` (`:134-...`) — **not touched.** Its verbatim copy is correct and must stay.

### 3.5 `apps/kira-studio/internal/connections/service.go`

- `:259` (`Create`) and `:327` (`Update`) — `s.deps.Cipher.Encrypt(secrets.ScopeConnection, *password)`.
  The `secrets` import already exists (`:99`, `:680`).
- `Duplicate` (`:373-395`) — **not touched**, and the four `P28 §5.5` comments (`:44, 363, 469, 616`,
  all v1's P28) are **not touched** either (see the header note).

### 3.6 `apps/kira-studio/internal/storage/repos/connections.go`

**Not touched.** `InsertDuplicateWithSecret`'s subquery copy is the behaviour the phase preserves.
Its comment at `:277` ("mirrors `SecretsRepo.Copy`'s own 'no decrypt, no re-encrypt' contract")
names a method that does not exist; left alone, since it is a comment about a contract that is still
accurate and correcting stale prose in an untouched file is not this phase's business.

### 3.7 Comments and docs

- `secrets/status.go:2` — `kira:v2:` → `kira:v3:`.
- `docs/ARCHITECTURE.md` — the Storage section: `:448`'s `kira:v2:<base64>` → `kira:v3:<base64>`;
  `:462-463`'s "Two things changed with the cipher" paragraph gains a third, which is this phase —
  the AAD, the three scopes, the three columns, the fact that duplication still copies raw
  ciphertext because kind does not change across a same-kind duplicate, that history re-seals
  because kind *does* change there, and D3's no-migration decision with the "has not shipped"
  reasoning the same section already uses for the keychain rename.
- `docs/v1.2/SPEC.md` — the **P29** row marked **Implemented**, in the same voice as P26's row,
  recording the four premise corrections from §0.3.

### 3.8 `apps/kira-studio/internal/bridge/collections_import_atomicity_test.go`

`:35-36` — `func (failingCipher) Encrypt(secrets.Scope, string) (string, error)` and the matching
`Decrypt`; add the import. No behaviour change; the test's own assertion (`:72`) is untouched.

---

## 4. Test plan

### 4.1 `apps/kira-studio/internal/secrets/cipher_test.go`

**Updated:**
- `TestEncryptUsesAFreshNoncePerCall` (`:80`) — pass `ScopeConnection` at `:84,88,95`; add one
  assertion that the envelope starts with `kira:v3:` (the only place the shipped prefix is asserted
  from outside the constant).
- `TestTamperDetectionFailsAuthentication` (`:104`) — pass `ScopeConnection` at `:106,132`. Its four
  cases keep working unchanged: an AAD only strengthens the tag it already checks.

**New — these four are the phase's proof:**

1. **`TestScopeBindsCiphertextToItsKind`** — the headline. A 3×3 table over
   `{ScopeConnection, ScopeVariable, ScopeVariableHistory}`: seal under scope A, open under scope B.
   Every diagonal cell returns the plaintext; every one of the six off-diagonal cells returns an
   `*ipcerr.Error` with code `E_SECRET_STORE` and a message containing "could not be decrypted".
   This is P21 round 2 finding 10, refuted mechanically.
2. **`TestDecryptRefusesAnOlderEnvelopeEvenWithTheRightKey`** — take a real, valid `kira:v3:`
   envelope from `Encrypt`, replace only its prefix with `kira:v2:` (and separately `kira:v1:`), and
   assert both are refused with the D6 sentence — *before* any key or tag work, since the bytes and
   the key are otherwise perfect. This is the test that makes "no dual-read path" a property of the
   suite rather than an intention: it fails the moment anyone adds a v2 fallback.
3. **`TestAnUnknownScopeIsRefusedByBothDirections`** — `Scope("connections")` (the plausible typo)
   and `Scope("")` (the zero value) are refused by `Encrypt` **and** `Decrypt` with
   `E_SECRET_STORE`, and `Encrypt` returns no envelope at all. The guard that turns D1's residual
   typo risk into a loud failure.
4. **`TestScopeStringsAndEnvelopePrefixAreFrozen`** — asserts the four literals
   (`"kira:v3:"`, `"connection"`, `"variable"`, `"variable-history"`) by value, with a comment saying
   why: each is a storage format whose silent rename orphans every secret stored under it. Three
   lines, and it makes a future accidental rename a failing test instead of a support ticket.

### 4.2 `apps/kira-studio/internal/storage/repos/secret_scope_test.go` — **new**

One file, so the cross-kind property has an obvious home. Both tests use the existing
`newVariablesRepo` / `newRepos` harness shape (`variables_test.go:22-28`) with
`KIRA_INSECURE_SECRETS=1` and a real `secrets.New()` — a genuine round trip, per that file's own
stated convention.

1. **`TestAHistorySecretRoundTripsUnderItsOwnScope`** — create a secret variable, `Upsert` a new
   value, then `RevealHistoryValue(hist[0].ID)` returns the **old** plaintext. Closes F6's coverage
   gap and is the regression guard for D5: it fails outright if `recordHistory` ever goes back to
   copying the live ciphertext.
2. **`TestACiphertextMovedBetweenColumnsIsRefused`** — the SPEC row's attack, executed against the
   app's real tables, in both directions that matter:
   - `SecretsRepo.Set(connID, "db-password")`, read `connections.password` by raw SQL, write it into
     an `api_variables.secret_value` row by raw SQL → `RevealValue` fails.
   - Read a live `api_variables.secret_value`, write it into an `api_variable_history.secret_value`
     row by raw SQL → `RevealHistoryValue` fails.

   Each assertion carries the sentence the row is built on: a connection credential can no longer be
   revealed through the lower-friction variables gate.

**Unchanged and must stay green with no edit** — this is how the row's "duplication keeps working"
requirement is proved: `variables_test.go:463`
`TestDuplicateEnvironmentCopiesCiphertextVerbatimNoHistoryNeverActive` (its `:537-546` byte-compare
of source and copy ciphertext) and `:570` `TestApplyBulkLeavesAnUntouchedSecretByteIdentical`. Also
green with no edit: `:114`, `:187`, `:613` (history counts and `History()` projections, which never
touch `secret_value` — F6), `:238`, `:324`, `:413`, `:437`, and every `RevealValue` call site.

### 4.3 `apps/kira-studio/internal/secrets/keychain_darwin_test.go`

`:63,67` — pass `ScopeConnection`. Behind `//go:build darwin && cgo`; it does not compile in this
container, so "it still compiles" is Tier 3 (§5.3), and the implementer must not assume a green Linux
run covers it.

### 4.4 The mutation check

Before committing §4.2, the implementer runs one deliberate mutation and reverts it: change
`RevealHistoryValue`'s scope from `ScopeVariableHistory` to `ScopeVariable` and confirm
`TestAHistorySecretRoundTripsUnderItsOwnScope` **fails**. A test that cannot fail is not evidence,
and this is the one assertion whose value depends entirely on D5 having actually been applied.

---

## 5. Exit criteria

**This phase is substantially Tier-1-provable in this container.** It is pure Go — no VS Code
extension, no webview, no Vue component, no CSS token, no Playwright spec, no `bun` tier of any
kind. The full behavioural claim ("a ciphertext refuses to decrypt outside the kind of column it was
written for, and nothing written before this phase decrypts at all") is a `go test` assertion end to
end, against the app's own SQLite schema, on Linux, in seconds. The only things that genuinely
escape Tier 1 are the darwin-tagged keychain test and the one-time human experience of re-entering
real credentials.

### 5.1 Tier 1 — fully provable here, and expected green

1. `go build ./apps/kira-studio/...` clean, and `go vet ./apps/kira-studio/...` clean.
2. `go test -race -count=1` green for the five packages the change reaches:
   `./apps/kira-studio/internal/secrets/...`, `./apps/kira-studio/internal/storage/repos/...`,
   `./apps/kira-studio/internal/connections/...`, `./apps/kira-studio/internal/apivars/...`,
   `./apps/kira-studio/internal/bridge/...`. Baseline for comparison, measured at `fa3d35be`:
   secrets 0.003 s, repos 3.5 s, apivars 0.040 s, all green; none of these packages uses
   testcontainers.
3. `go test -count=1 ./apps/kira-studio/internal/` — `layering_test.go` green, confirming the new
   `repos` → `secrets` edge introduces no `internal/bridge` reachability (F8).
4. `go test -count=1 ./apps/kira-studio/...` green overall — the cheap way to prove no call site was
   missed, since a missed one does not compile.
5. **§4.1's four new tests green**, in particular the 3×3 matrix's six off-diagonal refusals and the
   `kira:v2:`-with-a-perfect-payload refusal.
6. **§4.2's two new tests green**, and §4.4's mutation confirmed to make
   `TestAHistorySecretRoundTripsUnderItsOwnScope` fail before being reverted.
7. **The two duplication tests green with no edit to either** (`variables_test.go:463` and `:570`) —
   the SPEC row's "must keep working exactly as-is with zero decrypt/re-encrypt" requirement.
8. Grep proofs, each one command:
   - `rg -n 'kira:v2' apps/ docs/ARCHITECTURE.md` returns nothing (the surviving matches are all
     under `docs/v1/`, `docs/v1.1/`, `docs/v1.2/plans/` — historical records, deliberately left).
   - `rg -n 'Seal\(|\.Open\(' apps/kira-studio/internal/secrets/cipher.go` shows `scope.aad()` in
     both, and no `nil` as the final argument to either.
   - `rg -n '\.Encrypt\(|\.Decrypt\(' --type go apps/kira-studio` shows a scope constant as the
     first argument at every one of the sites in F1's tables, plus D5's new one — and no call with a
     single argument anywhere.
   - `rg -n 'upgradeLegacySecrets|isEnveloped|decryptAny|kira:v1' apps/kira-studio --type go`
     returns nothing (D3: no compatibility path was smuggled in).
9. `bun run typecheck` and `bun run lint` — run once as a sanity check and expected **unchanged**;
   this phase touches no file either of them reads. If either reports a change, something outside
   this plan's scope was edited.

### 5.2 Tier 2 — provable here as a compile/reasoning check, not as a run

- **`keychain_darwin_test.go`.** `//go:build darwin && cgo` means Linux never compiles it. Provable
  here only by reading that both call sites got a scope. `GOOS=darwin go vet` will not help
  (`cgo` is unset). §5.3 step 1 is where it is actually run.
- **The first-run experience against a real, pre-P29 `kira.db`.** Not reproducible here — this
  container has no such database. The equivalent proof in miniature is §4.1's test 2, which refuses a
  byte-perfect `kira:v2:` envelope sealed under the very key the process is holding. If that is
  refused, a real v2 row is refused for the same reason on the same line.
- **`Cipher.New()`'s macOS branch.** Untouched by this phase (D8); `probe`'s existing table test
  (`cipher_test.go:22`) still covers all three `goos` branches on Linux.

### 5.3 Tier 3 — needs a human on a Mac with a pre-P29 database

1. `go test ./apps/kira-studio/internal/secrets/...` on macOS with cgo, so
   `TestRealKeychainRoundTrip` actually runs against the real Keychain under its test-only
   service/account (§4.3).
2. Launch against an **existing** `~/.kira-studio/kira.db` that has saved connection passwords and
   secret variables in it. Confirm: connecting to a saved connection reports the D6 sentence rather
   than a stack trace or an empty password; revealing a secret variable reports the same; the message
   reads sensibly for a *variable* and not only for a connection (F7 — this is the one thing §8.3
   asks a human to judge).
3. Re-enter one connection password and one variable value. Confirm both save, both connect/reveal,
   and both survive an app restart.
4. **Duplicate a connection** whose password was re-entered, then reveal the duplicate's password —
   it must be the same value, with no re-prompt. **Duplicate an environment** containing a secret
   variable and reveal the copy — same. This is the raw-ciphertext-copy guarantee, confirmed by hand
   on top of §5.1(7)'s automated proof.
5. Edit a secret variable's value twice, then reveal an entry from its **history** — the old value
   comes back. This is D5 in front of a human; it is the path that would be silently broken by the
   literal reading of the SPEC row.

---

## 6. What this phase deliberately does not do

- **Row-scoped or column-plus-id AAD.** It would defeat both duplication paths, which is why
  `cipher.go`'s original comment ruled it out and why the SPEC row specifies kind. Kind-scoped
  closes the finding's actual attack (cross-*kind* movement) and leaves same-kind movement — moving
  one connection's password onto another connection row — open. That residual is real and is
  recorded, not fixed: closing it needs a row identity in the AAD, which means the duplication paths
  must decrypt and re-encrypt, which means Duplicate starts requiring the keychain and starts failing
  when it is unavailable. That trade is a phase of its own.
- **Any migration, dual-read, or upgrade routine.** D3, at length.
- **A re-key or a keychain-item rename.** D8.
- **Changing `decryptFailure`'s sentence.** §8.3.
- **Unwrapping `apivars`' error before it reaches the user.** `apivars/reveal.go:67-71` surfaces
  `err.Error()` with the `repos/variables: decrypt <uuid>:` prefix intact, where
  `connections.Service.Reveal` unwraps to the clean `ipcerr` message. That asymmetry is real, is
  pre-existing, and gets more visible after this phase — but fixing it means touching the
  `RevealResult` contract, which is P17/P14 territory, not P29's.
- **Correcting `repos/connections.go:277`'s reference to a `SecretsRepo.Copy` that does not exist.**
  §3.6.

---

## 7. Commit sequence

Each commit builds and each commit's tests pass; the signature change makes a smaller first commit
impossible, since nothing compiles between the cipher changing and its callers catching up.

| # | Commit | Contents |
|---|---|---|
| C1 | `feat(secrets)!: bind every ciphertext to its kind with a scope AAD (kira:v2: → kira:v3:)` | §3.1-3.6 and §3.8 — the new `scope.go`, the cipher, the `repos.Cipher` interface, all nine existing call sites, D5's `recordHistory` rework, the `failingCipher` fake, and the two existing `cipher_test.go` tests updated to the new signatures (they do not compile otherwise) |
| C2 | `test(secrets): prove a ciphertext cannot move between kinds, and that kira:v2: is refused` | §4.1's four new tests, §4.2's new file, §4.3's darwin update, and §4.4's mutation check run and reverted |
| C3 | `docs: record the kira:v3: scope-bound envelope and its one-time credential reset` | §3.7 — `ARCHITECTURE.md`, `status.go`'s package doc, and the P29 row in `docs/v1.2/SPEC.md` marked implemented |

The `!` on C1 is deliberate and is the repo's own convention for a user-visible break (cf.
`f13f1c11` `fix(datagrip)!: drop the KeePass/PasswordSafe-file fallback`): every stored credential
becomes unreadable, which is exactly what a breaking-change marker is for.

---

## 8. Three calls worth a human eye before implementation starts

All three are judgment calls the orchestrator or the user may reasonably decide differently, and all
three are cheap to change *now* and awkward after C1. None is a blocker: the plan takes a position on
each and can be implemented exactly as written.

### 8.1 Typed `Scope` constants plus a runtime validity check, or a loose `string`? (D1, D2)

**As planned**: a named `type Scope string` with three constants **and** a `valid()` check inside
both `Encrypt` and `Decrypt`. The reason both halves are there is worth stating plainly, because it
is easy to assume the type alone is enough and it is not: Go converts an untyped string constant to a
named string type implicitly, so `c.Encrypt("connections", plain)` — a plausible plural typo —
compiles cleanly and silently produces a secret that nothing will ever be able to read. The named
type buys self-documenting call sites and makes an argument swap a compile error; only the runtime
check turns a typo into a loud `E_SECRET_STORE` at the first test that exercises the path. Together
they cost about twelve lines.

**The alternative**: a plain `string` parameter with three package constants and no validation —
marginally less code, and no new `repos` → `secrets` import (F8) since the constants could be
inlined. The cost is that the failure mode of a typo is the worst one this codebase has: not a crash,
not a test failure, but a credential written to disk that decrypts nowhere, discovered by a user
whose password stopped working.

**A third option, if the `repos` → `secrets` import is unwelcome**: a four-line leaf package
`internal/secretscope` imported by all three. D1 declines it because the import is legal, acyclic and
already precedented, but it is a defensible preference and it is a five-minute change before C1 and a
tedious one after.

### 8.2 Does the history table get its own scope, and therefore a re-encrypt? (D5, F5)

**This is the one place the SPEC row's literal text does not work**, so it is flagged rather than
settled quietly. The row names `"variable-history"` as a scope and separately promises that the raw
ciphertext copies keep working — but it lists only two of the three copies. The third,
`recordHistory` (`variables.go:541-556`), copies a live `api_variables.secret_value` blob into
`api_variable_history.secret_value`, which is *cross*-kind. Both halves of the row cannot be true at
once.

**As planned**: keep the three scopes and make `recordHistory` re-encrypt, using the plaintext
`valueChanged` has already decrypted two statements earlier (D5). History rows get their own scope,
so a live ciphertext dropped into the history table is refused. Costs one `Encrypt`, one dropped
parameter, and a new (practically unreachable) error path inside a transaction.

**The alternative**: collapse to two scopes — history rows keep `ScopeVariable`, `recordHistory`'s
verbatim copy stands untouched, no new failure path, and the diff is one line smaller. The cost is
that a stolen live-variable ciphertext can still be parked in `api_variable_history` and revealed
through `apivars.Service.RevealHistory` — a quieter, more numerous table than the live variable list,
and arguably the better hiding place of the two. Note that this alternative does **not** reopen the
row's headline attack: a *connection* password still cannot be read as a variable or as history
either way.

Whoever decides this should also note that `RevealHistoryValue` has no test coverage at all today
(F6), so neither option is currently guarded — §4.2's first test is worth writing regardless of which
way this goes.

### 8.3 Is the existing "re-enter it" copy already right, or does it need work this phase? (D6, F7)

The brief asked for this to be confirmed rather than assumed. **Confirmed: it is not already right —
one of the two sentences must change, and the other probably should not.**

**The sentence that must change** is `cipher.go:106`'s, and it is not a nicety: after the prefix
bump it is what **every existing user sees on first run, for every stored secret**, and it currently
reads *"is not in this app's `kira:v2:` envelope format"* while rejecting a value that is precisely in
`kira:v2:` format. D6 rewrites it to name the real situation (an older format, unreadable, enter it
again) and drops its "fix this connection" tail, because after this phase the same sentence is also
what a variable reveal shows. **A human may reasonably want to write this sentence themselves** — it
is the phase's entire user-facing surface, seen once by everyone, and D6's wording is one plausible
version of it, not a researched one.

**The sentence that should not change** is `decryptFailure`'s (`cipher.go:128-133`), and the
confirmation cuts the other way: it is genuinely already correct for what it reports. It is the
message an AAD mismatch produces, and *"may have been written on a different machine or after a
keychain reset — re-enter it"* is honest for that case without narrating a possible tampering
attempt back at whoever triggered it. `docs/ARCHITECTURE.md` records it as deliberately kept
verbatim, and this plan keeps it.

The residual, flagged and **not** fixed here: that sentence's own "fix this connection" tail is
equally wrong for a variable, and `apivars/reveal.go:67-71` shows the user the whole wrapped string
including the `repos/variables: decrypt <uuid>:` prefix. Both are pre-existing (they are true at
`fa3d35be` today), both get more visible after this phase, and both are copy/contract work in P17's
territory rather than P29's. If a human wants the variables reveal path cleaned up, that is a
deliberate scope extension, not an oversight to be folded in quietly.

---

## 9. Sources

- `docs/v1.2/SPEC.md` — the **P29** row (last in the phase table; numbered P28 until `fa3d35be`).
- `apps/kira-studio/internal/secrets/cipher.go:18-21, 73-88, 89-99, 102-126, 128-133` — the prefix,
  the deferred-decision comment naming P21 round 2 finding 10, and the two `nil` AADs.
- `apps/kira-studio/internal/secrets/cipher_test.go:80-139`, `keychain_darwin_test.go:63-67` —
  existing coverage and its conventions.
- `apps/kira-studio/internal/secrets/status.go:1-4` — the package doc naming the envelope.
- `apps/kira-studio/internal/storage/repos/secrets.go:8-15, 39, 49` — the consumer-side interface and
  the connection-password round trip.
- `apps/kira-studio/internal/storage/repos/variables.go:122, 134-215, 452-454, 504-515, 517-536,
  538-556, 745-747, 780-782, 865-867, 901-921, 925-944, 976-999` — every variables call site,
  `DuplicateEnvironment`, and `recordHistory`.
- `apps/kira-studio/internal/storage/repos/connections.go:273-322` — `InsertDuplicateWithSecret`.
- `apps/kira-studio/internal/connections/service.go:99, 175-181, 227-276, 277-372, 373-395, 432-455,
  680` — the two Encrypt sites (Create and Update), `errorMessage`, and `Duplicate`.
- `apps/kira-studio/internal/apivars/vars.go:27-32, 46-47`, `apivars/reveal.go:33-79` — the unused
  `Deps.Cipher`, and the reveal path that surfaces `err.Error()` unwrapped.
- `apps/kira-studio/internal/bridge/collections_import_atomicity_test.go:31-36, 61` — `failingCipher`.
- `apps/kira-studio/internal/layering_test.go:24-43, 76-84` — the one edge the layering rule forbids.
- `apps/kira-studio/internal/storage/repos/variables_test.go:22-28, 114, 187, 258, 355, 463, 537-546,
  549, 570, 613, 639` — the harness convention, and the coverage that must stay green.
- `apps/kira-studio/internal/ipcerr/errors.go:42-43` — `SecretStore`.
- `docs/ARCHITECTURE.md`, Storage section (~`:437-480`) — the single-key design, the `kira:v2:`
  envelope, the v1→v2 bump, and the "app has not shipped, so this is free" reasoning D3 reuses.
