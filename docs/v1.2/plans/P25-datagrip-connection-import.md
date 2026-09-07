# P25 — importing connections (and their passwords) from a DataGrip project

> **Phase:** `docs/v1.2/SPEC.md`'s P25 row — *"DataGrip connection import"*.
> **Branch:** `claude/feature-v1-2`. **Predecessors this plan builds directly on:** none
> functionally — P25 is the most self-contained row in this batch and depends on nothing P22-P24
> landed. It leans on three *existing* subsystems rather than extending them:
> `internal/postman` (the shape of a third-party-format importer in this repo), `internal/secrets`
> + `repos/SecretsRepo` (where a decrypted password has to land), and `bridge.FilesService` /
> `internal/shell`'s `Dialogs` seam (the native picker).
>
> **This is a research-first phase and this plan is written as one.** §1 is longer than usual on
> purpose: every claim about DataGrip's and the IntelliJ Platform's on-disk formats is cited to a
> primary source (JetBrains' own documentation, or the `JetBrains/intellij-community` source
> itself), or — where JetBrains does not document the thing — to real files and to independent
> third-party implementations that agree with each other. §1.10 states plainly what is **not**
> confirmed, and D12 turns each of those into a loud, specific refusal instead of a guess.
>
> **Correction (scope-correction follow-up, landed on top of this phase after it shipped):** D1's
> scope and D4's lookup order below describe a **KEEPASS/file-based fallback that no longer
> exists.** §0.1's user quote is Keychain-only ("*the passwords are decrypted using the keychain
> key for datagrip*"); this plan's own §0.2 read the user's next sentence ("*the keys are stored as
> Intelij platform db and the db uuid*") as also describing `PasswordSafe`'s separate `KEEPASS`
> file backend (`c.kdbx`/`c.pwd`) and built support for it alongside the Keychain path the user
> actually asked for. The user corrected this directly after the phase shipped: only the Keychain
> path was ever wanted. `kdbx.go`, `mainkey.go`, their tests, the `testdata/passwordsafe/` fixtures
> and generator, and the `github.com/tobischo/gokeepasslib/v3` dependency are all deleted;
> `internal/datagrip` now tries exactly one backend (the macOS Keychain), and a project whose
> `security.xml` says `PROVIDER=KEEPASS` gets a named `credential-store-unsupported` refusal
> instead of a KDBX read attempt. **F1-F6, F9-F11 and §1.10 below are unaffected and still
> accurate** (the project-file formats, the credential-key naming, the config-directory discovery,
> and the Keychain query are all unchanged); **F7 and F8 (the `c.pwd`/`c.kdbx` formats) remain
> here as accurate research with no bearing on what is actually built** — they describe real
> formats this app deliberately no longer reads, kept for the historical record rather than scrubbed.
> D1, D4, and the commit table (§3) are corrected in place below with a pointer to this note rather
> than rewritten, so a reader comparing this plan against the tree isn't left wondering why
> `kdbx.go`/`mainkey.go` are cited but absent.

---

## 0. Scope

### 0.1 The item, in the user's own words

> *"Import connections and their passwords from datagrip. I select the folder where is the datagrip
> project from a file picker. It's parsed, and then the passwords are decrypted using the keychain
> key for datagrip. The keys are stored as Intelij platform db and the db uuid."*

That last sentence is not a guess on the user's part — it is an accurate description of the real
mechanism, and the research below confirms it exactly. The IntelliJ Platform names every credential
with `generateServiceName(subsystem, key)`, which formats as
`IntelliJ Platform <subsystem> — <key>`; for a database password the subsystem is `DB` and the key
is the data source's `uuid` from `dataSources.xml` (F4). "Intelij platform db and the db uuid" is
that string, spelled from memory.

### 0.2 What the investigation found, against the row's own premises

The SPEC row's framing is right in outline and wrong in one load-bearing detail:

- **Right:** a DataGrip project's connections live in the project's `.idea/` directory, split
  across `dataSources.xml` (shared: name, uuid, driver, JDBC URL) and `dataSources.local.xml`
  (per-user: username, which secret store was used, the detected DBMS) (F1, F2). Neither ever
  contains a password (F3).
- **Right:** the password is in the IntelliJ Platform `PasswordSafe`, keyed by the data source uuid
  (F4), retrievable with no JetBrains login of any kind — file and OS-keychain reads only.
- **Wrong, and this changes the design:** the row calls the store *"an on-disk 'IntelliJ platform
  db', keyed by a database UUID, encrypted with a locally-held master key"*. That describes exactly
  **one** of `PasswordSafe`'s **three** backends — `KEEPASS`, a real KDBX 3.1 file (`c.kdbx`)
  unlocked by a main key from `c.pwd`. It is **not the default on any platform this app ships to**.
  The default is `KEYCHAIN`: the real macOS Keychain on macOS, and the freedesktop Secret Service
  (gnome-keyring / KWallet, over `libsecret`) on Linux (F5). So "decrypt the on-disk db" is *a*
  path, not *the* path, and a macOS-first implementation must read the **system Keychain** first
  and treat `c.kdbx` as the fallback (D4). That is also what every independent third-party
  implementation found (F9).

The second thing the investigation settles is the **scope boundary** (D1). Three of the four
combinations of {macOS, Linux} × {`KEYCHAIN`, `KEEPASS`} are reachable in pure Go with what this
repo already depends on. The fourth — Linux + `KEYCHAIN` — needs `libsecret` over cgo, which this
repo's own Go code is deliberately free of (`AGENTS.md`: *"the product's own Go code is entirely
cgo-free"*), and lands the decrypted password in a store (`internal/secrets` on Linux) that
**does not exist** unless `KIRA_INSECURE_SECRETS=1` is set. It is out of scope, named as such, and
refused with a specific message rather than half-implemented.

### 0.3 Not in scope, and why

- **Windows.** `PasswordSafe`'s Windows main-key encryption is `CRYPT_32` — the built-in AES layer
  wrapped in DPAPI `CryptProtectData` (F7). This app does not ship on Windows
  (`internal/secrets/status.go`: *"Credential storage is only supported on macOS in this build"*),
  and DPAPI is not reachable from a non-Windows build. Refused by name (D12), not attempted.
- **Linux + the Secret Service backend** (the Linux default). D1. Refused by name with a message
  telling the user how to make the import work anyway (switch DataGrip to *In KeePass* and re-save
  the passwords, which writes `c.kdbx`).
- **`PGP_KEY` main-key encryption.** `c.pwd` can be encrypted to a GPG key (F7); unwrapping it
  needs a `gpg` agent round trip. Detected and refused by name.
- **SSH tunnels, SSL/TLS material, and driver properties.** DataGrip stores SSH tunnel settings
  (`<ssh-properties>`, with their own `PasswordSafe` entries under the `SshConfigPassword` /
  `SshConfigPassphrase` subsystems — F4) and per-driver `<driver-properties>`. This app's
  `model.ConnectionFields` has no representation for either. Not imported; a data source that has
  an enabled SSH tunnel is imported **without** it and the preview says so, because a connection
  that silently drops its tunnel is a connection that silently fails to connect.
- **Export back to DataGrip.** One-directional, unlike `internal/postman`. Nothing in the row asks
  for it and nothing in this app would consume it.
- **DataGrip's own global (IDE-level) data sources.** The row and the user both say *project
  folder*. The IDE-level list lives in `<config>/options/dataSources.xml` under
  `<application><component name="dataSourceStorage">` rather than
  `<project><component name="DataSourceManagerImpl">` (F1); the parser accepts both root shapes
  (they differ by two element names) but only the folder the picker returns is ever read.
- **Deduplicating against previous imports via persisted state.** No new column, and no new
  reserved key inside `options_json` — `options_json` is read by `internal/connections/resolve.go`
  and forwarded into adapter config, so a marker key there is not inert. The preview flags a
  probable re-import by matching name + host + port + database against existing connections
  (D10); nothing is stored.
- **Changing anything about how this app stores its own secrets.** The decrypted DataGrip password
  goes through `connections.Service.Create`, which already encrypts it with
  `internal/secrets.Cipher` and writes it in the same `INSERT` as the row
  (`ConnectionsRepo.InsertWithSecret`). No parallel path (D8).

---

## 1. Findings

Every DataGrip / IntelliJ Platform claim below carries its source. `intellij-community` paths are
relative to `https://github.com/JetBrains/intellij-community/blob/master/`.

### F1 — `.idea/dataSources.xml`: the shared half of a data source

