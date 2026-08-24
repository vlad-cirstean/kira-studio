# P25 — Credential encryption via the macOS Keychain

> Not an original SPEC.md §10 deliverable line — P25 closes out one item of SPEC.md:27's
> **explicitly deferred** list, on user request. The ask, verbatim: *"credentials encryption using
> keychain for now. It need to consider running the playwright tests."*
>
> **Phase number.** `docs/v1/plans/` held P0–P23 when this was written; **P24 is reserved for an
> unrelated in-flight phase** (search/cell-editor/design work) being planned concurrently, so this
> one takes **P25** deliberately rather than racing for the next free number.
>
> **What "for now" means here.** SPEC.md:27 defers, in one sentence: *"credential encryption,
> MySQL, SQLite-as-target, light mode, Windows/Linux, DDL editing, unit tests, code
> signing/notarization, auto-update"*, plus *"Deferred to v2: SSH tunnel"* and *"Out for v1: export
> to CSV/JSON, connection folders/groups, split editor groups, multiple windows."* This phase
> removes **exactly one** word from that list — *credential encryption* — and three of the
> surviving items bound it directly:
> - **Windows/Linux stays deferred.** This is a macOS-Keychain implementation, not a
>   cross-platform secret-storage abstraction (D2). Linux appears in this plan only as the
>   platform the Playwright suite is routinely run on in the dev container (F9), and is handled
>   as a *development* concern, never as product support.
> - **Code signing/notarization stays deferred**, which has a real, user-visible consequence for
>   Keychain ACLs that D12 states outright instead of letting it surface as a mystery prompt.
> - **Unit tests stay deferred** — SPEC §9 is *"No unit tests. Two suites only."* — so **every
>   assertion this phase adds has to be a Playwright assertion**, which is precisely why the user
>   flagged the test suite in the same breath as the feature. §2 and D14–D17 are the answer to
>   that half of the ask, and they are the larger half of this plan.
>
> **Why one phase.** The encryption swap itself is one file (F1). What makes it a phase rather
> than a commit is everything it drags in: the failure surface when the Keychain is unavailable
> (D6–D9), the already-stored plaintext (D10), and a UI test suite that creates a password-bearing
> connection in **19 spec files** and runs on two platforms with two different truths about
> whether `safeStorage` works at all (F9, F12, D13).

## 0. Ground rules for this phase

- **One file owns the ciphertext, one file owns the OS call.** `storage/repos/secrets.ts` stays
  the only file that reads or writes `connections.password` (P1 D8, restated in its own header
  comment); the new `main/secret-cipher.ts` is the only file in the repo that imports
  `safeStorage`. If encryption needs a third file, the design is wrong.
- **Never silently fall back to plaintext.** When the OS key is unavailable, a save that carries a
  secret **fails, with a message the user sees** (D6/D7). The one place a non-Keychain key is
  permitted is a Linux **development** fallback behind an explicit env var, which is ignored
  outright on macOS, logged on every startup that honours it, and surfaced in the connection
  dialog as an error-tone strip (D13). "Unset env var and no keyring" resolves to *unavailable*,
  not to *plaintext*.
- **No new dependency and no new error UI pattern.** `safeStorage` is part of Electron (already a
  dependency); failures surface through the two channels this app already has — the connection
  state's `error` field rendered by `ErrorPopover.vue` (F7), and inline dialog text in the style
  of `.field-error` / `MessageStrip.vue` (F8).
- **Nothing about the wire contract for connections changes.** `connectionsList()` still never
  carries a password (P1 D9, asserted at `tests/ui/connections.spec.ts:59-64`), `reveal()` still
  returns the real one (`:104-108`), and the dialog's three-state password convention
  (`null` = unchanged, `''` = clear, non-empty = replace — `main/connections.ts:255-269`) is
  untouched. Encryption happens strictly between that convention and SQLite.
- **A secret is touched only when one exists.** A connection with `password: null` never calls
  `safeStorage` at all, in either direction. This is what keeps the no-password specs
  (`tests/ui/sqs.spec.ts:93`, `startup.spec.ts:44`) platform-independent (D8).
- **Test assertions state the invariant, not the implementation.** The at-rest test asserts *the
  typed password is not what is in the column* and *the app can still read it back*, mirroring
  D9's "never carries a password over IPC" style — not the AES details of Chromium's OSCrypt.
- Comments per AGENTS.md: only where the code cannot say it for itself.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `bun run test:db` is
  untouched by this phase (no adapter changes) but must stay green;
  `xvfb-run -a bun run test:ui` matters from **step 1** on — it is the thing most likely to break.

## 1. Findings (verified against the tree, Electron's v43 docs and its source — not assumed)

**F1 — the swap really is one file, and that file already says so.**
`src/main/storage/repos/secrets.ts` is 33 lines: a `SecretStore` interface (`get`/`set`/`delete`)
and `createSecretStore(db)` whose three methods are a `select`, an `update` and an `update` to
`NULL` on `connections.password`. Its header comment (`:11-13`) already names the intended
replacement: *"§1 defers credential encryption; the intended replacement is Electron's
`safeStorage.encryptString` (Keychain-derived, no new dependency) — swapping it in only touches
this file."* Verified: `createSecretStore` has exactly **one** caller
(`main/connections.ts:65`), and `connections.password` appears nowhere else in `src/` —
`storage/repos/connections.ts:19-37`'s `SELECT_COLUMNS` deliberately omits it and its `:14-17`
comment records why. The claim holds for the *storage* half. It does **not** hold for the
*failure* half: nothing in the app currently has a way to say "this secret cannot be stored", and
that is where the rest of this plan goes.

**F2 — the column is `TEXT`, and that is load-bearing.** `storage/schema/connections.ts:14` is
`password: text('password')` (nullable), matching `0001_init.sql`. `safeStorage.encryptString`
returns a **`Buffer` of arbitrary bytes**. `storage/db.ts:71-85`'s `sqlite-proxy` callback binds
JS values straight through `node:sqlite`'s `StatementSync`, whose declared param union
(`db.ts:7`) does include `Uint8Array` — so a blob *could* physically be written into a `TEXT`
column (SQLite is dynamically typed) — but it would then read back through Drizzle's `text()`
mapper as a string, and any byte sequence that is not valid UTF-8 does not survive that round
trip intact. D3 is the consequence.

