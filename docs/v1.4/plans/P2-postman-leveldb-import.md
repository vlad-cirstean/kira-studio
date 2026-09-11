# P2 — Api: import collections from Postman's own local storage

> **What this phase is.** `docs/v1.4/SPEC.md`'s P2 row, turned into concrete steps from one Opus
> research pass (full report kept out of this file per `docs/v1.4/plans/`'s discipline — its
> substance is folded into the sections below). **Session override, this chapter only** (same as
> P1): plan and implementation both done by the orchestrating session directly, not a Sonnet
> implementer subagent — `AGENTS.md`'s own line stays written as-is.

## 0. Scope decision and the one blocking unknown

**Best-effort import when the format is recognized, loud clear failure otherwise — not full
fidelity.** Three reasons, established by research: the source is a signed-in sync cache Postman
may re-shape without notice; Chromium is actively migrating IndexedDB off LevelDB onto SQLite
(phase 2 of that migration is current as of this writing); and the value-decoding layer has an
open-ended tail (Blink host objects, blob-wrapped values, wire-format version skew) whose last 5%
costs far more than the first 95% and can't be verified from this sandbox regardless.

**The blocking unknown, stated plainly: this plan is authored against Postman's own bundled source
code (a real, current build was downloaded and read — exact byte-level formats below are cited from
it, not guessed), never against a real `postman-app` LevelDB directory.** No Postman installation
exists in this environment to produce one. This is the same shape of gap P1 hit with Docker
(`docs/v1.4/plans/P1-test-suite-speed.md` §1/§8) and is handled the same way: build and test
everything that can be verified from documented byte formats and hand-constructed golden fixtures,
gate the one thing that can't behind an opt-in real-store test
(`internal/datagrip/real_test.go`'s `KIRA_DATAGRIP_REAL_PROJECT` convention, mirrored exactly), and
track producing real fixtures as an explicit follow-up (§10) rather than pretend confidence that
isn't earned.

## 1. New package `internal/postmanstore/`, modelled on `internal/datagrip`

Same file-for-file shape as `internal/datagrip` (`configdir.go`/`scan.go`/`errors.go` +
platform-specific keychain-style split where needed):

- `storedir.go` — `postmanUserDataDir()`: `os.UserHomeDir()` + `runtime.GOOS` switch, no third-party
  path-discovery library, matching `configdir.go:28-37` exactly:
  - macOS: `~/Library/Application Support/Postman`
  - Linux: `~/.config/Postman`
  - Windows: **out of scope**, same call `internal/datagrip` already made (D1) and for the same
    reason (§9) — this package's directory lookup returns nothing on `GOOS == "windows"` rather than
    guessing at `%APPDATA%` lock semantics nobody has verified.
- `DiscoverStores(root string) ([]StoreCandidate, error)` — globs `root/IndexedDB/*.indexeddb.leveldb`
  and `root/Partitions/*/IndexedDB/*.indexeddb.leveldb`, keeps only directories that
  `looksLikeLevelDBDir` (contains `CURRENT` and at least one `MANIFEST-*`, the `looksLikeIDEConfigDir`
  analogue), and returns `nil, nil` — not an error — when `root` doesn't exist (`os.IsNotExist`,
  matching `configdir.go:46-51`). Each candidate records which IndexedDB origin it came from
  (`file__0` vs `https_desktop.postman.com_0`) so `Scan` can prefer the populated one.
- `errors.go` — closed `Reason*` enum + `RefusalError{Code, Message}`, one constant per row of §7's
  table below, package doc-comment pointing at this plan the way `datagrip/errors.go:1-8` points at
  its own.

## 2. LevelDB access: copy-then-open, never in place

**Never open Postman's directory in place.** Chromium's own leveldb holds an exclusive `fcntl` lock
on `LOCK` for as long as that origin's IndexedDB backing store is open in a running Postman;
`goleveldb` (the library this phase adds, see below) takes an `flock` instead, which does not
conflict with `fcntl` on Linux/macOS — so it would open successfully *anyway* while Postman is
running, racing a live compaction with no mutual exclusion at all. That's worse than refusing
outright, so:

1. Before touching the directory: check for a running `Postman`/`postman` process via
   `github.com/shirou/gopsutil/v4` (already a direct dependency — `go.mod`). Found → `ReasonStoreInUse`
   up front, no copy attempted.
