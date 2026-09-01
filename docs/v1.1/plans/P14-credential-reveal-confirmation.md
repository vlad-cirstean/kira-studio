# P14 — Confirm-before-reveal for saved credentials

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:29`, P14 row): *"When a user asks to view
> an already-saved password or secret — e.g. from a connection's edit form — show a confirmation step
> before revealing it rather than displaying it immediately. Investigate using the operating system's
> own authentication prompt (macOS's `LocalAuthentication` — Touch ID / system password — since this
> app is Mac-first) for that confirmation rather than a bespoke in-app "are you sure" modal, falling
> back to an in-app confirmation only where OS-level auth genuinely isn't a good fit."* Why: *"A real
> security/UX gap — a saved secret is visible today with no friction at all."*
>
> **The headline, in one line: the gap is worse than "no confirmation on the eye toggle" — the
> plaintext is already in the renderer, in the DOM, before the user asks for anything.**
> `openEditDialog` (`state/connections.ts:118`) calls `connectionsReveal(id)` on **every** *Edit…*
> click and writes the decrypted password straight into `draft.password` (`:130`), which
> `ConnectionDialog.vue:446` binds to a `TextField` as its real `value`. The eye button
> (`:453-458`) is a pure client-side `showPassword = !showPassword` — it flips `type="password"` to
> `type="text"` on a value that was already there. So gating the eye toggle alone would be theatre:
> the secret would still be one devtools inspection, one accessibility read, or one
> `document.querySelector('[data-testid=connection-password]').value` away, for every connection the
> user merely opens to rename. **The fix has to move the IPC round-trip itself behind the gate**, not
> decorate the toggle.
>
> **That move is free, because the backend already supports it.** `Service.Update`'s password
> convention is *nil = unchanged, "" = clear, non-empty = replace*
> (`internal/connections/service.go:253`, pinned by `TestPasswordThreeStateConvention`,
> `service_test.go:208-211`), and **URI-mode edits already open the dialog with `password: null` and
> save correctly** (`state/connections.ts:108-114`, P2 R2). Fields mode can take the exact same shape.
>
> **Decision on OS auth vs. in-app modal: both, in that order, with the backend as the authority.**
> `LAContext.evaluatePolicy(.deviceOwnerAuthentication)` — Touch ID *with* system-password fallback,
> never the biometrics-only policy — gated in Go, inside `ConnectionsService.Reveal`, with a
> process-wide 5-minute grace so a Touch ID prompt is never per-keystroke or per-toggle. Where OS auth
> is genuinely unavailable (Linux dev/CI, a Mac with no Touch ID *and* no login password, an
> `LAError` at probe time), the backend asks the renderer for the app's **existing**
> `confirmDialog()` (`state/confirmDialog.ts:23`) instead. No new dialog component is invented.
>
> **What this sandbox can and cannot prove, established by experiment, not assumption
> ([verified here], §1.6):** a cgo `LocalAuthentication` file cannot be compiled or vetted here at all
> — the same wall P7 hit. A **purego/objc** implementation *can* (`CGO_ENABLED=0 GOOS=darwin
> GOARCH={arm64,amd64} go build`/`go vet` both exit 0 against a real `LAContext`/`NewBlock` sketch),
> and that is a genuinely surprising result worth recording — but D4 still chooses cgo, because
> purego's selectors and block signatures are unchecked strings *everywhere*, including on the Mac,
> while clang checks them against the real framework header on the one machine that matters.
>
> **One incidental gap, closed while here (D10).** `CGO_ENABLED=0 GOOS=darwin go vet` is **already
> broken today** for `internal/secrets` and everything importing it — `keyring_darwin.go:1` is
> `//go:build darwin` but `github.com/keybase/go-keychain` is cgo-only, so `CGO_ENABLED=0` drops the
> library and leaves eight symbols dangling (**[verified here]**). Three build-tag edits and one
> nine-line stub make `internal/{secrets,connections,bridge}` cross-vet green (**[verified here]**,
> exit 0), which is what lets P14's own darwin file be type-checked from here at all. This is P7 D5's
> move, applied to the package P14 actually lands in.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `b2553f6` (`test(ui): the console Format button`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. P1-P13 have landed.

Three prior phases bear directly on this one and are read as current fact, not rediscovered:

- **P25** (`docs/v1/plans/P25-credential-keychain-encryption.md`) established the storage model and
  the `reveal()` never-throws contract (its D9). Its Electron `safeStorage` half is gone; its design
  survived the Go rewrite deliberately (`docs/ARCHITECTURE.md:395-400`).
- **P7** (`docs/v1.1/plans/P7-cpu-memory-status-readout.md` §1.4, D5) is the precedent for
  darwin-only code written in a sandbox with no macOS toolchain, and for the `darwin && !cgo`
  companion that keeps `go vet` honest.
- **P8** (`docs/v1.1/plans/P8-multi-window-correctness.md`, summarised at
  `docs/ARCHITECTURE.md:783-826`) drew the per-window / app-wide line this phase has to sit on.

### 0.2 Scope

1. **Stop revealing on open.** `openEditDialog` no longer calls `connectionsReveal`; the dialog opens
   with `draft.password = null` (= *unchanged*) and an empty, placeholder-labelled field.
2. **The eye button becomes a real action.** *Show password* calls `connectionsReveal`, which is
   gated in Go. Once the plaintext arrives it lives in the draft exactly as it does today, and
   hide/show toggling is free — no second prompt, no second round trip.
3. **The gate itself**: a new `internal/localauth` package. `Authorize(reason)` →
   `granted | cancelled | unavailable`, with a process-wide grace window, a darwin cgo
   implementation over `LAContext`, and a `!darwin || !cgo` companion reporting `unavailable`.
4. **`RevealResult` gains an `outcome` discriminant** and `Reveal` gains its own args struct carrying
   the renderer's `confirmed` flag, used **only** on the OS-auth-unavailable path.
5. **The in-app fallback** is the app's existing `confirmDialog()`, with wording that says what it is.
6. Build-tag repair for `internal/secrets` (D10), so this phase's darwin file is cross-vettable.
7. One `tests/ui/` spec, one Go unit test for the gate's decision table, and doc updates.

### 0.3 Not in this phase

- **Gating anything other than *display*.** `Connect`, `Test` and `Duplicate` all touch the stored
  secret today and keep doing so unprompted — see D2's threat model. P14 gates turning a secret into
  visible text, not using it.
- **A URI-mode reveal.** URI mode has no password field at all (P2 R2, `state/connections.ts:108-114`)
  and this phase does not add one. It does delete the pointless decrypt URI-mode edits perform today.
- **A settings toggle for the gate, or for the grace duration.** One stated policy ships. OQ-3, and
  P17 rewrites the settings dialog's commit model anyway.
- **Invalidating the grace on screen lock or sleep.** OQ-2 — it needs a second darwin observer
  (`com.apple.screenIsLocked` / `NSWorkspaceWillSleepNotification`) that nothing in the tree has, and
  a 5-minute window is short enough that the marginal gain is small. Named, not half-built.
- **Re-authentication for the app as a whole** (an app lock / vault). A different feature with a
  different threat model, and not what the SPEC row asks for.
- **Scrubbing plaintext from renderer memory after a reveal.** The draft must hold the value to save
  it; `closeDialog()` already drops the draft (`state/connections.ts:135-138`). Zeroing JS strings is
  not a thing JS offers, and pretending otherwise would be exactly the stub `AGENTS.md` forbids.
- **Any change to the cipher, the envelope, the keychain item, or the schema.** Nothing about how a
  secret is *stored* moves.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every claim is **[verified in source]** at the cited
  `file:line`, **[verified here]** if it was executed in this container, or explicitly
  **[unverified — needs a real Mac]**. §6.3 lists the third category in one place.
- **The backend is the authority.** The renderer never decides whether a reveal is allowed; it asks,
  and it renders what comes back. A `confirmed: true` from the renderer is honoured *only* when the
  backend has already determined OS auth is unavailable (D6).
- **No new UI primitive.** The confirmation is `confirmDialog()`; the failure message is the dialog's
  existing `connection-save-error` slot (`ConnectionDialog.vue:512-515`); the eye button is the
  `IconButton` already there.
- **All decision logic lives in a `//go:build`-free file** so the Linux test run actually covers it —
  P7 §1.4's rule, and the reason `secrets/cipher.go:123`'s `probe(goos, env, loadKey)` is shaped the
  way it is. The darwin file is mechanical and logic-free.
- **One unit test** (D9). Comments only where the code cannot say it for itself; three are budgeted
  and named in D4, D6 and D10.

---

## 1. What the code does today

### 1.1 The reveal path, end to end

**[verified in source]** Five hops, no gate anywhere on them:

| # | File:line | What happens |
|---|---|---|
| 1 | `project/menus.ts:143` | *Edit…* (and its `tree.rename`/F2 shortcut) → `openEditDialog(row.connectionId)`. The **only** caller — `grep openEditDialog` over `frontend/src` returns this one. |
| 2 | `state/connections.ts:118` | `const { password, error } = await control.connectionsReveal(id)` — unconditional, before the dialog exists. |
| 3 | `bridge/control.ts:158-159` | `unwrap(ConnectionsService.Reveal({ id }))`. |
| 4 | `internal/bridge/connections.go:64-70` | id check, then straight through. |
| 5 | `internal/connections/service.go:346-355` | `Secrets.Get(id)` → cipher decrypt → `RevealResult{Password: …}`. Logs `secret revealed for <id>` at **info** (`:353`) on every *Edit* click, including the URI-mode ones that discard the answer. |

Then `state/connections.ts:126-132` builds the draft with
`password: fields.mode === 'fields' ? password : null` (`:130`).

### 1.2 The eye toggle is client-side only, and the value is already in the DOM

**[verified in source]** `ConnectionDialog.vue`:

- `:81` `const showPassword = ref(false);`
- `:445-451` the `TextField`, `:model-value="draft.password ?? ''"`, `:type="showPassword ? 'text' : 'password'"` (`:447`), `data-testid="connection-password"`.
- `:453-458` the `IconButton`, `:icon="showPassword ? 'eye-closed' : 'eye'"`, `@click="showPassword = !showPassword"` (`:457`).

So the answer to *"is there currently any confirmation at all?"* is **none, and the framing
undersells it**: there is no confirmation on the toggle, and the toggle is not where the secret
crosses the trust boundary. It crossed at step 2 of §1.1.

`App.vue:58` mounts the dialog `v-if="connectionsState.dialog.open"`, so `showPassword` is destroyed
and re-created `false` on every open — the reveal state does not survive a close, and there is
nothing else in the app holding it.

### 1.3 How a secret is actually stored today (P25, as it stands after the Go rewrite)

**[verified in source]**, and consistent with `docs/ARCHITECTURE.md:395-436`:

- One **AES-256-GCM** key, 32 random bytes, held as a single generic-password Keychain item
  (service `Kira Studio Secrets`, account `Kira Studio`) via `github.com/keybase/go-keychain` —
  `internal/secrets/keyring_darwin.go` is the only file that touches the library.
- Values are sealed under a `kira:v2:` base64 envelope in `connections.password`
  (`internal/secrets/cipher.go:21`, `:74-111`). `Decrypt` of a non-enveloped value is an
  `E_SECRET_STORE` error, not a passthrough (`:88-92`) — P25's v1 legacy path is gone.
- `secrets.New()` probes **once** at startup (`cipher.go:39-69`), wired at `main.go:86` and handed to
  the connections service at `main.go:124`. The status never changes for the life of the process.
- The platform switch is a pure function with the OS key source injected —
  `probe(goos, insecureEnv, loadKey)` (`cipher.go:123-140`) — which is exactly why every branch of it
  is testable off its own platform. **This is the shape `internal/localauth` copies.**
- Linux has no keychain: `KIRA_INSECURE_SECRETS=1` gives obfuscation under a hardcoded key
  (`basic_text`), and without it secret storage is *unavailable* (`cipher.go:131-136`).

**So a reveal really is an IPC round-trip into Go that ends in a keychain-derived decrypt** — the
natural, and only correct, place to put an auth check. Gating in the renderer would gate a copy of a
secret the renderer already has.

### 1.4 The three-state password convention, and why "don't reveal on open" is safe

**[verified in source]** `internal/connections/service.go:253`: *"Three-state convention: nil =
unchanged, "" = clear, non-empty = replace."* `Update` only writes the secret when `password != nil`
(`:272-280`), and maps `""` to a `NULL` column. `service_test.go:208-211`'s
`TestPasswordThreeStateConvention` pins it.

The dialog already produces all three states from the field alone: never typing leaves
`draft.password` at whatever `openEditDialog` put there; typing sets a non-empty string
(`ConnectionDialog.vue:450`); clearing the field sets `''`. Today `openEditDialog` seeds it with the
real password, so "never typed" means *replace with the same value*. Seeding `null` instead makes
"never typed" mean *unchanged* — which is what it should have meant, and what **URI mode already
does today** (`state/connections.ts:130` passes `null` for `mode === 'uri'`;
`connections.spec.ts:328` asserts the field is empty in that case and the save still works).

### 1.5 The one real casualty: *Test connection* on an existing connection

**[verified in source]** `ConnectionDialog.vue:186-194`'s `onTest` sends the whole draft;
`Service.Test` resolves the config from that input alone (`service.go:367`, `resolveFromInput(in)`).
With `draft.password = null`, *Test* on an existing fields-mode connection would probe without a
password.

This is not hypothetical breakage invented by P14 — **URI-mode edits already have exactly this
behaviour today**, for exactly the same reason. But "already broken somewhere else" is not a licence
(`AGENTS.md`: no shortcuts), so D3 fixes it properly for both modes rather than extending the wart.

### 1.6 What this sandbox can and cannot do — measured, not assumed

Four experiments, all run here:

```
# 1. cgo, the P7 route — the same wall, unchanged.
$ CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build ./<a LocalAuthentication cgo file>
# runtime/cgo
clang: error: unsupported option '-arch' for target 'x86_64-pc-linux-gnu'

# 2. purego/objc, cgo-free — compiles AND vets, on both darwin arches.
#    (a real sketch: purego.Dlopen of LocalAuthentication.framework, objc.GetClass("LAContext"),
#     Send("alloc")/Send("init"), objc.NewBlock for the reply, Send("evaluatePolicy:localizedReason:reply:"))
$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build ./probe   -> exit 0
$ CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build ./probe   -> exit 0
$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet   ./probe   -> exit 0

# 3. The secrets chain does NOT cross-vet today, for a pre-existing reason.
$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/secrets/
vet: apps/kira-studio/internal/secrets/keyring_darwin.go:39:20: undefined: keychain.NewItem
#   ... and the same for internal/connections and internal/bridge, which import it.

# 4. Three build-tag edits + one stub fix it.
#    keyring_darwin.go   ->  //go:build darwin && cgo
#    keychain_darwin_test.go -> //go:build darwin && cgo
#    new keyring_nocgo_darwin.go (//go:build darwin && !cgo), loadOrCreateKey returns an error
$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet \
    ./apps/kira-studio/internal/secrets/ ./apps/kira-studio/internal/connections/ ./apps/kira-studio/internal/bridge/
-> exit 0
```

**[verified here]** all four. `github.com/ebitengine/purego v0.10.2` is already in `go.mod` as an
indirect dependency (via `gopsutil/v4`), and its `objc` subpackage ships real Objective-C block
support (`objc/objc_block_darwin.go:233-245`, `NewBlock`). `github.com/keybase/go-keychain@v0.0.1`'s
`keychain.go:1-11` is `//go:build darwin` **and** a cgo file, which is precisely why experiment 3
fails.

The reach of experiment 4 is bounded and worth stating: **`internal/shell` can never cross-vet**,
because it is the only package importing `wailsapp/wails/v3/pkg/application` (**[verified here]**,
one `grep`) and Wails' own darwin platform files are cgo. So the vettable set after D10 is
"everything under `internal/` except `shell`", not `./internal/...`.

Consequences this plan is built around, in P7's own words: every line of new darwin code is
**unreviewable by a compiler on a real Mac from here**, so it must be minimal, mechanical, and
separated from anything with logic in it; all decision logic goes in a tag-free file the Linux test
run genuinely covers.

---

## 2. Findings

### F1 — The secret is in the renderer before the user asks, and in the DOM the whole time
§1.1 + §1.2. The eye toggle is a CSS-level mask over a real `value`. Any confirmation attached to the
toggle would be defeated by devtools, by an accessibility client, or by a screenshot of a
`type="text"` field the user forgot to re-mask. This is the finding that decides the whole shape of
the phase (D1).

### F2 — Every *Edit…* click decrypts, even when nothing is shown
**[verified in source]** `state/connections.ts:118` runs before the mode is examined at `:130`, so a
URI-mode connection (whose secret the dialog will never render) is still decrypted, still logged
`secret revealed for <id>` at info (`service.go:353`), and still handed across the bridge. Under D1
that call disappears entirely for URI mode and moves behind the gate for fields mode.

### F3 — `reveal()`'s error is currently reported at the wrong moment
**[verified in source]** P25 D9 routes a decrypt failure into `dialog.error` at open time
(`state/connections.ts:131`), rendered at `ConnectionDialog.vue:512-515`. So a user renaming a
connection whose secret is undecryptable (a `kira.sqlite` restored from another machine, a keychain
reset) is greeted by a decrypt error they did not ask for. Under D1 that message surfaces when they
press *Show password* — the moment it is actually about — and connect-time failures already report it
independently (`ARCHITECTURE.md:426-428`).

### F4 — The three-state convention makes the fix additive, not a rework
§1.4. No schema change, no wire-shape change to `Update`, no migration, and URI mode is the
already-shipped proof that a `null` draft password saves correctly.

### F5 — `Test` is the only caller that genuinely needs the plaintext in the draft
§1.5. `Connect` resolves from storage (`service.go:438`, `resolve(Conns, Secrets, id)`) and never
looks at the draft. `Duplicate` copies the ciphertext column verbatim and never decrypts
(`service.go:307-311`, P25 D11). `Save` is covered by F4. So exactly one call site needs an answer,
and D3 gives it one.

### F6 — macOS's own API for this is `LAContext.evaluatePolicy`, and the policy choice matters
The framework is `LocalAuthentication.framework`; the call is
`-[LAContext evaluatePolicy:localizedReason:reply:]`, asynchronous, answering a
`^(BOOL success, NSError *error)` block. Two policies are candidates:

| Policy | Behaviour on macOS |
|---|---|
| `LAPolicyDeviceOwnerAuthenticationWithBiometrics` | Touch ID **only**. No fallback. Fails outright on a Mac without a Touch ID sensor, on an external keyboard without one, and in a Screen Sharing session. |
| `LAPolicyDeviceOwnerAuthentication` | Touch ID **or** Apple Watch **or** the account password, whichever the machine and the moment allow. The system presents the password field itself. |

`LAContext.canEvaluatePolicy:error:` is the availability probe; it answers `NO` with an `NSError`
whose code distinguishes *no biometry hardware*, *biometry not enrolled*, and *no passcode set*.

**[unverified — needs a real Mac]** the enum's raw integer values (believed
`WithBiometrics = 1`, `DeviceOwnerAuthentication = 2`, from `LAPublicDefines.h`), the exact
`LAError` codes, and everything in F7. D4's cgo shim removes the first of these from the risk list by
construction — it `#import`s the real header and names the constant, so clang resolves it and a wrong
guess cannot compile. That is a substantive reason to prefer cgo here beyond style.