JetBrains documents the location but not the schema: *"settings of all data sources are stored in
the `dataSources.xml` file located in the project directory under the `.idea` subdirectory"*
([Data sources | DataGrip Documentation](https://www.jetbrains.com/help/datagrip/managing-data-sources.html)).
The schema below is read off real files (all four fetched verbatim from public repositories;
see §7):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">
    <data-source source="LOCAL" name="origami" uuid="bc0040bc-5607-4d8d-b870-704efea934be">
      <driver-ref>postgresql</driver-ref>
      <synchronize>true</synchronize>
      <jdbc-driver>org.postgresql.Driver</jdbc-driver>
      <jdbc-url>jdbc:postgresql://localhost:5432/postgres</jdbc-url>
      <working-dir>$ProjectFileDir$</working-dir>
    </data-source>
  </component>
</project>
```

What matters, and what is optional:

- `uuid` (attribute) — **the credential key** (F4). Always present.
- `name` (attribute) — the display name. `group` (attribute) appears when the user filed the source
  under a folder in DataGrip's tree; this app has no connection groups, so it is ignored.
- `<driver-ref>` — the **driver family**, the primary engine signal (F6). Real values observed:
  `postgresql`, `mysql`, `mysql.8`, `mariadb`, `sqlite.xerial`, `clickhouse`, `mongo`, `mongo.4`.
  The convention is `<family>[.<variant>]`, so the family is everything before the first `.`.
- `<jdbc-url>` — host, port and database. May contain IDE **path macros** (`$PROJECT_DIR$`,
  `$ProjectFileDir$`, `$USER_HOME$`): a real captured SQLite source reads
  `jdbc:sqlite:$PROJECT_DIR$/tests/.coverage`.
- `<jdbc-driver>` — the Java driver class (`org.postgresql.Driver`, `com.mysql.cj.jdbc.Driver`,
  `com.dbschema.MongoJdbcDriver`). A third, weaker engine signal.
- `<configured-by-url>true</configured-by-url>` — appears on "URL only" sources. Relevant because
  JetBrains says the password *is* inside the URL in exactly this case (F3).
- `<driver-properties>`, `<libraries>`, `<remarks>`, `<synchronize>`, `<working-dir>`,
  `<imported>` — not imported (§0.3).

The IDE-level variant of the same file wraps the identical `<data-source>` elements in
`<application><component name="dataSourceStorage">` instead. Both root shapes are accepted by the
parser; only the picked project folder is read (§0.3).

### F2 — `.idea/dataSources.local.xml`: the per-user half, including *which* secret store

JetBrains: *"`dataSources.local.xml` … stores user names, SSH, and SSL configurations"*
([Data sources](https://www.jetbrains.com/help/datagrip/managing-data-sources.html)). Real shape,
correlated to `dataSources.xml` **by `uuid`**:

```xml
<project version="4">
  <component name="dataSourceStorageLocal" created-in="PY-243.22562.220">
    <data-source name="origami" uuid="bc0040bc-5607-4d8d-b870-704efea934be">
      <database-info product="PostgreSQL" version="" dbms="POSTGRES" exact-version="0">
        <identifier-quote-string>&quot;</identifier-quote-string>
      </database-info>
      <case-sensitivity plain-identifiers="lower" quoted-identifiers="exact" />
      <secret-storage>master_key</secret-storage>
      <user-name>postgres</user-name>
      <auth-provider>no-auth</auth-provider>
      <schema-mapping>…</schema-mapping>
    </data-source>
  </component>
</project>
```

Three elements are load-bearing for this phase:

- **`<user-name>`** — the connection's username. It is only ever here, never in `dataSources.xml`.
- **`<secret-storage>`** — *whether DataGrip saved the password at all*. Three values observed
  across real files: **`master_key`**, **`memory`**, **`forget`**. These line up one-to-one with
  DataGrip's own per-data-source *Save password* choice (*Forever* / *Until restart* / *Never*):
  only `master_key` means a durable entry was written to `PasswordSafe`. `memory` and `forget` mean
  **there is nothing on disk to find**, and the import must say that rather than report a failed
  decryption. (The value-to-choice mapping is inferred from the names and from which files carry
  which value — it is not documented by JetBrains. It is used only to *explain* a miss, never to
  skip a lookup, so an inference error costs a wording nuance, not a wrong result. D12.)
- **`<database-info dbms="…">`** — DataGrip's own detected DBMS, filled in after a first successful
  connection. Values observed: `POSTGRES`, `MYSQL`, `MARIADB`, `SQLITE`, `MONGO`, `CLICKHOUSE`.
  The strongest engine signal when present, but frequently `dbms` is absent entirely (the attribute
  only appears once the source has connected) — hence the three-signal cascade in F6/D6.

Also useful: `created-in="PY-243.22562.220"` on the `<component>` names the **product and build**
that last wrote the file (`DB` = DataGrip, `IU`/`IC` = IntelliJ IDEA, `PY` = PyCharm, …). D5 uses
it to rank candidate IDE config directories, because a `.idea/` data source may well have been
created by IntelliJ IDEA Ultimate rather than DataGrip, and its password then lives in *that*
product's `PasswordSafe`.

This file is `.gitignore`d in most projects, so it can be **absent**. When it is, the import has a
uuid and a JDBC URL but no username and no `secret-storage` hint; the lookup is attempted anyway.

### F3 — Neither file ever contains the password

JetBrains, on the shared file: *"the resulting XML does not include password information, unless it
was provided within a JDBC URL for the URL only connection type"*
([Data sources](https://www.jetbrains.com/help/datagrip/managing-data-sources.html)). And:
*"DataGrip does not have its own password store. It either uses the native password management
system or KeePass"*
([Passwords | DataGrip Documentation](https://www.jetbrains.com/help/datagrip/reference-ide-settings-password-safe.html)).

The one documented exception is real and worth handling: a `<configured-by-url>true</…>` source can
carry `user:password@host` inside `<jdbc-url>`. D7 covers it (and it is the *only* case where a
password is available with no credential-store access at all).

### F4 — The credential key: `IntelliJ Platform DB — <uuid>`

`platform/credential-store/src/credentialStore/CredentialAttributes.kt`, verbatim:

```kotlin
const val SERVICE_NAME_PREFIX: String = "IntelliJ Platform"

/**
 * … a prefixed human-readable format: `IntelliJ Platform Settings Repository — github.com`,
 * where `IntelliJ Platform` prefix **is mandatory**.
 */
fun generateServiceName(subsystem: String, key: String): String = "${SERVICE_NAME_PREFIX} ${subsystem} — ${key}"
```

The separator is **U+2014 EM DASH** with a regular space on each side. The database subsystem is
`DB` and the key is the data source `uuid`. That last pair is not in `intellij-community` (the
database tooling is closed-source), so it rests on four independent confirmations that all agree
byte for byte:

1. A macOS recipe that predates all of this:
   `security find-generic-password -l "IntelliJ Platform DB — {uuid}" -w`, with the uuid scraped
   out of `.idea/dataSources.xml`
   ([Reveal DataGrip passwords saved in Keychain](https://gist.github.com/EvgeniGordeev/ba93887c08f997b182ca9998a53826be)).
2. `TableProApp/TablePro` (Swift): `"IntelliJ Platform DB \u{2014} \(uuid)"`, with a unit test
   pinning the exact string
   (`TablePro/Core/Services/Export/ForeignApp/JetBrains/JetBrainsCredentialStore.swift`).
3. `t8y2/dbx` (TypeScript):
   ``export function datagripKeychainService(uuid: string) { return `IntelliJ Platform DB — ${uuid}`; }``
   (`apps/desktop/src/lib/imports/datagripImport.ts`).
4. `Lionear/DataTray` (C#): `"DataGrip" => $"IntelliJ Platform DB — {secretRef}"`, with a test
   commented *"Verified against a real DataGrip profile on Fedora 44 + KWallet"*
   (`src/DataTray.Core/Connections/Import/ExternalConnectionImport.cs`).

The same file in (2) also documents the sibling subsystems this phase does **not** use:
`SshConfigPassword` and `SshConfigPassphrase`, keyed `"<host>:<port> <ssh-config-id>"`.

### F5 — `PasswordSafe` has three backends, and the default is *not* the file store

`platform/credential-store-impl/src/credentialStore/PasswordSafeSettings.kt`:

- State component `PasswordSafe`, persisted to **`security.xml`** with `RoamingType.DISABLED`; the
  provider is the `PROVIDER` option tag and the KeePass database path is `keepassDb`.
- `providerType`'s getter: on Windows, `KEYCHAIN` is silently rewritten to `KEEPASS`.
- The default comes from `CredentialStoreManager.getInstance().defaultProvider()`, whose interface
  doc (`platform/credential-store/src/credentialStore/CredentialStoreManager.kt`) says: *"In most
  cases, it is `ProviderType.KEYCHAIN`, but in headless Linux environments it could be something
  else… in headless Linux it is challenging or even impossible to properly configure usage of
  'gnome-keychain', because it requires X11 (via 'libsecret'), so it will be better to exclude
  `ProviderType.KEYCHAIN` from this list."*

DataGrip's own settings page lists the three user-facing choices — *In native Keychain*, *In
KeePass*, *Do not save, forget passwords after restart* — and states the per-OS story: macOS uses
Keychain Access; native Keychain *"is not available for Windows"*; on Linux it depends on the
desktop environment, with GNOME Keyring preferred over KWallet
([Passwords | DataGrip Documentation](https://www.jetbrains.com/help/datagrip/reference-ide-settings-password-safe.html)).

The Linux `KEYCHAIN` implementation is
`platform/credential-store-impl/src/credentialStore/linuxSecretLibrary.kt` —
`SecretCredentialStore`, over `libsecret`'s `secret_password_lookup_sync`, storing the credential
under the attributes `service` (= the F4 service name) and `account`, with the username and
password **joined into one blob** (`joinData`/`splitData`) because *"Secret Service doesn't allow
getting attributes, so, we store joined data"*. Reaching it from Go means cgo + `libsecret`. D1.

**So: `security.xml`'s `PROVIDER` is what says which store to read**, and its absence means the
platform default (`KEYCHAIN` off Windows). `security.xml` is an app-level state storage, so it sits
at `<config>/options/security.xml` by the IDE's own storage convention (this last hop is convention,
not something the annotation itself spells out — D5 treats a missing/unparseable `security.xml` as
"try both stores" rather than as an error, so the convention is never load-bearing).

### F6 — Where the IDE config directory is, and what is in it

JetBrains documents the config directory per OS
([Directories used by the IDE](https://www.jetbrains.com/help/datagrip/directories-used-by-the-ide-to-store-settings-caches-plugins-and-logs.html)):

| OS | Config directory |
|---|---|
| macOS | `~/Library/Application Support/JetBrains/DataGrip<version>` |
| Linux | `~/.config/JetBrains/DataGrip<version>` |
| Windows | `%APPDATA%\JetBrains\DataGrip<version>` |

`<version>` is the marketing version, e.g. `DataGrip2026.2`. Other IntelliJ products use their own
folder name (`IntelliJIdea2025.3`, `PyCharm2025.3`, …) under the same `JetBrains/` parent — which
is why F2's `created-in` product code matters.

The KeePass store sits at the **root** of that directory, not under `options/`
(`platform/credential-store-impl/src/credentialStore/keePass/KeePassCredentialStore.kt`):

```kotlin
const val DB_FILE_NAME: String = "c.kdbx"

fun getDefaultDbFile(): Path = PathManager.getOriginalConfigDir().resolve(DB_FILE_NAME)
fun getDefaultMainPasswordFile(): Path = PathManager.getOriginalConfigDir().resolve(MAIN_KEY_FILE_NAME)
```

and `mainKey.kt`:

```kotlin
internal const val MAIN_KEY_FILE_NAME = "c.pwd"
private const val OLD_MAIN_PASSWORD_FILE_NAME = "pdb.pwd"
```

`security.xml`'s `keepassDb` can relocate `c.kdbx` (the user can point it anywhere); `c.pwd` is
then looked for **next to the `.kdbx`**, which is exactly what `KeePassFileManager.doImportOrUseExisting`
does (*"check the main key file in parent dir of imported file"*).

### F7 — `c.pwd`: a three-line YAML-ish file, AES-CBC under a hardcoded key

`mainKey.kt`'s `MainKeyFileStorage.save` writes, in order:

```
encryption: BUILT_IN
isAutoGenerated: true
value: !!binary <base64 of the encrypted main key>
```

and `load`/`decryptMainKey` reads it back with a SnakeYAML composer that forces every scalar to
`Tag.STR`, reading only the `encryption` and `value` keys (plus `isAutoGenerated` in a second pass).
`encryption` is an `EncryptionType`: `BUILT_IN`, `CRYPT_32`, or `PGP_KEY`
(`platform/credential-store-impl/src/credentialStore/EncryptionSupport.kt`), with
`getDefaultEncryptionType() = if (SystemInfo.isWindows) CRYPT_32 else BUILT_IN`.

`BUILT_IN` is `AesEncryptionSupport` under a **hardcoded 16-byte key**, which the source spells out
byte by byte and which decodes to the ASCII string **`Proxy Config Sec`**:

```kotlin
private val builtInEncryptionKey = SecretKeySpec(byteArrayOf(
  0x50, 0x72, 0x6f, 0x78, 0x79, 0x20,   // "Proxy "
  0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67,   // "Config"
  0x20, 0x53, 0x65, 0x63), "AES")       // " Sec"
```

The cipher is `AES/CBC/PKCS5Padding`, and the blob layout is stated by the code that writes it:

```kotlin
val byteBuffer = ByteBuffer.wrap(ByteArray(4 + iv.size + body.size))
byteBuffer.putInt(iv.size)   // big-endian, java.nio default
byteBuffer.put(iv)
byteBuffer.put(body)
```

i.e. **4-byte big-endian IV length ‖ IV (16 bytes) ‖ ciphertext**. `CRYPT_32` is the same thing
wrapped in Windows DPAPI (`WindowsCryptUtils.protect/unprotect`); `PGP_KEY` is GPG. The legacy
`pdb.pwd` file is the *raw* blob with no YAML wrapper, decrypted with the same built-in key.

The decrypted main key is, when auto-generated, `Base64.getEncoder().withoutPadding().encode(512
random bytes)` (`generateRandomMainKey`) — i.e. ASCII. It can also be a user-typed password.

**The single most important consequence, and the reason this import needs no prompt of any kind:**
when a user sets their own KeePass master password, `KeePassFileManager.askAndSetMainKey` /
`doSetNewMainPassword` still call `mainKeyFileStorage.save(createMainKey(new))` — the typed password
is written into `c.pwd` under the *same* built-in encryption, with `isAutoGenerated: false`. So
`c.pwd` alone always unlocks `c.kdbx`. (`isAutoGenerated` exists only to decide whether to *force*
the user to set a real one when the database is relocated —
`setCustomMainPasswordIfNeeded`.)

### F8 — `c.kdbx` is a stock KDBX 3.1 file with a standard password composite key

`platform/credential-store-impl/src/credentialStore/kdbx/KdbxHeader.kt`:

- Signature `0x9AA2D903` / `0xB54BFB67`; `FILE_VERSION_32 = 0x00030001` — KDBX **3.1**.
- Cipher UUID `31C1F2E6-BF71-4350-BE58-05216AFC5AFF` (AES), *"No other values are known."*
- Compression GZip by default; `transformRounds` default 6000 (AES-KDF); the header carries
  `MAIN_SEED`, `TRANSFORM_SEED`, `ENCRYPTION_IV`, `PROTECTED_STREAM_KEY`, `STREAM_START_BYTES`,
  `INNER_RANDOM_STREAM_ID`.
- A `// todo use kdbx 4` comment confirms 3.1 is still what is written today.

`kdbx.kt` gives the composite key:

```kotlin
internal class KdbxPassword(password: ByteArray) : KeePassCredentials {
  override val key: ByteArray
  init {
    val md = DigestUtil.sha256()
    key = md.digest(md.digest(password))   // sha256(sha256(mainKey))
  }
}
```

That is precisely KeePass's own password-only composite key, `SHA256(SHA256(password))` — so a
stock KDBX library reads this file with no special-casing at all, provided it is given the
`c.pwd` bytes as the password.

The entry layout is in
`platform/credential-store-impl/src/credentialStore/keePass/BaseKeePassCredentialStore.kt`:

```kotlin
internal const val ROOT_GROUP_NAME = SERVICE_NAME_PREFIX   // "IntelliJ Platform"
…
val group = db.rootGroup.getGroup(ROOT_GROUP_NAME) ?: return null
val entry = group.getEntry(attributes.serviceName, userName.nullize()) ?: return null
return Credentials(userName ?: entry.userName, entry.password?.get())
```

So: one group named **`IntelliJ Platform`** directly under the root, one entry per credential whose
**`Title` is the full service name** (`IntelliJ Platform DB — <uuid>`), `UserName` is the account,
and `Password` is the inner-stream-protected value (`kdbxApi.kt`'s `KdbxEntryElementNames`).
`kdbx.kt` also confirms the inner protection is Salsa20 (with the standard
`0xE830094B97205D2A` IV) or ChaCha20 — both of which a KDBX library handles.

### F9 — Prior art: one library worth adopting, and no library for the glue

Searched for something already fully open-source that does either half.

**The KDBX half — a library exists and should be used.**
[`github.com/tobischo/gokeepasslib/v3`](https://github.com/tobischo/gokeepasslib), **MIT**
(`LICENSE.md`: *"The MIT License (MIT) … Copyright (c) 2024 Tobias Schoknecht"*), pure Go, actively
released, dependencies `golang.org/x/crypto` + `github.com/tobischo/argon2` + test-only
`go-cmp`/`testify`. It reads KDBX 3.1, 4.0 and 4.1 (*"Reading works for all of them without passing
an option, since the version is taken from the file itself"*), does the AES-KDF transform and the
Salsa20/ChaCha20 inner-stream unprotection, and — decisively for F8 — exposes `DBCredentials` with
a public `Passphrase []byte` field holding `sha256(password)`, whose `buildCompositeKey()` then
takes `sha256` of it. So `&gokeepasslib.DBCredentials{Passphrase: sha256(mainKeyBytes)[:]}` is
byte-exactly `KdbxPassword`, with **no lossy `[]byte → string` conversion** of a main key that may
not be valid UTF-8. `AGENTS.md`'s library rule is satisfied here rather than argued around: nothing
about KDBX is hand-rolled.

**The IntelliJ-specific glue — nothing exists in Go, and the closest thing is AGPL.** Four
implementations of this exact task were found, none usable as a dependency here:

| Project | Language | License | Covers |
|---|---|---|---|
| `TableProApp/TablePro` | Swift | **AGPL-3.0** | macOS Keychain *and* `c.pwd`/`c.kdbx`; the most complete match to this plan |
| `Lionear/DataTray` | C# | (no SPDX reported by the API) | service-name derivation, Linux Secret Service |
| `t8y2/dbx` | TypeScript | (no SPDX reported by the API) | `dataSources.xml` parse + keychain service name |
| `ChristopherHammond13/JetDecrypt` | Python | — | Windows/DPAPI master-key recovery only |

DBeaver — the obvious place for a ready-made importer — **does not have one**: `dbeaver/dbeaver`
issue [#39035 *"Import connection settings from DataGrip into DBeaver CE"*](https://github.com/dbeaver/dbeaver/issues/39035)
is a feature request, closed without implementation, and it explicitly gives up on passwords
(*"Passwords are intentionally not included in DataGrip exports"* — true of *exports*, not of a
live profile, which is what this phase reads).

So the glue is hand-rolled, and `AGENTS.md` asks for the requirement to be named rather than
"existing code already works": **there is no Go library for the IntelliJ Platform credential-store
layout at all, the only complete implementation is AGPL-3.0 Swift and cannot be vendored into an
MIT repository, and the glue itself is ~150 lines of format-following code** (an XML struct
decode, a three-key text parse, one AES-CBC unwrap, one SHA-256 pair, one keychain query) sitting
on top of the library that does the actual cryptographic heavy lifting. Those four
implementations are used here as *corroboration of the format*, not as source to copy.

### F10 — This app's own side: everything the importer needs already exists

- **Native picker.** `bridge.Dialogs` (`internal/bridge/files.go`) is a two-method seam —
  `SaveFile`, `OpenFile` — implemented over `app.Dialog` in `internal/shell/app.go` and by a
  recorder in `files_test.go`. Wails v3 beta.16's `OpenFileDialogStruct` has
  `CanChooseDirectories(bool)` and `CanChooseFiles(bool)` (`pkg/application/dialogs.go`), so a
  **folder** picker is one more method on the same seam, not a new mechanism.
  `SetOptions` even guards the degenerate case (`if !options.CanChooseFiles && !options.CanChooseDirectories`).
- **The "only the path crosses the bridge" convention.** `api/state/collections.ts`'s
  `importCollection()` calls `control.filesChooseOpen(...)` and then hands *the path* to
  `control.collectionsImport(path)`; Go opens the file. P25 does the same, and here it is a
  security property, not just a size one: the decrypted password never crosses the bridge at all.
- **The write path.** `connections.Service.Create(Input)` validates (`input.go`'s `Validate`),
  encrypts through `secrets.Cipher`, and writes row + ciphertext in **one** statement
  (`ConnectionsRepo.InsertWithSecret` — added by P21 round 3 finding 4 precisely so a
  half-created connection is impossible), then emits `listChanged`. `SecretsRepo` remains the only
  file that touches `connections.password`. Nothing new is needed.
- **The secret-storage status.** `secrets.Status{available, backend, insecureFallback, reason}` is
  already probed once at startup and already rendered by `ConnectionDialog.vue` as a credential
  note; `connectionsState.secretStorage` holds it renderer-side. The import dialog reuses it
  verbatim rather than inventing a second warning.
- **The keychain library.** `github.com/keybase/go-keychain` is already a direct dependency, and
  `internal/secrets/keyring_darwin.go` (build tag `darwin && cgo`, with a `keyring_nocgo_darwin.go`
  and a `keyring_other.go` sibling) already demonstrates the exact query shape needed — `NewItem`,
  `SetSecClass(SecClassGenericPassword)`, `SetService`, `SetMatchLimit(MatchLimitOne)`,
  `SetReturnData(true)`, `QueryItem`. Reading DataGrip's item is the same call with a different
  service name and **no** account constraint. **No new dependency for the macOS path.**
- **The importer shape to copy.** `internal/postman` is one package, parse-first
  (`parse.go` — lenient on read, bounded by `maxCollectionBytes`), with a real `testdata/`
  directory of fixture files and a bridge service that returns an `ImportReport` carrying counted
  `ImportWarning`s that the UI renders (`api/ImportReportStrip.vue`). P25 follows that shape.
- **Connection kinds.** `model.ValidConnectionKind` — `postgres`, `mariadb`, `mysql`, `sqlite`,
  `clickhouse`, `mongodb`, `redis`, `kafka`, `sqs`, `s3`. `DEFAULT_PORT`
  (`packages/shared/domain/connection.ts`) supplies a fallback port per kind. `FILE_KINDS` =
  `{sqlite}`, where `database` holds an **absolute** path (`Validate` rejects a relative one).

### F11 — The macOS Keychain read will prompt, once per item

This is a UX fact with a design consequence, and it is worth stating because nothing in the
JetBrains documentation mentions it. A generic-password item created by DataGrip has DataGrip in
its ACL and Kira Studio is not; `SecItemCopyMatching` from a different binary therefore raises the
system's *"… wants to access key '…' in your keychain"* panel, once per item, with *Allow* /
*Always Allow* / *Deny*. That is correct and desirable behaviour — but it means an import of eight
data sources can raise eight panels, and it means **the scan step must not touch the Keychain at
all**, or the user pays the prompt cost twice for one import. D9.

### 1.10 — What is *not* confirmed, honestly

1. **The `DB` subsystem string is not in any JetBrains source or document.** The database tooling is
   closed-source. It rests on the four independent agreeing implementations in F4 (one of them
   verified by its author against a real profile). Confidence: high, but it is corroboration, not
   primary source.
2. **The `<secret-storage>` value semantics** (`master_key` / `memory` / `forget` → *Forever* /
   *Until restart* / *Never*) are inferred from the names and from which real files carry which
   value. Used only to word a miss (F2). Confidence: medium; blast radius: one sentence of UI copy.
3. **Whether IntelliJ writes Salsa20 or ChaCha20 as the KDBX 3.1 inner random stream.**
   `KdbxHeader.kt` can read both and allocates a 64-byte `protectedStreamKey` *"for ChaCha20"*,
   while stock KDBX 3.1 uses Salsa20. `gokeepasslib` handles Salsa20 for KDBX3 and ChaCha20 for
   KDBX4; a KDBX-3.1-with-ChaCha20 file, if IntelliJ ever writes one, may not decode. Unknown
   without a real capture. D12 makes this a named refusal, not a garbage password.
4. **`security.xml`'s exact path** (`<config>/options/security.xml`) is the IDE's app-level storage
   convention, not something the `@State` annotation states. D5 never depends on it: a missing or
   unparseable `security.xml` means "try both stores", which is the correct behaviour anyway.
5. **Version coverage.** Every source above is `intellij-community`'s `master` as of this plan
   (files carrying 2024-2026 copyright headers). `c.pwd`'s predecessor `pdb.pwd` is still read by
   the current code, so the format has been stable for years — but "works on every DataGrip
   version ever" is not a claim this investigation can make. D2 turns that into an explicit,
   stated scope boundary rather than an implied promise.
6. **No real DataGrip capture was possible in this environment.** DataGrip is commercial
   (trial requires a JetBrains account) and this sandbox has no display. §4.3 says exactly how the
   fixtures are built instead, and §4.5 says what that does and does not prove.

---

## 2. Decisions

### D1 — Scope: macOS Keychain **and** the `c.kdbx`/`c.pwd` file store; Linux Secret Service and Windows are refused by name (F5, §0.3)

> **Corrected by the keychain-only follow-up (see the note at the top of this plan).** The
> `KEEPASS` rows below are no longer this phase's scope — the file-based store was removed per
> explicit user correction. The only backend `internal/datagrip` tries now is the macOS Keychain;
> every other row in the table below is a refusal, including `KEEPASS` itself (as
> `credential-store-unsupported`, not "not found").

| Platform | DataGrip backend | This phase |
|---|---|---|
| macOS | `KEYCHAIN` (default) | **Supported** — `go-keychain`, already a dependency (F10) |
| macOS | `KEEPASS` | **Supported** — `c.pwd` + `c.kdbx`, pure Go (F7, F8) |
| Linux | `KEEPASS` | **Supported** — same pure-Go path; needs `KIRA_INSECURE_SECRETS=1` for the app to store the result at all |
| Linux | `KEYCHAIN` (default) | **Refused by name** — needs `libsecret` over cgo (F5); this repo's Go is cgo-free by design |
| Windows | any | **Refused by name** — `CRYPT_32`/DPAPI (F7); the app does not ship on Windows |

A refused combination still imports the **connection** (host, port, database, username, kind); only
the password is missing, and the row says exactly why, with the one actionable remedy where one
exists (*"set DataGrip's Passwords setting to In KeePass and re-save this password"* for
Linux + Secret Service).

### D2 — The scope boundary is stated as a version claim, in the plan, in the UI's error copy, and in `ARCHITECTURE.md` (§1.10.5)

This phase ships as: **"reads the `DataSourceManagerImpl` / `dataSourceStorageLocal` project files
and the IntelliJ Platform `PasswordSafe` as it exists in `intellij-community` `master` (2024-2026
lineage): `c.pwd` (and legacy `pdb.pwd`) with `BUILT_IN` encryption, `c.kdbx` as KDBX 3.1, and the
macOS Keychain under `IntelliJ Platform DB — <uuid>`."** Not *"DataGrip import"* unqualified.
Everything outside that produces a named refusal (D12), never a silent partial success. This is the
explicitly-versioned first cut the SPEC row's own risk note asks for.

### D3 — One Go package, `internal/datagrip`, shaped like `internal/postman` (F9, F10)

Studio-side, so it does not touch the Api module boundary. Files:

| File | Contents |
|---|---|
| `datasources.go` | `DataSource` struct; parse `dataSources.xml` + `dataSources.local.xml`, correlate by uuid |
| `jdbc.go` | JDBC URL → `{host, port, database}`; IDE path-macro expansion; driver-family → kind |
| `configdir.go` | Candidate IDE config directories; `security.xml`'s `PROVIDER` + `keepassDb` |
| `mainkey.go` | `c.pwd` / `pdb.pwd` parse + `BUILT_IN` unwrap |
| `kdbx.go` | `c.kdbx` via `gokeepasslib`; group/entry lookup by title |
| `keychain_darwin.go` | `//go:build darwin && cgo` — the `go-keychain` query |
| `keychain_other.go` | `//go:build !(darwin && cgo)` — returns the "not supported on this platform" refusal |
| `scan.go` | `Scan(projectDir) (*Preview, error)` |
| `apply.go` | `Apply(preview, selected, creator) Report` |
| `testdata/` | The fixtures of §4.3 |

`Scan` and `Apply` never import `internal/connections`; `Apply` takes a one-method `Creator`
interface (`Create(connections.Input) (model.ConnectionSummary, error)`), the same per-consumer
interface discipline `connections.Backend` and `tree.Backend` already follow. The bridge service
supplies the real `*connections.Service`.

### D4 — Credential lookup order: **Keychain first, KDBX second** (F5, F9)

> **Corrected by the keychain-only follow-up (see the note at the top of this plan).** There is no
> second backend to fall back to any more. `security.xml`'s `PROVIDER` is still read, but only to
> tell "no backend applies because DataGrip explicitly used the file store" (`KEEPASS`) — a real,
> readable-by-DataGrip store this app now declines to read, reported as
> `credential-store-unsupported` — apart from "no backend applies because DataGrip itself never
> saved a password" (`MEMORY_ONLY`/`DO_NOT_STORE`), reported as `password-not-saved`. Every other
> value (`KEYCHAIN`, absent, or unparseable) tries the Keychain and nothing else.

`security.xml`'s `PROVIDER` is read and *believed* when it is present and parses. When it is
absent, unparseable, or says `KEYCHAIN`: try the OS keychain, then fall back to `c.kdbx` if the
files exist. When it says `KEEPASS`: try `c.kdbx` only. When it says `MEMORY_ONLY` (or the
deprecated `DO_NOT_STORE`): skip the lookup and report *"DataGrip is configured not to save
passwords"*. This mirrors the ordering `TablePro` arrived at independently (*"only the 'In KeePass'
mode writes the encrypted `c.kdbx`, so the Keychain is tried first and the KDBX is a fallback"*)
while still honouring an explicit setting when there is one. **(Superseded — see the correction
note above this section.)**

### D5 — The IDE config directory is discovered, ranked, and named in every error (F2, F6)

The picker returns a *project* folder; the credential store lives in an *IDE config* folder, which
the project cannot point at. Discovery:

1. Enumerate `~/Library/Application Support/JetBrains/*` (darwin) or `~/.config/JetBrains/*`
   (linux). Keep entries that are directories containing at least one of `c.kdbx`,
   `options/security.xml`.
2. Rank: (a) product matching `dataSources.local.xml`'s `created-in` prefix (`DB`→`DataGrip`,
   `IU`/`IC`→`IntelliJIdea`, `PY`/`PC`→`PyCharm`, `WS`→`WebStorm`, `PS`→`PhpStorm`,
   `GO`→`GoLand`, `RM`→`RubyMine`, `CL`→`CLion`, `RD`→`Rider`, `DS`→`DataSpell`) first, then
   (b) `DataGrip*`, then (c) everything else; within a group, **descending by folder name**, which
   is descending by version for JetBrains' `<Product><YYYY>.<N>` scheme.
3. Try candidates in order until one yields a credential for the uuid.
4. If none do, the failure message **lists the directories actually searched** — the single most
   useful thing an error can say here.

`keepassDb` from `security.xml` overrides the `c.kdbx` path for that candidate, with `c.pwd` looked
for beside it (F6).

### D6 — Engine mapping: three signals, in order, and an unmapped source is *skipped with its reason shown* (F1, F2, F6)

Cascade, first hit wins:

1. **`<database-info dbms="…">`** from the local file, when present — DataGrip's own answer:
   `POSTGRES`→`postgres`, `MYSQL`→`mysql`, `MARIADB`→`mariadb`, `SQLITE`→`sqlite`,
   `CLICKHOUSE`→`clickhouse`, `MONGO`→`mongodb`, `REDIS`→`redis`.
2. **`<driver-ref>` family** (everything before the first `.`): `postgresql`→`postgres`,
   `mysql`→`mysql`, `mariadb`→`mariadb`, `sqlite`→`sqlite`, `clickhouse`→`clickhouse`,
   `mongo`→`mongodb`, `redis`→`redis`.
3. **`<jdbc-url>` scheme**: `jdbc:postgresql:`, `jdbc:mysql:`, `jdbc:mariadb:`, `jdbc:sqlite:`,
   `jdbc:clickhouse:` / `jdbc:ch:`, `mongodb://` / `mongodb+srv://`, `redis://` / `rediss://`.

Anything else — Oracle, SQL Server, H2, Snowflake, BigQuery, Cassandra, Redshift, CockroachDB,
Greenplum, Hive, DB2, Derby, Exasol, … — is **`unsupported-engine`**: shown in the preview, greyed,
with the driver-ref quoted back (*"DataGrip driver `oracle` — Kira Studio has no Oracle adapter"*),
not checkable, not silently dropped. Postgres-wire-compatible engines are **not** quietly mapped to
`postgres`: this app's `postgres` adapter has its own catalog SQL and capability set, and guessing
here produces a connection that half-works. Kafka, SQS and S3 have no DataGrip counterpart, so
nothing ever maps onto them.

### D7 — Field mapping: always `fields` mode; a URL that yields no host is a skip with a reason

- `host`, `port`, `database` come from the JDBC URL after macro expansion (`$PROJECT_DIR$` and
  `$ProjectFileDir$` → the picked folder; `$USER_HOME$` → `os.UserHomeDir()`). A missing port falls
  back to `DEFAULT_PORT[kind]`; a kind with no default and no port in the URL is a skip.
- **SQLite** (`FILE_KINDS`): `database` is the expanded, **absolute** file path;
  `Input.Validate` rejects a relative one, so a path that does not resolve absolute is a skip
  (`sqlite-path-not-absolute`) rather than a create that fails at the bridge.
- `username` from `<user-name>`; absent is fine (the field is nullable).
- `name` verbatim from the `name` attribute (`Validate` caps it at 120 chars — longer is truncated
  and counted as a warning, not refused).
- `kind` from D6; `color` = the dialog's own `KIND_ACCENT` for that kind, so an imported connection
  looks like a hand-made one; `mode` = `"fields"`; `readOnly` = false; `options` = `{}`;
  `preconnect` = null; `autoExplain` = false; `throttlePerSec` = 0.
- **No `uri` mode.** `canRoundTripToFields` (`packages/shared/domain/uri.ts`) only treats
  `postgres` and plain `mongodb` as round-trippable, and the backend's `buildURIFromFields`
  hardcodes `mongodb://` — so a `mongodb+srv://` or multi-host source cannot survive a trip through
  this app's own fields/URI machinery. Those are skips (`unrepresentable-url`), not half-imports.
- **The `configured-by-url` exception (F3):** when `<configured-by-url>` is true and the JDBC URL
  carries `user:password@` in its userinfo, that password is used directly, no credential store
  touched, and the row is badged *"password came from the JDBC URL"*. `connections.Service.Create`
  already strips a userinfo password out of a URI in `uri` mode — here the strip happens in the
  importer, since the connection is created in `fields` mode.

### D8 — The decrypted password goes through `connections.Service.Create`, and never crosses the bridge (F10)

`Apply` builds a `connections.Input` with `Password` set and calls `Create`, which encrypts with
`secrets.Cipher` and writes row+ciphertext in one `INSERT` (`InsertWithSecret`). Consequences,
all deliberate:

- No new secret path, no new column, no second cipher, and `SecretsRepo`'s "one file touches
  `connections.password`" discipline is untouched.
- If `secrets.Cipher` is unavailable (Linux without `KIRA_INSECURE_SECRETS`, or a Mac whose
  Keychain probe failed), `Create` returns `E_SECRET_STORE` **before** writing anything. The
  importer pre-checks `secrets.Status.Available` once and, when false, imports every selected row
  **without** a password, showing the *existing* credential-note text
  (`internal/secrets/status.go`'s `linuxUnavailableReason` / `darwinUnavailableReason`) once at the
  top of the dialog. Same wording the connection dialog already uses; nothing new to translate.
- Each row is its own `Create`. There is no all-or-nothing transaction across rows, because there is
  no repo API for one and because the rows are genuinely independent — a failure on row 4 does not
  make rows 1-3 wrong. The report says per row what happened.

### D9 — Two steps, and **the scan step never touches the OS keychain** (F11)

`Scan(projectDir)` parses the two XML files, maps engines, resolves fields, locates the config
directory, and reads `security.xml` — **file reads only**. Per data source it reports a
`passwordOutlook` derived from `<secret-storage>` and the resolved provider:
`will-attempt` / `not-saved` / `from-url` / `store-unsupported`. It does **not** pre-verify by
fetching, because on macOS that doubles the number of authorization panels the user sees for one
import (F11), and because a pre-verified "yes" is stale by the time Apply runs anyway.

`Apply(paths, selectedUuids)` re-parses, then fetches and decrypts **once**, at create time. The
plaintext exists only inside `Apply`'s stack, is passed straight into `Create`, and is never placed
in the `Preview`, the `Report`, a log line, or any bridge payload. The `Report` carries a
`passwordImported bool` and, on failure, a reason **code**.

### D10 — The preview is a real review step, and nothing is written before the user confirms

The dialog shows one row per data source: name, engine badge, `host:port/database`, username, a
password-outlook badge, and a checkbox. Rows that cannot be imported are greyed with their reason
and have no checkbox. Rows whose name+host+port+database already match an existing connection are
badged *"looks like it's already imported"* and start **unchecked** (D-§0.3: nothing is persisted to
detect this; it is a live comparison against `connectionsState.records`). Everything else that maps
starts checked. *Import N connections* is the only write.

### D11 — Refusal reasons are a closed enum, rendered by the UI, counted in the report

Mirrors `postman.WarnX` + `bridge.ImportWarning`, which `api/ImportReportStrip.vue` already renders
as *"the import report is part of the feature, not decoration."* The set:

| Code | Meaning |
|---|---|
| `unsupported-engine` | D6 — no adapter for this driver family |
| `unrepresentable-url` | D7 — no host, multi-host, or `mongodb+srv` |
| `sqlite-path-not-absolute` | D7 — macro did not resolve to an absolute path |
| `no-jdbc-url` | the `<data-source>` has neither `<jdbc-url>` nor enough to build one |
| `password-not-saved` | `<secret-storage>` is `memory`/`forget`, or the provider is `MEMORY_ONLY` |
| `password-not-found` | the store was readable; there is no entry for this uuid |
| `credential-store-not-found` | no IDE config directory found — the message lists what was searched (D5) |
| `credential-store-unsupported` | D1/D12 — Linux Secret Service, Windows DPAPI, `PGP_KEY`, an unreadable `c.kdbx` |
| `credential-store-locked` | the OS keychain denied or the user cancelled the panel (F11) |
| `secret-storage-unavailable` | D8 — *this* app cannot store a password on this machine |
| `name-truncated` | D7 — name over 120 chars |
| `ssh-tunnel-dropped` | §0.3 — the source has `<ssh-properties><enabled>true` |

### D12 — Every uncertainty in §1.10 fails loudly, with the version and the file named

Concretely, the implementer writes these as explicit guards, each with its own message — never a
fallthrough, never an empty-string password, never a `_ = err`:

- `c.pwd` `encryption:` is not `BUILT_IN` → *"`c.pwd` in `<dir>` uses `CRYPT_32` encryption
  (Windows DPAPI), which Kira Studio cannot read on this platform."* Likewise `PGP_KEY`.
- The `BUILT_IN` blob's IV length is not 16, or the AES-CBC unpad fails → *"could not decrypt the
  PasswordSafe main key in `<path>` — this DataGrip/IDE version may store it differently."*
- `c.kdbx` fails to decode, or decodes but has no `IntelliJ Platform` group → *"could not read
  `<path>` — unsupported KeePass database version or an unexpected layout for this IDE version."*
  A KDBX decode error is **never** retried with a different key and **never** downgraded to
  "password not found".
- The keychain query returns data that is not valid UTF-8 → *"the stored value for `<name>` is not
  readable text"*, not a mojibake password.
- An entry is found whose password is the empty string → treated as `password-not-found`, since an
  empty password would be indistinguishable from a successful import of a wrong value.

Every one of these leaves the **connection** importable and the **password** missing; none of them
aborts the whole import.

### D13 — The folder picker is one more method on the existing `Dialogs` seam (F10)

`bridge.Dialogs` gains `OpenDirectory(OpenDirectoryRequest{Title}) (string, error)`;
`internal/shell`'s `dialogs` implements it as
`app.Dialog.OpenFile().AttachToWindow(…).CanChooseFiles(false).CanChooseDirectories(true).SetTitle(…).PromptForSingleSelection()`;
`files_test.go`'s recorder implements it too. `FilesService` gains
`ChooseFolder(FilesChooseFolderArgs{Title}) (FilesChooseFolderResult{Canceled, Path})`, following
`ChooseOpen`'s existing `"" means cancelled` convention verbatim. No new service, no new seam.

The dialog additionally accepts a **typed path**, for the case where the user has the project path
in the clipboard, and validates it the same way the picker's result is validated (must be a
directory; must contain `.idea/dataSources.xml`, or *be* a `.idea` directory containing it — both
are accepted, since users routinely navigate one level too deep).

### D14 — Tests: one Go suite, and it is the kind `AGENTS.md` says earns its keep

`AGENTS.md`'s bar exempts almost everything and names *"a parser/splitter with several interacting
rules"*, *"a decision structure too large to hold in your head"*, and *"crypto beyond
encrypt-then-decrypt"*. This phase is all three: a two-file XML correlation, a three-signal engine
cascade with a dozen outcomes, macro expansion, and a two-stage decrypt (AES-CBC unwrap → KDBX
composite key → inner-stream unprotect). So `internal/datagrip` gets a real test suite (§4.2).

What does **not** get a test, per the same bar: the bridge service (a thin pass-through), the
`Dialogs` folder method (a one-line wrapper), and the frontend store's happy path (covered by the
one UI spec in §4.4).

---

## 3. Commit sequence

Fourteen commits. G1-G9 are Go and each is independently green; B1 is the bridge + wiring +
bindings; F1-F2 are frontend; V1-V2 are verification and docs. Order matters in one place: the
credential-store commits (G5-G8) must land before the importer (G9) that calls them.

> **Corrected by the keychain-only follow-up (see the note at the top of this plan).** G5
> (`mainkey.go`), G6 (`kdbx.go` + the `gokeepasslib` dependency), and G8's fixture generator
> (`testdata/passwordsafe/`) are all reverted by that follow-up's own commit(s) — kept below as the
> historical record of what G1-G9 originally built, not as a description of the current tree.

| # | Commit | Contents |
|---|---|---|
| **G1** | `feat(datagrip): parse a DataGrip project's data sources` | `internal/datagrip/datasources.go` — `DataSource`/`Project` types; `encoding/xml` decode of both root shapes (F1); correlate `dataSources.local.xml` by uuid (F2); `created-in` product code; a `maxProjectFileBytes` read bound copied from `postman.Parse`'s reasoning. Plus the `testdata/project-*/` fixtures of §4.3. |
| **G2** | `feat(datagrip): map JDBC URLs and driver families onto connection kinds` | `internal/datagrip/jdbc.go` — macro expansion, `jdbc:` URL → `{host, port, database}`, the D6 three-signal cascade, the D11 skip codes. |
| **G3** | `test(datagrip): the project parser and the engine mapping` | §4.2's first half. Table-driven over the `testdata/project-*` fixtures. |
| **G4** | `feat(datagrip): locate the IntelliJ Platform config directory` | `internal/datagrip/configdir.go` — D5's enumeration and ranking, `security.xml`'s `PROVIDER` + `keepassDb`, and the "directories searched" list that goes into the error. |
| **G5** | `feat(datagrip): decrypt the PasswordSafe main key from c.pwd` | `internal/datagrip/mainkey.go` — the three-key text parse (including a folded/indented `!!binary` block), `BUILT_IN` AES-CBC-PKCS7 under `Proxy Config Sec` with the 4-byte-big-endian-IV-length envelope (F7), legacy `pdb.pwd`, and D12's `CRYPT_32`/`PGP_KEY` refusals. |
| **G6** | `feat(datagrip): read a data source password out of c.kdbx` | `go.mod`: `github.com/tobischo/gokeepasslib/v3`. `internal/datagrip/kdbx.go` — `DBCredentials{Passphrase: sha256(mainKey)}` (F8/F9), find the `IntelliJ Platform` group, entry by `Title`, `UnlockProtectedEntries`, `GetPassword`. D12's decode refusals. |
| **G7** | `feat(datagrip): read a data source password out of the macOS Keychain` | `keychain_darwin.go` (`darwin && cgo`) + `keychain_other.go`, sharing `serviceNameForDataSource(uuid)`. Query by service only, `MatchLimitOne`, `ReturnData` — modelled on `secrets/keyring_darwin.go`'s documented gotchas. Denied/cancelled → `credential-store-locked` (F11), never "not found". |
| **G8** | `test(datagrip): the credential store, end to end, over generated fixtures` | §4.2's second half + the `testdata/passwordsafe/` generator (§4.3), plus the opt-in real-profile test of §4.4.3. |
| **G9** | `feat(datagrip): scan a project and apply the selected data sources` | `scan.go` / `apply.go` — `Preview`, `Report`, the `Creator` seam (D3), D4's lookup order, D9's two-step contract, D8's `secrets.Status` pre-check. |
| **B1** | `feat(bridge): a folder picker and the DataGrip import service` | `Dialogs.OpenDirectory` + `shell` impl + `files_test.go` recorder + `FilesService.ChooseFolder` (D13); `internal/bridge/datagrip.go` (`DataGripService.Scan` / `.Import`); `main.go` registration; `wails3 task common:generate:bindings`; `frontend/src/bridge/index.ts` wrappers. |
| **F1** | `feat(studio): the DataGrip import dialog` | `frontend/src/state/datagripImport.ts` + `frontend/src/project/DataGripImportDialog.vue` (D10) + the `#actions` `IconButton` in `workbench/panels/ProjectPanel.vue`, beside *New connection*. Reuses `DialogFrame`, `MessageStrip`, `Checkbox`, `AppButton`, `EngineIcon` — no new primitives. |
| **F2** | `feat(studio): offer the DataGrip import on first run` | `workbench/panels/StudioStart.vue`'s no-connections block gains a secondary *Import from DataGrip* action beside the existing primary button. One line of state, no new component. |
| **V1** | `test(studio): the import preview, its skips, and what a confirm writes` | `apps/kira-studio/tests/ui/datagrip-import.spec.ts` — §4.4. |
| **V2** | `docs: record what DataGrip and the IntelliJ Platform actually store` | `docs/ARCHITECTURE.md`'s Storage section gains a *DataGrip import* subsection (the formats, the D1 support matrix, the D2 version claim); `NOTICES.md`/`go.mod` note for `gokeepasslib` (MIT); `docs/v1.2/SPEC.md`'s P25 row gets its `Implemented:` summary. |

---

## 4. Verification plan

### 4.1 Fast checks

`bun run lint`, `bun run typecheck`, `bun run build`; `go build ./apps/kira-studio/internal/...`,
`go vet ./apps/kira-studio/internal/...`. **Bindings must be regenerated** at B1 —
`wails3 task common:generate:bindings` via `scripts/setup.sh`, never a hand-typed flag list, and
never without `-names` (`AGENTS.md`'s own warning: a `-names`-less regeneration silently breaks
every `tests/ui/` spec at the first bound call with an error that points nowhere near bindings).

### 4.2 Go — `internal/datagrip` (`bun run test:go`), the cases this phase owes

**Parser and mapping (G3), table-driven over `testdata/project-*`:**

1. A project with six data sources round-trips: uuid, name, driver-ref, jdbc-url, and the
   `<user-name>` / `<secret-storage>` / `dbms` pulled across from the local file by uuid.
2. `dataSources.local.xml` **absent** → six sources, no usernames, `secret-storage` unknown, no
   error.
3. A source present in the local file but not the shared file is ignored (no phantom row).
4. The `<application><component name="dataSourceStorage">` root shape parses identically.
5. Engine cascade: `dbms` wins over `driver-ref` wins over URL scheme; `mysql.8` → `mysql`;
   `sqlite.xerial` → `sqlite`; `mongo.4` → `mongodb`; `oracle` → `unsupported-engine` with the
   driver-ref quoted in the reason.
6. `jdbc:sqlite:$PROJECT_DIR$/db/app.sqlite` expands against the picked folder and is absolute;
   `jdbc:sqlite:relative.db` → `sqlite-path-not-absolute`.
7. `jdbc:postgresql://host/db` with no port → `DEFAULT_PORT.postgres` = 5432.
8. `mongodb+srv://cluster/db` → `unrepresentable-url`; a comma-separated multi-host URL likewise.
9. A `configured-by-url` source with `user:pw@` in the URL yields the password and badges
   `from-url`, and the **stored** connection's fields carry no password remnant.
10. A 400-character name truncates to 120 and emits `name-truncated`.
11. A source with `<ssh-properties><enabled>true` still imports and emits `ssh-tunnel-dropped`.

**Credential store (G8), against `testdata/passwordsafe/`:**

12. `c.pwd` → main key → `c.kdbx` → the password for a known uuid. The end-to-end happy path.
13. Legacy `pdb.pwd` (raw blob, no YAML) is read when `c.pwd` is absent.
14. `c.pwd` with `encryption: CRYPT_32` → `credential-store-unsupported`, message names `CRYPT_32`.
    Same for `PGP_KEY`.
15. `c.pwd` truncated / IV length ≠ 16 / bad padding → the D12 main-key message; **never** a
    `password-not-found`.
16. `c.kdbx` decrypted with the *wrong* main key → the D12 KDBX message, not a fallthrough.
17. `c.kdbx` valid but with no `IntelliJ Platform` group → the D12 layout message.
18. `c.kdbx` valid, group present, no entry for this uuid → `password-not-found` (this is the one
    "clean miss", and it must be distinguishable from all of 14-17).
19. An entry whose password is `""` → `password-not-found` (D12's last bullet).
20. `security.xml` with `PROVIDER` = `MEMORY_ONLY` → `password-not-saved`, and no store is opened
    at all.
21. Config-directory ranking: given `DataGrip2025.3`, `DataGrip2026.1` and `IntelliJIdea2026.1`
    fixtures and a `created-in="IU-…"` hint, `IntelliJIdea2026.1` is tried first; with a
    `created-in="DB-…"` hint, `DataGrip2026.1` then `DataGrip2025.3`.
22. `credential-store-not-found`'s message contains every directory searched (D5.4).
23. `keychain_other.go`'s stub returns `credential-store-unsupported` naming the platform — asserted
    on Linux, which is where CI runs.

**Apply (G9):** 24. `Apply` with a stub `Creator` that records its `connections.Input`s: the
selected rows create in order with the right kind/host/port/database/username/password; an
unselected row creates nothing; a `Creator` error on row 2 of 4 leaves rows 1, 3, 4 created and the
report marking 2 failed. 25. With `secrets.Status.Available == false`, every `Input.Password` is
`nil` and every row carries `secret-storage-unavailable`.

### 4.3 Fixtures: how they are obtained, since DataGrip cannot be installed here

**The XML half is real, redacted.** `testdata/project-*/` is built from the *verbatim shapes* of
real files quoted in F1/F2 — four public repositories' committed `dataSources.xml` /
`dataSources.local.xml` were fetched during this investigation and are cited in §7. Hostnames,
usernames, database names and uuids are replaced; element names, attribute names, nesting, and the
`created-in` build-code format are kept byte-identical. Every fixture header comment names the
element set it was derived from and the source URL.

**The credential half must be generated, and this is stated as a limitation, not hidden.** DataGrip
is commercial (a trial needs a JetBrains account) and this sandbox has no display, so no real
profile can be captured here. Instead, `internal/datagrip/testdata/gen/main.go` (behind
`KIRA_DATAGRIP_FIXTURES=write`, exactly the shape `internal/ipcfixture`'s
`KIRA_IPC_FIXTURES=write` already uses) writes `testdata/passwordsafe/`:

- `c.kdbx` — a **KDBX 3.1** database built with `gokeepasslib.WithDatabaseKDBXVersion3()`, one group
  `IntelliJ Platform`, entries titled `IntelliJ Platform DB — <fixture uuid>` with a `UserName` and
  a `Password`, saved under a known main key.
- `c.pwd` — that main key, AES-CBC-PKCS7-encrypted under `Proxy Config Sec`, wrapped as
  4-byte-big-endian IV length ‖ IV ‖ ciphertext, base64'd, written as the three-line file of F7.
  Plus `c.pwd.crypt32`, `c.pwd.pgp`, `c.pwd.truncated` and `pdb.pwd` variants for cases 13-15.
- `options/security.xml` variants for cases 20-21.

The `c.pwd` side of this is a genuinely independent check — the generator writes the format from
`EncryptionSupport.kt`'s description and the reader parses it from `mainKey.kt`'s description, with
no shared code. The `c.kdbx` side is **not**: writing and reading with the same library cannot prove
compatibility with an IntelliJ-written file. Two mitigations, both cheap:

1. **`keepassxc-cli`, if it is installable in the environment** (`keepassxc-cli ls`
   /`show` against the generated `c.kdbx` with the main key as the password) — an independent
   KDBX implementation confirming the file is a real KDBX 3.1 and that
   `SHA256(SHA256(mainKey))` is the right composite key. Optional; skipped with a note if the
   binary is unavailable.
2. **The opt-in real-profile test of §4.4.3**, for whoever has DataGrip on their own machine.

### 4.4 The rest

**4.4.1 UI (`bun run test:ui`) — `tests/ui/datagrip-import.spec.ts`.** Against
`support/mockRuntime.ts`'s interception layer, with a canned `DataGripService.Scan` payload
covering one importable Postgres source, one `unsupported-engine` Oracle source, one
`password-not-saved` source and one "already imported" match. Asserts: the preview lists all four;
the two unimportable rows are greyed and carry their reason text; the already-imported row starts
unchecked; the confirm button's label counts only checked rows; confirming calls
`DataGripService.Import` with exactly the checked uuids; the report strip renders the returned
counts. Plus the cancel path (no `Import` call) and the
`secretStorage.available === false` banner.

**4.4.2 e2e (`tests/e2e-real/`)** — nothing new. This phase touches no adapter and no engine; a
real-container run would exercise nothing the UI spec and the Go suite do not.

**4.4.3 The real-profile check, opt-in, for a machine that has DataGrip.**
`internal/datagrip/real_test.go`, guarded by `t.Skip` unless `KIRA_DATAGRIP_REAL_PROJECT` (a project
folder) is set: scans it, and asserts that at least one data source resolves a non-empty password.
Never runs in CI, never in this sandbox. **This is the check that would upgrade §1.10's
"format read out of the source" into "verified against a real profile", and the phase should say so
out loud in its handoff rather than imply the synthetic fixtures already did it.**

### 4.5 What is deliberately *not* verified, and what that means

- **That every DataGrip version writes what this reads.** The formats are read out of
  `intellij-community` `master`; `pdb.pwd`'s continued support shows years of stability; but D2's
  version claim is a claim about what was verified, not about what will work. Every unverified path
  is a named refusal (D12), so the failure mode of being wrong is a clear error message, not a
  wrong password.
- **KDBX 3.1 with a ChaCha20 inner stream** (§1.10.3). No fixture can be built for a combination
  that may not exist; if it does exist, `gokeepasslib` will fail to decode and D12 turns that into
  the "unsupported KeePass database version" refusal.
- **The Linux Secret Service and Windows DPAPI paths.** Out of scope by D1; the tests assert the
  *refusal*, not the retrieval.
- **The macOS Keychain authorization panel** (F11). It cannot be driven headlessly and is not
  mocked; `keychain_darwin.go`'s denied/cancelled branch is asserted by shape (the `go-keychain`
  error is mapped to `credential-store-locked`), not by raising a real panel.

---

## 5. What this phase deliberately does not do

- No export to DataGrip, no DBeaver/TablePlus/Sequel Ace import (a second format is a second
  phase; the `internal/datagrip` shape is copyable, not generalisable up front).
- No SSH tunnel, SSL material, or driver-property import (§0.3) — each would need new
  `ConnectionFields` columns, which is a schema phase, not this one.
- No connection *groups*: DataGrip's `group="…"` is dropped, because this app has no such concept
  and inventing one during an import is the wrong place to introduce it.
- No update-in-place of an already-imported connection. The preview flags a likely duplicate and
  starts it unchecked (D10); it never overwrites.
- No change to `internal/secrets`, to the `connections.password` column, or to how this app's own
  passwords are stored, revealed, or gated (D8).
- No new frontend primitive and no new dialog framework — `DialogFrame`, `MessageStrip`, `Checkbox`,
  `AppButton`, `IconButton`, `EngineIcon` already carry this.

---

## 6. Open questions, with their resolutions

**OQ-1 — Should the import read the IDE-level (global) data source list too, since many DataGrip
users keep every connection there rather than per project?** *Resolved: no, this phase.* The user
said "the folder where is the datagrip project" and the row says the same. The parser already
accepts the global file's root shape (F1), so adding a *"…or import the IDE's global data sources"*
entry later is a picker change plus a config-dir path, not a parser change. Recorded so the next
phase does not re-derive the format.

**OQ-2 — Should a Postgres-wire-compatible engine (CockroachDB, Redshift, Greenplum, YugabyteDB)
map onto `postgres`?** *Resolved: no.* D6. This app's `postgres` adapter has its own catalog SQL and
capability probe; a guessed mapping produces a connection that connects and then misbehaves during
introspection, which is worse than an honest skip. Revisit only with a real request and a real
capability check.

**OQ-3 — Should the decrypted password be shown in the preview (masked, revealable) so the user can
confirm it before importing?** *Resolved: no.* It would put plaintext across the bridge and into the
DOM for the whole life of the dialog — exactly what P14 removed from `ConnectionDialog.vue`
(`state/connections.ts`'s own comment: *"that secret was then sitting in the DOM the whole time the
dialog was open"*). The post-import path is already correct: open the connection's edit dialog and
press *Show password*, which goes through `internal/localauth`.

**OQ-4 — What if two DataGrip data sources share a name?** *Resolved: import both, verbatim.* This
app does not require unique connection names (`Validate` checks length only), and renaming on the
user's behalf is a surprise. The preview shows both rows and the duplicate badge of D10 fires on
name+host+port+database, so a genuine duplicate is still visible.

**OQ-5 — Should `Apply` roll back every created connection if one fails?** *Resolved: no.* D8. The
rows are independent; a partial import with a precise report is more useful than losing three good
connections because the fourth had an unreadable password. The report is the mechanism that makes
this honest.

---

## Checklist

- [ ] G1 `datasources.go` — both root shapes, uuid correlation, `created-in`, read bound; `testdata/project-*`
- [ ] G2 `jdbc.go` — macro expansion, URL → fields, the D6 cascade, the D11 codes
- [ ] G3 parser + mapping suite (§4.2 cases 1-11)
- [ ] G4 `configdir.go` — enumeration, D5 ranking, `security.xml` `PROVIDER`/`keepassDb`, searched-dirs list
- [ ] G5 `mainkey.go` — `c.pwd`/`pdb.pwd`, `BUILT_IN` unwrap, `CRYPT_32`/`PGP_KEY` refusals
- [ ] G6 `kdbx.go` + `gokeepasslib` in `go.mod` — `Passphrase: sha256(mainKey)`, group/entry lookup, D12 refusals
- [ ] G7 `keychain_darwin.go` / `keychain_other.go` — service-name derivation, denied ≠ not-found
- [ ] G8 credential-store suite (§4.2 cases 12-23) + `testdata/gen` behind `KIRA_DATAGRIP_FIXTURES=write`
- [ ] G9 `scan.go` / `apply.go` — `Preview`, `Report`, `Creator` seam, D4 order, D9 two-step, D8 pre-check (§4.2 cases 24-25)
- [ ] B1 `Dialogs.OpenDirectory` + `FilesService.ChooseFolder` + `bridge/datagrip.go` + `main.go` + bindings (`-names`) + `bridge/index.ts`
- [ ] F1 `state/datagripImport.ts` + `project/DataGripImportDialog.vue` + `ProjectPanel.vue` action
- [ ] F2 `StudioStart.vue` first-run secondary action
- [ ] V1 `tests/ui/datagrip-import.spec.ts` (§4.4.1)
- [ ] V2 `docs/ARCHITECTURE.md` Storage subsection; `NOTICES.md` for `gokeepasslib` (MIT); `docs/v1.2/SPEC.md` P25 row
- [ ] `bun run lint` / `typecheck` / `build`; `go build` / `go vet` / `bun run test:go`; `bun run test:unit`; `bun run test:ui`
- [ ] The handoff note says plainly that §4.4.3's real-profile check has **not** been run here, and what it would prove

---

## 7. Sources

Repository claims are against the tree at `origin/claude/feature-v1-2` (`593fd26`).

**JetBrains documentation**

- [Data sources | DataGrip Documentation](https://www.jetbrains.com/help/datagrip/managing-data-sources.html) — `.idea/dataSources.xml`, `dataSources.local.xml`, "does not include password information, unless it was provided within a JDBC URL for the URL only connection type"
- [Passwords | DataGrip Documentation](https://www.jetbrains.com/help/datagrip/reference-ide-settings-password-safe.html) — the three provider choices, `c.kdbx`, "DataGrip does not have its own password store", the per-OS story
- [Directories used by the IDE | DataGrip Documentation](https://www.jetbrains.com/help/datagrip/directories-used-by-the-ide-to-store-settings-caches-plugins-and-logs.html) — config directory per OS

**`JetBrains/intellij-community` (Apache-2.0), `master`, all read as raw source during this investigation**

- `platform/credential-store/src/credentialStore/CredentialAttributes.kt` — `SERVICE_NAME_PREFIX`, `generateServiceName` (F4)
- `platform/credential-store/src/credentialStore/CredentialStoreManager.kt` — `defaultProvider()` and the headless-Linux note (F5)
- `platform/credential-store-impl/src/credentialStore/PasswordSafeSettings.kt` — `security.xml`, `PROVIDER`, `keepassDb`, the Windows rewrite (F5)
- `platform/credential-store-impl/src/credentialStore/EncryptionSupport.kt` — `EncryptionType`, `AesEncryptionSupport`, the `Proxy Config Sec` key bytes, the IV-length-prefixed blob layout (F7)
- `platform/credential-store-impl/src/credentialStore/keePass/mainKey.kt` — `MAIN_KEY_FILE_NAME = "c.pwd"`, `pdb.pwd`, the `encryption`/`isAutoGenerated`/`value: !!binary` file (F7)
- `platform/credential-store-impl/src/credentialStore/keePass/KeePassCredentialStore.kt` — `DB_FILE_NAME = "c.kdbx"`, `getDefaultDbFile()`, `generateRandomMainKey` (F6, F7)
- `platform/credential-store-impl/src/credentialStore/keePass/KeePassFileManager.kt` — a user-set main password is still written to `c.pwd`; "check the main key file in parent dir of imported file" (F6, F7)
- `platform/credential-store-impl/src/credentialStore/keePass/BaseKeePassCredentialStore.kt` — `ROOT_GROUP_NAME = SERVICE_NAME_PREFIX`, entry-by-service-name lookup (F8)
- `platform/credential-store-impl/src/credentialStore/kdbx/KdbxHeader.kt` — signatures, `FILE_VERSION_32`, AES cipher UUID, 6000 transform rounds, the `// todo use kdbx 4` (F8)
- `platform/credential-store-impl/src/credentialStore/kdbx/kdbx.kt` — `KdbxPassword` = `sha256(sha256(password))`, Salsa20/ChaCha20 inner streams (F8)
- `platform/credential-store-impl/src/credentialStore/kdbx/kdbxApi.kt` — `Title`/`UserName`/`Password` element names (F8)
- `platform/credential-store-impl/src/credentialStore/linuxSecretLibrary.kt` — `SecretCredentialStore`, `service`/`account` attributes, joined data (F5)

**Real DataGrip/IntelliJ project files, fetched verbatim (the basis for `testdata/project-*`)**

- `wikimedia/mediawiki-vagrant` — `support/idea-dist/dataSources.xml` + `dataSources.local.xml` (`<secret-storage>master_key`, `<ssh-properties>`)
- `origamiphp/source` — `src/Resources/phpstorm/{postgres,mysql,mariadb}/dataSources{,.local}.xml` (`<database-info product="PostgreSQL">`, `<case-sensitivity>`, `<schema-mapping>`)
- `aws-samples/sagemaker-ssh-helper` — `dataSources.xml` + `dataSources.local.xml` (`sqlite.xerial`, `jdbc:sqlite:$PROJECT_DIR$/…`, `<secret-storage>forget`, `created-in="PY-243.22562.220"`, `dbms="SQLITE"`)
- `NovawareRBX/fortune-frenzy` — `.idea/dataSources.xml` (`driver-ref` `mariadb`, `clickhouse`)
- `JamesNurden/java_spring_microservices_app`, `mdevizi-byte/MicroservizioMoto`, `grahamcrowell/idea-intellij-settings` — `mongo` / `mongo.4` driver-refs, `<configured-by-url>`, the `<application><component name="dataSourceStorage">` root shape
- `nbfujx/Goku.WebService`, `hevervie/SystemMonitor`, `xiaobeibi/JavaDemoProjects`, `jacobsen9026/AD-Accounts-Manager` — `<secret-storage>` values `memory` / `forget`, `<auth-provider>no-auth`, `dbms="MYSQL"`

**Independent third-party implementations (corroboration of F4/F7/F8; none vendored)**

- [Reveal DataGrip passwords saved in Keychain](https://gist.github.com/EvgeniGordeev/ba93887c08f997b182ca9998a53826be) — `security find-generic-password -l "IntelliJ Platform DB — {uuid}"`
- `TableProApp/TablePro` — `TablePro/Core/Services/Export/ForeignApp/JetBrains/JetBrainsCredentialStore.swift` and its tests; **AGPL-3.0**, reference only (F9)
- `t8y2/dbx` — `apps/desktop/src/lib/imports/datagripImport.ts`
- `Lionear/DataTray` — `src/DataTray.Core/Connections/Import/ExternalConnectionImport.cs`, `tests/DataTray.Core.Tests/ForeignSecretImportTests.cs`
- [`ChristopherHammond13/JetDecrypt`](https://github.com/ChristopherHammond13/JetDecrypt) — Windows/DPAPI master-key recovery
- [`dbeaver/dbeaver` #39035](https://github.com/dbeaver/dbeaver/issues/39035) — the DataGrip importer DBeaver does **not** have

**The library adopted**

- [`github.com/tobischo/gokeepasslib`](https://github.com/tobischo/gokeepasslib) — `LICENSE.md` (MIT), `README.md` (KDBX 3.1/4.0/4.1 read support), `credentials.go` (`DBCredentials.Passphrase`, `buildCompositeKey`, `cryptAESKey`), `go.mod`

**This repository**

- `AGENTS.md` — the library-adoption rule, the only-fully-open-source rule, the testing bar, the cgo-free note, the bindings `-names` warning, the `KIRA_INSECURE_SECRETS` section
- `docs/ARCHITECTURE.md` — the Storage section (the cipher, the envelope, the per-platform secret-storage story)
- `apps/kira-studio/internal/postman/{parse.go,testdata/}` — the importer shape this phase copies
- `apps/kira-studio/internal/bridge/{files.go,collections.go}`; `apps/kira-studio/internal/shell/app.go` — the `Dialogs` seam, `ChooseOpen`'s cancel convention, `ImportReport`/`ImportWarning`
- `apps/kira-studio/internal/connections/{service.go,input.go}` — `Create`, `Validate`, `stripURIPassword`
- `apps/kira-studio/internal/storage/repos/{connections.go,secrets.go}` — `InsertWithSecret`, `SecretsRepo`'s single-file discipline
- `apps/kira-studio/internal/secrets/{status.go,cipher.go,keyring_darwin.go,keyring_other.go}` — the status shape, the build-tag pattern, the `go-keychain` query and its documented gotchas
- `apps/kira-studio/internal/storage/model/connection.go`; `packages/shared/domain/connection.ts` — `ConnectionFields`, the ten kinds, `DEFAULT_PORT`, `FILE_KINDS`
- `packages/shared/domain/uri.ts` — `canRoundTripToFields` and why `mongodb+srv` is excluded
- `apps/kira-studio/frontend/src/api/state/collections.ts`, `api/ImportReportStrip.vue` — the "only the path crosses the bridge" convention and the report strip this dialog mirrors
- `apps/kira-studio/frontend/src/{state/connections.ts,project/ConnectionDialog.vue,workbench/panels/{ProjectPanel,StudioStart}.vue}` — `secretStorage`, `KIND_ACCENT`, the panel action slot, the first-run block
- `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.16/pkg/application/dialogs.go` — `CanChooseDirectories`, `CanChooseFiles`, `PromptForSingleSelection`