2. Copy the candidate directory to a fresh `os.MkdirTemp`: `CURRENT`, every `MANIFEST-*`, every
   `*.ldb`/`*.sst`, every `*.log` (the write-ahead journal — recent writes live only there until
   compaction, so an incomplete copy silently loses the newest records). Skip `LOCK`/`LOG*`. Defer
   removal of the temp dir.
3. Open the copy read-only. A "missing sst" / corruption-shaped error on first open → retry the copy
   once (a write mid-copy is possible even past step 1's check) → still failing →
   `ReasonStoreUnreadable`, goleveldb's own message appended.

**Go dependencies, both new to `go.mod`, both pure Go, both permissive-licensed** (clears
`AGENTS.md:92-96`'s bar — no dual license, no gated tier):

- `github.com/syndtr/goleveldb` (BSD-2) — the reader itself. `opt.Options{ReadOnly: true,
  ErrorIfMissing: true, Comparer: indexeddb.Comparer}`.
- `github.com/cions/leveldb-cli/indexeddb` (MIT) — supplies exactly the `idb_cmp1` comparer
  Chromium's manifest names (goleveldb refuses to open a DB whose manifest comparer name doesn't
  match the one passed in `Options`, `leveldb/session.go:193-194`) and a `Prefix()` range helper.
  Its only import beyond stdlib is `goleveldb/leveldb/comparer`.

`golang/snappy` arrives transitively via goleveldb and is reused directly for the
`kCompressedWithSnappy` case in §3.

**Key layout** (from Chromium's own `leveldb_coding_scheme.md`, read during research — cited, not
guessed): a key prefix packs `«databaseId, objectStoreId, indexId»` (one header byte encoding the
three field widths, then the three little-endian integers), followed by a type byte. Global-metadata
keys (`00 00 00` + type `0xC9`) map `(origin, database name)` → database id — look up the entry whose
database name is `postman-app`. Object-store-metadata keys (`«dbId,0,0»` + type `50` + storeId
varint + a metadata-kind byte) give the `name → storeId` map — resolve `collections`, `folders`,
`requests`, `environments`. Object-store data keys are `«dbId, storeId, 1»` + an encoded IDB key
(type byte `1` = String: varint length in UTF-16 units + UTF-16BE bytes, for Postman's own
string-`id` primary keys) — iterate that key range per store.

## 3. Value decoding: Blink envelope → V8 subset → JSON

Every object-store value is a Blink `SerializedScriptValue`, not JSON. Decode in three nested
layers, all byte-format details taken from Chromium/V8 source read during research:

1. **Blink record envelope**: `varint recordVersion` (discard) → byte `0xFF` (else: not an SSV,
   reject as `ReasonRecordUnreadable`) → `varint blinkVersion`. `blinkVersion == 0x11`
   (`kRequiresProcessingSSVPseudoVersion`) means one more tag byte: `0x01 kReplaceWithBlob` (real
   bytes live under the sibling `*.indexeddb.blob/<dbId-hex>/` directory — resolve via the blob-entry
   keys, index id `3` in the same key scheme, then recurse into this same envelope decode on the blob
   bytes) or `0x02 kCompressedWithSnappy` (raw-snappy-decompress the remainder via the already-vendored
   `golang/snappy`, then recurse). Otherwise, `blinkVersion >= 21` means a 13-byte trailer
   (`0xFE` + big-endian offset/length) to skip before the payload starts.
2. **V8 `ValueSerializer` subset**: payload starts `0xFF <varint v8Version>`. Implement exactly the
   tags Postman's plain-data records need — `_`/`0`/`T`/`F` (undefined/null/true/false), `I`/`U`
   (zigzag/plain varint ints), `N` (float64 LE), `S`/`"`/`c` (UTF-8/Latin-1/UTF-16LE strings), `o`…`{`
   (object), `A`…`$` (dense array), `^` (object reference — Dexie records share sub-objects, this one
   is load-bearing, not optional), `D` (date), `\0` (skip). Decode straight into `map[string]any` /
   `[]any` / Go scalars, then `json.Marshal` — no intermediate Postman-shaped struct at this layer.
   `v8Version < 12` uses raw-UTF-8 property keys rather than nested tagged values — branch on it.
3. **Everything else refuses loudly, never partially decodes.** Any tag this package doesn't
   implement (Blink host objects — `\`/`b`/`i`/`f`/`e`/`l`/`L`/`K`/`#`/`g` for Blob/File/CryptoKey/
   ImageData/DOMPoint/… — none of which a `collections`/`folders`/`requests`/`environments` record
   should ever contain per their field shapes in §5) is `ReasonRecordUnreadable` for that one record,
   named by tag byte in the error, caught and counted by the caller (§7's per-record skip, never an
   abort).

## 4. Postman's records are Collection Format v1, denormalized — convert to v2.1 in Go, then reuse `postman.Parse`

**This is the key architectural call.** Postman's own bundle carries `postman-collection-transformer`
(Apache-2.0) whose own predicate, read verbatim from the bundle: `isv1 = e => Boolean(e && e.name &&
e.order && e.requests)`. The five stable object stores (`collections`, `folders`, `requests`,
`environments`, `globals` — untouched across all 57 migrations in the bundle's own migration list)
are Collection Format v1 fields, normalized into separate tables: `order`/`folders_order` (item
ordering), `folder`/`collection` (parent pointers), `dataMode`/`headerData`/`queryParams`/
`pathVariableData` (the v1 request shape). Record shapes, from the bundle's own model definitions:

- `collections`: `id, name, description, auth, events, variables, order[], folders_order[]`
- `folders`: `id, name, description, auth, events, collection, folder(nullable parent), order,
  folders_order`
- `requests`: `id, name, url, description, data, dataOptions, dataMode ∈ {raw, urlencoded, params,
  binary, graphql, null}, headerData[], method, pathVariableData[], queryParams[], auth, events,
  collection, folder(nullable)`
- `environments`: `id, name, values`

Decode into a Go struct mirroring this v1 shape (populated from §3's decoded records, joined
in-memory by `collection`/`folder` id), then convert to a v2.1 document: `dataMode` → `body.mode`
(`params`→`formdata`, `urlencoded`→`urlencoded`, `raw`+`dataOptions`→`body.options.raw.language`,
`graphql`, `binary`), `headerData`→`header[]`, `queryParams`+`pathVariableData`→`url.query`/
`url.variable`, `events`→`event`, `variables`→`variable`, `order`+`folders_order`→ordered nested
`item[]`, `auth`/`protocolProfileBehavior` pass through unchanged.

**Hand the resulting v2.1 JSON bytes to the existing `postman.Parse` (`internal/postman/parse.go:38`)
— do not construct a `*postman.Tree` by hand.** `Parse` already: enforces the 64 MiB cap, gates on
schema version, counts all ten `postman.Warn*` kinds, and captures `Origin` for the `origin_json`
round-trip (v1.2 P4) that a later `Export` of this same collection depends on. Building a `Tree`
directly would either leave `Origin` empty (breaking re-export fidelity) or hand-build it
(duplicating `cloneOrigin` for no reason). This also means the 794-line existing round-trip suite
covers this path for free once the v1→v2.1 bytes are correct — the new code's own test burden is
only "does this package produce correct v2.1 JSON from a v1 document," which is independently
testable with plain JSON fixtures, no LevelDB involved.

## 5. Wire into the existing bridge pipeline

1. **Refactor first, behavior-preserving.** `bridge/collections.go:271-325`'s `Import` currently
   inlines file-open + `postman.Parse` + `ImportTree` + the `ImportVariables` second-commit-with-
   rollback + `ImportReport` assembly in one method. Extract lines 287-325 verbatim into an unexported
   `func (s *CollectionsService) importTree(tree *postman.Tree) (ImportReport, error)`. `Import` calls
   it after its own file-open+`Parse`. No behavior change — this is what makes the postmanstore path
   mechanically share storage, fidelity and the warning report rather than by re-implementing them.
2. **New service, mirroring `DataGripService`** (`internal/bridge/datagrip.go`) rather than folding
   into `CollectionsService` — same two-step `Scan`/`Import` shape, same "only the internal package's
   own typed result crosses the bridge" convention:
   - `PostmanStoreService.Scan() (postmanstore.Preview, error)` — no args (no file chooser at all,
     the whole point of this phase): runs `DiscoverStores` + per-store `Scan`, returns a flat list of
     found collections (name, folder/request counts, `Importable`, `SkipReason` — §7's per-collection
     row, same shape as `datagrip.PreviewRow`).
   - `PostmanStoreService.Import(args {SelectedIDs []string}) (postmanstore.Report, error)` — for
     each selected collection id, produce v2.1 bytes (§4) and call
     `s.Deps.Collections.importTree(...)` (the §5.1 helper) via a small adapter, same shape as
     `datagripCreator` (`datagrip.go:45-52`) keeping `internal/postmanstore` from importing
     `internal/bridge`.
   - Registered in `main.go` beside the existing `DataGripService` registration (`:334`).
3. **New channel**: `ChannelImportPostmanLocal = "kira:menu:import-postman-local"` in
   `internal/bridge/events.go` beside `ChannelImportPostman`/`ChannelImportDataGrip`, mirrored in
   `packages/shared/protocol/events.ts` and `frontend/src/bridge/index.ts`.
4. **New menu item**, `internal/shell/menutemplate.go:53`, directly below today's *"Import Postman
   Collection…"*: *"Import from Postman App…"*. No accelerator (P28 D18's own precedent for these
   import actions).

## 6. Frontend: preview dialog, mirroring `DataGripImportDialog`

New `frontend/src/state/postmanStoreImport.ts`, structurally identical to
`state/datagripImport.ts` but with **no folder picker step** — `control.onImportPostmanLocal(() => {
setMode('api'); void scanPostmanStore(); })` in `App.vue` calls `Scan` directly, no
`filesChooseFolder` round trip, since the whole point of this phase is removing a manual location
step. `scanPostmanStore()`:

- opens the dialog **on both success and failure** — fixing, not copying, `pickAndScanDataGripProject`'s
  known gap (`scanDataGripProject`, `datagripImport.ts:65`, never opens its dialog when the scan
  itself fails, so a failed scan's error is written into an unmounted component and never seen). Add
  `error: string | null` to the new state, render via `<MessageStrip tone="err">` inside a dialog that
  opens regardless of outcome.
- an empty `Preview` (no store found at all, §7 row (a)) renders the same dialog with an explicit
  empty state naming the path(s) searched, not a silent no-op.
- selection defaults: every `Importable` row starts checked, mirroring `initialSelection`
  (`datagripImport.ts:38-46`) — no "already imported" heuristic this phase (collections don't carry
  the stable host/port/database triple `looksAlreadyImported` matches on; a name-based heuristic is
  weaker evidence and is left as a follow-up, §10, not shipped half-working).
- confirm → `PostmanStoreService.Import` → render through the existing `ImportReportStrip.vue`
  per imported collection, same component the file-based path already uses (`CollectionsPanel.vue`).

**Also fix, same pass, since it's the same bug class**: `importCollection()`
(`frontend/src/api/state/collections.ts:577`) has no `try/catch` — a rejection from
`control.collectionsImport` (e.g. `postman.Parse`'s v2.0-schema refusal) currently propagates out of
a `void`-ed promise and is never shown to the user. Add the same `error`-surfacing this phase adds
for the new path.

## 7. Failure modes — closed enum, never a bare error

| Case | Code | Behavior |
|---|---|---|
| No Postman install / no store found | *(not an error)* | `Scan` returns an empty `Preview`. Dialog opens with an explicit "No Postman data was found. Looked in `<path>`." Menu entry is never greyed out — greying it needs an I/O probe at menu-build time, and `menutemplate.go` builds a static template with no I/O today; stays that way. |
| Store found, Postman running / locked | `ReasonStoreInUse` | Detected up front via `gopsutil` process scan (§2 step 1), or from a copy-then-open failure. "Postman is running and writing to its data. Quit Postman and try again," with a Retry action. |
| Directory exists, not a LevelDB dir (e.g. Chromium's newer SQLite IndexedDB backend) | `ReasonStoreFormatUnsupported` | Names what was found. Specifically checks for a SQLite-backed alternative and says so by name rather than a generic "unsupported." |
| LevelDB opens, but no `postman-app` database / no `collections` store inside it | `ReasonNoCollections` | Same empty-state UX as "no store found." |
| Manifest/comparer mismatch, unknown compression tag, corrupt sstable | `ReasonStoreUnreadable` | One retry through the copy (§2 step 3), then goleveldb's own message surfaced. |
| One record fails to decode (unrecognized V8 tag, Blink host object, missing blob file) | *(per-record, not fatal)* | Skip, count, never abort the whole import — same shape as `postman.Parse`'s existing ten `Warn*` counters. Surfaced as "N items could not be read from Postman's store and were skipped." |

## 8. Testing — golden bytes hand-built from the documented format, real-store test opt-in

No real Postman LevelDB directory exists to test against (§0). What's verifiable now, and what
isn't:

1. **`storedir.go`/`DiscoverStores`**: fully testable today — synthetic directories with/without
   `CURRENT`/`MANIFEST-*` markers, `t.TempDir()`-based, no real Postman needed. Matches
   `configdir_test.go`'s own approach.
2. **LevelDB key/prefix decode + V8 subset decode (§2/§3)**: testable via **hand-constructed golden
   byte sequences** written directly from the documented format (the exact byte layouts cited in §2
   and §3 are precise enough to encode by hand or with a small test-only encoder) — commit these
   under `testdata/` the same way `porcelain`'s golden-byte corpus works (`AGENTS.md`'s "several
   interacting rules" bar for a committed corpus applies squarely here: type-byte dispatch, varint
   lengths, nested object-reference tags). This proves the decoder is correct against the *documented*
   format; it does not prove Postman's actual bundled build writes exactly that format with no
   surprises.
3. **v1 → v2.1 conversion (§4)**: fully testable with plain JSON fixtures — a hand-built v1 document
   in, assert the v2.1 document `postman.Parse` accepts and the resulting `Tree` matches expectations.
   No LevelDB involved at all; this is the highest-value test surface since it's the actual behavioral
   contract with the rest of the app.
4. **Real-store verification — explicitly deferred, `internal/datagrip/real_test.go`'s own pattern
   copied exactly**: `postmanstore/real_test.go`'s `TestRealPostmanStore` skips unless
   `KIRA_POSTMAN_REAL_STORE` names a real directory, with a comment stating plainly (as `datagrip`'s
   own does) that nothing else in the suite verifies against a real installation. Producing that real
   fixture — install Postman, create one collection with a folder, a raw-JSON body, a form-data body
   and a header, quit Postman, copy the directory, commit a redacted version under `testdata/` — is
   tracked as a follow-up task (§10), not done as part of this phase's implementation.

## 9. Explicitly out of scope

- **Windows.** Same call `internal/datagrip` already made (D1) and the same reason: this phase's own
  research found the read-only-open-while-locked interaction unverified on Windows (goleveldb's
  share-mode flags vs. Chromium leveldb's own `env_windows.cc`, not independently confirmed), and
  there's no Windows box in this environment to check it on.
- **Blink host objects** (Blob/File/CryptoKey/ImageData/DOMPoint/…, §3 point 3) — refused loudly per
  record, never partially decoded. None of Postman's own record shapes (§4) should produce one; if
  research is wrong about that, the per-record skip-and-count in §7 is the safety net, not a crash.
- **Opening Postman's directory in place** — always copy-then-open (§2); never attempted as an
  optimization even when no running-Postman process is detected, since detection can race a launch.
- **An "already imported" de-dup heuristic** for collections (§6) — `datagrip`'s
  `looksAlreadyImported` has a strong match key (host+port+database); collections don't, and a weak
  name-only heuristic isn't worth shipping half-confident. Every `Importable` row just starts checked.
- **Full-fidelity conversion of every v1 field** — the v1→v2.1 mapping in §4 covers the fields
  Postman's own transformer maps for the record shapes this app's five relevant stores actually carry;
  an exotic v1 field with no v2.1 equivalent is dropped with a counted warning through the existing
  `postman.Warn*` mechanism, the same as the file-based import path already does for its own set of
  lossy cases.

## 10. Follow-ups (not done in this phase)

- Produce and commit a real (redacted) `testdata/` fixture from an actual Postman installation, and
  un-skip a real-store assertion against it — tracked as its own task once an environment with a real
  Postman install is available (mirrors P1's `internal/ipcfixture` merge, deferred for the analogous
  reason: unverifiable without infrastructure this sandbox doesn't have).
- A name-based "looks already imported" heuristic for the Postman-store preview dialog, if it turns
  out to matter in practice once real usage is possible.
- Re-check §0's Chromium SQLite-IndexedDB-backend migration risk against whatever Postman version is
  current when the real-store fixture above gets produced — if a mainstream Postman build has already
  moved off LevelDB by then, `ReasonStoreFormatUnsupported`'s message is this phase's entire answer to
  that user, and a future phase would need a second backend.

## 11. Verification

Fast checks per commit (`go build`, `go vet`, `bun run typecheck`, `bun run lint`), AGENTS.md's
default. Package-level `go test ./internal/postmanstore/...` (golden-byte + v1→v2.1 fixtures from §8)
plus the existing `internal/postman` round-trip suite (unchanged, proving the v2.1-bytes-in path
still produces correct trees) are the phase's real verification — no container tier, no Docker
dependency, unlike P1. `bun run test:ui`/`test:ipc:fe` cover the new dialog's mount/empty-state/
error-state behavior the same way `DataGripImportDialog`'s own specs do today.