### F7 — Three real-Mac unknowns that could each change the fallback story
**[unverified — needs a real Mac]**, each with a stated consequence rather than an assumption:

1. **Does `evaluatePolicy` work in an ad-hoc-signed app?** `docs/PACKAGING.md:5` and `:190-194`:
   this app ships ad-hoc (`Signature=adhoc`, `TeamIdentifier=not set`), with Developer ID signing
   deferred (`:147-151`). Public reports of `LAError` *"Caller is not Apple signed"* (code -1007) are
   about `LocalAuthenticationView`, a different API, so they do not settle this. **If ad-hoc turns
   out to be rejected, the phase still ships**: the backend reports `unavailable` and the in-app
   confirm is what users see, which is precisely why the fallback is built rather than treated as
   dead code. `docs/PACKAGING.md`'s existing Keychain-ACL paragraph (`:152-157`) is where the answer
   gets recorded.
2. **Threading.** The shim (D4) blocks its calling goroutine on a semaphore while the system sheet is
   up. Wails bound-service calls run on their own goroutines, never the main thread, so this is safe
   — but it must **not** be wrapped in `application.InvokeSync`
   (`wails/v3@v3.0.0-beta.15/pkg/application/mainthread.go:23`), which would dispatch it to the main
   thread and deadlock the UI against its own modal. Stated as a hazard in C3's comment budget.