**F3 — the migration runner is SQL-only, forward-only, and has no data-transform precedent.**
`storage/migrate.ts` reads `schema_version`, refuses to run when the file is *newer* than the
build (`:15-21`), and applies each `migrations[]` entry as `db.exec(m.sql)` inside a transaction.
All four existing migrations are pure DDL — `0003_p11.sql` and `0004_misc_fixes.sql` are single
`ALTER TABLE … ADD COLUMN` statements. **A SQL file cannot call `safeStorage`**, so re-encrypting
existing rows cannot be a migration in the shape this repo has (D10).

**F4 — every secret in the app funnels through `SecretStore`, including URI-mode and AWS static
keys.** `main/connections.ts:236-240` and `:262-266` run `stripUriPassword()`
(`shared/domain/uri.ts:50-59`) on save, so a URI's userinfo password is moved *out* of the stored
`uri` column and into the secret store; `resolve()` (`:117-123`) puts it back with
`injectUriPassword()` at connect time. `s3/client.ts:24-34` and `sqs/client.ts:24-25` read AWS
static keys from exactly that userinfo position (SPEC §5.1: static keys are accepted only in URI
mode), so **encrypting the secret store encrypts the AWS secret access keys too** — no separate
work, but it is why D5 covers the URI path with its own test scenario rather than assuming
symmetry.

**F5 — `duplicate()` is the one caller that moves a secret without needing to read it.**
`main/connections.ts:275-289` calls `secrets.get(id)` then `secrets.set(newId, password)` — a
decrypt/re-encrypt round trip whose plaintext is never used. D11 turns it into a raw column copy.

**F6 — `reveal()` and `duplicate()` are the two IPC paths that would reject on a decrypt failure,
and neither renderer caller catches.** `state/connections.ts:83` (`openEditDialog`) does
`const { password } = await control.connectionsReveal(id)` with no `try`, so a rejection leaves
the dialog unopened and produces an unhandled rejection — which several specs would see as a
console error (`fixtures.ts:49-51` collects them and specs assert on `consoleErrors`).
`duplicateConnection` (`:120-124`) has the same shape. `saveDialog()` (`:103-118`) and
`ConnectionDialog.vue:176-190`'s `onSave` likewise `await` the IPC with no catch — so **today, any
main-side save failure is an unhandled rejection with no user-visible message**. This phase
introduces the first realistic way to trigger it, so it fixes it (D7).

**F7 — connect-time failures already have a complete, tested surface.**
`main/connections.ts:163-224`'s `doConnect` wraps everything — including `resolve()`, which is
where `secrets.get()` is called (`:117`) — in one `try/catch` that emits
`{ status: 'error', error: <message> }`. `TreeRow.vue` renders that through
`ErrorPopover.vue` (P16: click-to-open, Copy, Escape-to-close). `test()`
(`main/connections.ts:315-326`) catches into `{ ok: false, error }` and the dialog shows it in its
test chip (`ConnectionDialog.vue:166-174`, `[data-testid="connection-test-result"]`).
**So a decryption failure at connect time needs no new UI at all** — it needs a message worth
reading, which is a wording decision, not a design one.

**F8 — error text in main reaches the renderer with a `[CODE]` prefix, and nothing parses it.**
`main/ipc/errors.ts:8-15` folds a thrown error's `.code` into the message as `` `[${code}] ${msg}` ``
because Electron's IPC serialization preserves only `.message`. A grep for `[E_` in
`src/renderer` finds only comments — no renderer branches on the prefix; every surface prints the
message verbatim. Consequence for D6: a coded error is fine, but **the message must read as a
complete sentence on its own**, because that whole string is what the user sees.

