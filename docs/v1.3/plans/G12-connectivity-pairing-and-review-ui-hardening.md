# G12 — Connectivity, pairing, and review-UI hardening: eleven real defects found by using the shipped `.vsix`

> **What this phase is.** The twelfth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> second "cross-cutting hardening bug batch, not a single clean feature" in it (G8 was the first).
> SPEC's own G12 row lists **eleven numbered items**, every one of them found by installing G10's
> `.vsix` into a real VS Code and pointing it at a running Kira Studio. None is speculative, none is
> upstream-derived, and none is a feature request: each is a defect with a cause somewhere in
> G1–G11's own code.
>
> **In one line: three of the eleven turned out to share a single root cause — the extension never
> reaches `connected` on a freshly paired window because the `ready` frame is dropped — a fourth
> (revoke-then-relist) is a plain `INSERT` against a primary key that already exists, and the
> "open file is broken" item is `vscode.Uri.parse` *throwing* on every virtual document this
> extension has ever minted. All five were reproduced in this container, against real code, and
> the exact output is quoted below.**
>
> **The framing in SPEC's own G12 row is corrected in two places, on evidence, not opinion.** Item 1
> calls the revoke bug "a stale-list bug"; it is not — the list refresh works and is wired end to
> end (F2), the *re-pairing* is what fails, so a refresh button would have papered over a handshake
> that answers `pairingDenied`. Item 2 asks why pairing is "repo-scoped"; it is not repo-scoped
> anywhere in the code (F3) — nothing in the trust store, the broker, or the handshake has ever seen
> a repository — and the per-repo *feel* is items 1 and 5's two bugs plus one real multi-window
> identity race. Both corrections are the point of a planning pass, and both are stated as findings
> with the code cited rather than left for the implementer to rediscover.
>
> **This phase does ship one contract change**, flagged rather than smuggled and since **confirmed**:
> item 8 ("every diff opens in VS Code's native diff view") needs a way to ask for a *two-revision*
> diff, which no existing method can express — `editor.openDiff` takes one `sha`. `CONTRACT_VERSION`
> goes **18 → 19** for exactly one new, extension-answered request (D1, §12.1).
>
> **Revised after review.** All three of §12's calls have been answered, and two of them changed the
> plan rather than confirming it. **Item 9's restyle no longer transcribes Kira Studio's palette**:
> the sidebar takes its *structure* — spacing, layout, panel/toolbar anatomy, control geometry, icon
> usage, the data/UI font law — while every colour keeps deriving from the user's own VS Code theme,
> so light, dark and high-contrast all keep working. D14 is re-derived on that basis (§12.2). **And
> range/hunk-level "mark reviewed" is deferred, not dropped**: G12 ships whole-file marking as an
> explicit interim state, and §11.1 hands a later phase a concrete direction — gutter decorations in
> VS Code's native diff editor, modelled on the built-in Git extension's hunk staging, against the
> `ranges` payload `review.mark` already accepts.
>
> **Tiering is named honestly, per G9/G10's own precedent.** Five items are provable here end to end;
> four are provable only as type/unit checks plus a reasoned argument; two need a human on a Mac
> with a real VS Code and a running Kira Studio. §8 says which is which, per item, and never claims
> more.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`bf534dee`, the whole
of G1–G11 plus the SPEC edit that inserted this phase). Every claim below was checked against source
read, or a command **run in this container**, including G1–G11's own plans, which are records of
intent and are verified against the code they produced rather than trusted.