3. **Presentation.** Whether the sheet attaches to the app's key window or appears as a standalone
   system alert, and whether the app must be frontmost. Cosmetic either way; recorded so nobody
   treats a floating alert as a bug.

### F8 — There is no per-reveal prompt-storm risk, but there is a per-*dialog* one
**[verified in source]** Once the plaintext is in `draft.password`, hide/show is `showPassword`
flipping (`:457`) with no round trip, and Vue re-renders read the same draft — so **a keystroke
cannot trigger an auth prompt**, and neither can a re-render. What *can* prompt repeatedly is the
sequence a user actually performs: open connection A, reveal, close; open connection B, reveal;
reopen A, reveal. Three prompts in thirty seconds. That, not the render path, is what the grace
window in D5 exists for.

### F9 — The app already has an in-app confirmation, and a reason it exists
**[verified in source]** `state/confirmDialog.ts:23`'s `confirmDialog(message, {danger})` returns a
`Promise<boolean>`; `workbench/ConfirmDialog.vue` is mounted once at `App.vue:60`. Its header comment
(`confirmDialog.ts:3-8`) records why it replaced `window.confirm()`. Two views already use it for
destructive actions (`views/keyvalue/KeyValueView.vue:355`, `views/browse/menu.ts:134`). The fallback
path therefore costs one call, not a component.