**F9 — the Playwright suite is routinely run on Linux, headless, under Xvfb — and Linux is where
`safeStorage` is *not* available.** `README.md:153` documents `xvfb-run -a bun run test:ui` for a
headless Linux machine, and eight prior plans name that exact command as the per-step check
(P5, P10, P13, P17, P18, P19, P20's §294, P14). This dev container is one of those machines: no
systemd (AGENTS.md's Docker section), therefore no `gnome-keyring` or `kwallet` daemon, therefore
Chromium's OSCrypt picks the `basic_text` backend and `safeStorage.isEncryptionAvailable()`
returns **false**. Without a deliberate answer, this phase breaks the suite on the machine the
suite is normally run on. D13 is that answer, and it is the single most important decision here.

**F10 — how `safeStorage` actually behaves, per Electron v43's own docs and source** (this repo
pins `electron@43.4.1`; `docs/api/safe-storage.md` and
`shell/browser/api/electron_api_safe_storage.cc` at tag `v43.0.0`):
- `isEncryptionAvailable()` — *"On Linux, returns true if the app has emitted the `ready` event
  and the secret key is available. On MacOS, returns true if Keychain is available. On Windows,
  returns true once the app has emitted the `ready` event."*
- Every method checks browser-ready first and throws **"safeStorage cannot be used before app is
  ready"** otherwise; `encryptString`/`decryptString` additionally throw *"Encryption is not
  available"* / *"Decryption is not available"* when `IsEncryptionAvailable()` is false.
- `decryptString` validates that the ciphertext starts with Chromium's `v10`/`v11` version tag.
- macOS: *"Access to the system Keychain is required and these calls can block the current thread
  to collect user input."* The key is one random AES key stored as a generic-password Keychain
  item named after the app; **`app.setName('Kira Studio')` already runs at `main/index.ts:18`**,
  before `app.whenReady()` at `:57`, so the item is *"Kira Studio Safe Storage"* and not
  *"Chromium Safe Storage"* (electron/electron#45328 is exactly this bug, and this app is already
  on the right side of it — but only because the probe is placed after `whenReady`, which D1
  makes explicit rather than incidental).
- Linux: `getSelectedStorageBackend()` (Linux-only) returns one of `basic_text`,
  `gnome_libsecret`, `kwallet*`, `unknown`; with `basic_text` *"items stored using the
  `safeStorage` API will be unprotected as they are encrypted via hardcoded plaintext password"*.
  `setUsePlainTextEncryption(true)` opts into exactly that, and the v43 source confirms
  `IsEncryptionAvailable()` *"on Linux also permits encryption when `use_password_v10_` is true
  and the backend is `basic_text`"* — i.e. the override is honoured by the **synchronous** API
  path specifically.
- v43 also ships an async API (`isAsyncEncryptionAvailable`, `encryptStringAsync`,
  `decryptStringAsync` → `{ shouldReEncrypt, result }`). D4 records why this phase uses the
  synchronous pair anyway.

**F11 — CI is macOS-only and runs the whole UI suite, so it *will* exercise the Keychain.**
`.github/workflows/ci.yml` has three jobs, all `runs-on: macos-15`; `ui-smoke` runs
`bun run test:ui` (= `electron-vite build && playwright test`, `playwright.config.ts` → `testDir:
./tests/ui`, `workers: 1`, `timeout: 60_000`). GitHub's macOS runners have no Docker, so every
container-backed spec self-skips (`test.skip(true, DOCKER_UNAVAILABLE_MESSAGE)`, e.g.
`data-view.spec.ts:17-21`) — but `connections.spec.ts` is explicitly *"No container needed …
Must never skip (§12b)"* (`:4-5`), and it creates a password-bearing connection at `:88-96`. So
the Keychain path runs on every CI push. The documented CI risk is real and specific: a macOS
runner's login keychain may be locked or absent for a non-interactive session, in which case
either `isEncryptionAvailable()` returns false, or the OSCrypt call blocks the main process
waiting for a UI authorization that never comes — a 60 s Playwright timeout with no useful error.
D15 handles it with the standard fix (a purpose-made, unlocked, default keychain created in the
job) plus a **fail-loud assertion** so a regression in that setup can never degrade into silent
plaintext.

**F12 — no spec reads the SQLite file, and only one asserts on a stored secret.** A full grep of
`tests/` for `sqlite` / `node:sqlite` / `better-sqlite3` returns **nothing**: every spec goes
through `window.kira.*` IPC or the dialog. `password` appears in 19 spec files, always as an
*input* (`connectionsCreate({ … password: cfg.password })` or
`page.fill('[data-testid="connection-password"]', …)`). The only assertions *about* a secret are
`connections.spec.ts:59-64` (no `password` key on any `connectionsList()` record) and `:104-108`
(`reveal()` returns `'secretpw'` for a URI-mode connection). **Both keep passing unchanged under
encryption**, because both read through the app. Conclusion, stated as an acceptance item: this
phase must require **zero edits** to any existing spec — anything else means the encryption leaked
into a contract it had no business touching.

**F13 — the test harness is already fully isolated per test, and its env is the seam this phase
needs.** `tests/ui/fixtures.ts:22-26` makes a fresh `mkdtemp(tmpdir(), 'kira-ui-')` per test and
deletes it after; `:34-37` hard-refuses a `kiraHome` outside `tmpdir()` (P0 D10); `:44-47` launches
`out/main/index.js` with `env: { ...process.env, KIRA_HOME: kiraHome, NODE_ENV: 'test' }`;
`relaunch()` closes and relaunches against the *same* `KIRA_HOME`, which is what makes a
persistence assertion possible. The env object is one line and is the only place a per-run
`safeStorage` policy can be set (D13, D16).

**F14 — the storage file is WAL, which changes what a raw-bytes assertion can honestly claim.**
`storage/db.ts:64-67` sets `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`.
Two consequences for §2's tests: (a) a value written moments ago may live in `kira.sqlite-wal`
rather than `kira.sqlite` until the last connection closes, so any file scan must cover
`kira.sqlite*` and run **after** the app has been closed; and (b) an *overwritten* value can
linger in freed pages, so "the file contains no copy of the old plaintext" is a sound assertion
only for a row whose plaintext was **never** written (D17 splits the two cases accordingly).

## 2. Shapes introduced in this plan

```ts
// src/shared/domain/secrets.ts   (new — types + Zod for a domain concept, per SPEC §11)

/** What the app can tell the user about where credentials are kept. Reported by main once at
 *  startup; never changes for the life of the process. */
export const secretStorageStatusSchema = z.object({
  available: z.boolean(),
  backend: z.enum(['keychain', 'basic_text', 'unavailable']),
  /** True only for the Linux development fallback (D13). Always false on darwin. */
  insecureFallback: z.boolean(),
  /** One sentence, shown verbatim in the connection dialog; null when `available`. */
  reason: z.string().nullable(),
});
export type SecretStorageStatus = z.infer<typeof secretStorageStatusSchema>;
```

```ts
// src/main/secret-cipher.ts   (new — the ONLY file that imports `safeStorage`)

export class SecretStoreError extends Error {
  readonly code = 'E_SECRET_STORE';   // main/ipc/errors.ts folds this into the message (F8)
}

export interface SecretCipher {
  readonly status: SecretStorageStatus;
  /** `kira:v1:<base64>`. Throws SecretStoreError when `status.available` is false. */
  encrypt(plain: string): string;
  /** Enveloped -> decrypted. Not enveloped -> returned verbatim (pre-P25 plaintext, D10).
   *  Throws SecretStoreError when an enveloped value cannot be decrypted. */
  decrypt(stored: string): string;
  isEnveloped(stored: string): boolean;
}

/** Called once, after `app.whenReady()` (F10/D1). Probes availability, applies the Linux
 *  development fallback if and only if it is enabled (D13), and logs the outcome. */
export function createSecretCipher(): SecretCipher;
```

```ts
// src/main/storage/repos/secrets.ts   (MOD — same file, same role, one added dependency)

export function createSecretStore(db: KiraDb, cipher: SecretCipher): SecretStore;

export interface SecretStore {
  get(connectionId: string): Promise<string | null>;
  set(connectionId: string, secret: string | null): Promise<void>;
  /** Copies the stored column value verbatim — no decrypt, no re-encrypt (D11). */
  copy(fromConnectionId: string, toConnectionId: string): Promise<void>;
  delete(connectionId: string): Promise<void>;
}

/** One-shot, idempotent upgrade of rows written before P25. Returns how many it re-encrypted;
 *  a no-op (logged) when the cipher is unavailable. Called from main() after migrate() (D10). */
export async function upgradeLegacySecrets(db: KiraDb, cipher: SecretCipher): Promise<number>;
```

```ts
// src/main/connections.ts        (MOD)  createConnectionsService(db, engineHost, cipher)
//                                       + secretsStatus(): SecretStorageStatus
//                                       + reveal() -> { password, error }   (D9)
// src/shared/protocol/ipc.ts     (MOD)  connectionsSecretsStatus: 'kira:connections:secretsStatus'
// src/preload/index.ts           (MOD)  one passthrough
// src/renderer/bridge/control.ts (MOD)  one wrapper
// src/renderer/state/connections.ts (MOD) connectionsState.secretStorage, filled by
//                                       hydrateConnections(); saveDialog() surfaces failure
```

```ts
// tests/ui/fixtures.ts   (MOD — one optional argument, every existing `relaunch()` call unchanged)

/** Entries set to `undefined` are *removed* from the merged env — that is how a scenario turns
 *  the Linux development fallback off to exercise the unavailable path (D16). */
relaunch: (options?: { env?: Record<string, string | undefined> }) => Promise<KiraApp>;
```

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Encryption is `safeStorage`, probed exactly once, in `main()` after `await app.whenReady()` and before `createConnectionsService`.** `createSecretCipher()` calls `isEncryptionAvailable()` once, stores the result, and logs one line naming the backend. Nothing else in the codebase calls `safeStorage`. | F10: every `safeStorage` method throws *"safeStorage cannot be used before app is ready"* before ready, and on macOS a pre-ready call creates the Keychain item under the name *"Chromium"* instead of the app's (electron/electron#45328) — `app.setName` at `main/index.ts:18` fixes the name only if nothing touches the module earlier. Probing once also means the *first* Keychain access — the one that can block on user authorization (F10) — happens at a predictable moment during startup, not in the middle of a connection save. One probe per process is correct because availability cannot change under a running app: the key is fetched once by OSCrypt and cached. |
| D2 | **macOS-only, and stated as a decision rather than a limitation to be discovered.** No `SecretBackend` interface, no DPAPI/libsecret branch, no runtime platform switch beyond the one Linux development fallback in D13. `safeStorage` *is* the abstraction. | SPEC.md:16 (*"macOS only"*) and :27 (*"Windows/Linux"* deferred) — inventing a cross-platform indirection now would be scaffolding for a platform this app does not target, and AGENTS.md's *"scope left out of a phase is left out entirely"* cuts against a half-built one. **Not a dead end:** `safeStorage` already *is* cross-platform (DPAPI on Windows, libsecret/kwallet on Linux), so a future Windows/Linux pass adds no new crypto at all — it needs three things this plan deliberately does not build: a Linux `getSelectedStorageBackend()`-driven policy for `basic_text` (a real user-facing prompt, not the dev flag), the packaging-level app identity each OS keys its store on, and its own test matrix. Recording that here means the follow-up is a scoping exercise, not a rediscovery. |
| D3 | **The ciphertext is stored as the string `kira:v1:<base64>` in the existing `TEXT` column. No schema change, no `blob()` column, no migration file for the format.** `isEnveloped()` is a literal `startsWith('kira:v1:')`. | F2: `encryptString` returns arbitrary bytes and this column is `text()`; a Buffer written there reads back through Drizzle's text mapper as a string, and bytes that are not valid UTF-8 do not survive that round trip — silent credential corruption is the worst possible failure mode for this phase. Base64 sidesteps it entirely at a 33% size cost on a value that is tens of bytes. The **explicit `kira:v1:` prefix** (rather than sniffing Chromium's own `v10`/`v11` tag, F10) is what makes legacy detection exact: a user's real password could legitimately begin with `v10`, and mis-classifying it would either corrupt it or throw at connect time. The version segment costs nothing now and is the seam a future re-key needs. |
| D4 | **Use the synchronous `encryptString`/`decryptString`, not v43's async pair.** | Two reasons, in order. (1) **The Linux development fallback (D13) is verified only for the sync path**: v43's `electron_api_safe_storage.cc` honours `use_password_v10_` + `basic_text` inside `IsEncryptionAvailable()`/`EncryptString()`, while the async API goes through `os_crypt_async`, whose interaction with that override this plan could not verify — and D13 is what keeps `xvfb-run -a bun run test:ui` green, so it may not rest on an unverified assumption. (2) **The cost is bounded and paid once**: OSCrypt fetches the key from the Keychain a single time per process (D1 forces that to startup); every later `encryptString` is an in-memory AES call on a ≤ 100-byte string, on a code path that is already `await`ing SQLite. The async API's `shouldReEncrypt` key-rotation signal is the genuine loss; it is worth revisiting if macOS ever rotates the OSCrypt key, and the `kira:v1:` prefix (D3) is where that would be handled. |
| D5 | **`SecretStore` keeps its exact interface and role; `createSecretStore(db, cipher)` gains one parameter.** `get()` = select → `cipher.decrypt`; `set(id, secret)` = `cipher.encrypt` → update (and `set(id, null)` writes `NULL` with no `safeStorage` call at all). Everything above it — the three-state password convention, `stripUriPassword`/`injectUriPassword`, `resolve()`, the engine's `ResolvedConnectionConfig` — is byte-for-byte unchanged. | F1's promise, kept. It also means the AWS static keys that ride the URI userinfo position (F4) are encrypted by construction rather than by a second mechanism, and that the engine process never sees anything but the plaintext it already receives — no key material, no ciphertext, and no new engine-side code. |
| D6 | **When the cipher is unavailable, a write that carries a secret throws `SecretStoreError` (`code: 'E_SECRET_STORE'`), and `create()`/`update()` encrypt *before* touching SQLite so a failure leaves nothing written.** The message is one full sentence, e.g. *"The macOS Keychain is unavailable, so this connection's password could not be saved. Everything else about the connection was left unchanged."* | F8: the `[CODE]` prefix exists for machine branching that no renderer does today, so the message carries the whole meaning and must stand alone. Encrypting first is what makes the failure atomic in practice without introducing a cross-repo transaction: `main/connections.ts:242-247` currently inserts the row and *then* calls `secrets.set`, which under a throwing cipher would leave a passwordless connection behind and a user wondering which half landed. |
| D7 | **The dialog stops swallowing save failures.** `onSave` wraps `saveDialog()` in `try/catch`, keeps the dialog open on failure, and renders the message inline (`data-testid="connection-save-error"`, `.field-error` styling). `saveDialog()` re-throws rather than returning `null` on error, so the dialog is the single place that decides what a failed save looks like. | F6: today *any* main-side save failure is an unhandled promise rejection with no user-visible effect — the dialog just sits there. This phase creates the first realistic trigger, so leaving it would be shipping a known dead end, which AGENTS.md's no-stubbed-error-handling rule forbids. Reusing `.field-error` (already used for six validation messages in this dialog) means no new error idiom is invented. |
| D8 | **Up-front honesty in the dialog, replacing the plaintext warning.** `ConnectionDialog.vue:443-445`'s *"Credentials are stored unencrypted in ~/.kira-studio/kira.sqlite."* becomes one of three states driven by `connectionsState.secretStorage`, all carrying `data-testid="connection-credential-note"`: **available** — *"Credentials are encrypted with your macOS Keychain."* (muted, not warn-toned); **insecure fallback** — a `MessageStrip tone="warn"`: *"Development fallback: credentials on this platform are obfuscated with a built-in key, not a real keychain."*; **unavailable** — a `MessageStrip tone="err"`: *"The macOS Keychain is unavailable, so passwords cannot be saved. Everything else about this connection can be."* | The plaintext sentence becomes a lie the moment step 2 lands, and SPEC §8.13 requires *a* credential notice — the notice stays, it stops being wrong. Saying it before the user types a password is worth more than only reporting it after a failed save (D7 covers the case where the state changes between dialog open and save). `MessageStrip` (`theme/primitives/MessageStrip.vue`, `tone: 'warn' \| 'err'`) is the app's existing banner primitive, so no new component. |
| D9 | **`reveal()` returns `{ password, error }` instead of throwing.** Main catches a decrypt failure, logs it, and returns `{ password: null, error: <sentence> }`; `openEditDialog` opens the dialog with an empty password field and shows that sentence in the same slot D7 uses. | F6: `openEditDialog` has no catch, so a throw here means the Edit menu item silently does nothing *and* logs a console error the `consoleErrors` fixture would flag. An undecryptable stored secret is a genuinely reachable state — a restored `kira.sqlite` from another machine, a reset login keychain — and the only useful response is "type it again", which requires the dialog to actually open. Adding a field is backward-compatible with `connections.spec.ts:104-108`, which reads `revealed.password` only. |
| D10 | **Pre-P25 plaintext is upgraded by a one-shot `upgradeLegacySecrets(db, cipher)` in `main()`, immediately after `migrate(raw)` — not by a migration file, and not lazily on read.** It selects every non-null, non-empty, non-enveloped `password`, re-encrypts each, and writes them back in one transaction; it logs the count; when the cipher is unavailable it logs a warning and changes nothing. `cipher.decrypt` *also* passes a non-enveloped value through verbatim, so a row that somehow escapes the pass still works. | F3: migrations are SQL and SQL cannot call `safeStorage`, so this cannot be `0005_*.sql` — and inventing a JS-migration mechanism for one transform would be new machinery for a one-time job. Doing it at startup (rather than lazily in `get()`) means a user's existing connections are *all* protected the first time they launch the new build, instead of only the ones they happen to open; the read-path passthrough is the belt to that braces, not an alternative to it. **Deliberately no `schema_version` bump**: the column's type and shape are unchanged, and `migrate.ts:15-21`'s downgrade guard would make an older build refuse to open the file *at all* — a harsher failure than the one it would prevent (an older build handing a `kira:v1:…` string to a driver, which fails authentication with a recoverable "re-enter your password"). |
| D11 | **`duplicate()` copies the stored column verbatim via a new `SecretStore.copy()`.** | F5: the existing decrypt→re-encrypt round trip never uses the plaintext, so it is pure risk — it can fail (or prompt) for no benefit, and it is the one secret operation that has no reason to need the OS key at all. A raw copy is also the only way *Duplicate* keeps working on a machine where the Keychain is momentarily unavailable, which is a nice property to get for free rather than a goal in itself. |
| D12 | **The ad-hoc-signing consequence is documented, not engineered around.** README's status section and `docs/v1/PACKAGING.md` gain one paragraph: because the packaged app is unsigned/ad-hoc (SPEC.md:27 defers code signing), macOS treats each new build as a different application for Keychain ACL purposes, so the first launch after installing a new build may show one *"Kira Studio wants to use your confidential information stored in … "* prompt; **Always Allow** answers it permanently for that build. | Electron's own docs state *"your app should be code signed for `safeStorage` to behave consistently"*. The fix is a Developer ID signature, which is explicitly deferred past v1 — so the honest move is to name the symptom, the cause and the one-click answer where a user will look for it, rather than to bolt on a workaround (a private keychain, a bundled key) that would be strictly worse security *and* would have to be unpicked once signing lands. |
| D13 | **Linux gets one explicit, loud development fallback: `KIRA_INSECURE_SECRETS=1`.** When set **and** `process.platform === 'linux'` **and** `isEncryptionAvailable()` is false, `createSecretCipher()` calls `safeStorage.setUsePlainTextEncryption(true)`, re-probes, and reports `{ available: true, backend: 'basic_text', insecureFallback: true }`. On any other platform the variable is ignored outright — a packaged macOS build cannot be talked into it by an env var. Every startup that honours it logs `warn`, and the dialog says so (D8). With the variable unset, Linux resolves to `{ available: false, backend: 'unavailable' }` and D6 applies. | F9 is the problem: the suite is normally run in a keyring-less Linux container, and this phase would otherwise fail every password-bearing spec there. The alternatives were both worse. *Silently storing plaintext when unavailable* is what the user ruled out and what this phase exists to end. *Branching every spec on `process.platform`* spreads a platform conditional through 19 files to work around a two-line startup policy, and leaves the Linux runs asserting a **different** contract from CI's — the exact divergence that makes a green local suite meaningless. With the fallback on, the observable contract is **identical on both platforms** (a `kira:v1:` envelope, a round trip, no plaintext in the column), so the specs need no platform branches at all. What differs is only the strength of the key, which is precisely what `insecureFallback` and the dialog strip report. This is also what Electron's `setUsePlainTextEncryption` is *for* (F10). |
| D14 | **New coverage lands in a new `tests/ui/secrets.spec.ts`, not in `connections.spec.ts`.** No container, never skipped on macOS; its platform-conditional scenarios skip explicitly and say why. | `connections.spec.ts` is one long CRUD narrative about the *dialog* (create → relaunch → URI mode → colors → duplicate → delete) and its header pins it as the spec that *"must never skip"*. The at-rest contract is a different invariant with different machinery (a raw SQLite read, a platform probe) and, per D13/D16, one Linux-only scenario — grafting that on would make the CRUD spec conditional and dilute both. It also mirrors how P1's D9 contract lives as its own tightly-scoped assertion block rather than being smeared through the flow. |
| D15 | **`.github/workflows/ci.yml`'s `ui-smoke` job gains a keychain-preparation step before `bun run test:ui`,** creating a dedicated, unlocked, non-expiring keychain and making it the default: `security create-keychain -p "$P" kira-ci.keychain-db`; `security set-keychain-settings -lut 21600 kira-ci.keychain-db`; `security unlock-keychain -p "$P" kira-ci.keychain-db`; `security default-keychain -s kira-ci.keychain-db`; `security list-keychains -d user -s kira-ci.keychain-db login.keychain-db` — with `P` a per-run `openssl rand -base64 24`. No other job changes. | F11: OSCrypt reads and writes its key in the **default** keychain, and a GitHub-hosted runner's login keychain in a non-interactive session is the documented source of both failure modes — `isEncryptionAvailable()` false, or a blocking authorization prompt that turns into a 60 s Playwright timeout. A *fresh* keychain guarantees the item does not exist yet, so the app **creates** it (which grants its own binary access implicitly, no prompt) instead of asking to read someone else's; unlocked with a long `-lut` means it cannot re-lock mid-run. This is the standard approach Electron/macOS projects use for signing on CI, applied to the one job that launches the app. Nothing is added to `checks` or `package-smoke` — neither runs the app. |
| D16 | **The harness sets `KIRA_INSECURE_SECRETS: '1'` unconditionally in `fixtures.ts`'s launch env, and `relaunch()` grows an optional env overlay so one scenario can remove it.** Entries whose value is `undefined` are deleted from the merged env before launch. | The variable is inert on macOS (D13), so setting it unconditionally keeps one code path in the fixture and means **CI exercises the real Keychain** while the Linux container exercises the same observable contract. The overlay is what makes the *unavailable* path testable at all (D6/D7/D8 would otherwise be assertion-free code, which AGENTS.md's no-stubs rule treats the same as unimplemented). It is one optional parameter with a default, so all ~30 existing `relaunch()` calls are untouched. |
| D17 | **Two different at-rest assertions, applied to two different cases — deliberately, because WAL makes only one of them sound.** For a row whose plaintext was *never written* (the normal case), assert **both** that the column value is enveloped and unequal to what was typed, **and** that no file matching `kira.sqlite*` in the test's `KIRA_HOME` contains the password's bytes — after the app has been closed. For the legacy-upgrade case, assert **only** the column value, never the file bytes. | F14: `journal_mode = WAL` means a recent write may still be in `kira.sqlite-wal` (hence the glob and the close-first ordering), and an *overwritten* value can survive in freed pages until a vacuum — so "the old plaintext is nowhere in the file" is simply not true after an in-place re-encrypt, and asserting it would produce a test that fails for a reason unrelated to the feature. The column assertion is exact in both cases. The file scan is kept where it *is* sound because it is the stronger statement — it catches a leak into **any** column or table (the `uri` column, `op_log.command`, a saved query), not just the one this phase touched. |
| D18 | **Docs are updated in the implementation commit, not in this one.** SPEC §1's deferred list (drop *credential encryption*), §6's *"Credentials are stored in plain text for now"* paragraph, §8.13's *"plain-text credential warning"*, §9's isolation note (the Keychain item is shared with the developer's login keychain by design — F10 — while the test's own secrets stay in its temp `KIRA_HOME`), §10's phasing table (a new P25 row), `README.md:15-17`'s plaintext bullet, `docs/v1/PACKAGING.md` (D12), and `AGENTS.md` (one short subsection on running the suite on Linux vs macOS, alongside the existing Docker one). | Same convention as P23 D12: the plan lands first and alone; the spec is only true once the code is. `README.md:15-17` currently tells users *"do not store production credentials"* — that sentence has to change in the same commit that stops making it true, or the docs actively mislead in the other direction. |