| Claim | Evidence |
|---|---|
| G11 landed in full; G12 is the tip's next phase | `git log --oneline`: `c650b219`…`eaf146a4`, then `bf534dee` (`docs(v1.3): insert G12…`). `internal/gitreview/` exists; `packages/git-ui/src/components/review/ReviewFilesPane.vue` exists |
| `CONTRACT_VERSION` is **18** in all three hand-maintained places, and they agree | `gitrpc/contract.go:20`, `packages/git-ipc/src/validate.ts:12`, `tests/e2e-real/git-pairing-real.spec.ts:93`. **The G10→17 / G11→18 bumps did *not* skew any consumer** — this was the prompt's first suspect for item 5 and it is clean |
| `bun run typecheck:git` is green | run here, no output |
| `bun run build:vscode` produces both bundles | run here: `dist/ui/assets/webview-CrpcS2ue.js` 270.69 kB, `dist/extension.cjs`, "bundle checks passed" |
| The Vite manifest carries the entry `html.ts` looks for | `dist/ui/.vite/manifest.json` has `apps/kira-studio-vscode/src/webview/main.ts` with its `css` array — F4 of G10's plan still holds |
| A real socket client reaches `ready`, `app.init`, `repo.open`, and streams a **correct** `graph.stream` | probe, §1 F5(d): `chunks=1 rows=12`, `CommitStore.rowCount=12`, row 0 decoded with its three decorations |
| …but only if it does not use `connection.ts`'s own handshake shape | probe, §1 F1: with that shape the client hangs after `paired`, forever |
| `paired` and `ready` arrive in **one** socket read | probe, §1 F1: `one read returned 198 bytes; first frame is 71 bytes; 123 bytes follow it in the SAME read` |
| Re-pairing a revoked client is impossible | probe, §1 F2: `UNIQUE constraint failed: git_clients.id (1555)` → handshake answers `pairingDenied` |
| `vscode.Uri.parse` **throws** on every virtual document key this extension mints | probe, §1 F9, against the real `vscode-uri@3.1.0` VS Code vendors: `[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters ("//")` |
| Nothing in `gitsock`/`gitrpc`/`gitsession` keys trust, cooldown or pairing on a repository | `grep -rn "repo" internal/gitsock/{pairing,handshake,token,clients}.go` (run here) → every hit is the `storage/repos` package name or the word "reported"; no repository path, id or name is read anywhere on the trust path. `GitClientRow` (`storage/repos/gitclients.go:16-24`) has seven columns and none is a repo |
| The *Connected editors* list already refreshes on every trust-store write | `gitsock/server.go:175` (the `ClientsChanged` wiring) (`ClientsChanged: s.notifyClientsChanged`), `:239` (after `Revoke`), `bridge/events.go:107`, `frontend/src/state/gitClients.ts:54` |
| The extension's status-bar item **hides itself unless `connected`** | `extension.ts:78-88` — `if (!enabled || state.kind !== 'connected') { item.hide(); return; }` |
| The webview's whole template is behind `v-if="repoState"` | `packages/git-ui/src/App.vue:956` — a failed `bootstrap()` renders two visually-hidden spans and nothing else |
| `BridgeClient.init()` memoises the **rejection** | `packages/git-ui/src/bridge/client.ts:38-52` — `#initPromise` is assigned once, failure included |
| The webview never opens a repository unless one was persisted | `App.vue:719-728` — `if (persisted.repoId)` is the only `repo.open` call on the boot path |
| The palette command already defaults to the workspace folder; the webview does not | `extension.ts:310` (`workspaceFolders?.[0]?.uri.fsPath`) vs. `NoRepositoryPanel.vue` (a list plus "Open Folder…") |
| Every expanded review row renders its **own** filter box and Tree/Flat toggle | `ReviewCommitRow.vue:136-148` mounts `FileTree`; `FileTree.vue:326-352` is that toolbar |
| The review sidebar renders diffs **inside the webview** | `ReviewView.vue:580-596` (`.kv-review-diff-overlay` + `DiffView`), `ReviewFilesPane.vue:130-140` |
| The Files pane force-disables "Open in editor"/"Go to file" | `ReviewFilesPane.vue:50-53` — an explicit `openInEditor: false, goToFile: false` override |
| `packages/git-ui` derives every colour from `--vscode-*`; Kira Studio has its own fixed `--kira-*` palette + a 1091-line primitives layer | `packages/git-ui/src/theme/vscode-tokens.css` (202 lines) vs. `apps/kira-studio/frontend/src/theme/{tokens,base,primitives}.css` (222/97/1091) |
| The extension icon is a generic black git glyph; Kira Studio's own icon is a 1024×1024 cat mascot | `apps/kira-studio-vscode/resources/icon.png` (128×128, from `0246f8dd`) vs. `apps/kira-studio/build/appicon.png`; vector source at `apps/kira-studio/build/appicon.icon/Assets/kira_icon_vector.svg` |
| There is no `apps/kira-studio-vscode/README.md` | `find apps/kira-studio-vscode -type f` — manifest, `LICENSE`, `src/`, `resources/`, `tsconfig.json`, `.vscodeignore`, and nothing else |
| Wails v3 beta.16's `Window.Focus()` already does `activateIgnoringOtherApps:YES` + `makeKeyAndOrderFront:` on darwin | `pkg/application/webview_window_darwin.go:1100-1113`, reached from `:1196` `focus()` |
| Wails v3 beta.16 ships a real `UNUserNotificationCenter` service | `pkg/services/notifications/notifications_darwin.m:103` — and it refuses to run unbundled (`notifications_darwin.go:66-67`, "notifications require a valid bundle identifier") |
| `main.go` already resolves "the window to act on" and already subscribes to broker events | `main.go:324-330` (`attachDialogs`'s `Current() ?? windows.Any()`), `bridge/events.go:100-110` (`OnPairingChanged`) |
| `vscode.env.machineId` exists in the pinned typings | `node_modules/@types/vscode/index.d.ts:10785`, "A unique identifier for the computer" |
| Toolchain here: Go 1.27.0, git 2.43.0, bun 1.3.11, Python PIL 12.3.0 (for the icon downscale) | run here |

### 0.2 Scope

Eleven items, eleven fixes, and nothing else. The map from SPEC's own numbering to this plan's
findings and decisions — the one table to read before anything else:

| SPEC G12 item | Root cause | Finding | Decision | Tier (§8) |
|---|---|---|---|---|
| **1** Revoke-then-relist | `GitClientsRepo.Insert` is a plain `INSERT`; the revoked row still holds the primary key, so the approved re-pair dies on a UNIQUE violation and answers `pairingDenied`. The list itself is fine | F2 | D3 | **1** |
| **2** Per-repo vs. per-editor pairing | Nothing is repo-scoped, anywhere. The symptom is F1 + F2, plus a real `getOrCreateClientId` race across simultaneously-opened windows | F3 | D4, D18 | **1** (Go/unit) / **3** (the felt symptom) |
| **3** Foreground on the pairing dialog | Never implemented — nothing calls any window API when a request is enqueued | F4 | D8 | **3** |
| **4** *Connected editors* as its own tab | The section exists but bundles the pairing list with two server-owned git settings leaves | F6 | D9 | **1** |
| **5** The commit graph does not render | (a) the `ready` frame is dropped, so the extension never connects; (b) `app.init`'s rejection is memoised and the whole template is `v-if`'d away; (c) no repo is ever opened. The pipeline below all three is **healthy** | F1, F7, F8, F5 | D5, D6, D7 | **1** (a, and the pipeline) / **3** (the rendered result) |
| **6** Default to the workspace repo | The webview's boot only opens a *persisted* repoId; `repo.list` candidates are rendered as buttons to click | F8 | D7 | **2** |
| **7** Visible connection state | The status-bar item hides itself in every state except `connected` | F10 | D10 | **2** |
| **8** Diff in VS Code only + one toolbar | The review view renders `DiffView` in-webview; `FileTree`'s toolbar is per-row. Routing to VS Code is *blocked* by F9 and needs a two-revision request | F9, F11 | D1, D11, D12, D13 | **1** (F9's fix) / **3** (the result) |
| **9** Restyle to match Kira Studio | `--kv-*` derives from `--vscode-*`; Kira Studio's structural scales and primitives are a separate system the webview cannot import. Resolved (§12.2): take the *structure*, keep colours theme-derived | F12 | D14 | **2** |
| **10** App icon + README | The icon is G10's placeholder glyph; there is no README | F13 | D15 | **1** |
| **11** Broken "open file" + icon-only buttons | `toUri({kind:'virtual'})` throws `UriError` for every real repository | F9 | D11, D16 | **1** (F9's fix) / **3** (the result) |

### 0.3 Not in this phase

Everything in §10's table, but the ones most likely to be mistaken for G12 work:

- **Any git feature.** Stash (G14), reset/cherry-pick (G15), search (G16), PR links (G17), worktrees
  (G18), stacked branches (G19) are untouched. A defect batch that grows a feature has left the phase.
- **Restyling the *graph* webview** (item 9 says "the review sidebar"). D14 draws that line by
  scoping its structural tokens to the review root, and §12.2 records the settled answer: the graph
  panel keeps the workbench design language it has today.
- **Removing `DiffView.vue`.** Item 8 stops the *review* view from rendering it; the graph panel's
  detail pane still does, and that is correct — a commit's diff beside the graph is not the same
  affordance as a review file opened for editing.
- **A second Kira Studio instance's revoke hole** (G8 F7, still open). Unrelated to item 1, and §10
  carries it forward unchanged.
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule: a chapter spec is not
  retro-edited by a phase. The two corrections to SPEC's own G12 wording (F2, F3) are settled *here*.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or **run** here.
- `CLAUDE.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out is left out entirely, not half-implemented.
- **Layering:** no new or changed code in an `internal/git*` package may import `internal/bridge`.
  `TestDomainPackagesDoNotImportBridge` (`internal/layering_test.go`) is the guard and must stay
  green. D8's window activation lives in `main.go`, which already imports both sides — that is the
  only place in the tree where it can honestly live.
- **Comments: very concise, only where the code cannot say it itself.**
- **Tests only where `CLAUDE.md`'s bar is met.** D17 says, per item, whether one is warranted and
  why. Most of these are wiring fixes and get none; four get a real test each, and each of those
  four is in a category the bar names by name (ordering/framing, a decision structure, a parser-ish
  round trip).
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§7).

---

## 1. Findings

Every finding that claims a defect was either **reproduced in this container** with a throwaway probe
against real production types, or **read directly out of the shipped source with the line cited**.
The probes are not part of the deliverable — §3/§4's tests are their permanent form — but their exact
output is quoted so the implementer can confirm they are seeing the same thing.

### F1 — A freshly paired extension never reaches `connected`: the `ready` frame is delivered to a handler that has just unsubscribed itself, and is silently dropped

**This is the single most consequential finding in the phase**, and it is item 5's first cause,
item 2's felt symptom, and the reason a user who approves a pairing sees precisely nothing happen.

**The mechanism, in three files.**

1. `internal/gitsock/handshake.go:167-173` (`finishPairing`) sends `paired` and then `ready` as two
   separate `Send` calls, back to back, with nothing between them.
2. `packages/git-ipc/src/socketChannel.ts:117-158` drains **every complete frame present after one
   read**, synchronously, in a `for(;;)` loop — deliberately, and correctly (its own doc comment
   names the stranded-second-frame bug that loop exists to avoid). It delivers each frame to
   `currentHandler`, which is a **single** subscriber slot (`:177-182`), by design (D21's
   one-reader invariant).
3. `apps/kira-studio-vscode/src/connection.ts:244-249` subscribes one handler that **unsubscribes
   itself as its first statement**, and re-subscribes only from inside
   `#handleHandshakeFrame` — which, on the `paired` branch (`:267-271`), first does
   `await this.#context.secrets.store(...)`.

So the loop delivers `paired`, the handler sets `currentHandler = null`, the loop's next iteration
evaluates `currentHandler?.(...)` — and `ready` goes nowhere. `#transport` is never assigned, the
state never leaves `pairing`, and the socket stays open forever with a fully live server session on
the other end.

**Both halves reproduced.** The frames really do coalesce (Go-side probe, real `Server`, real
socket):

```
=== RUN   TestG12Probe_PairedReadyCoalesce
    frame 1: pairingRequired
    one read returned 198 bytes; first frame is 71 bytes; 123 bytes follow it in the SAME read
    COALESCED: 'paired' and 'ready' arrive in one read …
      first={"kind":"paired","token":"wMYXzqwVLcbS4xcmbTEjIfqeTdOn8pZrfg08K0FZm9k"}
      second={"kind":"ready","serverVersion":"test-version","contractVersion":18,"sessionId":"4ffa…"}
```

and a client using `connection.ts`'s own read shape hangs, against a real server over a real Unix
socket with a real 12-commit fixture repository:

```
probe start
connected
handshake frame: pairingRequired
handshake frame: paired
<nothing — the client sat here until its 90 s timeout killed it>
```

The same probe, changed **only** to keep one handler installed for the whole handshake, walks
straight through (F5's transcript).

**Crucially, `await secrets.store(...)` makes this deterministic even without coalescing.** On real
VS Code that call is a Keychain write of tens of milliseconds; the subscriber slot is empty for that
entire window. Coalescing merely makes it certain rather than near-certain, which is why this is a
100 %-of-the-time bug in the field and not a flake.

**Blast radius, precisely.** Only the *pairing* dial is affected — a dial that presents a stored
token gets `ready` as a lone frame with nothing behind it (`handshake.go:106-110`) and connects
normally. So the failure is: **the first-ever connection after any approval never works, and every
later one does** — which is exactly the shape a user reports as "it needed approving again" (item 2)
and "the graph doesn't render" (item 5).

### F2 — A revoked editor can never pair again: `Insert` is a plain `INSERT` and the revoked row still owns the primary key

Item 1's real cause, and SPEC's "stale-list" framing is wrong (F3's companion correction).

`storage/repos/gitclients.go:50-60` is `INSERT INTO git_clients (id, …) VALUES (…)`; `id` is the
table's primary key and `Revoke` (`:76`) only sets `revoked_at`, never deletes. `finishPairing`
(`handshake.go:159-163`) treats the insert error as a pairing failure and answers `pairingDenied`.

Reproduced end to end, over the real socket, with a real approval click simulated through the real
`Broker`:

```
=== RUN   TestG12Probe_RevokeThenRepair
    first pairing: kind=ready tokenLen=43
    after first pairing, Connected editors list has 1 row(s)
    after revoke: id=editor-1 revokedAt=<set>
    re-dial with the revoked token: kind=tokenRejected (want tokenRejected)
WARN gitsock: insert paired client client=editor-1
     err="repos/gitclients: insert editor-1: constraint failed: UNIQUE constraint failed: git_clients.id (1555)"
    re-pair after approval: kind=pairingDenied tokenLen=0 approveErr=<nil>
    Connected editors list after re-pairing: 1 row(s)
      id=editor-1 label=VS Code revokedAt=<still set>
    BUG CONFIRMED: a revoked editor can never pair again — handshake answered "pairingDenied"
```

Every step before the last is exactly what SPEC §3.3 prescribes ("A revoked extension gets
`tokenRejected`, clears its stored token, and re-dials with none — producing a fresh pairing
prompt"). The prompt appears, the user approves, and the server denies them. From the pane's side
the row stays `Revoked` and no new row appears — read as "the list is stale".

**The list is not stale.** `notifyClientsChanged` runs after `Revoke` (`server.go:239`) and is wired
as `ClientsChanged` into the handshake (`server.go:175` → `handshake.go:164-166`), fans out through
`bridge/events.go:107` on `kira:git:clients`, and `frontend/src/state/gitClients.ts:54` replaces
`gitClientsState.clients` wholesale on every emission. The refresh path is complete and correct;
it is simply never given a successful pairing to report. **A manual refresh button would have hidden
this bug rather than fixed it**, which is the exact outcome the prompt warned against.

### F3 — Pairing is not repo-scoped, has never been, and the code contains no repository anywhere on the trust path

Item 2 asks this phase to determine whether pairing is keyed by (editor), (editor, repo) or (repo).
Answer, from the code:

| Trust-path object | Key | Cite |
|---|---|---|
| `git_clients` row | `id TEXT PRIMARY KEY` — the client's own id, seven columns, none a repo | `storage/repos/gitclients.go:16-24`, migration in `storage/` |
| `Broker` queue / `byID` | `clientID` | `gitsock/pairing.go:62-67` |
| `Broker` cooldown | `clientID` | `gitsock/pairing.go:66` |
| Handshake decision table | `hello.Client.ID` + token | `gitsock/handshake.go:96-142` |
| `Server.conns` | `map[clientID][]net.Conn` | `gitsock/server.go`, `Revoke` at `:227-241` |

`repo.open` happens **after** `ready`, on an already-trusted connection, and touches nothing in the
trust store. So there is no security reason for per-repo re-approval, because there is no per-repo
approval to remove.

**What actually produces the symptom**, in order of how often it fires:

1. **F1.** A pairing approval never completes, so the user is left with a window that behaves as if
   it were never paired.
2. **F2.** After any revoke — and the user was necessarily revoking while investigating item 1 —
   every subsequent approval is answered `pairingDenied`, and `connection.ts:285-292` puts the
   window into the terminal `denied` state, which only a manual `Retry` leaves. Retry re-dials with
   no token, prompts again, and is denied again: **an approval loop that never sticks**, which is
   precisely "a fresh connect/approval is required per repo" as a user would describe it, since they
   have one window per repo.
3. **A real identity race, narrow but genuine.** `connection.ts:76-82`'s `getOrCreateClientId` reads
   `context.globalState`, and on a miss mints a fresh `crypto.randomUUID()` and writes it back. Two
   windows opened close together both miss, both mint, and the trust store legitimately grows **two
   rows needing two approvals** — one per window, i.e. one per repo, for as long as the race keeps
   firing. `context.secrets` holds a single `kira.git.token` key shared by every window, so the
   losing id's token is also the one that gets overwritten.

D4 fixes (3) by taking the identity from something VS Code already guarantees is stable per
installation rather than minting one; D18 records the scope answer so a later phase does not
re-litigate it.

### F4 — Nothing anywhere calls a window API when a pairing request is enqueued

Item 3, confirmed by absence. `Broker.Request` (`pairing.go:122`) enqueues and emits a
`PairingSnapshot`; `Server.OnPairingChanged` (`server.go:65`) re-exports the subscription;
`bridge/events.go:100-110` forwards it to the renderer as `kira:git:pairing`; `GitPairingDialog.vue`
renders it. At no point does anything call `Show`, `Restore`, `Focus`, or any notification API —
`grep -rn "Notification\|NSUserNotification\|osascript" --include=*.go internal/ main.go` finds
exactly one hit, and it is `application.PermissionNotifications: application.PermissionDeny` in
`internal/shell/security.go:21`, which is the *webview's* permission prompt policy and unrelated.

The platform side is already solved and needs no cgo: `WebviewWindow.Focus()`
(`pkg/application/webview_window.go:1688`) calls `windowFocus` on darwin, which is
`activateIgnoringOtherApps:YES` followed by `makeKeyAndOrderFront:` and `makeKeyWindow`
(`webview_window_darwin.go:1100-1113`). `Show()` (`:514`) and `Restore()` (`:1327`) cover a hidden or
minimised window. The one thing not covered is "no window exists at all", which SPEC §3.3 already
contemplates ("A request arriving with no Kira Studio window open yet is held").

For that case Wails beta.16 ships `pkg/services/notifications`, whose darwin implementation is
`UNUserNotificationCenter` (`notifications_darwin.m:103`) — the modern API, not the deprecated
`NSUserNotification`. It refuses to run without a bundle identifier
(`notifications_darwin.go:66-67`), i.e. it works in a packaged `.app` and not in `bun run dev`.
That is a real constraint to design around, not a reason to hand-roll cgo.

### F5 — Everything below the connection is healthy: the wire, the FlatBuffers, the store and the decode path all work, end to end, today

The prompt's stated suspects for item 5 — the G10 bump to 17 and G11's to 18 — are **clean**. All
three hand-maintained copies read 18 and agree (`gitrpc/contract.go:20`,
`packages/git-ipc/src/validate.ts:12`, `tests/e2e-real/git-pairing-real.spec.ts:93`).

Proven positively rather than by inspection. A real client — the real `createSocketChannel`, the
real `createRpcClient`, therefore the real `decodeStreamPayload` → `graphChunkCodec.fromWire` →
`"KIG1"` identifier check — against a real `gitsock.Server` over a real Unix socket, on a real
12-commit fixture repository with a tag and a second branch:

```
handshake frame: pairingRequired / paired / ready
app.init: {"contractVersion":18,"serverVersion":"test-version",
           "git":{"kind":"ok","path":"/usr/bin/git","version":"2.43.0"}}
repo.open kind: ok repoId: /tmp/…/002
first chunk envelope keys: repoId,seq,from,to,source,remaining,exhausted,commits
first chunk envelope: {"seq":0,"from":0,"to":12,"source":"git","remaining":0,"exhausted":true}
first chunk commits: {"from":0,"to":12,"shaWidthBytes":20,"shasBytes":240,"parentOffsetsBytes":52,
  "parentShasBytes":220,"identityIdsBytes":192,"timesBytes":96,"subjectBytes":98,
  "subjectOffsetsBytes":52,"dictionaryBase":0,"dictionaryLen":2,
  "dictionarySample":["Test","test@example.com"],
  "decorations":[[0,[{"kind":"branch","name":"main","isHead":true},{"kind":"tag","name":"v1"},
                     {"kind":"branch","name":"feature","isHead":false}]]]}
graph.stream OK: chunks=1 rows=12
CommitStore: chunks=1 rowCount=12
row 0: {"sha":"e66d5dc2…","parents":["7da094bc…"],"author":{…},"subject":"commit 11",
        "decoration":[{"kind":"branch","name":"main","isHead":true},{"kind":"tag","name":"v1"},…]}
refs.list OK {…}
status.get OK {"head":{"kind":"branch","name":"main"},"isClean":true,…}
```

The blob frame, the `{"$blob":true}` substitution, the `$fb: "gitwire/1"` wrapper, the
`file_identifier` check, the seven byte columns, the dictionary, the decorations and
`CommitStore.appendPacked` are all correct. **The graph does not render because nothing ever gets
this far in a real window** (F1, F7, F8) — not because anything in G3's pipeline regressed. An
implementer must not go looking for a wire bug; there isn't one.

### F6 — The *Connected editors* settings section already exists, and bundles two unrelated things

Item 4's real shape. `SettingsDialog.vue:98` already lists `'Connected editors'` as one of five
sections, and its template branch (`:616`) contains, in order:

1. the *Install VS Code Integration* / *Reveal in Finder* button and its outcome copy (G10 D14),
2. the paired-clients list with per-row Revoke — both of which **bypass the draft/Save model
   entirely** (`:102-104`'s own comment: "a revoke must take effect immediately"),
3. a `Git remote operations` subhead with `protectedBranches` and `fetchAutoIntervalMinutes` —
   two server-owned settings leaves that go through `draft`/`pendingPatch`/Save like every other
   setting in the dialog.

So one tab mixes "actions that apply instantly" with "settings that apply on Save", which is exactly
the confusion item 4 names. The tab-registration pattern is small and must be matched, not invented:
one entry in the `sections` tuple (`:98`), one `v-else-if="activeSection === '…'"` branch, and the
`data-testid` comes free from `:361`'s `settings-section-${section}` template.

One test reaches into this: `tests/e2e-real/git-pairing-real.spec.ts:163` clicks
`[data-testid="settings-section-Connected editors"]`. D9 keeps that name on the pairing half
precisely so it does not need touching.

### F7 — A webview whose `app.init` fails renders *literally nothing*, and can never recover

Item 5's second cause, read straight out of the source.

- `proxyHandlers.ts:87` forwards `app.init` to `connection.request`, which rejects with
  `new Error('connection: not connected to Kira Studio')` whenever `#transport` is undefined
  (`connection.ts:130-132`) — which is every moment before `ready`, and permanently after F1.
- `BridgeClient.init()` (`bridge/client.ts:38-52`) assigns `#initPromise` once and returns it
  forever, **rejection included**. There is no retry and no invalidation.
- `App.vue:651` calls `void bootstrap().then(...)`; `bootstrap()`'s first statement is
  `await bridge.init()`. On rejection nothing after it runs, `repoState` stays `undefined`, and the
  template's `<template v-if="repoState">` (`:956`) excludes the entire UI. What renders is
  `.kv-visually-hidden` connection-state text and an empty live region: **a blank panel.**

This is not merely F1's consequence. It is an independent race in its own right: the graph view
resolves whenever the user opens the panel, and `activationEvents: ["onStartupFinished"]` plus a
reconnect backoff of up to 8 s (`connection.ts:44`) means "panel opened before the socket is up" is
ordinary, not exotic — Kira Studio not running yet is the common case. Today that permanently blanks
the panel until the user hides and re-reveals the view.

`ReviewView.vue:68` has the same `await bridge.init()` first line, and the same one-shot
`void bootstrap()` (`:173`) — with a friendlier failure (`v-if="!review"` renders "Loading…"
forever) but the same permanence.

### F8 — The webview opens a repository only if one was persisted; the workspace's own repo is a button to click

Items 5(c) and 6, one cause.

`App.vue:719-728` is the only `repo.open` on the boot path and it is gated on `persisted.repoId`.
With nothing persisted — a first-ever open, or a webview whose `setState` was cleared — the template
falls to `NoRepositoryPanel` (`:959-963`), which lists `repo.list`'s candidates as buttons plus an
"Open Folder…" action (`NoRepositoryPanel.vue:33-47`). `repo.list` is answered locally from
`vscode.workspace.workspaceFolders` (`proxyHandlers.ts:104-107`, `ports/workspaceRoots.ts:10-16`),
so the workspace's own repository is *already right there* — as a thing to click.

The host-side palette command already gets this right (`extension.ts:310`:
`vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? await dialogs.pickFolder(...)`), so the fix is
to give the webview's boot the same default, multi-root-aware, rather than to invent a policy.

### F9 — `vscode.Uri.parse` **throws** on every virtual document this extension mints, so every historical diff and every "open file" in a historical revision fails

Item 11's root cause, and the reason item 8 cannot simply "route diffs to VS Code" without fixing
this first.

`ports/editorIntegration.ts:39-50`'s `toUri` builds
`kira-version:/${encodeURIComponent(key)}/${encodeURIComponent(label)}`, where `key` is
`virtualKey.ts`'s `${repoId}\0${rev}\0${path}`. `RepoID` is the **absolute worktree root** for a
non-bare repository (G3 D7), so the key always begins with `/`, and `encodeURIComponent` turns that
into `%2F`.

VS Code's `Uri` is `vscode-uri`, whose `parse` **percent-decodes the path component** and then
validates it. Run here against the real published package:

```
--- absolute repo root (every real repo) — repoId="/Users/me/code/kira-studio"
    encodeURIComponent(key): "%2FUsers%2Fme%2Fcode%2Fkira-studio%00abc1234%00src%2Fmain.ts"
    THROWS: Error: [UriError]: If a URI does not contain an authority component,
            then the path cannot begin with two slash characters ("//")
--- relative id (never produced, for contrast) — repoId="code/kira-studio"
    uri.path              : "/code/kira-studio\0abc1234\0src/main.ts/main.ts"
    segments[0]           : "code"
    key round-trips?      : false
--- empty side path       : "/empty/main.ts"
```

So there are **two** defects stacked, and the first one masks the second:

1. `URI.parse` throws before `vscode.diff` or `openTextDocument` is ever reached, for every real
   repository. `openDiff` (`:80-87`) and `reveal` (`:89-95`) both throw synchronously.
2. Even if it did not throw, `provideTextDocumentContent`'s recovery is wrong: it splits the
   *decoded* path on `/` and takes `segments[0]` (`:64-67`), which for a key containing any `/`
   is a fragment, not the key. `parseVirtualKey` then returns `undefined` and the document renders
   empty. The `EMPTY_SEGMENT` comment at `:30-33` states the assumption that fails — "a real key
   always contains at least one percent-encoded `/`" is true of the string handed to `Uri.parse`
   and false of `uri.path` afterwards.

**What this breaks today**, in the shipped `.vsix`: `editor.openDiff` (the graph detail pane's "Open
in editor", and every review-row diff that would route through it), and `editor.goToFile`'s
`historical` arm (`proxyHandlers.ts:191-200`). The `live` arm survives, because it uses
`{kind:'file'}` → `vscode.Uri.file` (`:41-42`), which has no encoding problem — which is exactly why
"open file" is reported as *sometimes* working: it works for a file that exists in the checkout and
fails the moment the target is historical.

**Two fixes verified here**, both round-tripping the real key through the real library:

```
A  base64url in the first path segment
   path      : "/L1VzZXJzL21lL2NvZGUva2lyYS1zdHVkaW8AYWJjMTIzNABzcmMvbWFpbi50cw/main.ts"
   recovered : "/Users/me/code/kira-studio\0abc1234\0src/main.ts"   ok: true   reparsed: true
B  the key in the query component, the label as the path
   toString  : "kira-version:/main.ts?%2FUsers%2Fme%2F…%00src%2Fmain.ts"
   reparsed  : true
```

D11 takes A, for the reason stated there.

### F10 — The status-bar item hides itself in every state except `connected`, which is the one state that needs no indicator

Item 7. `extension.ts:78-88`:

```ts
if (!enabled || state.kind !== 'connected') { item.hide(); return; }
```

`ConnectionState` (`connection.ts:46-56`) already carries five states — `connecting`, `pairing`,
`connected`, `denied`, `versionMismatch` — sourced from the real handshake, and `onStateChange` fires
on every transition. G10 D16 chose "an entry point with connection state"; what it implemented is an
entry point that vanishes whenever the connection is in trouble. The user's complaint ("little to no
indication of socket state") is the direct consequence: the *only* time anything is visible is when
nothing is wrong.

`showConnectionStatus` (`:265-304`) already renders honest per-state copy for all five — so the
vocabulary exists and only the always-visible surface is missing.

"Actively loading" has no host-side source today, and does not need a new wire event to get one:
every webview request and every stream already passes through `proxyHandlers` → `ConnectionManager`
(`connection.ts:125-148`), so the manager can count its own in-flight work. D10 takes that rather
than inventing a `CONTRACT_VERSION`-bumping event for a spinner.

### F11 — Every expanded review row renders its own filter box and its own Tree/Flat toggle

Item 8's second half. `ReviewCommitRow.vue:136-148` mounts one `FileTree` per expanded row, bound to
that row's own `DetailState.listMode`/`filter`. `FileTree.vue:326-352` is the toolbar: a
`Filter files` input and a two-button `Tree`/`Flat` group. Expand three commits and there are three
of each, each independently stateful. The Files pane (G11) has its own third copy again
(`ReviewFilesPane.vue:29-30` holds `listMode`/`filter` locally).

Note that `FileTree` is shared with the **graph** panel's `DetailPane`, where exactly one is ever
mounted and per-instance state is correct. So the fix cannot be "delete the toolbar from
`FileTree`"; it has to make the toolbar optional and let the review view own one.

### F12 — The two design systems are genuinely different systems, not two palettes

Item 9, stated precisely so D14 is not hand-waving.

- `packages/git-ui/src/theme/vscode-tokens.css` (202 lines) defines `--kv-*` as a chain of
  `var(--vscode-<workbench colour id>, <literal fallback>)`. Its own header calls itself "the only
  file in `packages/ui` permitted to contain a colour literal". This makes the webview follow the
  user's VS Code theme, light or dark, high contrast included — deliberate, and good webview
  citizenship.
- Kira Studio's `frontend/src/theme/tokens.css` (222 lines) is a **fixed** VS-Code-Dark-Modern-derived
  palette of `--kira-*` tokens, with documented contrast ratios and a radius/spacing tier system;
  `primitives.css` (1091 lines) is the component layer above it (`AppButton`, `IconButton`,
  `TextField`, field/handle/subhead shapes). `scripts/check-tokens.sh` guards `--kira-*` references
  in `apps/kira-studio/frontend/src` only — it does not see `packages/git-ui` at all.

The webview cannot `import` the Wails app's CSS (different bundle, different process, no shared
origin), so "reuse Kira Studio's components/tokens" can only mean *port values into*
`packages/git-ui`'s own token layer. **Which values is the whole question**, and §12.2 settled it:
porting the *palette* would be wrong for every light and high-contrast user, so D14 ports the
colourless half — the spacing, type, control-height and radius scales, the panel/toolbar anatomy and
the font-role law — and leaves colour deriving from `--vscode-*` exactly as it does today. The two
halves are separable because Kira Studio's own primitives already separate them (D14's first table).

### F13 — The extension ships G10's placeholder glyph and no README

Item 10. `package.json:17` points `icon` at `resources/icon.png`, a 128×128 black git-branch glyph
committed in `0246f8dd` (G10's packaging commit) — visibly a placeholder, not Kira Studio's identity.
Kira Studio's own icon is `apps/kira-studio/build/appicon.png` (1024×1024 RGBA, the cat mascot), with
its vector source at `apps/kira-studio/build/appicon.icon/Assets/kira_icon_vector.svg`.

Two things `resources/icon.png` is **not**: it is not the two view-container icons
(`resources/icon.svg` at `package.json:42`, `resources/review-icon.svg` at `:49`), which are
monochrome `currentColor` SVGs and must stay that way — VS Code tints activity-bar and panel icons,
and a full-colour mascot there would look broken, not branded. Only the marketplace/extensions-list
icon changes.

There is no `README.md` in `apps/kira-studio-vscode/`. `.vscodeignore` (G10 D4) is an exclusion list,
so a new README is included in the `.vsix` automatically and becomes the extension's details page.

### F14 — `finishPairing`'s failure path is indistinguishable from a user denial, and that is what turned F2 into a silent loop

Worth separating from F2 because the fix for one does not fix the other. `handshake.go:151` and
`:161` both answer `pairingDenied{Reason:"denied"}` — the same frame a real "Deny" click produces.
`connection.ts:285-292` maps it to the terminal `denied` state and stops reconnecting. So a *server-side
failure* (mint error, insert error) is presented to the user as "you denied this", with the real
cause visible only in Kira Studio's own log at `WARN`.

SPEC §3.3's handshake union has no "pairing failed" member, and adding one is a protocol change this
phase will not make for a path D3 removes the cause of. What it will do is log at `Error` rather than
`Warn` (a failure to persist a trust grant the user just approved is not a warning), and say so in
D3. §12.3 raises the protocol question for a later phase rather than answering it here.

---

## 2. Decisions

### D1 — `CONTRACT_VERSION` 18 → 19, for exactly one new request: `editor.openRangeDiff`. Flagged, not smuggled

Item 8 requires that a file opened from the review sidebar's Files pane show its diff in **VS Code's
native diff view**. That diff is `base..branch` for one path — two revisions. No existing method can
express it:

- `editor.openDiff` takes a single `sha` plus an optional `parentIndex` (`contract.ts:1101-1110`) and
  composes its two sides from `commit.detail`'s parent list (`proxyHandlers.ts:145-178`). A branch
  review has no single commit and no parent index; passing the branch tip would be a lie that
  happens to compile.
- `review.fileDiff` (`contract.ts:1027-1043`) returns a *rendered body* for the webview, which is
  what item 8 is removing.

So one new request, answered **entirely inside the extension** exactly as `review.open` and
`editor.openDiff` already are — the server never sees it:

```ts
'editor.openRangeDiff': {
  params: {
    repoId: string;
    base: string;          // a revision: the resolved base sha or ref
    branch: string;        // a revision: the branch being reviewed
    path: string;          // the path as it stands on `branch`
    originalPath?: string; // the path as it stood on `base`, when the file was renamed
    status: 'added' | 'deleted' | 'modified' | 'renamed'; // which side may be empty
  };
  result: Record<string, never>;
};
```

`status` is carried rather than re-derived because the extension must know which side is `{kind:
'empty'}` (an added file has no base-side blob) and `review.files` already answers it — re-deriving
it host-side would mean a second round trip for something the caller already holds.

`ContractVersion` is the sole compatibility authority (SPEC §3.4), so Go's constant moves in lockstep
even though Go neither emits nor parses this method — **the identical situation G10 D9 was in for
`ui.action`**, and the same answer. Three hand-maintained places move together:
`gitrpc/contract.go:20`, `packages/git-ipc/src/validate.ts:12`,
`tests/e2e-real/git-pairing-real.spec.ts:93`. Two more must be updated or the build breaks by
construction: `validate.ts`'s `REQUEST_KEY_MAP` (a `Record<RequestKey, true>`, so a missing key is a
compile error) and `proxyHandlers.ts`'s `requests` map (total over `RequestKey`, same guarantee).

§12.1 puts the bump to a human before implementation starts.

### D2 — This phase is eleven fixes; no item is allowed to grow into a feature

Stated as a decision because two items invite it. Item 9 ("restyle") can become a design system;
item 7 ("connection state") can become a status dashboard. The rule the implementer applies: **a
change that is not the shortest honest fix for one of the eleven numbered items is out of scope**,
and §10 lists the specific temptations by name.

### D3 — Re-pairing an existing client id is an upsert, and it clears `revoked_at`

Fixing F2. `GitClientsRepo.Insert` becomes `UpsertOnPair`, and the name is part of the fix — the call
site should read as "this user just approved a trust grant", not "add a row":

```sql
INSERT INTO git_clients (id, label, token_hash, token_salt, created_at, last_seen_at, revoked_at)
VALUES (?, ?, ?, ?, ?, ?, NULL)
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  token_hash = excluded.token_hash,
  token_salt = excluded.token_salt,
  last_seen_at = excluded.last_seen_at,
  revoked_at = NULL
```

- **`created_at` is preserved** on the conflict path. It means "first paired", and the pane renders
  nothing from it today; resetting it would silently rewrite history for no gain.
- **`revoked_at = NULL` is the actual fix.** A row that stays revoked after a fresh approval would
  make the next `verifyClientToken` (`handshake.go:201`) reject the brand-new token.
- **The old token is invalidated**, because `token_hash`/`token_salt` are replaced. That is correct
  and important: a re-pair must not leave the previously revoked secret usable.

**This does not weaken the trust boundary, and the reasoning is worth writing down.** The upsert runs
only from `finishPairing`, which runs only after `Broker.Request` returned `PairingApproved`, which
happens only when a human clicked Approve in Kira Studio's own window. A revoked client cannot
re-admit itself; it can only ask again and be told yes by a person. That is verbatim what SPEC §3.3
already specifies ("A revoked extension gets `tokenRejected`, clears its stored token, and re-dials
with none — producing a fresh pairing prompt"). The code simply could not complete the flow its own
spec describes.

`gitsock`'s `TrustStore` interface (declared where it is consumed, `server.go`) renames its method to
match. The `WARN` on a persist failure becomes `Error` (F14) — a trust grant the user approved and
the app then failed to store is not a warning.

### D4 — The client id comes from `vscode.env.machineId`, with a migration; the label names the editor, not one workspace

Fixing F3(3), and answering item 2's "once per VS Code installation" literally.

```ts
const CLIENT_ID_PREFIX = 'kira-vscode:';

async function resolveClientId(context: vscode.ExtensionContext): Promise<string> {
  // A pre-D4 install already has a paired row under its minted UUID; keeping it is what stops
  // this change from forcing every existing user through a fresh approval.
  const legacy = context.globalState.get<string>(CLIENT_ID_KEY);
  if (legacy) return legacy;
  return `${CLIENT_ID_PREFIX}${vscode.env.machineId}`;
}
```

- `vscode.env.machineId` is "a unique identifier for the computer"
  (`@types/vscode/index.d.ts:10785`), stable across windows and restarts and distinct per editor
  installation — so it **cannot race**, unlike a mint-and-store UUID, and it needs no storage at all.
- The legacy read is kept but the *write* is deleted: nothing new is ever stored under
  `CLIENT_ID_KEY`, so the race has no path left to fire.
- **The label stops naming a workspace.** `clientLabel()` (`connection.ts:84-87`) currently returns
  `${os.hostname()} — ${workspaceName}`, which was honest when a row could plausibly be one window
  and is misleading once one row legitimately covers every window. It becomes
  `${vscode.env.appName} — ${os.hostname()}` (e.g. "Visual Studio Code — mbp.local"), so the
  *Connected editors* pane names the thing that was actually trusted. `handshake.go`'s 200-byte
  clamp (`clampLabel`) is unchanged and still applies.

**Rejected: a per-workspace client id.** It would make the observed symptom the *design*, needs N
approvals for N repos, and buys nothing — the trust boundary is the editor's OS-level access to the
socket, which is identical for every workspace that installation opens.

**Rejected: `secrets` keyed per workspace.** `context.secrets` is per-extension and shared across
windows by design; one identity means one token, which is the point.

### D5 — `socketChannel` buffers a frame that arrives with no subscriber, and the handshake keeps one subscriber for its whole duration

Fixing F1, with two changes because the bug has two halves and each is worth closing on its own.

**(a) `packages/git-ipc/src/socketChannel.ts` — make the drop impossible.** A frame delivered while
`currentHandler` is null is queued, and the queue is flushed when a handler is installed:

```ts
// A frame that arrives between two subscribers is queued, never dropped: the read loop above
// drains every complete frame in one synchronous pass (see this file's own doc comment), so a
// handler that resubscribes across an await — connection.ts's handshake does — would otherwise
// lose whatever the same read already delivered. Bounded because an unread queue is a leak, not
// a feature: past the cap the socket is destroyed, the same hard-error posture as an oversize
// frame.
const MAX_PENDING_FRAMES = 64;
```

`onMessage(handler)` installs the handler and then flushes the queue **in arrival order**, before
returning. The single-subscriber invariant (D21's "one reader, sequential ownership") is unchanged —
this is about the gap between two readers, not about two concurrent ones.

**(b) `apps/kira-studio-vscode/src/connection.ts` — stop unsubscribing mid-handshake.** The
`#awaitOneFrame` / self-unsubscribing shape is replaced by one handler installed at `connect` and
removed exactly once, at the `ready` branch, immediately before `createRpcClient(channel)` takes the
slot in the same synchronous statement. The state machine itself does not change — the same five
frames, the same five outcomes — only who is holding the subscription while `secrets.store` is
awaited.

Both are needed. (b) is the correctness fix; (a) is the structural one that stops the next
`await`-across-a-frame from reintroducing it — and, in particular, protects the handover in (b) if a
future change ever puts an `await` between the unsubscribe and `createRpcClient`.

**This is the one place in the phase where a test is unambiguously earned** (D17): frame ordering
across a subscriber handover is exactly `CLAUDE.md`'s "concurrency (ordering, backpressure,
cancellation, races)" category, and the bug is invisible to every other tier.

### D6 — The webview boots against a connected transport, and an `app.init` failure is retryable and visible

Fixing F7. Three changes, each small:

1. **`BridgeClient.init()` stops memoising a rejection.** On failure it clears `#initPromise` before
   rethrowing, so a later call genuinely retries. The success memo is unchanged — that is the
   property the class exists for.
2. **`ConnectionManager` gains `whenConnected(signal)`**, and `proxyHandlers`' `app.init` awaits it
   instead of failing fast. Its shape is the one already used elsewhere in the file: resolve
   immediately when `#state.kind === 'connected'`, otherwise subscribe to `onStateChange` and resolve
   on the first `connected`. It rejects on `denied`/`versionMismatch` — the two terminal states
   (`connection.ts:318`) — because waiting for a state the manager will never re-enter without a
   `retry()` is a hang, not patience.
3. **`App.vue` and `ReviewView.vue` render their boot failure**, and offer a retry. A new
   `bootError` ref, set in a `catch` around `bootstrap()`, renders a small panel ("Kira Studio isn't
   reachable — <reason>", with a Retry button that clears it and calls `bootstrap()` again) *outside*
   the `v-if="repoState"` gate. A blank panel is never an acceptable rendering of a failure, and
   today it is the only one this webview has.

`ConnectionManager.onStateChange` also drives (3) passively: `extension.ts` already forwards state
transitions, and the graph provider can re-emit nothing at all — the webview's own retry is enough,
and adding a state-push event would be a `CONTRACT_VERSION` change (D1 keeps this phase to one).

### D7 — The webview opens the workspace's repository automatically, and falls back to the picker only when none is there

Fixing F8 and item 6. In `App.vue`'s `bootstrap()`, after the persisted-state restore and only when
it did **not** open a repository:

```
if no persisted repoId opened a repo:
  candidates = await repo.refreshList()          // repo.list, answered from workspaceFolders
  for candidate in candidates:                    // multi-root aware: first match wins
      result = await repo.open(candidate.path)
      if result.kind === 'ok': handleRepoOpened(result.repo.repoId); break
      if result.kind === 'gitUnavailable': break  // git itself is blocked; GitBlockedPanel owns it
      // 'notARepository' — a workspace folder that simply is not a repo; try the next one
```

- **Persisted state still wins.** A user who had repo B open in this view gets repo B back, not
  workspace folder A. This is the one ordering that must not be got wrong.
- **Multi-root is handled by trying each folder in order**, not by picking `[0]` and giving up —
  a workspace whose first folder is a docs directory and whose second is the repository is common.
- **`NoRepositoryPanel` stays**, reached when there are no candidates or none is a repository. That
  is item 6's own "falling back to the current folder-picker behavior only when no repo is found".
- Errors from `repo.open` are caught per candidate and do not abort the loop; a thrown request
  (the connection dropped mid-boot) surfaces through D6(3)'s `bootError`.

`ReviewView.vue` needs no equivalent: it already resolves `repo.list`'s `activeRepoId`
(`:87-92`), which this change now populates as a side effect of the graph view opening one
(`proxyHandlers.ts:112-118` sets `activeRepoId` on every successful `repo.open`).

### D8 — Kira Studio comes to the front when a pairing request is enqueued, from `main.go`, with a notification fallback

Fixing F4 and item 3. The subscription and the activation both live in `main.go`, which is the only
file that legitimately sees both `gitsock` and `application` — no `internal/git*` package grows a
Wails import, and the layering test stays green.

```
gitSock.OnPairingChanged(func(snap gitsock.PairingSnapshot) {
    // Only a queue that just went from "nothing pending" to "something pending" is worth
    // stealing focus for; a snapshot emitted because the count behind the head changed is not.
    if snap.Pending == nil { … reset the edge latch; return }
    if the same RequestID was already presented { return }
    if w := currentOrAnyWindow(); w != nil {
        application.InvokeAsync(func() { w.Show(); w.Restore(); w.Focus() })
        return
    }
    notifyPairingPending(snap.Pending)
})
```

- **The window API is the one Wails already implements**: `Focus()` is
  `activateIgnoringOtherApps:YES` + `makeKeyAndOrderFront:` + `makeKeyWindow` on darwin
  (`webview_window_darwin.go:1100-1113`). No cgo, no raw Cocoa, no new dependency. `Show()` and
  `Restore()` precede it so a hidden or minimised window is actually presented rather than merely
  made key.
- **`Show`/`Restore`/`Focus` must run on the main thread.** Wails' own `Focus()` wraps its impl in
  `InvokeSync`, but this callback runs on the broker's goroutine, so the whole three-call sequence
  goes through `application.InvokeAsync` — async rather than sync, because the broker's emit must
  never block on the UI thread.
- **Window resolution reuses `main.go`'s existing helper shape** — `app.Window.Current()` falling
  back to `windows.Any()`, which is exactly what `attachDialogs` (`main.go:324-330`) already does and
  for the same reason.
- **The edge latch matters.** `PairingSnapshot` is emitted on *every* queue change, including a
  second request arriving behind the first. Re-activating on each would make a queue of three
  approvals steal focus three times. The latch is the presented `RequestID`.

**The fallback, and its honest limits.** With no window open (SPEC §3.3's "held, not auto-denied"
case), there is nothing to focus, and the request would otherwise sit invisible for its full 120 s.
`pkg/services/notifications` is registered as an ordinary Wails service alongside the others
(`main.go:284-301`) and `SendNotification` is called with the requesting editor's label. Two limits,
both stated rather than discovered:

- **It only works in a packaged, signed `.app`** — `checkBundleIdentifier` refuses otherwise
  (`notifications_darwin.go:66-67`). In `bun run dev` the call returns an error, which is logged at
  `Debug` and otherwise ignored. That is acceptable: a developer running from source has a terminal
  and a window.
- **Authorization is requested lazily, on first use, never at startup.** `RequestNotificationAuthorization`
  triggers the OS prompt; asking for it at launch, before the app has any reason to notify, is the
  behaviour every good macOS app avoids. A denial is terminal for the session and is logged once.

**Rejected: opening a window when none exists.** SPEC §3.3 deliberately holds the request instead,
and a background app spawning a window because a *different* app connected to it is worse than a
notification, not better.

### D9 — *Connected editors* becomes pairing-only; a new *Git* section takes the two server-owned settings

Fixing F6 and item 4, matching `SettingsDialog.vue`'s existing registration pattern exactly.

- `sections` (`:98`) becomes
  `['Appearance', 'Data', 'Cache', 'Connected editors', 'Git', 'Advanced']`.
- The `'Connected editors'` branch keeps the Install button, the paired-client list and Revoke —
  every one of which bypasses the draft/Save model, so the tab becomes uniformly "actions that apply
  immediately".
- A new `'Git'` branch takes the `Git remote operations` subhead, `protectedBranches` and
  `fetchAutoIntervalMinutes` verbatim — same `data-testid`s, same reset buttons, same validation,
  same `draft`/`pendingPatch` wiring. Nothing about those two leaves changes; they move.
- `data-testid` comes from `:361`'s existing `settings-section-${section}` template, so
  `settings-section-Git` exists automatically and no new pattern is introduced.

**`settings-section-Connected editors` keeps its name and its content**, so
`tests/e2e-real/git-pairing-real.spec.ts:163-167` needs no change — it clicks that tab and asserts a
client row, both of which stay put. This is a deliberate constraint on the split, not a coincidence:
the alternative naming (pairing under a new tab, settings keeping the old name) would have broken a
passing e2e test for no gain.

### D10 — The status-bar item is always visible, over five states plus in-flight work

Fixing F10 and item 7. `updateStatusBar` stops early-returning and renders a state per row:

| `ConnectionState` | Text | Tooltip |
|---|---|---|
| `connecting` | `$(sync~spin) Kira Version` | `Connecting to Kira Studio…` + the socket path |
| `pairing` | `$(key) Kira Version` | `Waiting for approval in Kira Studio` |
| `connected`, idle | `$(git-branch) Kira Version` | `Connected` + the workspace root (today's text) |
| `connected`, work in flight | `$(sync~spin) Kira Version` | `Loading…` |
| `denied` | `$(error) Kira Version` | `Pairing was denied` / `…timed out` — click runs the existing command, which offers Retry |
| `versionMismatch` | `$(error) Kira Version` | both versions named, as `showConnectionStatus` already words it |

- `item.hide()` survives for exactly one case: `kiraVersion.statusBar.enabled === false`. A user who
  turned the item off keeps it off.
- **`backgroundColor` is set to `statusBarItem.errorBackground` for `denied`/`versionMismatch`** and
  cleared otherwise — the standard VS Code affordance for "this needs you", and the difference
  between an indicator and an ornament.
- **The command changes per state.** `connected` keeps `kiraVersion.focusGraph`; every other state
  points at `kiraVersion.showConnectionStatus`, which already renders correct copy and a Retry
  affordance for all five (`extension.ts:265-304`). Clicking a broken connection should explain it,
  not try to focus a panel that cannot load.
- **"Actively loading" is counted, not guessed.** `ConnectionManager` gains a private in-flight
  counter incremented in `request`/`stream` and decremented in their `finally`, with an
  `onActivityChange` emitter fired only on the 0↔non-0 edge. No new wire event, no
  `CONTRACT_VERSION` change, and the source is the real socket traffic rather than a webview
  self-report.
- **Debounced at 150 ms on the rising edge only.** Without it, a burst of small `commit.detail`
  requests flickers the item several times a second, which is worse than no indicator.

### D11 — The virtual-document key is base64url in the first path segment; the empty sentinel moves outside that alphabet

Fixing F9, and the precondition for D12. Verified against the real `vscode-uri` (F9's transcript,
candidate A round-trips and re-parses).

`ports/editorIntegration.ts`:

```ts
const EMPTY_SEGMENT = '.empty'; // '.' is not in the base64url alphabet, so this can never collide
                                // with an encoded key — unlike the bare 'empty' it replaces.

function encodeKey(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}
```

- `toUri({kind:'virtual'})` builds `${SCHEME}:/${encodeKey(ref.key)}/${encodeURIComponent(ref.label)}`.
  base64url's alphabet is `A-Za-z0-9_-`, so the encoded segment survives `Uri.parse`'s percent-decode
  untouched, contains no `/`, and can never begin the path with `//`.
- `provideTextDocumentContent` decodes with `Buffer.from(segment, 'base64url').toString('utf8')`
  instead of `decodeURIComponent`, and returns `''` for the `.empty` sentinel exactly as today.
- The **label** stays percent-encoded: it is the last segment, VS Code resolves the language mode
  from it, and a filename with a space or a `#` must survive. It is never decoded back into a key, so
  the decode asymmetry is fine and worth one comment.
- A malformed segment (not valid base64url, or a key `parseVirtualKey` rejects) resolves to `''`, as
  it already does — an empty document, never a thrown provider.

**Rejected: candidate B (the key in the query component).** It also works (F9's transcript) and is
arguably tidier, but it changes the URI's *shape*, and `EMPTY_SEGMENT`'s sentinel, the `pathSegments`
helper and G4's own comments are all written against the path form. A one-function encoding change is
a smaller diff with the same guarantee.

**This is the second place a test is earned** (D17): an encode/decode round trip whose failure mode
is a thrown `UriError` in a host this container cannot run. A plain `bun test` over the pure
`encodeKey`/`decodeKey` pair plus `virtualKey.ts`'s own round trip catches the regression that
actually shipped, with no VS Code required — provided the key corpus includes an absolute repo root,
a path with a space, and a non-ASCII filename.

### D12 — The review sidebar renders no diff at all; every file opens in VS Code's native diff view

Item 8's first half, and it deletes code rather than adding a mode.

- **`ReviewView.vue` loses `.kv-review-diff-overlay`** (`:580-596`) and the `DiffView` import,
  `activeDiffSha`/`activeDiffExpansion`, and the `useModalFocus` overlay wiring. `onDocumentKeydown`'s
  Escape ordering loses its first stage and keeps the second (collapse the focused row).
- **`ReviewCommitRow`'s `FileTree` selection stops opening an in-webview diff** and calls
  `actions.openInEditor({sha, path, originalPath, parentIndex})` — the existing request, now
  functional because D11 fixed the URI it produces.
- **`ReviewFilesPane` loses its `DiffView` branch** and the `diffActions` capability override
  (`:50-53`) with it. Selecting a file calls the new `editor.openRangeDiff` (D1) with the pane's own
  `(base, branch, path, originalPath, status)`. The Since-review / Full-range toggle
  (`:111-129`) **stays** and selects which two revisions are compared:
  - `range` → `base` … `branch`,
  - `sinceReview` → the file's `reviewedAtSha` (already on `review.fileDiff`'s result,
    `contract.ts:1041`) … `branch`, falling back to `range` when it is `null` (never reviewed).
  This is the one place where removing the in-webview diff would have lost a real capability, and
  this is how it is kept.
- **`review.fileDiff` is still called**, and is not dead: the pane needs `deltaSource`,
  `reviewedRanges` and `lineCount` for the per-file reviewed marks and the status line. Only the
  rendered `body` stops being displayed. Whether the server should stop *sending* the body is a real
  question and is deliberately **not** answered here — it is a wire change on a request this phase is
  already at its budget for, and §11 hands it to G13.
- **`DiffView.vue` itself is untouched.** The graph panel's detail pane still uses it, correctly.

**What this costs in G12, and what is explicitly *not* being given up.** The range-level "mark
reviewed" gutter affordance (G11 D16's `ReviewDiffAdornment`, `ReviewFilesPane.vue:63-74`) lives
inside `DiffView` and has no home in this phase once the diff leaves the webview. **Whole-file**
marking survives untouched — `FileTree`'s own per-row toggle (`FileTree.vue:415-424`) and the
`toggleFileReviewed` palette command (`ReviewView.vue:95-106`) — and is G12's **interim** state.

**Range-level marking is deferred, not dropped** (resolved, §12.2): a later phase reinstates it
*inside VS Code's native diff editor*, modelled on the built-in Git extension's own hunk-staging
gutter. Two properties of this plan make that a UI-only phase rather than a rework, and both are
why it is safe to ship the interim state:

- **The server side already carries ranges and G12 does not touch it.** `review.mark`'s params are
  `{repoId, branch, path, reviewed, ranges?: readonly LineRange[]}` (`contract.ts:1050-1059`) —
  the optional `ranges` is already there — and `review.fileDiff` already returns `reviewedRanges`
  (`:1039`) projected onto current content by G11's own fast/slow path. **No new RPC, no
  `CONTRACT_VERSION` bump, and no `internal/gitreview` change** is needed to restore the feature.
- **This phase's own `review.fileDiff` call is retained precisely because of that** (the bullet
  above): the pane keeps fetching `deltaSource`/`reviewedRanges`/`lineCount`, so the data a gutter
  would render is still on the client when the later phase wants it.

§11 carries the concrete direction and its dependencies forward; the design itself belongs to that
phase's own Opus planning pass, exactly as this chapter already defers G18/G19/G21.

### D13 — One panel-level toolbar: `FileTree`'s own becomes opt-out, and the review view owns a single instance

Item 8's second half, fixing F11. `FileTree.vue` gains one prop:

```ts
/** Whether this instance renders its own filter/list-mode toolbar. False when a panel above it
 *  owns one for several trees at once (the review sidebar, G12) — the graph's detail pane, which
 *  mounts exactly one tree, leaves it true. */
showToolbar?: boolean; // default true
```

`filter` and `listMode` remain **props with `update:` emits**, unchanged — only the control that
edits them moves. So:

- `DetailPane.vue` (graph) passes nothing and keeps today's behaviour byte for byte.
- `ReviewView.vue` renders **one** toolbar in its header row, beside the Commits/Files toggle, and
  holds `listMode`/`filter` as its own refs. It passes them down to every `ReviewCommitRow` (which
  forwards to its `FileTree` with `:show-toolbar="false"`) and to `ReviewFilesPane`.
- `ReviewSessionState`'s per-row `DetailState.listMode`/`filter` stop being the source of truth for
  the review view. They are not deleted — `DetailState` is shared with the graph — the review view
  simply stops reading them and drives every row from one place. `ReviewCommitRow`'s
  `@update:list-mode`/`@update:filter` handlers are removed rather than left wired to state nothing
  renders.
- The toolbar is visible for both panes (Commits and Files), because both are file lists and a
  filter that disappears when you switch tabs is its own bug.

### D14 — The review sidebar adopts Kira Studio's *structural* design language; every colour keeps deriving from the user's VS Code theme

Item 9. **Re-derived after the fixed-palette skin this plan first proposed was rejected** — the
sidebar must read as Kira Studio in spacing, layout, panel/toolbar anatomy, control geometry, icon
usage and composition, while its actual colours keep following whatever theme the user has active in
VS Code (light, dark or high contrast), through the `--kv-*` → `--vscode-*` derivation F12 describes.

**Why the split is clean rather than a compromise: Kira Studio's own stylesheet already makes it.**
Every primitive separates geometry from colour, declaration by declaration —

| Primitive | Geometry (taken) | Colour (not taken) |
|---|---|---|
| `.p-toolbar` (`primitives.css:744-752`) | `height: --kira-toolbar-h`, `gap: --kira-s-3`, `padding: 0 --kira-s-4`, `border-bottom: --kira-border-width` | `--kira-border` |
| `.p-panel` (`:720-728`) | `border-radius: --kira-radius`, `border-width`, flex column, `min-height: 0` | `--kira-border`, `--kira-bg` |
| `.p-panel-head` (`:729-741`) | `height: --kira-control-h-lg`, `gap: --kira-s-2`, `padding: 0 --kira-s-3`, `font-size: --kira-t-sm`, `text-transform: uppercase`, `letter-spacing: .05em` | `--kira-fg-muted`, `--kira-border` |
| `.p-seg` (`:452-469`) | `height: --kira-control-h`, `border-radius: --kira-radius-sm`, `padding: 0 --kira-s-3`, `font-size: --kira-t-sm`, `overflow: hidden` | `--kira-border-strong`, `--kira-fg-muted` |
| `.p-iconbtn` (`:35-52`) | `height`/`width: --kira-control-h` (a square), `border-radius: --kira-radius-sm` | `--kira-hover`, `--kira-fg`, `--kira-bg-input` |
| `.p-btn` (`:70-87`) | `height: --kira-control-h`, `gap: --kira-s-2`, `padding: 0 --kira-s-3`, `border-radius: --kira-radius-sm`, `font-size: --kira-t-sm` | same three |

So "reuse Kira Studio's design" is implementable as: **take the left column verbatim, and for the
right column substitute the `--kv-*` token that already resolves to the user's theme.** No colour
literal is transcribed, nothing is duplicated that could drift, and the sidebar inherits every
light/high-contrast correction `vscode-tokens.css` already carries.

**A new `packages/git-ui/src/theme/kira-structure.css`**, containing **only colourless tokens**,
scoped under one root class so it cannot reach the graph panel by accident:

```css
/* Kira Studio's structural scales (G12 item 9), transcribed from
   apps/kira-studio/frontend/src/theme/tokens.css — spacing, type, control heights, radius tiers,
   font roles. COLOUR IS DEFINED NOWHERE IN THIS FILE, by design: the review sidebar follows the
   user's VS Code theme through vscode-tokens.css exactly as the graph panel does. Scoped to
   .kv-skin-kira rather than :root so density.css's own (workbench-shaped) scale keeps governing
   the graph panel unchanged. */
.kv-skin-kira { … }
```

| Role | Added as | Value, from Kira Studio | Today in `--kv-*` |
|---|---|---|---|
| Space scale | `--kv-s-1` … `--kv-s-6` | 2 / 4 / 6 / 8 / 12 / 16 px (`--kira-s-*`) | `--kv-space-1..5` = 2/4/8/12/16 — five steps, no 6px |
| Type scale | `--kv-t-xs`/`sm`/`md`/`lg` | `calc(--kv-font-size - 2px)` … `+1px` (`--kira-t-*`'s own derivation, so it still tracks the host's font size) | none — one `--kv-font-size` |
| Control heights | `--kv-h-xs`/`sm`/`md`/`lg`, `--kv-icon-box` | 18 / 22 / 26 / 30 px, 16 px (`--kira-h-*`, `--kira-icon-box`) | none |
| Control-height *roles* | `--kv-control-h`, `--kv-control-h-lg` | `--kv-h-sm` (toolbar density), `--kv-h-md` (panel-head density) — Kira's own aliasing, kept because it is what makes "one step taller everywhere" a single edit | none |
| Radius tiers | `--kv-radius-sm`, `--kv-radius-panel` | 4 px, 6 px (`--kira-radius-sm`, `--kira-radius`) | `--kv-radius: 0px` |
| Bar height | `--kv-bar-h` | 34 px (`--kira-bar-h`) | `--kv-toolbar-height: 35px` |
| Border width | `--kv-border-width` | 1 px (`--kira-border-width`) | none (literals) |
| Font roles | `--kv-font-ui`, `--kv-font-data` | Kira's fixed system-sans stack, and `--kv-font-family` respectively | one `--kv-font-family` for everything |
| Shadow **geometry** | `--kv-shadow` | `0 2px 8px` (`--kira-shadow`'s offsets/blur) composed with the existing `--kv-widget-shadow` **colour** | a colour only |

Three things this deliberately does **not** do:

- **`density.css` is not re-valued.** Changing `--kv-space-3` from 8 px to 6 px globally would
  restyle the graph panel, which item 9 does not ask for. New names alongside the old ones, scoped
  to the review root — so the graph panel is byte-identical by construction, not by discipline.
- **`--kv-radius: 0px` stays exactly as written**, comment included ("the workbench has square
  corners; we do not invent rounded ones"). That is a real decision for a panel that sits in the
  VS Code workbench and it still holds there. The review sidebar uses the new tiers instead; the
  two coexist because they describe two surfaces with two design languages, and §12.2 records that
  the graph panel keeps the workbench one.
- **`vscode-tokens.css` is not touched at all** — not its `:root` block, not `body.vscode-light`,
  not `body.vscode-high-contrast`. This is the checklist item (§8.4) that makes the coordinator's
  requirement mechanically verifiable rather than a claim.

**What changes in the review sidebar**, concretely — five control kinds and one page anatomy:

| Surface | Today | Becomes |
|---|---|---|
| The header (`ReviewView.vue:456-494`) | one flex row of mixed-height items | a `.p-panel-head`-shaped **view head** (`--kv-control-h-lg`, uppercase `--kv-t-sm` label, `--kv-s-3` padding) carrying the branch name and base selector |
| The new panel toolbar (D13) | — | a `.p-toolbar`-shaped bar: `--kv-bar-h`, `--kv-s-3` gap, `--kv-s-4` inline padding, one bottom border, holding only `--kv-control-h` controls (Kira's own stated law at `primitives.css:743`) |
| Commits/Files and Tree/Flat and Since-review/Full-range toggles | ad-hoc bordered buttons | `.p-seg`-shaped segmented groups: one bordered container, `--kv-radius-sm`, `--kv-control-h`, children `--kv-t-sm` |
| Icon buttons (D16) | text buttons | `.p-iconbtn`-shaped squares: `--kv-control-h` on both axes, `--kv-radius-sm`, `--kv-icon-box` glyph |
| Load more (`:558-567`) | full-width bordered button | `.p-btn`-shaped: `--kv-control-h`, `--kv-radius-sm`, `--kv-s-3` padding |
| Rows (commit rows, file rows) | `--kv-space-*` padding | `--kv-s-*` padding on Kira's rhythm, row height `--kv-control-h` |

**Plus Kira Studio's font law, which is structure, not colour.** `docs/design/kira-design-system`'s
LAW 08, quoted in `tokens.css`'s own comment: *"Mono is for data. If a string came out of a database
— a value, an identifier, a query, a duration — it is mono. If the app wrote it, it is UI."* The
review sidebar renders both and currently sets one family for everything
(`ReviewView.vue:609`). Applied here: a sha, a branch name, a base ref and a file path are
**data** → `--kv-font-data`; headings, button labels, counts, status lines and empty-state copy are
**UI** → `--kv-font-ui`. This is the single change that most makes the panel read as Kira Studio, and
it costs two token references.

**D12 shrinks what has to be restyled**, which is why these two items belong in one phase: once the
review view renders no `DiffView`, its only surface shared with the graph panel is `FileTree`, whose
rows are already token-driven — so it picks up the scoped scale from its ancestor and needs no
component-level fork.

**Rejected: the fixed `--kv-*` colour skin this plan originally proposed.** It would have broken
every light and high-contrast user, duplicated a palette that then drifts from Kira Studio's real
one with no guard, and thrown away `vscode-tokens.css`'s own WCAG-verified light-theme block
(`:147-161`) — three costs for an appearance item. Rejected by the user, and correctly.

**Rejected: a `kiraVersion.review.theme` setting.** Unchanged from this plan's first pass, and now
moot: with colours theme-derived there is nothing left for such a setting to switch.

`scripts/check-tokens.sh` still does not cover `packages/git-ui` (its `--kira-*` grep matches nothing
in a `--kv-*` file), and is still not extended to. The guard that matters here is narrower and is a
checklist item instead: **`kira-structure.css` contains no colour** — no hex literal, no `rgb(`, no
`color`/`background`/`border-color` property — which is one `grep` and cannot be argued with.

### D15 — The extension icon becomes Kira Studio's own app icon; the README is short and real

Item 10, fixing F13.

- **`resources/icon.png` is replaced** by a 128×128 downscale of `apps/kira-studio/build/appicon.png`
  (Kira Studio's own 1024×1024 app icon), committed as a binary asset. It is generated once, with the
  command recorded in this plan so it is reproducible rather than folklore:
  `python3 -c "from PIL import Image; im=Image.open('apps/kira-studio/build/appicon.png').convert('RGBA'); im.resize((128,128), Image.LANCZOS).save('apps/kira-studio-vscode/resources/icon.png')"`.
  No build step, no new dependency, no tool needed at package time — `vsce` reads the committed file.
- **`resources/icon.svg` and `resources/review-icon.svg` do not change** (F13). VS Code tints
  view-container icons to the theme's foreground colour; a full-colour mascot there renders as a
  silhouette, which is worse than the current monochrome glyph, not better.
- **`apps/kira-studio-vscode/README.md`** — genuinely short, four sections and no more: what it is
  (Kira Studio's git graph, branch review and remote operations, inside VS Code); how it connects
  (Kira Studio runs the git backend and this extension dials `~/.kira-studio/git.sock`; the first
  connection asks for approval in Kira Studio's own window, once per editor installation); basic
  usage (the Git Graph panel, the Branch Review activity-bar view, the `Kira Version:` command
  palette prefix, the status-bar item); and requirements (macOS, Kira Studio running, git ≥ 2.38).
  It states the version-lockstep rule in one sentence, because that is the failure a user is most
  likely to hit and least likely to diagnose.
- `.vscodeignore` is an exclusion list (G10 D4), so the README ships without an edit; the
  `verify-packaging.sh` check that the `.vsix` contains what it should gains one line for it.

### D16 — Every text-label button in the review panel becomes an icon button, from the existing codicon set

Item 11's second half. The set is `packages/git-ui/src/icons/index.ts`'s three maps — `ACTION_ICONS`,
`BADGE_ICONS`, `STATE_ICONS` — over `@vscode/codicons`, already bundled (the manifest lists
`assets/codicon-CMYWzYni.ttf`). No new icon library, and no invented glyph.

| Control (file) | Today | Becomes |
|---|---|---|
| Commits / Files pane toggle (`ReviewView.vue:472-487`) | text `Commits` / `Files` | `codicon-git-commit` / `codicon-files`, `aria-pressed` unchanged |
| Tree / Flat toggle (`FileTree.vue:336-350`, now panel-level per D13) | text `Tree` / `Flat` | `codicon-list-tree` / `codicon-list-flat` |
| Since review / Full range (`ReviewFilesPane.vue:112-127`) | text | `codicon-diff` / `codicon-diff-multiple` |
| Load more (`ReviewView.vue:558-567`) | text incl. a count | **stays text** — it carries a number ("Load more (412 remaining)") that no icon can say |
| Stale-comparison Refresh (`ReviewView.vue:534`) | text `Refresh` | `ACTION_ICONS.refresh` |

Three rules the conversion follows, so it does not become an accessibility regression:

1. **Every icon-only button keeps an `aria-label` and a `title`** carrying the text it replaced. An
   icon with no accessible name is a worse button, not a smaller one.
2. **`aria-pressed` stays** on both toggle groups — icon-only or not, they are still toggles.
3. **A button whose label carries data is not converted.** Load more is the only one, and it stays.
   This is the rule, not the exception list: an icon replaces a *name*, never a *value*.

### D17 — What gets a test, and what does not

`CLAUDE.md`'s bar, applied per item rather than as a blanket. **Four tests, and the reason each one
clears the bar:**

| # | Test | Why it earns its place |
|---|---|---|
| **D5** | `packages/git-ipc/src/socketChannel.test.ts` gains: two frames delivered in one `socket.on('data')` pass with the subscriber swapped between them arrive **both**, in order | Frame ordering across a subscriber handover — `CLAUDE.md`'s named "concurrency (ordering…)" category, and the exact bug that shipped. Invisible to typecheck, to the Go tier, and to any tier without a real socket |
| **D3** | `internal/gitsock`'s existing integration tier gains one test: pair → revoke → re-dial with the token (`tokenRejected`) → re-dial with none → approve → **`ready`**, and the client list shows one un-revoked row | A decision structure with a persistence side effect, whose failure mode is a silent `pairingDenied`. Reproduced above as a probe; this is its permanent form. Runs here, no VS Code needed |
| **D11** | `apps/kira-studio-vscode/src/virtualKey.test.ts` (new) — `encodeKey`/`decodeKey` round trip over a corpus: an absolute repo root, a path with a space, a non-ASCII filename, a rename's `originalPath` | A format round trip **with** a real edge case (the leading `/` that threw), in a host this container cannot run. Exactly the case the bar keeps rather than deletes |
| **D1** | `apps/kira-studio-vscode/src/commands.test.ts`'s existing contract cross-checks extend to the new `editor.openRangeDiff` key | Not a new test — one more assertion in the file that already keeps the manifest, the table and Go's `opTable` in agreement. Free |

**Everything else gets nothing, deliberately:**

- **D4** (client id) — two branches over one `globalState` read. A one/two-condition read is the
  bar's own named exclusion.
- **D6/D7** (boot ordering, auto-open) — real logic, but its failure mode is visible in the first
  seconds of using the extension, and testing it needs a mounted Vue app against a mock transport,
  which `packages/git-ui` has no harness for. Building one to guard a loop over `repo.list` is not
  proportionate; §11 hands the harness question forward rather than pretending a token test covers it.
- **D8** (window activation) — a Wails call this container cannot make. A test would assert that a
  fake was called, which is a test of the fake.
- **D9/D12/D13/D14/D16** — template and CSS changes. `vue-tsc` is the guard that already exists,
  and D14's own guarantee (no colour in `kira-structure.css`, `vscode-tokens.css` unchanged) is a
  `grep` and a `git diff`, not something a test would say better.
- **D10** (status bar) — a switch over five states writing strings onto a `vscode.StatusBarItem`.
  The in-flight counter is two increments and a decrement in a `finally`; if it were subtler it would
  earn one, and if a reviewer thinks it is, that is the signal to simplify it rather than test it.
- **D15** — a binary asset and a Markdown file.

### D18 — Pairing scope, recorded: per editor installation, and not repo-scoped now or before

Item 2's judgment call, written down so a later phase does not re-derive it (SPEC's own G12 row will
still read "re-examines why pairing is repo-scoped at all", and the answer is that it never was).

**The trust boundary is the editor installation's OS-level access to the socket**, and nothing
narrower is enforceable: `${KIRA_HOME}/git.sock` is 0600 inside a 0700 directory (SPEC §3.1), so any
process running as that user can dial it, and a per-repo grant would gate a capability the OS has
already granted. A paired extension can already `repo.open` any path on the machine — that is the
design, and per-repo prompts would have been UX theatre over an unenforced boundary rather than a
security control.

**What genuinely is per-repo, and stays that way:** `gitsession.Registry`'s `RepoEntry` refcounts and
`Conn.held` (SPEC §6). Those are session lifetime, not trust, and item 2 does not touch them.

**So there is no alternative UX to propose**, and none is proposed: D3, D4 and D5 remove the three
things that made a per-editor model behave like a per-repo one, and the model itself is already what
item 2 asks for.

---

## 3. The Go side, file by file

Small. Four files, one of them `main.go`.

### 3.1 `internal/storage/repos/gitclients.go` — edited (D3)

`Insert` → `UpsertOnPair`, with the `ON CONFLICT(id) DO UPDATE` clause spelled out in D3. One
sentence of doc comment on why the conflict path exists (a revoked client re-approved by the user)
and on what it deliberately preserves (`created_at`) and replaces (the token material). No migration:
the schema is unchanged — this is a different statement against the same table.

### 3.2 `internal/gitsock/handshake.go` — edited (D3, F14)

`handshakeDeps`' `Clients` (the `TrustStore` interface `server.go` declares) renames its method to
match. `finishPairing`'s persist-failure branch logs at `slog.Error` rather than `slog.Warn`, with
the client id and the error; the frame it sends is unchanged (`pairingDenied`), because the protocol
has no better one and §12.3 hands that question forward.

### 3.3 `internal/gitrpc/contract.go` — edited (D1)

`ContractVersion` 18 → 19, with the same shape of comment G10 D9 and G11 D1 already left: what moved,
why, and — as with `ui.action` — that the Go server neither emits nor parses the new method, since it
is answered inside the extension.

### 3.4 `apps/kira-studio/main.go` — edited (D8)

One subscription and one helper, placed beside the existing `attachDialogs` block so the
"which window" logic sits next to the only other code that answers the same question:

- `pairingActivator(app, windows, notifier)` — the edge-latched callback from D8, registered via
  `gitSock.OnPairingChanged(...)` and unsubscribed in the same shutdown path that already tears the
  other subscriptions down.
- `application.NewService(notifications.New())` added to the service list (`main.go:284-301`), and
  the notifier's lazy authorization request.

Nothing in `internal/git*` changes for this. `TestDomainPackagesDoNotImportBridge` stays green by
construction.

### 3.5 `internal/gitsock/*_test.go` — one new test (D17)

The revoke-then-re-pair integration test, in the existing `gitsock` integration tier, reusing
`newIntegrationServer`/`dialTestClient`/`approveHead` exactly as the probe did — no new harness.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ipc/src/socketChannel.ts` — edited (D5a)

The bounded pending-frame queue and the flush-on-subscribe, as specified. `post`, the framing, the
blob-frame path and the size cap are untouched.

### 4.2 `packages/git-ipc/src/socketChannel.test.ts` — edited (D17)

One test: a fake `Socket` emits a single `data` buffer containing two complete frames; the handler
installed for the first unsubscribes itself and a second is installed synchronously after; both
frames arrive, in order. Fails on the pre-fix tree.

### 4.3 `packages/git-ipc/src/contract.ts` and `validate.ts` — edited (D1)

`editor.openRangeDiff`'s params/result on `Contract["requests"]`, its key in `REQUEST_KEY_MAP`, and
`CONTRACT_VERSION` 18 → 19 with the comment convention the file already uses.

### 4.4 `apps/kira-studio-vscode/src/connection.ts` — edited (D4, D5b, D6.2, D10)

The single-handler handshake, `resolveClientId`, the new `clientLabel`, `whenConnected(signal)`, and
the in-flight counter with its `onActivityChange` emitter. The reconnect/backoff state machine, the
five handshake outcomes and the token handling are otherwise unchanged.

### 4.5 `apps/kira-studio-vscode/src/proxyHandlers.ts` — edited (D1, D6.2, D12)

`app.init` awaits `whenConnected` before forwarding; `editor.openRangeDiff` is added as a
locally-answered handler that composes two `DocumentRef`s from `(base, branch, path, originalPath,
status)` and calls `editor.openDiff` on the port — the same composition `editor.openDiff`'s own
handler does, minus the `commit.detail` round trip, because the caller already knows both revisions.

### 4.6 `apps/kira-studio-vscode/src/ports/editorIntegration.ts` — edited (D11)

`encodeKey`/`decodeKey`, the `.empty` sentinel, and `provideTextDocumentContent`'s decode. `openDiff`,
`reveal` and `resolveConflict` keep their bodies; only `toUri` changes underneath them.

### 4.7 `apps/kira-studio-vscode/src/virtualKey.ts` + `virtualKey.test.ts` — edited / new (D11, D17)

`encodeKey`/`decodeKey` live here rather than in the port, so the test needs no `vscode` import —
the same reason `commands.ts` holds the palette table (its own doc comment). The port imports them.

### 4.8 `apps/kira-studio-vscode/src/extension.ts` — edited (D10)

`updateStatusBar` becomes the state table, `backgroundColor` handling and the per-state command;
`manager.onActivityChange` joins `manager.onStateChange` as a second trigger.

### 4.9 `apps/kira-studio-vscode/package.json` + `README.md` + `resources/icon.png` — edited / new (D15)

Nothing in the manifest changes except that the `icon` path now points at a different file's bytes.

### 4.10 `packages/git-ui/src/bridge/client.ts` — edited (D6.1)

`init()` clears `#initPromise` on rejection before rethrowing.

### 4.11 `packages/git-ui/src/App.vue` — edited (D6.3, D7)

The `bootError` ref, its panel outside the `v-if="repoState"` gate with a Retry button, and
`bootstrap()`'s auto-open loop.

### 4.12 `packages/git-ui/src/components/review/ReviewView.vue` — edited (D6.3, D12, D13, D14, D16)

The largest single file in the phase: the diff overlay comes out, the panel toolbar goes in, the
`kv-skin-kira` class lands on the root (D14's structural scale, no colour), the header becomes a
view head, the two toggles become icon segmented groups, the data/UI font split is applied, and
`bootError` gets the same treatment as `App.vue`'s.

### 4.13 `packages/git-ui/src/components/review/ReviewFilesPane.vue` — edited (D12, D13, D16)

The `DiffView` branch and the `diffActions` override come out; file selection calls
`editor.openRangeDiff`; the mode toggle becomes icons and its `listMode`/`filter` become props.

### 4.14 `packages/git-ui/src/components/review/ReviewCommitRow.vue` — edited (D12, D13)

`FileTree` gets `:show-toolbar="false"` and the panel's `listMode`/`filter`; file selection calls
`actions.openInEditor` instead of opening the in-webview diff.

### 4.15 `packages/git-ui/src/components/FileTree.vue` — edited (D13, D16)

The `showToolbar` prop and the two icon buttons. **`DetailPane.vue`'s call site is not edited** —
the default keeps the graph panel byte-identical.

### 4.16 `packages/git-ui/src/theme/kira-structure.css` — new (D14)

Kira Studio's colourless scales under `.kv-skin-kira`, plus its import in the review entry.
**`vscode-tokens.css` and `density.css` are both untouched** — the new file adds names beside them
and re-values nothing, which is what keeps the graph panel byte-identical and every theme working.

### 4.17 `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts` — edited (D1)

Its hand-mirrored `CONTRACT_VERSION` 18 → 19. Its *Connected editors* assertions are untouched, by
D9's design.

---

## 5. The Wails frontend

`apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` only (D9): one entry in `sections`, one
template branch moved, no script changes beyond nothing — `protectedBranchesText`,
`onFetchAutoIntervalInput`, `resetProtectedBranches` and the rest keep working from the new branch
unchanged, because they were never scoped to a section.

No change to `GitPairingDialog.vue`, `state/gitClients.ts` or `bridge/` — D8's activation is entirely
Go-side, and the pane's own refresh path is already correct (F2).

---

## 6. Dependencies and tooling

**None added.** Every mechanism this phase uses is already in the tree or already in the pinned Wails
module:

- `Buffer.from(…, 'base64url')` — Node/Bun builtin (D11).
- `vscode.env.machineId`, `vscode.StatusBarItem.backgroundColor`, `ThemeColor` — `@types/vscode`
  1.134.0, already pinned (D4, D10).
- `WebviewWindow.Show/Restore/Focus` and `pkg/services/notifications` — `wails/v3` beta.16, already in
  `go.mod` (D8).
- `@vscode/codicons` — already a devDependency and already bundled into `dist/ui` (D16).
- Python PIL for the one-off icon downscale (D15) — a local tool, not a repo dependency; the output
  is a committed file.

---

## 7. Implementation order

Ten commits. The ordering is not cosmetic: **C1–C3 must land first**, because until the extension can
actually connect, nothing downstream of it can be observed at all — including whether the rest of the
phase worked.

| # | Commit | Covers |
|---|---|---|
| **C1** | `fix(ipc): never drop a frame delivered between two subscribers` | D5a + its test (§4.1, §4.2) |
| **C2** | `fix(vscode): keep one handshake reader, so the ready frame after pairing is not lost` | D5b (§4.4's handshake half) |
| **C3** | `fix(gitsock)!: re-pairing a revoked editor upserts its trust row` | D3, F14's log level, §3.1–§3.2, §3.5's test |
| **C4** | `fix(vscode): one client identity per editor installation` | D4 (§4.4's identity half) |
| **C5** | `fix(git-ui): a webview whose app.init fails says so, and can retry` | D6 (§4.10, §4.11's error half, §4.12's error half) |
| **C6** | `feat(git-ui): open the workspace's own repository automatically` | D7 (§4.11's auto-open half) |
| **C7** | `fix(vscode): base64url the virtual-document key so Uri.parse can carry it` | D11 + its test (§4.6, §4.7) |
| **C8** | `feat(ipc)!: editor.openRangeDiff, and the review sidebar's diffs move into VS Code — CONTRACT_VERSION 19` | D1, D12 (§4.3, §4.5, §4.12–§4.14, §4.17) |
| **C9** | `feat(git-ui): one review toolbar, icon buttons, and Kira Studio's structural design` | D13, D14, D16 (§4.12–§4.16) |
| **C10** | `feat: foreground on pairing, a real connection indicator, the Connected editors tab, the app icon and a README` | D8, D9, D10, D15 (§3.4, §4.8, §4.9, §5) |

C10 batches four independent, small, non-overlapping changes rather than spending four commits on
them; every other commit is one decision. C7 **must** precede C8 — routing diffs into VS Code before
the URI they use stops throwing would ship a feature that fails on first click.

---

## 8. Exit criteria, and exactly how each is proven

### 8.1 Tier 1 — fully provable in this container, and expected green

1. `go build ./apps/kira-studio/internal/...` and `go vet` clean.
2. `go test -race -count=1` over SPEC's scoped git list (`gitclient`, `gitclient/porcelain`,
   `gitclient/catfile`, `gitclient/logsession`, `gitpreflight`, `gitops`, `gitsession`, `gitrpc`,
   `gitsock`, `gitstore`, `gitwire`, `gitreview`, `gitaskpass`, `bridge`, `bridge/rpcstream`,
   `internal` for the layering test) — green, **including the new revoke-then-re-pair test, which
   fails on the pre-C3 tree with `kind=pairingDenied`.**
3. `bun run typecheck` (all five projects) green.
4. `bun run lint` green.
5. `bun run test:unit` green, including the two new tests (socket-channel handover, virtual-key
   round trip) — **both fail on the pre-fix tree**, which is the property that makes them worth
   having.
6. `bun run build:vscode` produces both bundles and passes its own bundle checks.
7. `bun run package:vscode` produces a `.vsix` containing `README.md` and the new
   `resources/icon.png`; `scripts/verify-packaging.sh` green.
8. **The end-to-end socket probe from F5, re-run against the fixed `connection.ts` handshake**, now
   passes through `pairingRequired → paired → ready` and streams a correct graph — the same
   transcript F5 quotes, reached through the real client shape rather than a hand-written one.
9. `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts` green with `CONTRACT_VERSION` 19,
   including its *Connected editors* click (unchanged by D9).

### 8.2 Tier 2 — provable here only as a type/unit check plus a reasoned argument

Each of these is real work whose *result* cannot be observed without a running VS Code. What is
provable here is named; what is not is not claimed.

- **D7 (auto-open).** Provable: `vue-tsc`, and the loop's own logic read against `repo.list`'s
  contract. Not provable: that a real multi-root workspace opens the right folder.
- **D10 (status bar).** Provable: the state table typechecks against `ConnectionState`'s five
  members and `vscode.StatusBarItem`'s API. Not provable: that the item renders, that the spinner
  animates, or that the error background reads as intended.
- **D14/D16 (structural scale, icon buttons).** Provable, and mechanically: `vue-tsc`; that
  `kira-structure.css` contains **no colour** (one `grep` for a hex literal, `rgb(`, or a
  `color`/`background`/`border-color` property); and that `vscode-tokens.css` and `density.css` are
  byte-identical to before, which is what proves every theme still works. Not provable: how it
  looks.
- **D15 (icon).** Provable: the file is 128×128 RGBA and is inside the `.vsix`. Not provable: how it
  renders in the Extensions list.

### 8.3 Tier 3 — needs a human on a Mac, with VS Code and Kira Studio both running

The script, in order, because several steps depend on the one before:

1. Install the freshly built `.vsix` into a VS Code that has **never** paired with this Kira Studio
   (or revoke the existing row first). Open a folder that is a git repository.
2. **Item 3:** approve nothing yet — confirm Kira Studio's window comes to the front by itself when
   the request arrives. Repeat with Kira Studio minimised (`Restore`) and with all its windows closed
   (expect a notification, in a **packaged** build only — D8's stated limit).
3. **Items 5 + 2 + 1's cure:** approve. Confirm the graph renders **on this first connection**, with
   no reload — the exact thing that fails today (F1).
4. **Item 6:** confirm no "Open a repository" panel appeared at any point; the workspace's repo opened
   itself. Then open a second window on a *different* repo and confirm it connects with **no second
   approval** (item 2).
5. **Item 1:** revoke that editor in Settings → Connected editors. Confirm the extension re-prompts,
   approve, and confirm **a live row reappears in the list** and the graph comes back — today this is
   `pairingDenied` and an empty list (F2).
6. **Item 7:** quit Kira Studio. Confirm the status-bar item switches to a visible broken state
   rather than vanishing; restart it and confirm the item recovers.
7. **Items 8 + 11:** in the Branch Review sidebar, open a file from the Commits tab and from the Files
   tab. Confirm **both** open VS Code's native diff editor with real content on both sides — today
   the first throws `UriError` and the second renders in the webview (F9, D12). Confirm one toolbar,
   not one per commit.
8. **Item 9:** confirm the sidebar reads as Kira Studio *structurally* — spacing, the view head and
   toolbar, segmented toggles, icon-square buttons, mono for shas/branches/paths and UI font for
   chrome. Then switch VS Code to a **light** theme and to a **high-contrast** theme and confirm the
   sidebar recolours with them and stays legible (§12.2's resolved answer — this is now a
   verification, not an open question). Confirm the **graph** panel looks unchanged.
9. **Item 4:** Settings shows *Connected editors* (pairing only) and *Git* (the two settings), and
   Save still works on the latter.
10. **Item 10:** the Extensions list shows Kira Studio's icon and the README's details page.

### 8.4 The checklist

- [ ] `CONTRACT_VERSION` is **19** in all three hand-maintained places and nowhere is it 18.
- [ ] `git diff --stat` shows **no** change to `internal/gitclient/**`, `internal/gitstore/**`,
      `internal/gitwire/**`, `packages/git-ipc/schema/**` or `packages/git-ipc/src/generated/**` —
      F5 proved the pipeline healthy and this phase has no business in it.
- [ ] No `internal/git*` file imports `internal/bridge` or `wails`; the layering test is green.
- [ ] `packages/git-ui/src/components/DiffView.vue` still exists and is still used by
      `DetailPane.vue` (D12 removes it from the *review* view only).
- [ ] `FileTree.vue`'s `showToolbar` defaults to `true` and `DetailPane.vue`'s call site is unedited.
- [ ] Every icon-only button added by D16 has both `aria-label` and `title`; Load more is still text.
- [ ] `settings-section-Connected editors` still exists and still contains
      `git-client-row-*`/`git-client-revoke-*`.
- [ ] The two new tests fail on the pre-fix tree and pass after. (Not a hope: run them at C1/C7
      against a stash of the fix.)
- [ ] `packages/git-ui/src/theme/kira-structure.css` contains **no colour**: `grep -nE
      "#[0-9a-fA-F]{3,8}|rgb\\(|oklch\\(|(^|[^-])(color|background|border-color):"` finds nothing.
- [ ] `packages/git-ui/src/theme/vscode-tokens.css` and `density.css` are **byte-identical** to
      before this phase — the property that keeps light, dark and high-contrast themes working, and
      the graph panel unrestyled.
- [ ] `resources/icon.svg` and `resources/review-icon.svg` are byte-identical to before.
- [ ] No new dependency in `package.json` or `go.mod`.

---

## 9. Sequencing

**One implementer, sequentially.** The temptation is to split "Go + Wails" from "extension +
webview", and it is wrong here for a specific reason rather than a general one: **C3 (Go) and C2
(extension) are two halves of one user-visible flow**, and the only way to know either is right is to
run the pairing handshake end to end after both have landed. A parallel split would have one agent
proving the server answers `ready` and another proving the client would have read it, with nobody
proving the pair.

The one defensible cut, if a second agent is genuinely wanted: **C10's four items** (window
activation, status bar, settings tab, icon + README) touch four files nothing else in the phase
touches, and depend on nothing C1–C9 changes. They can run alongside C5–C9 once C1–C4 have landed.
Everything before that is order-dependent.

---

## 10. Explicit non-goals for G12

| Not this phase | Why | Where |
|---|---|---|
| Any new git feature | This is a defect batch | G14–G19 |
| Restyling the graph webview | Item 9 says "the review sidebar"; D14's tokens are scoped to the review root | §12.2, resolved: it keeps the workbench language |
| Deleting `DiffView.vue` | The graph's detail pane still needs it | — |
| Making `review.fileDiff` stop sending a body nothing renders | A wire change on a request D1 is already at budget for | §11, G13 |
| Range/hunk-level "mark reviewed" in VS Code's diff editor | Real, separable work — deferred to its own phase, **not** dropped | §11.1, §12.2 |
| A "pairing failed" handshake frame distinct from `pairingDenied` | A protocol change for a path D3 removes the cause of | §12.3 |
| G8 F7's cross-instance revocation hole | Unrelated; still open | §11 |
| Any colour change at all — a fixed palette, a skin, or a `kiraVersion.review.theme` setting | §12.2 resolved item 9 as *structure only*; colours keep deriving from the user's VS Code theme | D14, §12.2 |
| A mounted-Vue test harness for `packages/git-ui` | Disproportionate to what D17 needs it for | §11 |
| Editing `docs/v1.3/SPEC.md` | A chapter spec is not retro-edited by a phase | — |

---

## 11. Handed forward

- **`review.fileDiff` sends a rendered `body` the review sidebar no longer displays** (D12). The
  fields it still needs (`deltaSource`, `reviewedRanges`, `lineCount`, `reviewedAtSha`) are cheap;
  the body is not. G13 owns whether to split them, since it is already in `review.*`'s wire surface
  for the AI-comment list.
- **`packages/git-ui` has no test harness that mounts a component** (D17). Four of this phase's items
  are template changes whose only guard is `vue-tsc`, and G11's Files pane was in the same position.
  Worth building once, by whichever later phase first needs to *assert* rendered behaviour rather
  than merely compile it — not worth building for this phase alone.
- **G8 F7 is still open**: a second Kira Studio instance renders a working *Connected editors* pane
  and its Revoke severs nothing, because `s.conns` is empty in a non-listening instance. D3 does not
  touch it (the DB write half already works; it is the "then close" half that has nothing to close).
- **`clientLabel` no longer names a workspace** (D4). If a future phase wants "which windows are
  currently connected" in the pane, that is a live-connection projection off `Server.conns`, not a
  column on `git_clients` — one row now legitimately covers N windows.
- **Range/hunk-level review marking must come back** (D12, resolved in §12.2). It is a phase of its
  own, not a fold-in here; §11.1 states the direction and its dependencies concretely enough to
  sequence, and stops short of designing it.

### 11.1 A future phase: range/hunk-level review marking inside VS Code's native diff editor

**Placeholder-then-design, the convention this chapter already uses for G18/G19/G21** — the
requirement is fixed here, the mechanism is not, and the full design (decoration lifecycle, how a
selection maps to a `LineRange`, what happens when the diff is re-opened after new commits land)
belongs to that phase's own Opus planning pass. What is fixed:

**The requirement.** G11 shipped partial, range-level "reviewed" marking inside the webview's own
diff; G12 moves every diff into VS Code's native diff editor (D12) and leaves whole-file marking as
the interim. A later phase restores range-level marking *in that native editor*, so a reviewer can
mark part of a file reviewed without leaving the diff they are reading.

**The model to follow, named:** VS Code's own built-in Git extension's hunk-staging affordance — the
per-hunk buttons it renders in the gutter of its diff editor ("stage this hunk"). The review
sidebar's equivalent is "mark this hunk reviewed" / "mark this hunk unreviewed", with already-reviewed
hunks visibly distinguished. Concretely that means editor **gutter decorations** plus per-hunk
**CodeLens** (or `editor/title`-scoped) actions attached to the right-hand document of the diff — not
a webview, and not a new panel.

**Why it is cheap, and why it can only happen after G12:**

- **No wire change.** `review.mark` already accepts `ranges?: readonly LineRange[]`
  (`contract.ts:1050-1059`) and `review.fileDiff` already returns `reviewedRanges` projected onto
  current content (`:1039`, G11's fast/slow path). The phase calls the *existing* request with a
  range payload instead of a whole-file one. No `CONTRACT_VERSION` bump, no `internal/gitreview`
  change, no `review.db` migration.
- **It needs a document to decorate**, which is what G12 creates: `editor.openRangeDiff` (D1) and the
  fixed `kira-version:` virtual-document scheme (D11). A decoration provider keys on that scheme, so
  the diff has to be opening in VS Code before there is anywhere to hang one.
- **It is extension-side only**: `apps/kira-studio-vscode/src` (a decoration/CodeLens provider plus
  two commands and their manifest entries). No Go change, and no `packages/git-ui` change — the
  sidebar's file list only needs to re-read `review.files` afterwards, which it already does.

**Suggested dependencies for the SPEC phase table** (the coordinator owns the insertion and any
renumbering; this plan does not touch `docs/v1.3/SPEC.md`):

| Field | Value |
|---|---|
| **Depends on** | **G11** (the `review.mark` `ranges` param, `review.fileDiff`'s `reviewedRanges` projection, `review.db`'s partial-review state — all already built) and **G12** (`editor.openRangeDiff`, diffs opening in VS Code's native editor, and the base64url `kira-version:` virtual-document scheme the decorations attach to) |
| **Covers upstream** | new — no upstream equivalent, same as G11/G13 |
| **Touches** | `apps/kira-studio-vscode/src` only; no Go, no `packages/git-ui`, no contract change |
| **Natural position** | after G13 (which is already in `review.*`'s surface for the AI-comment list, so the two share a review-UI context), and before the G22–G24 review rounds so it is covered by them |

---

## 12. Three calls that needed a human eye — two answered, one recorded

### 12.1 `CONTRACT_VERSION` 18 → 19, for one extension-answered request (D1)

**The call:** item 8 needs a two-revision diff request, and no existing method expresses one. This
plan adds `editor.openRangeDiff`, answered entirely inside the extension — the server never sees it
— and bumps the contract because `CONTRACT_VERSION` is the sole compatibility authority (SPEC §3.4).

**Why it is flagged rather than just done:** a bump makes every already-installed `.vsix` refuse to
talk to a newer Kira Studio and vice versa (SPEC §3.4's hard lockstep), and this is the *second*
consecutive phase to bump. G10 D9 set the exact precedent — `ui.action` also never crosses the socket
and also bumped — so the shape is established; the question is only whether item 8 is worth it now.

**The alternative, and why this plan declines it:** keep the review sidebar's diff in the webview and
do only the toolbar half of item 8. That leaves item 8's headline requirement unmet and leaves the
Files pane the one place in the extension that renders a diff itself, which is precisely the
inconsistency the item was filed about.

**Resolved: confirmed as planned.** The bump goes ahead exactly as written above — 18 → 19 for
`editor.openRangeDiff`, extension-answered, with the three hand-maintained copies and the two
totality-checked maps moving together.

### 12.2 Item 9's two questions — **both resolved**, and both changed the plan (D12, D14)

Raised as open calls in this plan's first pass; answered before implementation, and recorded here
rather than silently folded in, because each answer moved a decision rather than confirming one.

1. **Light and high-contrast VS Code themes — the fixed dark skin is REJECTED.** The original D14
   transcribed Kira Studio's palette into a `--kv-*` skin, which would have left a user on a light
   or high-contrast theme with a dark sidebar in a light window. **The answer: take Kira Studio's
   *structural* design — spacing, layout, panel/toolbar anatomy, control geometry, icon usage,
   composition — and keep every colour deriving from the user's own VS Code theme.** D14 is
   re-derived accordingly and is a materially different plan, not a softened one: no colour token is
   added or changed anywhere, `vscode-tokens.css` is byte-identical afterwards, and the new
   `kira-structure.css` is colour-free by construction (§8.4 makes that a one-`grep` checklist item).
   The re-derivation is possible at all because Kira Studio's own primitives already separate
   geometry from colour declaration by declaration — D14's first table is that seam.
2. **Range-level "mark reviewed" — the "accept the loss" framing is REJECTED.** It must remain
   possible once diffs move into VS Code's native diff view. **The answer, matching this plan's own
   assessment that it is real, separable work:** G12 ships whole-file-only marking as an explicit
   *interim* state (D12), and a later phase restores range/hunk-level marking inside VS Code's
   native diff editor, modelled on the built-in Git extension's hunk-staging gutter. §11.1 states
   that direction and its dependency list concretely — and stops there, since the design belongs to
   that phase's own planning pass, the same placeholder-then-design convention this chapter already
   uses for G18/G19/G21. D12 now records the two properties that make it a UI-only phase: the
   `ranges` payload already exists on `review.mark`, and this phase keeps fetching the
   `reviewedRanges` a gutter would render.

**One consequence worth naming, since it is now settled rather than open:** the *graph* panel keeps
the workbench design language it has today — square corners, `density.css`'s own scale — and does not
follow the review sidebar. Item 9 asked for the sidebar, D14 scopes the structural tokens to it by
class, and `--kv-radius: 0px` and its comment survive untouched.

### 12.3 `pairingDenied` is what a server-side pairing *failure* looks like (F14)

D3 removes the cause that made this matter, so nothing in this phase depends on the answer. But the
protocol still cannot distinguish "the user said no" from "the server could not persist your trust
grant", and the second is presented to the user as the first while the real reason sits in a log they
will never read. Adding a member to SPEC §3.3's handshake union is a protocol change, and this plan
will not make one for a path it is already fixing. Worth a decision by whoever owns the next
handshake change — recorded here so it is not rediscovered a third time.