### F10 — `tests/ui/` can drive the whole thing, because it mocks bound calls by FQN
**[verified in source]** `tests/ui/support/mockRuntime.ts:38-56` maps an `IPC` key to a Go method FQN
(`connectionsReveal: 'ConnectionsService.Reveal'`, `:55`), and `tests/ui/secrets.spec.ts:44-46` is the
worked example of mocking a control channel per-scenario. A new outcome shape is a mocked response,
not new harness machinery — and `secrets.spec.ts`'s own header (`:17-24`) argues that mocking the
status is *better* coverage than branching on the host OS, which applies verbatim here: all four
reveal outcomes run on any OS, in one file.

### F11 — P8's line puts the grant app-wide, and P25's own rationale says the same thing
**[verified in source]** `docs/ARCHITECTURE.md:789-794`: per window = "the tab set and active tab …
and the window's own rectangle"; app-wide = "connections and their live state, settings, the op log,
all three cache tiers, the metrics readout, **the keychain**, pre-connect supervision, and panel
layout". And `:397-400` records why there is one key rather than one item per connection: *"one
keychain item means one authorization decision rather than a prompt per connection"*. A per-window
grant would re-litigate a decision P25 made on purpose. D7.

---

## 3. Checked, and not fired

- **Another surface that displays a stored secret.** `grep` for `password` over `frontend/src` returns
  the dialog field, `state/connections.ts`, and `uri.ts`'s parse/format helpers. *Copy URI* is
  explicitly passwordless for both modes (`project/menus.ts:168-175`, P25 D7); `connectionsList()`
  never carries a password (P1 D9, `service.go:202-204`); the op log stores `command`, not
  credentials. **The connection edit dialog is the only reveal surface in the app.**
- **Gating `Duplicate`.** It copies the ciphertext column and never decrypts (`service.go:307-311`).
  There is nothing to gate.
- **Gating `Connect`/`Test`.** They use the secret without displaying it, exactly as they do today.
  Prompting for Touch ID on every connect would be a different (and much more annoying) feature than
  the SPEC row asks for, and it would not close the gap the row names.
- **Keychain-level `SecAccessControl` / `kSecAccessControlUserPresence` on the key item.** The
  tempting "let the OS gate the key itself" design. It does not fit: the key is loaded **once at
  startup** (`cipher.go:39-40`) and cached in an `aead` for the process's life, so a user-presence
  ACL would prompt once at launch and never again — the opposite of what is wanted — and making it
  prompt per reveal would mean re-reading the keychain item on every secret operation including
  `Connect`. It would also break the Linux fallback's symmetry and the `SecretStore.copy()` property
  P25 D11 bought deliberately.
- **A `security`-CLI or `osascript` shell-out for the prompt.** `osascript -e 'display dialog … with
  hidden answer'` is a password *box*, not an authentication — it validates nothing — and shelling
  out to `security` cannot present Touch ID. Both would be strictly worse than the in-app confirm
  while looking more secure.
- **Doing the OS call from the renderer.** There is no such API in a WebView. `PublicKeyCredential`
  /WebAuthn platform authenticators are a different mechanism with a relying-party model this app has
  no server for, and `WebviewWindowOptions.Permissions` is inert on darwin anyway
  (`docs/ARCHITECTURE.md:891`).
- **A new dependency.** `LocalAuthentication` is an OS framework reached by cgo; `purego` is already
  in the module graph. Either way `go.mod`'s direct-requirement list is unchanged under D4.
- **A migration, a settings row, or a schema change.** Nothing is persisted by this phase — the grant
  is process memory, deliberately (D5).
- **`NOTICES.md`.** Icon assets only (`NOTICES.md:1-3`); a system framework adds no entry.
- **Touching `tests/ui/support/ipcChannels.ts`'s `kira:menu:*` rows.** Same reasoning P13 C4 recorded:
  that table is the legacy channel namespace with no live consumers. The `connectionsReveal` row
  (`:42`) already exists and is what `mockRuntime.ts:55` keys on; nothing new is needed there.

---

## 4. Decisions