## 4. Implementation order

Each step ends green on `bun run lint`, `bun run typecheck`, `bun run build`, and — from step 1 —
`xvfb-run -a bun run test:ui`.

1. **The harness seam, first and alone.** `tests/ui/fixtures.ts`: add `KIRA_INSECURE_SECRETS: '1'`
   to the launch env and the optional `{ env }` overlay on `relaunch()` (D16). Nothing in `src/`
   reads the variable yet, so the whole suite must be green and unchanged — this step exists so
   that when step 3 lands, a failure is unambiguously about encryption and not about the fixture.
2. **`src/shared/domain/secrets.ts`** (`SecretStorageStatus` + Zod) and
   **`src/main/secret-cipher.ts`** (`createSecretCipher`, `SecretStoreError`, the envelope, the
   Linux fallback, one startup log line). Wire it into `main()` after `app.whenReady()` and log
   the probe result. Nothing consumes it yet; the app must behave exactly as before, and the log
   line is the manual check on both platforms.
3. **The storage swap.** `storage/repos/secrets.ts`: `createSecretStore(db, cipher)`, `copy()`
   (D11), `upgradeLegacySecrets()` (D10); `main/connections.ts` takes the cipher, uses `copy()` in
   `duplicate()`, encrypts-before-insert in `create()`/`update()` (D6), and gains
   `secretsStatus()`; `main/index.ts` calls `upgradeLegacySecrets` after `migrate`. **This is the
   step where the existing suite either passes untouched or the plan is wrong** (F12) — run the
   full `xvfb-run -a bun run test:ui` here and treat any spec edit as a red flag to re-examine
   rather than a task.