**D1 — The gate goes on the IPC round trip, not on the eye toggle; the dialog opens with no secret in
it.** `openEditDialog` drops its `connectionsReveal` call entirely and builds the draft with
`password: null` for both modes. `ConnectionDialog.vue`'s password `TextField` gains
`placeholder="Unchanged — click the eye to reveal"` (the prop exists,
`theme/primitives/TextField.vue:17`), and the eye `IconButton` becomes: **not yet revealed** → an
action that calls `onReveal()`; **revealed** → today's pure `showPassword` toggle. Rationale is F1:
any gate that leaves the plaintext in `draft.password` at open time gates a copy, not the secret.
This is also what makes F2 and F3 go away as side effects rather than as separate work.

**D2 — The threat model, stated once so the scope argues for itself.** P14 defends against **an
unattended unlocked machine, a shoulder-surfer, and a screen share** — someone with the user's
running app in front of them. It does **not** defend against code execution in the renderer or the Go
process (which already hold or can fetch every secret), nor against a stolen disk (P25's at-rest
encryption is that layer). Everything in §3's "not fired" list follows from this line, and stating it
is what keeps a later reviewer from reading `Connect`'s ungated use of the secret as an oversight.

**D3 — *Test connection* resolves the stored secret server-side when the draft carries none.**
`ConnectionsService.Test` takes a new args struct `{ input, id }` (`id` optional, the dialog's
`editingId`), and `Service.Test(in Input, existingID string)` fills `in.Password` from
`Secrets.Get(existingID)` when `in.Password == nil && existingID != ""`. **Not gated** (D2: Test uses
the secret, it never shows it — the same footing as `Connect`). This is strictly better than today
for URI mode too, which currently tests passwordless (§1.5) — the wart is fixed rather than widened.
A missing/undecryptable secret here is not fatal: `Test` already reports failure inside `TestResult`
(`service.go:362-366`) and this path keeps that contract.

**D4 — OS auth is `LAPolicyDeviceOwnerAuthentication`, called through a small synchronous cgo shim.**
Three parts of this decision, each with its own reason:

- **The policy is `DeviceOwnerAuthentication`, not `…WithBiometrics`** (F6). Biometry-only would
  simply not work on a Mac with no Touch ID sensor, on an external keyboard, or over Screen Sharing —
  and the fallback the SPEC row asks for is the *system password*, which is what this policy already
  provides, presented by the OS rather than by us.
- **cgo, not purego** — despite §1.6 proving purego would cross-compile and cross-vet from here.
  Three reasons, in order. (1) purego's selectors, block signatures and enum values are unchecked
  strings and `any`s on **every** platform, including the Mac; cgo's `#import
  <LocalAuthentication/LocalAuthentication.h>` makes clang check all three on the machine that
  actually builds the product, which is the stronger guarantee where it counts — and it removes F6's
  raw-enum-value unknown by construction. (2) The repo already ships `CGO_ENABLED=1` on darwin
  (`build/darwin/Taskfile.yml:54`) because `go-keychain` requires it, so cgo adds no build constraint
  that is not already there. (3) The house pattern exists and is one file away:
  `internal/metrics/probe_darwin.go:1-32` is a `//go:build darwin && cgo` file wrapping a syscall in
  a static C helper with unambiguous out-parameters. **The purego result is recorded in §1.6 anyway**,
  because it is genuinely useful to a future phase and nobody should have to rediscover it.
- **The shim is synchronous and bounded.** `evaluatePolicy` is asynchronous, so the C helper creates
  a `dispatch_semaphore_t`, signals it from the reply block, and waits with a timeout, returning a
  plain `int` — 0 granted, 1 cancelled/denied, 2 unavailable, 3 timed out. That keeps the **Go side a
  single blocking call with no callback lifetime to manage**, which is the whole reason not to hand
  a Go closure to an ObjC block that may fire minutes later. F7 item 2's hazard — never wrap it in
  `application.InvokeSync` — is the one comment this file gets.

**D5 — A process-wide grace window of 5 minutes, on the OS-auth path only.** After a successful
`evaluatePolicy`, `internal/localauth` records a monotonic deadline; a reveal inside it returns
`granted` without prompting. Fixed from the grant, not sliding — a sliding window would let a
half-hour editing session hold one authentication indefinitely. F8 is why it exists: the prompt
storm is per-dialog-open, not per-keystroke, and three prompts in thirty seconds is exactly the
friction that gets a security feature disabled. **The in-app confirm path records no grant**: it is a
deliberate-action gate, not an authentication, and caching it would erase the only thing it does —
while re-asking costs one click. The duration is a named constant with the reasoning in one line, not
a setting (OQ-3).

**D6 — `Reveal` grows an `outcome` discriminant and its own args struct; the backend decides, the
renderer renders.**

```go
// internal/bridge/connections.go
type ConnectionsRevealArgs struct {
    ID string `json:"id"`
    // Honoured ONLY when the backend has itself determined OS authentication is unavailable
    // (D6) — on a Mac where LocalAuthentication works, this field cannot influence anything.
    Confirmed bool `json:"confirmed"`
}

// internal/connections/service.go
type RevealResult struct {
    Password *string `json:"password"`
    Error    *string `json:"error"`
    Outcome  string  `json:"outcome"` // revealed | cancelled | confirmation-required | error
}
```

`Reveal` leaves the shared `ConnectionsIDArgs` (whose own comment, `connections.go:34`, scopes it to
methods "that need nothing but a connection id" — no longer true here). The decision table, which is
the pure function D9 tests:

| Gate state | `confirmed` | Result |
|---|---|---|
| grace grant live | — | decrypt → `revealed` |
| OS auth available, prompt granted | — | record grant, decrypt → `revealed` |
| OS auth available, user cancelled | — | `cancelled`, no password, **no error message** |
| OS auth available, prompt errored | — | `error` + the reason |
| OS auth unavailable | `false` | `confirmation-required`, no password, no decrypt |
| OS auth unavailable | `true` | decrypt → `revealed`, **no grant recorded** (D5) |
| decrypt itself fails | — | `error` + P25's existing wording, unchanged |

P25 D9's never-throws contract is preserved exactly: every row is a returned struct, never a rejected
call. The renderer's `onReveal()` is one `await`, one `switch`, and — for `confirmation-required` —
one `confirmDialog()` (F9) followed by a second call with `confirmed: true`.

**D7 — The grant is app-wide; the *revealed* UI state stays per-window and per-dialog.** F11: P8's own
table already puts the keychain app-wide, and P25 chose one key precisely so there would be one
authorization decision. The OS prompt authenticates the machine's owner, not a workbench — two
windows are one person at one keyboard, and `Reveal` is a plain bound call that carries no window key
today (only menu signals are window-addressed, `ARCHITECTURE.md:815-826`), so a per-window grant would
mean threading a window key through the data path to buy a distinction the user does not perceive.
**What stays per-window is the part that should**: window B's dialog still opens masked with an empty
field and still requires its own explicit *Show password* press — during a live grace that press just
succeeds without a prompt. The action is always deliberate; only the authentication is shared. The
alternative (per-window grants) was rejected on both correctness and precedent: it would prompt a
second time for the same human within seconds of the first, which trains people to dismiss prompts.