4. **The status channel.** `IPC.connectionsSecretsStatus` + handler + preload + `control.ts` +
   `hydrateConnections()` filling `connectionsState.secretStorage`. Still nothing rendered.
5. **The dialog.** D8's three-state credential note, D7's save-error handling, D9's
   `reveal() -> { password, error }` and its `openEditDialog` consumer. New testids:
   `connection-credential-note`, `connection-save-error`.
6. **`tests/ui/secrets.spec.ts`** — the five scenarios in §5 below.
7. **CI.** `.github/workflows/ci.yml`'s keychain step (D15). Push and confirm `ui-smoke` is green
   **and** that the new spec's macOS branch actually asserted `available === true` (a skipped or
   degraded assertion here is the failure mode this whole phase must not have).
8. **Docs** per D18, including the new SPEC §10 phasing row, in the same commit as step 7.

Commits follow Conventional Commits: `feat(secrets): encrypt stored credentials with the macOS
Keychain` for steps 2–5, `test(secrets): assert the at-rest and round-trip contract` for step 6,
`ci: give the UI job an unlocked keychain for safeStorage` for step 7, `docs: …` for step 8.
Note that `.githooks/pre-commit` runs `bun run lint` and `bun run typecheck` and fails outright
when `node_modules` is missing.

## 5. `tests/ui/secrets.spec.ts` — the scenarios, in full