**D8 — `internal/localauth` is a new package with the platform switch injected, mirroring
`secrets.probe`.** Four files:

- `localauth.go` — **no build tag.** The `Authorizer` type, the grace bookkeeping, the decision
  table, and `New(now func() time.Time, evaluate func(reason string) Outcome, available func() bool)`.
  Every line of logic lives here so the Linux `go test` genuinely covers it (P7 §1.4's rule).
- `evaluate_darwin.go` — `//go:build darwin && cgo`. The C shim and a ~10-line Go wrapper mapping its
  `int` to an `Outcome`. Mechanical, logic-free.
- `evaluate_other.go` — `//go:build !darwin || !cgo`. Reports unavailable, logs once at startup so a
  build that accidentally ships this way says so out loud rather than silently taking the weak path
  (P7 D5's shape, and `secrets/keyring_other.go:7-11`'s).
- `localauth_test.go` — D9.

`main.go` constructs it beside `secrets.New()` (`main.go:86`) and passes it into `connections.Deps`
(`:124`), which is where `Cipher` already lives.

**D9 — One unit test, for the decision table only.** `AGENTS.md`'s bar: a cgo wrapper and a bound-call
passthrough are plumbing. The gate is a small state machine over *(OS availability, grace deadline,
clock, confirmed flag)* whose wrong answers are silent and security-relevant — a grace that never
expires, a `confirmed` flag honoured while OS auth is available, a cancelled prompt recording a
grant. With `now` and `evaluate` injected (D8) it is a pure table test with no darwin, no clock sleep
and no UI. Cases: first call prompts; second inside the window does not; a call past the deadline
prompts again; a cancelled prompt records nothing and the next call prompts again; `confirmed: true`
is ignored while OS auth is available; `confirmed: true` grants once and records nothing while OS
auth is unavailable. One comment above the file naming the rule it guards, per `AGENTS.md`.

**D10 — Repair the `internal/secrets` build tags in a separate first commit.** `keyring_darwin.go:1`
and `keychain_darwin_test.go:1` become `//go:build darwin && cgo`; a new nine-line
`keyring_nocgo_darwin.go` (`//go:build darwin && !cgo`) returns the same "not available" error
`keyring_other.go:13` already returns, with a comment saying why it exists (P7 D5's comment,
transposed). **[verified here]** this takes `CGO_ENABLED=0 GOOS=darwin go vet` of
`internal/{secrets,connections,bridge}` from three pages of undefined symbols to exit 0. It is
in-scope rather than drive-by cleanup because `internal/localauth` is imported by
`internal/connections`: without it, this phase could not cross-vet its own darwin build at the level
that matters, and §6.1's strongest check would be unavailable. Separate commit, separately
revertible, no behaviour change on any platform this app ships on.

**D11 — Wording, fixed here so it is not invented three times.** The `evaluatePolicy` reason string
(shown by macOS inside its own sheet, which prefixes *"Kira Studio is trying to …"*): **"reveal a
saved connection password."** The in-app confirm: **"Show the saved password for "<name>"? It will be
displayed in plain text."**, `danger: false` (it is not destructive, so it gets the *Continue*
button, `ConfirmDialog.vue:37`). A cancelled OS prompt shows **nothing** — the user cancelled on
purpose and a message would be nagging. A prompt error or a decrypt error goes to the existing
`connection-save-error` slot (`ConnectionDialog.vue:512-515`), which already renders
`connectionsState.dialog.error` and is already cleared on every save attempt (`:213`).

---

## 5. Implementation order

Six commits. C1 is first and separately revertible because it is a build-tag change with no runtime
effect, and it is what makes C2's own verification possible.

### C1 — `build(secrets): tag the Keychain files for cgo so darwin cross-vets again`

D10. Three tag edits, one nine-line stub, no behaviour change. The commit body records the before/after
`CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/{secrets,connections,bridge}/`
output, and notes that `internal/shell` is out of reach for the Wails reason (§1.6).

### C2 — `feat(auth): a local-authentication gate with a grace window`

New `internal/localauth/` per D8: `localauth.go` (tag-free logic), `evaluate_darwin.go`
(`darwin && cgo`, the shim), `evaluate_other.go` (`!darwin || !cgo`). Constructed in `main.go` beside
`secrets.New()` and logged once at startup the way `cipher.go:46-51` logs its own probe. **Nothing
consumes it yet** — the app must behave exactly as before, and the startup log line is the manual
check on both platforms. Ends with `CGO_ENABLED=0 GOOS=darwin go vet ./apps/kira-studio/internal/localauth/`
green (which C1 is not needed for, but which C3 is).

### C3 — `test(unit): the reveal gate's decision table`

D9's single earned test. Placed here rather than after C4 so the gate's rules are pinned before
anything depends on them.

### C4 — `feat(connections): gate a credential reveal behind local authentication`

- `internal/connections/service.go`: `RevealResult.Outcome`; `Reveal(id string, confirmed bool)`
  implementing D6's table against the injected `localauth.Authorizer` (new field on `Deps`, beside
  `Cipher`); `Test(in Input, existingID string)` per D3.
- `internal/bridge/connections.go`: `ConnectionsRevealArgs`, `ConnectionsTestArgs`, and the two
  updated method signatures. `Reveal` keeps its never-errors contract.
- `wails3 generate bindings -b -i -ts` from `apps/kira-studio/` — the method set changed, and
  `AGENTS.md`'s Wails section makes this a prerequisite for the frontend build, not just for `go run`.
- `frontend/src/bridge/control.ts`: `connectionsReveal(id, confirmed)` returning the new shape;
  `connectionsTest(input, id)`.

### C5 — `feat(connections): the edit dialog reveals a password on request, not on open`

- `state/connections.ts`: `openEditDialog` loses the `connectionsReveal` call and builds the draft
  with `password: null` for both modes (D1); its long D9/P2-R2 comment is rewritten to describe what
  the function now does, not what it used to.
- `ConnectionDialog.vue`: a `revealed` ref beside `showPassword` (`:81`); `onReveal()` implementing
  D6's client half — `await control.connectionsReveal(id, false)`, then a `switch` on `outcome`
  (`revealed` → write `draft.password`, set `revealed`/`showPassword`; `cancelled` → nothing;
  `confirmation-required` → `confirmDialog(D11's wording, {danger:false})` and, on `true`, a second
  call with `confirmed: true`; `error` → `connectionsState.dialog.error`). The eye `IconButton`
  (`:453-458`) dispatches to `onReveal()` until `revealed`, then to the existing toggle. The
  `TextField` gains D11's placeholder. `onTest` (`:186-194`) passes `connectionsState.dialog.editingId`.