No container, no Docker gate. Helpers mirror the ones `connections.spec.ts` already uses
(`connectionRow`, `listConnections`, the `PERSIST_SETTLE_MS` settle before a relaunch).

Two shared helpers, defined once in this file:

```ts
/** Reads one row's raw stored password through the main process's own Node runtime — the same
 *  `node:sqlite` the app uses (storage/db.ts), so no test dependency is added. WAL + the app's
 *  5 s busy timeout make a second reader safe while the app is running. */
async function storedPassword(app: ElectronApplication, kiraHome: string, id: string) {
  return app.evaluate(async (_electron, args) => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(`${args.kiraHome}/kira.sqlite`);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const row = db.prepare('SELECT password FROM connections WHERE id = ?').get(args.id);
      return (row?.password ?? null) as string | null;
    } finally { db.close(); }
  }, { kiraHome, id });
}

/** Same seam, writing — used only to plant a pre-P25 plaintext row (scenario 4). */
async function writePlaintextPassword(app, kiraHome, id, value): Promise<void>;
```

**Scenario 1 — the platform's storage status is what it claims to be (never skipped).**
Read `window.kira.connectionsSecretsStatus()`. On `darwin`: `available === true`,
`backend === 'keychain'`, `insecureFallback === false`, `reason === null` — **this is the CI
guard**, and it must fail loudly rather than skip if D15's keychain step ever regresses. On
`linux`: `available === true`, `backend === 'basic_text'`, `insecureFallback === true`, and the
connection dialog's `connection-credential-note` shows the development-fallback wording. On any
other platform, `test.skip()` with *"SPEC §1: macOS only; Linux is dev-only (P25 D13)"*.