- The password field is never pre-filled again, in either mode.

### C6 — `test(ui): the credential reveal gate`

§6.1's spec, plus the `docs/` edits, in one commit (P25 D18's convention: the docs change lands with
the code that makes them true):

- `docs/ARCHITECTURE.md`'s Storage section gains one short paragraph after `:436`: a saved credential
  is decrypted for *display* only behind a local-authentication gate, app-wide grace, in-app
  confirmation where the OS prompt is unavailable — and one clause on the multi-window bullet at
  `:791-794` naming the auth grant as app-wide alongside the keychain.
- `docs/PACKAGING.md`'s ad-hoc-signing paragraph (`:152-157`) gains a sentence: whether
  `LAContext.evaluatePolicy` is honoured for an ad-hoc-signed bundle is F7 item 1's open question,
  and the app degrades to the in-app confirm if it is not.
- `AGENTS.md` gains nothing. This is a phase result, and it belongs in this file — its own rule.

---

## 6. Verification

### 6.1 What this sandbox can actually prove

| Check | Command | Covers |
|---|---|---|
| The gate's rules | `go test ./apps/kira-studio/internal/localauth/...` | D9's six cases — grace hit/miss/expiry, cancel-records-nothing, `confirmed` ignored while OS auth is available |
| The service half | `go test ./apps/kira-studio/internal/connections/... ./apps/kira-studio/internal/bridge/...` | D6's outcomes end to end against a fake authorizer, D3's Test fill-from-storage, and `TestPasswordThreeStateConvention` unbroken |
| Nothing else regressed | `go build ./apps/kira-studio/internal/... && go test ./apps/kira-studio/internal/...` | every caller |
| **The darwin build type-checks** | `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/localauth/ ./apps/kira-studio/internal/secrets/ ./apps/kira-studio/internal/connections/ ./apps/kira-studio/internal/bridge/` | green only after C1 + C2's `darwin && !cgo` companion — **[verified here]** that this exact command goes from failing to exit 0 with D10's edits. `internal/shell` is deliberately absent (§1.6). |
| Frontend | `bun run lint`, `bun run typecheck`, `bun run build` | C4/C5 |
| The whole user-visible flow | `bun run test:ui` | §6.1's spec below — **all four outcomes, on Linux, in one process** |
| Linux end to end, real backend | `node node_modules/.bin/playwright test --project=e2e-real` | that a real Go backend with `localauth` reporting *unavailable* still lets a user edit and save a connection (`postgres-real.spec.ts:131` already opens the edit dialog) — i.e. the fallback path is exercised for real, not mocked |

**The `tests/ui/` spec** — new `apps/kira-studio/tests/ui/credential-reveal.spec.ts`, following
`secrets.spec.ts`'s mock-the-status-per-scenario pattern (F10) and its argument for why that beats
branching on the host OS. Five scenarios, each mocking `ConnectionsService.Reveal`'s response:

1. **Opening *Edit…* does not fetch or show the secret.** Open the dialog on an existing fields-mode
   connection and assert `[data-testid="connection-password"]` has value `''`, that its placeholder
   is the D11 text, and — the load-bearing half — that the mocked `Reveal` channel recorded **zero**
   calls. This is F1's guard and the assertion most likely to be deleted by someone who thinks
   pre-filling is a feature, so its comment must say why it exists.
2. **`revealed` fills the field and unmasks it.** Press the eye; assert the field's value is the
   mocked password and its `type` is `text`. Press again (hide) and again (show) and assert the
   `Reveal` channel was still called exactly **once** — F8/D5's no-second-prompt rule, asserted at
   the layer where it is observable.
3. **`cancelled` shows nothing and leaves the field empty.** Assert value `''`, no
   `[data-testid="connection-save-error"]`, and that a *Save* immediately afterwards still succeeds —
   i.e. `null` still means *unchanged* (D1/F4). This is the scenario that proves a cancelled reveal
   cannot silently wipe a stored password.
4. **`confirmation-required` routes through the in-app confirm.** Press the eye; assert
   `[data-testid="confirm-dialog"]` appears with the D11 wording; click
   `[data-testid="confirm-dialog-cancel"]` and assert the field stays empty and no second `Reveal`
   call happened; then repeat, click `[data-testid="confirm-dialog-confirm"]`, and assert the second
   call carried `confirmed: true` and the field filled.
5. **`error` renders in the existing slot.** Assert `[data-testid="connection-save-error"]` shows the
   backend's sentence and the field stays empty.

**What none of this proves:** anything inside `evaluate_darwin.go`. Its C shim will not have been
compiled by anything, anywhere, when the Linux suite goes green — the same statement P7 §7.1 had to
make, and the reason D8 keeps that file mechanical and logic-free.

### 6.2 What must not regress

- `tests/ui/connections.spec.ts` — `:157-165`'s `Reveal` snapshots and `:299-328`'s URI-mode block.
  `:328`'s *"the password field must be empty, not the revealed secret"* assertion for URI mode now
  holds for **both** modes; it should keep passing untouched and its comment gains one clause.
- `tests/ui/interaction.spec.ts:341-345` (F2/rename reveals first) and
  `tests/ui/preconnect.spec.ts:69` — both snapshot `Reveal` because *Edit* used to call it. Under D1 it
  is no longer called on open. **A stale, now-unused control snapshot is not a failure**, so the
  honest move is to delete those two rows rather than leave a mock for a call that cannot happen; if
  either spec fails instead, something else is still revealing on open and that is the bug.
- `tests/ui/secrets.spec.ts` — untouched. The credential-note states are orthogonal to this phase.
- `internal/connections`' existing tests, `TestPasswordThreeStateConvention` above all: it is the
  contract D1 leans its whole weight on.
- `tests/e2e-real/postgres-real.spec.ts` and `mariadb-real.spec.ts` — they fill the password on
  *create* (`:55`, `:66`), which is unaffected, and reopen the dialog at `:131`/`:155`, which now
  opens with an empty field. If either then saves and expects the connection to still work, that is
  the real-backend proof that `null` = *unchanged* survives the round trip.

### 6.3 What a human must run on a real Mac, once

The phase is not fully closed until these are recorded (in this file, per `AGENTS.md`'s rule that a
phase's findings live in its own plan doc). Build with `bun run package` (`CGO_ENABLED=1`, ad-hoc
signed) and launch the bundle.

1. **Does the shim compile at all?** `go build ./apps/kira-studio/internal/localauth/` on the Mac.
   This is the first time clang sees the file, and it is where a wrong selector, a wrong block
   signature or a wrong `LAPolicy` constant is caught (F6). Nothing before this point can catch them.
2. **Does the prompt appear, and is it the right one?** Press *Show password* and confirm a
   **Touch ID** sheet appears **with a "Use Password…" affordance** — i.e. that
   `DeviceOwnerAuthentication` and not the biometrics-only policy is what shipped (D4). Cancel it and
   confirm the field stays empty with no error strip (D6/D11).
3. **F7 item 1 — the ad-hoc signing question, and it is the one that can change the outcome.**
   If `canEvaluatePolicy` answers `NO` or `evaluatePolicy` errors for the ad-hoc bundle, record the
   `LAError` code here and in `docs/PACKAGING.md:152-157`. The app is still correct — it falls back to
   the in-app confirm — but "macOS Touch ID" would then be a Developer-ID-only capability, which is a
   fact the next packaging phase needs.
4. **F7 item 2 — no deadlock.** Press *Show password* and confirm the window still repaints while the
   sheet is up. A frozen UI means the call reached the main thread and the shim's semaphore is
   waiting on the thread that must dismiss it.
5. **The grace window, and D7's multi-window claim.** Reveal in window A; open a second window
   (⇧⌘N), edit a *different* connection, press *Show password*, and confirm it reveals **without** a
   second prompt but **only after** the explicit press. Then wait past five minutes and confirm the
   next press prompts again.
6. **A Mac with no Touch ID** (or an external keyboard): confirm the system password sheet appears
   rather than an outright failure — the other half of D4's policy choice.

### 6.4 Running the rest here

```
go build ./apps/kira-studio/internal/... && go test ./apps/kira-studio/internal/...
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/localauth/ \
  ./apps/kira-studio/internal/secrets/ ./apps/kira-studio/internal/connections/ ./apps/kira-studio/internal/bridge/
cd apps/kira-studio && wails3 generate bindings -b -i -ts && cd -
bun run lint && bun run typecheck && bun run build
bun run test:ui
```

`wails3` and the GTK4/WebKitGTK headers do not persist across containers — re-run `AGENTS.md`'s Wails
setup first, pinning the `go.mod` version, never `@latest`. `bunx playwright install webkit` is needed
before the first `test:ui`. No Docker and no `xvfb` are required by anything in this phase.

---

## 7. Acceptance checklist

1. Opening *Edit…* on a fields-mode connection makes **no** `ConnectionsService.Reveal` call and shows
   an empty, placeholder-labelled password field; saving without touching it leaves the stored
   password unchanged.
2. Pressing the eye calls `Reveal`; a successful reveal fills and unmasks the field, and subsequent
   hide/show toggling makes no further call.
3. On macOS with LocalAuthentication available, a reveal presents the OS prompt
   (`LAPolicyDeviceOwnerAuthentication` — Touch ID with system-password fallback), and a cancel
   reveals nothing and says nothing.
4. A second reveal inside five minutes does not prompt again; one past it does. The grace is process
   memory only — a relaunch always prompts.
5. Where OS authentication is unavailable, the app's existing `confirmDialog()` is what the user
   sees, its cancel reveals nothing, and its confirm reveals **without** recording a grace grant.
6. `confirmed: true` from the renderer is ignored whenever OS authentication is available, and there
   is a test that says so.
7. `RevealResult` still never throws (P25 D9); every outcome is a returned struct.
8. *Test connection* on an existing connection uses the stored secret when the draft carries none —
   in **both** fields and URI mode — and is not itself gated.
9. `internal/localauth` holds all of its logic in a `//go:build`-free file, with a `darwin && cgo`
   implementation and a `!darwin || !cgo` companion that reports unavailable and logs it.
10. `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet` is green for
    `internal/{localauth,secrets,connections,bridge}` — it is not today (§1.6, experiment 3).
11. Exactly one new Go unit test exists (D9's decision table) and one new `tests/ui/` spec (§6.1's
    five scenarios); no other test was added, and the two now-dead `Reveal` snapshots in
    `interaction.spec.ts`/`preconnect.spec.ts` are deleted rather than left mocking an impossible call.
12. `docs/ARCHITECTURE.md`'s Storage and multi-window sections and `docs/PACKAGING.md`'s ad-hoc
    paragraph are true again; `AGENTS.md` is untouched.
13. §6.1's rows are green from this sandbox; §6.3's are recorded here or the phase closes with §6.3
    named as an open item, P7's own closing discipline.

---

## 8. Open questions, handed forward

- **OQ-1 — Should a *successful* reveal be recorded in the op log?** There is a `slog.Info` today
  (`service.go:353`) and nothing user-visible. A per-connection "password last revealed at" would be
  genuinely useful on a shared machine, but the op log is a *connection operations* log
  (`ARCHITECTURE.md:449-450`) and stretching it to cover app-security events is a schema decision
  nobody has asked for. Recorded so it is a choice rather than an omission.
- **OQ-2 — Invalidate the grace on screen lock or sleep.** The correct behaviour, and cheap in
  principle: observe `com.apple.screenIsLocked` on the distributed notification centre, or
  `NSWorkspaceWillSleepNotification`, and zero the deadline. It needs a second darwin observer with a
  callback lifetime — exactly the shape D4 avoided for the prompt itself — so it is not built here.
  Five minutes bounds the exposure meanwhile.
- **OQ-3 — Settings for the gate.** *Require authentication to reveal a password* (on/off) and the
  grace duration are the two knobs users of other clients expect. **For P17**, which rewrites the
  settings dialog's commit model. Note the honest default if it ever becomes a toggle: off is a real
  weakening, so it should be a per-machine convenience with wording that says so, not a neutral
  preference.
- **OQ-4 — The purego route, if the cgo shim ever becomes a liability.** §1.6 proves a cgo-free
  darwin implementation cross-compiles **and** cross-vets from a Linux container, which would make
  every future darwin phase reviewable here rather than only on a Mac. The trade D4 declined is real
  in both directions; if the repo ever wants `CGO_ENABLED=0` darwin builds (or a Linux CI that
  type-checks the shipping build), this is the thread to pull, and `internal/localauth`'s injected
  `evaluate` seam (D8) means only one file changes.
- **OQ-5 — For P17 and P18.** P17 will restage the connection dialog's commit model; the
  `null`-means-unchanged draft this phase depends on is the exact thing an apply-on-save rework can
  break silently, because nothing about it is visible in the UI. P17's plan should re-read D1/F4
  before touching `saveDialog()`.