**Scenario 2 — a saved password is encrypted at rest and survives a relaunch (the core contract).**
Create a Postgres connection through the dialog with password `p25-secret-π-🔐` (non-ASCII on
purpose — a naive `Buffer`/`TEXT` round trip breaks visibly here, D3). Then:
- `storedPassword()` is non-null, **starts with `kira:v1:`**, and is **not equal** to the typed
  password.
- `connectionsList()` still exposes no `password` key on any record (P1 D9, re-asserted here so
  the two guarantees are checked together).
- Wait `PERSIST_SETTLE_MS`, `relaunch()` — a **fresh process, fresh decrypt** —
  `connectionsReveal({ id })` returns exactly `p25-secret-π-🔐` with `error === null`.
- After that relaunch (so the WAL is checkpointed, F14/D17), read every file in `KIRA_HOME`
  matching `kira.sqlite*` and assert **none** contains the UTF-8 bytes of the password.
- Reopen the connection through **Edit**, change only the name, save; `reveal()` still returns the
  same password (the three-state convention is unaffected) and `storedPassword()` is still
  enveloped.
- **Duplicate** the connection; `reveal()` on the copy returns the same password and its stored
  value is enveloped (D11's copy path).

**Scenario 3 — a URI-mode secret takes the same path (covers AWS static keys, F4).**
Mirrors `connections.spec.ts:87-108` and extends it to at-rest: save a URI-mode connection with
`postgresql://uriuser:p25-uri-secret@10.0.0.9:5555/uridb`; assert the stored `uri` contains
`uriuser` and not `p25-uri-secret` (existing guarantee), `storedPassword()` is enveloped, and
after a relaunch the `kira.sqlite*` bytes contain `p25-uri-secret` nowhere while `reveal()`
returns it exactly.

**Scenario 4 — a pre-P25 plaintext row is upgraded on next launch (D10).**
Create a connection normally, then `writePlaintextPassword(app, kiraHome, id, 'p25-legacy-pw')` to
put a bare plaintext value in the column, exactly as a pre-P25 build would have. `relaunch()`.
Then: `storedPassword()` now **starts with `kira:v1:`** and is not `'p25-legacy-pw'`, and
`reveal()` returns `'p25-legacy-pw'` — nothing was lost. Relaunch once more and assert the value
is still enveloped and unchanged in shape, proving the pass is idempotent and does not re-wrap an
already-enveloped value. **No file-bytes assertion in this scenario** (D17: the plaintext was
genuinely written once, and WAL/freed pages may still hold it).

**Scenario 5 — the unavailable path fails loudly and safely (Linux only).**
`test.skip(process.platform !== 'linux', 'the Keychain cannot be made unavailable on macOS from
within a test (P25 D16)')`. `relaunch({ env: { KIRA_INSECURE_SECRETS: undefined } })`, then:
- `connectionsSecretsStatus()` → `{ available: false, backend: 'unavailable' }` with a non-null
  `reason`.
- The dialog's `connection-credential-note` is the error-tone strip (D8).
- Filling the fields **with** a password and saving: the dialog **stays open**,
  `connection-save-error` is visible and mentions that the password could not be saved, and
  `connectionsList()` gained **no** record (D6's encrypt-before-insert).
- Filling the same fields **without** a password and saving: succeeds normally, the record
  appears, and `storedPassword()` is `null` — proving the cipher is never consulted when there is
  no secret.
- No unhandled rejection reaches the renderer: the spec's `consoleErrors` fixture is empty at the
  end (D7's real point).

## 6. Explicitly out of scope

- **Windows and Linux as supported platforms** (D2). Linux appears only as a development
  environment, behind an env var that a macOS build ignores.
- **A cross-platform `SecretBackend` abstraction, keytar, or any new dependency.** `safeStorage`
  is the abstraction; the follow-up a real Windows/Linux pass would need is named in D2.
- **Encrypting anything other than `connections.password`.** `saved_queries.body`,
  `op_log.command` and `filter_history.where_text` can all contain user data, and none of them is
  a credential; whole-file encryption of `kira.sqlite` is a different feature with different
  key-management and different failure modes. Note the one adjacent guarantee this phase *does*
  keep: `stripUriPassword` already ensures the `uri` column never holds a password (F4).
- **A master password / passphrase mode**, i.e. anything that asks the user for a secret to
  protect the secrets. `safeStorage` derives its key from the OS, which is the entire point of
  *"using keychain"*.
- **Re-keying, key rotation, or an export/import of stored credentials.** The `kira:v1:` prefix
  (D3) is the seam if any of those ever land; nothing implements them here.
- **Making the packaged app's Keychain behaviour prompt-free across builds** — that needs a stable
  Developer ID signature, which SPEC.md:27 defers past v1 (D12 documents the symptom instead).
- **A unit test for the cipher.** SPEC §9: *"No unit tests. Two suites only."* All coverage is the
  Playwright scenarios in §5.
- **Any change to `tests/db/`.** No adapter, no engine and no wire shape moves in this phase; the
  engine still receives the same plaintext `ResolvedConnectionConfig` it does today.
- **Changing what the engine process holds in memory.** Decrypted credentials still live in the
  engine's `ResolvedConnectionConfig` for the life of a connection; scrubbing process memory is a
  different (and much larger) threat model.

## 7. Target tree at the end of P25

```
src/shared/
  domain/secrets.ts              NEW  SecretStorageStatus + Zod (D1/D8)
  protocol/ipc.ts                MOD  connectionsSecretsStatus channel + KiraApi entry
src/main/
  secret-cipher.ts               NEW  the ONLY importer of `safeStorage` (D1–D4, D13)
  index.ts                       MOD  createSecretCipher() after whenReady; upgradeLegacySecrets()
                                      after migrate() (D1/D10)
  connections.ts                 MOD  takes the cipher; secrets.copy() in duplicate() (D11);
                                      encrypt-before-write (D6); secretsStatus(); reveal() ->
                                      { password, error } (D9)
  ipc/connections.ts             MOD  one handler
  storage/repos/secrets.ts       MOD  createSecretStore(db, cipher), copy(),
                                      upgradeLegacySecrets() — still the only file that touches
                                      connections.password
  storage/schema/connections.ts   --  UNCHANGED (TEXT column, D3)
  storage/migrations/             --  UNCHANGED (no new file, no version bump — D10/F3)
src/preload/index.ts             MOD  one passthrough
src/renderer/
  bridge/control.ts              MOD  one wrapper
  state/connections.ts           MOD  secretStorage in the store; saveDialog() re-throws;
                                      openEditDialog() handles reveal().error (D7/D9)
  project/ConnectionDialog.vue   MOD  three-state credential note; inline save error (D7/D8)
  project/ErrorPopover.vue        --  UNCHANGED (connect-time failures already land here, F7)
tests/ui/
  fixtures.ts                    MOD  KIRA_INSECURE_SECRETS in the launch env; relaunch({ env })
  secrets.spec.ts                NEW  the five scenarios of §5 (D14)
  connections.spec.ts             --  UNCHANGED (F12 — the D9 and reveal assertions must survive)
  *.spec.ts (18 others)           --  UNCHANGED
.github/workflows/ci.yml         MOD  keychain step in ui-smoke only (D15)
docs/
  v1/SPEC.md                     MOD  §1, §6, §8.13, §9, §10 row (D18 — implementation commit)
  v1/PACKAGING.md                MOD  ad-hoc signing vs Keychain ACL (D12)
  v1/plans/P25-credential-keychain-encryption.md  NEW  this document
README.md                        MOD  the plaintext-credentials bullet (D18)
AGENTS.md                        MOD  short note: running the UI suite on Linux vs macOS
```

## 8. Acceptance checklist

- [ ] A password saved through the dialog is stored as `kira:v1:<base64>`; the typed password is
      not the column value and appears in **no** `kira.sqlite*` file after the app closes.
- [ ] The same password comes back exactly — including non-ASCII characters — from `reveal()`
      after a full relaunch, and the connection still connects against a real database
      (`tests/ui/data-view.spec.ts` and friends green, unedited).
- [ ] A URI-mode connection's embedded password (and therefore an AWS static secret key) takes the
      same path: absent from the stored `uri`, enveloped in the column, recoverable via `reveal()`.
- [ ] `connectionsList()` still carries no `password` key on any record (P1 D9 unbroken).
- [ ] Duplicating a connection copies the secret without decrypting it, and the copy reveals the
      same password.
- [ ] A row left plaintext by a pre-P25 build is re-encrypted on the next launch, loses nothing,
      and a second launch does not double-wrap it.
- [ ] **Every existing spec passes with zero edits** — the single strongest signal that encryption
      stayed behind the interface it was supposed to stay behind (F12).
- [ ] `xvfb-run -a bun run test:ui` is green in the Linux dev container, with
      `KIRA_INSECURE_SECRETS=1` supplied by the fixture and the dialog showing the
      development-fallback strip.
- [ ] On CI (`macos-15`, `ui-smoke`), `secrets.spec.ts` scenario 1 **asserts** `available === true`
      and `backend === 'keychain'` — no skip, no degradation — and the job does not hang on a
      Keychain prompt.
- [ ] With the fallback removed on Linux: saving a password fails visibly in the dialog, no
      half-created connection is left behind, saving *without* a password still works, and no
      unhandled rejection reaches the renderer console.
- [ ] The connection dialog never claims credentials are stored unencrypted again, in any of the
      three states.
- [ ] `bun run lint`, all three `typecheck` projects, and `bun run build` clean; `bun run test:db`
      green and untouched.
- [ ] SPEC §1's deferred list no longer says *credential encryption*, §6 describes the envelope
      and the Keychain, §10 has a P25 row, and README no longer warns about plaintext credentials.

## 9. Open questions for the user

1. **Is the Linux development fallback acceptable at all?** D13 lets a Linux dev/test run encrypt
   with Chromium's hardcoded `basic_text` key behind `KIRA_INSECURE_SECRETS=1`, so the Playwright
   suite asserts the *same* contract on both platforms. The stricter alternative is no fallback:
   Linux is always *unavailable*, and every password-bearing spec then needs a `process.platform`
   branch — which means the suite you run locally stops checking what CI checks. Flagging it
   because it is the one place this phase deliberately allows a weak key, and the flag name and
   wording are cheap to change before step 2 and tedious after.
2. **Should an unavailable Keychain block saving the whole connection, or only its password?**
   D6/D7 keep the connection unsaved and tell the user why, on the argument that a connection
   silently missing the password it was just given is worse than a failed save. The alternative —
   save everything except the secret, with a warning — is friendlier for the fields-only cases
   (SQS/S3 named profiles, a passwordless local Postgres) but produces a connection that fails at
   connect time for a reason the user has to remember from an earlier banner.
3. **Should `bun run dev` on Linux imply the fallback?** As written, a contributor on Linux has to
   export `KIRA_INSECURE_SECRETS=1` themselves (AGENTS.md will say so); only the test fixture sets
   it automatically. Making the `dev` script set it would be one line in `package.json` and would
   remove a papercut, at the cost of making the weak key the silent default in one more place.
