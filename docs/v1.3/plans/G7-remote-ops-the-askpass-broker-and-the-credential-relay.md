# G7 — Remote ops: fetch, push, decomposed pull, force-with-lease, protected branches, the askpass broker and the credential relay

> **What this phase is.** The seventh phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> first one where this backend talks to a machine it does not control. Every git invocation through
> G6 was local, bounded, and finished in milliseconds; G5's whole write model is built on that
> (`context.WithoutCancel`, one spawn, one result, no deadline, no progress). A fetch over a slow
> link takes ninety seconds, can be cancelled, reports progress, and — if it asks for a password
> with nowhere to answer — **hangs forever**. That last case is the one SPEC's own package table
> singles out ("the four no-hang guarantees") and it is why this phase gets its own request-key
> family, its own cancellation policy, and a whole new package whose only job is making a hang
> impossible.
>
> **It is also the first phase in this chapter where a user's real credential — an SSH passphrase,
> an HTTPS token or password — passes through Kira Studio's process at all.** Everything about that
> path is scrutinised here the way G1 scrutinised the pairing token: where the bytes go, who can
> see them, what is written down (nothing), and what happens when the far end vanishes mid-prompt.
>
> **In one line: `gitclient.Spec` grows the two fields G2 promised G7 would add (`Env`, and a live
> stderr tee) and every spawn moves from `Setpgid` to `Setsid`; a new package `gitaskpass` holds
> the `GIT_ASKPASS`/`SSH_ASKPASS` shim, its private socket and the broker; `gitops` grows
> `fetch`/`push`/`pull` argv plus the stderr progress parser SPEC's own package table names;
> `gitpreflight` grows `ClassifyPush`/`ClassifyPull` and the protected-branch glob matcher;
> `gitsession.RepoEntry` grows SPEC §6's own "active remote op (≤1)" box and an auto-fetch timer;
> `gitsession.Conn` grows the credential-waiter map that makes the relay's no-hang guarantee
> concrete; `gitrpc` serves the four `remote.*` methods the contract has declared since G1 plus one
> new `credential.provide`; `CONTRACT_VERSION` goes 15 → 16. The webview does not change. The
> extension gains its first genuinely new client-side logic since G4: answering
> `credential.request` with VS Code's own input box.**
>
> **The SPEC is authoritative and is not re-litigated here** — the shared/private split, the
> JSON-control-plane/FlatBuffers-data-plane boundary, `packages/git-ui` staying unchanged, the
> package layout and the phasing table are settled in `docs/v1.3/SPEC.md` §2, §4.2, §5 and §6.
> This plan is the *how*: the exact argv, the exact env, the exact socket protocol, the exact wire
> shapes, the exact commit sequence and the exact proof.
>
> **Six places where a literal reading of the SPEC, of upstream, or of what an earlier phase left
> behind collides with what actually works are called out and resolved with evidence** — a SPEC
> that says credential prompts appear in Kira Studio's window and, four sections later, that they
> are relayed to the VS Code connection (F2/D3); a runner whose `Setpgid` does *not* deliver
> upstream's second no-hang guarantee (F6/D6); a write gate that would freeze every window's graph
> for the length of a fetch (F8/D11); three "server-owned" settings with no server that owns
> anything (F12/D16); a stderr buffer no caller can read before exit (F5/D5); and a
> `--porcelain` push whose rejection reason never appears on stderr at all, where the existing
> error table looks for it (F10/D14).
>
> **Three of those want a human eye before implementation starts — §11. The first is
> security-relevant and is the single most consequential decision in the phase.**

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`8fb93f76`, the whole
of G1–G6). Every claim below was checked against source read or commands run in this container,
never against prose — including G1–G6's own plans, which are records of intent and are verified
against the code they produced.

| Claim | Evidence |
|---|---|
| G6 landed in full; `CONTRACT_VERSION` is **15** in three hand-maintained places | `git log --oneline`: `68409a53`…`8fb93f76`; `packages/git-ipc/src/validate.ts:7`, `internal/gitrpc/contract.go`, `tests/e2e-real/git-pairing-real.spec.ts` |
| The contract **already declares every remote type and all four `remote.*` requests and the `remote.progress` event** | `contract.ts:445-550` (`PullStrategy`, `PullStrategySource`, `RemoteOpKind`, `RefUpdate`, `PullRoute`, `PullBlocker`, `PullPreflight`, `PushPreflight`, `RemoteOpParams`, `RemoteOpResult`, `RemoteProgress`), `:1076-1100` (the four requests), `:1155` (`remote.progress`); `validate.ts:83-86`, `:101` admit all five |
| It declares **no** credential vocabulary at all | `grep -n "credential" packages/git-ipc/src/contract.ts` → nothing. `credential.request`/`credential.provide` are this phase's own additions (D2) |
| `OpErrorKind` already has all ten remote members | `contract.ts:636-694`: `AuthFailed`, `NonFastForward`, `RemoteRefMissing`, `HookRejected`, `LeaseViolation`, `RemoteRefUpdated`, `NetworkFailed`, `RemoteNotFound`, `ProtectedBranch`, `Cancelled` |
| `proxyHandlers` forwards all four `remote.*` verbatim today | `proxyHandlers.ts:255-258` |
| The **whole remote-ops webview UI is migrated and unchanged since G1** — toolbar buttons, progress affordance, cancel, force-push dialog, pull-strategy picker, the `#runRemote` executor | `packages/git-ui/src/components/AppToolbar.vue`, `components/PullStrategyPicker.vue`, `components/pullStrategyModel.ts`, `state/ops.ts:179-243` (`activeRemoteOp`, `remote.progress` subscription), `:997-1240` (`runPull`/`runPush`/`runForcePush`/`cancelRemote`/`#runRemote`/`#applyRemoteResult`) |
| `ops.ts` sends `remote.pullPreflight` with `{repoId, branch}` and always passes an **explicit** `strategy` into `remote.run` | `ops.ts:1044-1047`, `:1049`, `:1065-1078` — so only the *pre-flight* needs the `pull.strategy` setting, never `remote.run` (D2) |
| `RemoteOpResult.updates` is **read by nothing** in the migrated UI | `grep -rn "\.updates" packages/git-ui/src` → **no hits at all**; the only mention of the field anywhere in that package is a prose comment at `state/ops.ts:65` |
| The server answers `E_UNKNOWN_METHOD` for all four `remote.*` today | `gitrpc/handlers.go:48-87` — eighteen cases, then `default:` |
| `op.run` serves ten of nineteen kinds and refuses `tagPush`/`tagDeleteRemote` by name | `gitsession/ops.go:90-141` (`opTable`, ten entries), `:64-71` (`ErrUnservedOpKind`) |
| `gitclient.Spec` has **no `Env` field and no stderr tee** — stderr is drained into a bounded buffer readable only after `Wait()` | `runner.go:25-41` (`Dir`/`Args`/`ReadOnly`/`Stdin`), `:243-245` + `:294-297` (`drainStderr` → `boundedWriter`), `Process` interface `:133-151` exposes `Stdout()`/`Stdin()`/`Wait()`/`Close()` and no stderr |
| Every spawn gets `Setpgid: true`, **not** `Setsid` | `runner.go:207` |
| `hygieneEnv` already carries `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `LC_ALL=C`; `buildEnv` appends it *after* the base so later entries win | `runner.go:99-115` |
| `Repo.Write` is an **exclusive** gate — no concurrent `Read` | `repo.go:89-115`, `:119-142` |
| `Repo` exposes no busy/idle signal | `repo.go` in full — `writing`/`readers` are unexported and unread outside the gate |
| `RepoEntry` has no remote-op slot, and `entry.go` says so by name | `entry.go:29-66`; `:33-34`: "still to come: stash shapes and active remote op (G7/G12)" |
| `Conn` has no disconnect signal a waiter can select on | `gitsession/conn.go:41-53`, `:159-174` (`Close` drops holds and walks; nothing is closed that another goroutine could observe) |
| `rpcstream` is **one-directional for requests**: the server can only `Emit` an `evt` frame, and a `res` frame arriving *from* the client is dropped | `session.go:151-157` (`Emit`), `:269-288` (`handleRaw`'s switch — `req`/`open`/`credit`/`cancel` only; its own comment: "`res`/`evt`/`chunk`/`end` are server → client only … dropped") |
| `ConnectionManager` supports both directions the relay needs | `connection.ts:125-133` (`request`), `:150-168` (`on(eventKey, handler)`, resubscribed across reconnects) |
| `VsCodeCredentialPrompt` **already exists, migrated, and is constructed by nothing** | `apps/kira-studio-vscode/src/ports/credentialPrompt.ts` (45 lines, `createInputBox` + `signal`-driven `hide()`); `grep -rn VsCodeCredentialPrompt apps/` → the file and nothing else |
| `git-core` still carries `preflight/push.ts`, `preflight/pull.ts` and `model/protectedBranch.ts`, and **nothing outside their own tests imports any of them** | `grep -rn "classifyPush\|buildPullPreflight\|resolvePullStrategy\|matchProtectedBranch" packages/git-ui packages/git-core apps/kira-studio-vscode --include=*.ts --include=*.vue` → `index.ts`'s three export lines, `preflight/push.ts` itself, and the three `.test.ts` files |
| All three of this phase's settings already exist in the schema and the manifest | `packages/git-core/src/settings/schema.ts:77-104` (`kiraVersion.fetch.autoInterval`, `kiraVersion.pull.strategy`, `kiraVersion.protectedBranches`); `apps/kira-studio-vscode/package.json#contributes.configuration:125-154`. There is **no** `gen-settings` script in this repo — the manifest is hand-maintained (`ls scripts/`) |
| Kira Studio owns a generic key→JSON `settings` table, a typed `model.Settings`, a per-leaf patch writer, and a settings dialog that already has a **Connected editors** section | `storage/migrations/0001_init.sql:3-6`, `storage/repos/settings.go:26-140`, `frontend/src/workbench/SettingsDialog.vue:83` |
| `gitsock` already takes its DB dependency as a narrow interface satisfied structurally by a `repos` type | `gitsock/clients.go:9-20` (`TrustStore`) — the precedent for D16's settings reader |
| Nothing in `gitsock`/`rpcstream` logs a frame or a payload | `grep -n "slog\|Printf" gitsock/*.go rpcstream/*.go` → three `slog` lines in `server.go`, none carrying a frame |
| git here is 2.43.0; OpenSSH is 9.6p1; `go build ./apps/kira-studio/internal/...` is green | run here |

**Probes, run in this container against real git 2.43.0 and real OpenSSH 9.6, with a real local
bare remote, a real `pre-receive` hook and a real HTTP 401.** Upstream recorded eight; all eight
reproduce, and seven more this chapter's own constraints made necessary. Every fixture repository
was created with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` and per-commit
`-c user.email=…`; **nothing in this session ran `git config --global` or `--system`.**

| # | Question | What was observed here |
|---|---|---|
| **P1** | Is `GIT_ASKPASS` honoured with `GIT_TERMINAL_PROMPT=0`? (upstream probe 7) | **Yes.** Against a real 401: the helper is exec'd with `argc == 1`, `$0` = the helper's own path, `$1` = git's prompt text verbatim; the answer is read from the helper's **stdout**. Two calls per HTTPS op: `Username for 'http://127.0.0.1:8731': ` then `Password for 'http://<the username just given>@127.0.0.1:8731': ` |
| **P2** | What happens when the askpass helper exits non-zero? (upstream probe 8) | `error: unable to read askpass response from '<path>'` then `fatal: could not read Username for '…': terminal prompts disabled`, **rc 128, no retry, no hang** |
| | …and with no askpass at all | `fatal: could not read Username for '…': terminal prompts disabled`, rc 128 |
| | …and when the helper answers wrongly | `fatal: Authentication failed for 'http://…/repo.git/'`, rc 128 |
| **P3** | Does a `GIT_ASKPASS` path containing a **space** work? | **Yes** — a helper at `/tmp/dir with space/ask.sh` is invoked correctly and its answer is used. So a shim is *not* needed to route around a space in a macOS `.app` bundle path; it is needed only to carry fixed extra argv (D8) |
| **P4** | Does `SSH_ASKPASS` work the same way, without a tty, on OpenSSH 9.6? | **Yes** — `SSH_ASKPASS=<helper> SSH_ASKPASS_REQUIRE=force ssh-add <encrypted key> </dev/null` calls the helper with `n=1`, `a1=[Enter passphrase for /tmp/k: ]`, reads the answer from stdout, and the key is added. Identical protocol to `GIT_ASKPASS` |
| **P5** | `git push --porcelain` — where does the *reason* for a rejection go? | **stdout**, tab-separated, and **not stderr at all**. Non-ff: stdout `!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)` + `Done`; stderr carries only `error: failed to push some refs to '…'` and the `hint:` block. **The existing `NonFastForward` pattern (`! [rejected]`) never fires against that stderr** |
| | success | stdout ` \trefs/heads/main:refs/heads/main\tddba93b..1998b87`, then `Done`, rc 0 |
| | forced success | `+\t…\tebe905a...b14ae70 (forced update)` |
| | new branch, with `--set-upstream` and a fully-qualified refspec | `*\trefs/heads/fq:refs/heads/fq\t[new branch]`; `branch.fq.merge`/`branch.fq.remote` are both set |
| **P6** | The three lease shapes (upstream probe 1) | never fetched → `[rejected] (stale info)`, rc 1; fetched-but-not-integrated → `[rejected] (remote ref updated since checkout)`, rc 1; plain `--force` → `+ … (forced update)`, rc 0. All reproduce exactly |
| **P7** | Hook rejection (upstream probe 4) | stdout `!\t…\t[remote rejected] (pre-receive hook declined)`; stderr `remote: policy: no pushes on Fridays        ` — **git pads `remote:` lines with trailing spaces**, so the extracted message must be right-trimmed per line |
| **P8** | `push --porcelain --delete` of a ref that does not exist | stdout is **empty**; stderr `error: unable to delete 'fx': remote ref does not exist`. So classification must read stderr *and* the porcelain block, never only one |
| **P9** | Push/fetch progress framing (upstream probes 5/6) | push: `Enumerating objects: 1, done.` / `Counting objects: 100% (1/1)\rCounting objects: 100% (1/1), done.` — CR within a phase, LF at its end. fetch: server phases arrive `remote: `-prefixed **and right-padded with spaces**, then `From ../rem` and the ref block. A trivially small local fetch emits no percentages at all — "no progress" is normal, never a stall |
| **P10** | `git config --null --get-regexp '^(pull\.(rebase\|ff)\|branch\.main\.rebase)$'` framing | Records are **NUL-terminated**, and within a record the key and value are separated by a **newline**, not a space: `branch.main.rebase\nmerges\0pull.rebase\ntrue\0`. (G5's own `config --get-regexp` capture, without `--null`, is space-separated — a different format, and both are in this tree after this phase) |
| **P11** | `git rev-list --left-right --count <branch>...<upstream>` | `1\t0` (left = ahead, right = behind), rc 0. With a nonexistent ref: `fatal: ambiguous argument …`, **rc 128** — so the ahead/behind read must be guarded on the upstream existing, never run speculatively |
| **P12** | `git fetch --porcelain` at this chapter's 2.38 floor | Not available (added in git 2.41). The ref-update block is human-formatted stderr only, which is why D13 derives `RefUpdate[]` from a ref snapshot diff instead of parsing it |
| **P13** | Does `--prune-tags` delete a local-only tag? (upstream probe 2) | Confirmed by upstream against the same git; not re-run here because the conclusion (default it off) is settled and the behaviour is documented in `git-fetch(1)`. **The default stays off (D12)** |
| **P14** | Is the socket path length a constraint? | macOS caps `sun_path` at 104 bytes. `$TMPDIR` on macOS is `/var/folders/xx/…/T/` (~50 bytes); with `kira-askpass-XXXXXXXXX/` (~24) the socket filename must stay short — D8 names it `s` |

**Upstream baseline** (`/home/user/vlad-cirstean/kira-version-vscode`, `claude/start-p2-gwlgly`,
`0ea4cfe`), read as the source this phase ports:

| Claim | Evidence |
|---|---|
| P8's own design in full — the four no-hang guarantees, the cancellation asymmetry, the strategy ladder, the protected-branch scope, the `remote.run`-not-`op.run` argument | `docs/plans/P8.md` in full (1345 lines) |
| The broker: a `0700` `mkdtemp` dir, an `sh` shim, a Node helper, a unix socket, a session token in env, a per-op id in env, and a bounded wait on **both** sides | `packages/git/src/askpass.ts` in full |
| `deriveMasked` is `!/^Username/i` — everything unrecognised is masked | `askpass.ts`'s `UNMASKED_PROMPT` |
| `shouldInterposeAskpass` — never override a user's own `core.askPass` or an inherited `GIT_ASKPASS` | `askpass.ts`'s exported gate |
| The glob matcher: `*` matches any run of characters **except `/`**; `**` is not supported and is reported as a settings problem; the matched *pattern* is returned, never a bool | `packages/core/src/model/protectedBranch.ts` |
| Protected gating covers `forcePush` (both flavours) and `deleteRemoteBranch`, never plain push | `docs/plans/P8.md` "The hard parts" §6, D52 |
| The strategy ladder, six steps, first match wins, read in one `--get-regexp` spawn | `docs/plans/P8.md` "The hard parts" §5; `packages/core/src/preflight/pull.ts` |
| Force-push is bare `--force-with-lease --force-if-includes`, plus a re-read-and-compare of `remoteTip` immediately before spawning | D48; `RemoteOpParams.expectedRemoteTip`'s own doc comment in this repo's migrated `contract.ts` |
| Remote ops never touch the undo slot, in either direction | D51/OQ6 |
| Auto-fetch is silent, first tick waits a full interval, and one failure disables it for the session | "The hard parts" §7, judgment call 13 |
| The progress parser is a pure incremental decoder over `\r`/`\n`, strips `remote: `, matches `NN% (n/N)` and `N, done.`, drops everything else, and is throttled at 100 ms host-side | W3, OQ10 |

### 0.2 Scope

1. `internal/gitclient` — `Spec.Env` and `Spec.OnStderr` (D5), `Setpgid` → `Setsid` (D6),
   `Repo.Writing()` (D11). Nothing else in `gitclient` changes.
2. `internal/gitaskpass` — **new package**: the shim writer, the private socket, the broker, the
   `Prompter` seam and the helper's client half (D7–D10).
3. `apps/kira-studio/main.go` — the `askpass` subcommand branch (D8), and the broker's construction
   and disposal.
4. `internal/gitops` — `fetch.go`, `push.go`, `pull.go`, `remote.go`, `progress.go`, and six new
   rows on the existing error table (D12–D15).
5. `internal/gitpreflight` — `push.go` (`ClassifyPush` + the protected-branch matcher), `pull.go`
   (`ClassifyPull` + `ResolvePullStrategy`) (D17/D18).
6. `internal/gitsession` — `remote.go` (the ≤1 slot, the executor, the two pre-flights, the
   progress pump), `autofetch.go`, `Conn`'s credential waiters and disconnect signal (D11, D19–D21).
7. `internal/gitrpc` — five handlers; `CONTRACT_VERSION` **15 → 16** (D2).
8. `internal/gitsock` — the settings reader interface, the broker in `Deps`, one line for `Conn`'s
   done channel; the integration tier (D16, §3.11).
9. `internal/storage` — one migration-free addition: two `git.*` leaves on `model.Settings` and its
   patch (D16), plus two fields in Kira Studio's own settings dialog.
10. `packages/git-ipc` — `credential.request`/`credential.provide`, one optional param on
    `remote.pullPreflight`, `CONTRACT_VERSION` 16 (D2).
11. `apps/kira-studio-vscode` — the credential relay's client half, `remote.progress` fan-out to
    the panel, `strategySetting` injection, and the palette entries this phase's operations need
    are **not** here (G9's audit owns those — §9).
12. `packages/git-core` — delete `preflight/push.ts`, `preflight/pull.ts`, `model/protectedBranch.ts`
    and their tests; drop two settings keys from `schema.ts` and the manifest (D22/D16).
13. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G7 work:

- **`stash.list` and the five stash `op.run` kinds.** Still G12's — and `#stashAndCarry`, the path
  a *dirty non-fast-forward* pull takes in the migrated UI, still fails there (F19). Recorded
  honestly in §7.2 step 12, not papered over.
- **`reset`/`cherryPick`.** G13's.
- **Any change to `packages/git-ui`.** `AppToolbar.vue`, `PullStrategyPicker.vue`,
  `ForcePushDialog.vue`, `pullStrategyModel.ts` and `state/ops.ts`'s whole `#runRemote` executor
  are migrated, correct and untouchable by SPEC §5. If an implementer finds themselves editing that
  directory, something has drifted out of scope.
- **A Kira-Studio-window credential prompt.** SPEC §5 item 4's relay is what this phase builds
  (F2/D3, §11.1).
- **Credential *storage* of any kind.** Never, in this chapter — D9.
- **Remote management** (add/remove/rename a remote), submodules, signed pushes, interactive
  rebase. Out of scope for v1.3.
- **`kiraVersion.git.path`'s server-side consumption.** SPEC's Settings-ownership section names it
  alongside the two this phase does own, but it is not a remote-op setting, it has a live copy in
  `packages/git-ui`'s own blocked-state copy (`gitBlockedCopy.ts:50-51`, untouchable), and wiring it
  would change `Discovery`'s contract for no G7 caller. **Handed to G8** (§10).
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out of this phase is left out *entirely*.
- **No shell in any git spawn.** argv-only through `os/exec`, exactly as `gitclient` has done since
  G2. The one `sh` script this phase writes is not a git spawn — it is the shim `git` itself execs,
  and it takes no interpolated user data (D8).
- **Never store a credential at rest.** No file, no `kira.db` row, no log line, no in-memory cache
  that outlives one prompt (D9). G1's pairing-token posture — salted hash only, never reversible —
  is the bar; a credential clears it by never being retained at all.
- **Comments very concise, only where the code cannot say it itself.**
- **Tests only where `AGENTS.md`'s bar is met** (D24). G7 clears it in eight places.
- **Fixture repositories scope their git config to themselves** — G4 D15's `fixtureEnv()`
  (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `-c commit.gpgsign=false`), copied
  by every new fixture builder, *including the bare-remote builder this phase adds*. **Never
  `git config --global` or `--system`, in a test, a fixture or a script.**
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§6).

---

## 1. Findings

### F1 — The contract already declares the whole remote vocabulary; it declares none of the credential vocabulary

`contract.ts:445-550` carries `PullStrategy`, `PullStrategySource`, `RemoteOpKind`, `RefUpdate`,
`PullRoute`, `PullBlocker`, `PullPreflight`, `PushPreflight`, `RemoteOpParams`, `RemoteOpResult`
and `RemoteProgress`, structurally identical to upstream's post-P8 shapes; `:1076-1100` declares
`remote.pullPreflight`, `remote.pushPreflight`, `remote.run` and `remote.cancel`; `:1155` declares
the `remote.progress` event; `validate.ts`'s three `Record<Key, true>` maps admit all five. So the
five remote wire shapes are **given**, not designed — G7's job is producing those bytes.

Two deltas from upstream's own P8, both already absorbed by the migration and neither re-litigated
here: `RemoteOpParams` has **no `opId`** (there is at most one remote op per repo, so `repoId`
correlates progress on its own), and `RemoteOpResult` has **no `strategy`/`upstreamSet`** (the UI
learns the strategy from `remote.pullPreflight` before it runs, `ops.ts:1049-1052`).

`grep -n credential packages/git-ipc/src/contract.ts` finds nothing. SPEC §5 item 4 names
`credential.request` and `credential.provide` in prose and nowhere else. **They are this phase's own
wire design** — the only wire design in the phase, and the reason `CONTRACT_VERSION` moves.

### F2 — The SPEC says credential prompts appear in Kira Studio's window, and also that they are relayed to the VS Code connection

Two sections, in direct contradiction:

- §6, last bullet: *"**Credential prompts**: shown in Kira Studio's own window, never the VS Code
  window that started the remote operation — consistent with Kira Studio being the one
  trust/approval authority for everything credential- and pairing-related in this design."*
- §5, "What changes in `extension.ts`, precisely", item 4: *"Askpass becomes a relay: the server
  emits `credential.request` to the connection that owns the in-flight remote op; the extension
  answers with `credential.provide`. If that connection dies mid-prompt, the broker fails the
  credential request non-zero — never hangs."*

These cannot both be built. The evidence on the ground favours §5 decisively: the extension already
ships `VsCodeCredentialPrompt` (a `createInputBox` implementation whose entire doc comment is about
being cancellable so it "must never hang"), migrated by G1 and constructed by nothing; Kira Studio's
own window has no masked-text-input surface at all, only the pairing approval prompt (a yes/no
modal, structurally the wrong shape); and the phasing table's own G7 row says "askpass broker +
**credential relay**". §6's bullet reads as a statement about *trust authority* — which pairing
genuinely is Kira Studio's — over-applied to a git credential, which is not an approval of anything
about Kira Studio.

Resolved in D3 and flagged for a human in §11.1, because it is the security-shaped decision of the
phase and reasonable people could read §6 literally.

### F3 — `rpcstream` cannot carry a server-initiated *request*; it can carry an event and a client request

`session.go:269-288`'s `handleRaw` switch accepts `req`, `open`, `credit` and `cancel` from the
client and nothing else — its own comment: *"`res`/`evt`/`chunk`/`end` are server → client only; a
stray one from the renderer is dropped"*. The server's only outbound-initiative primitive is
`Emit` (`:151-157`), an `evt` frame with a method and a payload and **no id and no reply path**.

So "the server emits `credential.request` … the extension answers with `credential.provide`" is not
loose phrasing to be tightened into a bidirectional RPC — it is *exactly* what the transport
already supports, and the only shape it supports without a protocol change. The correlation id has
to live in the payloads (D4), not in the frame envelope.

This is worth stating because the obvious "clean" alternative — teach `rpcstream` server-initiated
requests — would touch the one package SPEC §2 says is reused **verbatim** from `feature-v1-3`, for
one caller, and would need a matching change in `packages/git-ipc/src/rpc.ts` on the other side.

### F4 — The credential answer is the only user secret that has ever crossed this socket, and the prompt text carries part of it

Probe P1: git asks twice per HTTPS operation, and the **second prompt embeds the first answer**:
`Password for 'http://<username>@127.0.0.1:8731': `. So the prompt *text* — which crosses the wire
to the extension and is rendered — is not always innocuous: a user who pastes a token into the
username field sees it echoed in the next prompt. That is git's own behaviour, identical in a
terminal, and not something this phase can or should change; what it does mean is that **prompt
text is treated with exactly the same care as the answer**: never logged, never persisted, never
included in an error message.

The answer's full path is: VS Code input box → `credential.provide` params → `gitsession.Conn`'s
waiter channel → `gitaskpass` broker → the private unix socket → the helper's stdout → git. Six
hops, all in-process or over 0600/0700 unix sockets, and **no branch of it writes anything to disk
or to a log**. `grep -n "slog\|Printf" gitsock/*.go rpcstream/*.go` confirms no frame is ever
logged today, which is the property this phase must not break.

### F5 — Nothing can read a spawn's stderr before it exits, and SPEC names "stderr progress parsing" as this phase's

`runner.go:243-245` hands stderr to `drainStderr`, which `io.Copy`s it into a `boundedWriter`
readable only after `Wait()` (`:294-297`, `:299-316`). The `Process` interface (`:133-151`) exposes
`Stdout()`, `Stdin()`, `Wait()` and `Close()` — there is no stderr accessor at all, by design (G2
D4: stderr is attacker-adjacent, capped, and only ever read as error material).

SPEC's `gitops` package row names "conflict handling + **stderr progress parsing**" as this
chapter's port of upstream's `progress.ts`. Progress is the only reason to read stderr before exit,
and G2's own §10 handed this exact seam forward: *"`Spec` grows … **G7** adds `Env`"*.

Upstream solved it with an `onStderr` tee inside the *existing* collect loop rather than a second
reader — "the whole point is that the tee cannot desynchronize from the buffer" — and that argument
transfers unchanged.

### F6 — `Setpgid` is not `setsid`: upstream's second no-hang guarantee does not currently hold here

Upstream's four no-hang guarantees list `detached: true` → POSIX `setsid()` as the second, and
calls it "load-bearing in a way nobody wrote down: a detached child has **no controlling terminal**,
so git cannot fall back to `/dev/tty` even if `GIT_TERMINAL_PROMPT` were unset."

`runner.go:207` sets `Setpgid: true`. A new process *group* does not leave the session, so the child
**keeps the parent's controlling terminal**. For a GUI-launched Kira Studio there is no controlling
terminal to keep and the difference is invisible; for a developer running `bun run dev` from a
terminal it is not. And `GIT_TERMINAL_PROMPT=0` does not close the gap for **ssh**, which is a
different program with its own rules: `ssh` reads a key passphrase straight from `/dev/tty` when it
has one, consulting `SSH_ASKPASS` only when it does not (or when `SSH_ASKPASS_REQUIRE=force`, probe
P4). An encrypted key with no agent, in a dev-launched instance, is a real hang.

`syscall.SysProcAttr` has `Setsid bool`. `Setsid` makes the child a session leader *and* a process
group leader with `pgid == pid`, so `killGroup(-pid, …)` — the entire basis of G2 D3's
graceful-stop machinery — behaves identically.

### F7 — git's askpass protocol is one argv, stdout, and a hard fail on non-zero — probed three ways

Probe P1/P2, reproducing upstream's probes 7 and 8 exactly:

| Case | Observed |
|---|---|
| helper answers | called with `argc == 1`, prompt verbatim; answer read from stdout; op proceeds |
| helper exits non-zero | `error: unable to read askpass response from '<path>'` then `fatal: could not read Username …: terminal prompts disabled`, rc 128 — **no retry, no fallback, no hang** |
| no helper at all | `fatal: could not read Username …: terminal prompts disabled`, rc 128 |
| helper answers wrong credentials | `fatal: Authentication failed for '…'`, rc 128 |

The middle row is the whole mechanism: **declining is expressed by exiting non-zero, and git treats
that as fatal immediately.** Every "we cannot answer" path in this phase — the user dismissed the
box, the owning connection died, the broker's timer fired, the op was cancelled — funnels into that
one exit code.

Probe P3 additionally kills a justification that would otherwise be tempting: an askpass path
containing a space works fine on git 2.43, so the shim is *not* needed to route around
`/Applications/Kira Studio.app/…`. It is needed for one reason only — carrying fixed extra argv
(D8).

### F8 — `Repo.Write` is exclusive, and routing a fetch through it would freeze every window's graph

`repo.go:89-115`: `Write` waits for `!writing && readers == 0` and holds that condition for the
duration of `fn`. `Read` (`:119-142`) waits for `!writing`. So a ninety-second fetch inside
`Repo.Write` blocks **every read on that repository, from every connection**, for ninety seconds:
no `graph.stream` page, no `commit.detail`, no `refs.list`, in any window.

Upstream did not have this problem because its `GitDriver.write()` is a *write queue* that does not
exclude reads at all. This repo's gate is stricter — correctly so for a checkout, which must not
race a read of the index — and G5 relied on that strictness.

A fetch or a push takes no index lock, writes no worktree file, and moves only remote-tracking refs
(and objects, under git's own locking). Concurrent reads during one are exactly as safe as
concurrent reads during a `git fetch` a user typed in a terminal.

### F9 — SPEC §6 already decided where remote-op state lives, and this phase is the first to read that decision

SPEC §6's own box diagram puts, inside `RepoEntry` — the **shared** box, "SHARED across every
connection open on that repo" — the line:

```
  undo slot (one per repo — see below)   active remote op (≤1)
```

`entry.go:29-34`'s own comment has carried the forward reference since G2: *"still to come: stash
shapes and active remote op (G7/G12)"*. G5's plan quoted the same line when it placed the undo slot.

So "is a remote operation a fact about the repository or about one viewer's request?" is not an open
question about *the operation* — the SPEC answered it, and the `≤1` is the point: two windows must
not fetch the same repository twice concurrently, and a `remote.cancel` from either window must
reach the one op that is running.

What SPEC does **not** decide is where the *credential prompt* and the *progress rendering* live,
and those are genuinely per-viewer (D20/D21).

### F10 — `push --porcelain` moves the rejection reason to stdout, where the existing error table never looks

Probe P5, and it is the sharpest of the probes. A non-fast-forward push with `--porcelain`:

```
stdout: To ../rem.git
        !\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)
        Done
stderr: error: failed to push some refs to '../rem.git'
        hint: Updates were rejected because the remote contains work that you do not
        …
```

`gitops.ClassifyOpError` matches on stderr only. Neither `! [rejected]` nor `non-fast-forward`
appears in that stderr — the *only* statement of what went wrong is on stdout. Add `--porcelain`
naively and every push failure classifies as `Unknown`.

The same probe run **without** `--porcelain` puts ` ! [rejected]        main -> main (fetch first)`
on stderr, which is what upstream classified against.

`--porcelain` is still worth having — it is the exact, tab-separated, locale-independent statement
of every ref's outcome and its reason, it is available far below this chapter's 2.38 floor, and
probe P5's success rows give `from..to` and the forced flag for free. But it moves classification's
primary input, and probe P8 shows a third case (`--delete` of a missing ref) where the porcelain
block is **empty** and stderr carries everything. So the classifier must read both.

### F11 — `fetch --porcelain` does not exist at this chapter's git floor

Probe P12: `git fetch --porcelain` landed in git 2.41; `gitclient`'s `RequiredVersion` floor is
2.38. So fetch has no machine-readable ref-update output, and `RefUpdate[]` for a fetch would have
to come from parsing the human `From …` block on stderr — which carries at least five shapes
(`a..b`, `a...b (forced update)`, `* [new branch]`, `- [deleted]`, `[up to date]`), is
column-aligned, and is exactly the kind of thing this chapter has otherwise refused to parse.

Meanwhile `porcelain.RefSnapshotArgs()` already exists (G3 D9): `for-each-ref
--format=%(refname)\x1f%(objectname)` over **all** refs, one spawn, with a tested parser
(`ParseRefSnapshot`). A before/after diff of that map is an exact statement of which refs moved,
independent of git's output formatting, of locale, and of version — and it works identically for a
*cancelled* fetch, which upstream explicitly wanted ("returns `RefUpdate[]` even on the cancelled
path").

And `RemoteOpResult.updates` is rendered by nothing in the migrated UI today (`grep`), so the cost
of getting it slightly less precise than a hand-written parser would be is zero, while the cost of
the parser is a fixture corpus and a maintenance surface.

### F12 — "Server-owned settings" has no server that owns anything, and two of the three keys have no reader left after this phase

SPEC's Settings-ownership section: *"Server-owned (Kira Studio), not per-window, because two windows
disagreeing about them is a correctness/safety issue, not a preference: `protectedBranches`,
`fetch.autoInterval`, `git.path`."*

All three exist in `packages/git-core/src/settings/schema.ts` and in the extension manifest, coerced
per window by `extension.ts` and shipped to the webview inside `app.init`. Nothing on the server has
ever read any of them; there is no `gen-settings` script in this repo, so the manifest is
hand-maintained.

After this phase, `kiraVersion.protectedBranches` and `kiraVersion.fetch.autoInterval` have **no
reader at all** on either side: their only consumer was `preflight/push.ts` (deleted, D22) and a
client-side auto-fetch scheduler that this chapter never ported. Leaving them in the manifest would
be a user-editable setting that silently does nothing — the worst of the three options.

`kiraVersion.git.path` is different: `packages/git-ui/src/components/gitBlockedCopy.ts:50-51` tells
the user, in the blocked-state panel, to *"Install git, or set `kiraVersion.git.path` to point at
it"*, and `packages/git-ui` may not be edited. Removing that key would make shipped copy lie.

Kira Studio, meanwhile, already owns exactly the machinery a server-owned setting needs: a key→JSON
`settings` table (`0001_init.sql:3-6`), a typed `model.Settings` with per-leaf reads and a
**per-leaf patch writer** (`repos/settings.go:26-140` — a patch touches only what it names, so a new
section cannot be clobbered by a frontend that does not know about it), and a settings dialog that
already carries a **Connected editors** section built by G1.

### F13 — The write gate has no busy signal, and auto-fetch's central guardrail needs one

Upstream's auto-fetch guardrails are "only while the window is focused **and** the panel is visible;
never while another op holds the write queue; a failure disables the timer for the session", and
W2 adds a `busy` getter for the third.

`Repo`'s `writing`/`readers` are unexported and read nowhere outside the gate itself (`repo.go`).
The first two guardrails have no headless equivalent at all: there is no focus signal in the
contract (G2 F14 already recorded that `setUiVisible` has no wire method here), and "the panel is
visible" is per-window in a design where the timer must be per-repository (F9).

What *does* exist is `Registry`'s refcount: a `RepoEntry` exists exactly while at least one
connection holds the repository open, plus G2 D12's five-minute linger. "Somebody has this
repository open in a window" is precisely the guardrail's intent, and it is free.

### F14 — `--set-upstream` works with a fully-qualified refspec, and a bare branch name is ambiguous

Probe P5's last row: `git push --porcelain --set-upstream origin refs/heads/fq:refs/heads/fq`
reports `*\trefs/heads/fq:refs/heads/fq\t[new branch]` and sets both `branch.fq.merge` and
`branch.fq.remote` correctly.

Upstream used `<branch>:<branch>`. Fully qualifying both sides costs nothing and closes a real
ambiguity: a bare `main` on the source side is resolved by git's usual revision rules, so a *tag*
named `main` in a repository that also has a branch named `main` changes what gets pushed.
Upstream's own reason for an explicit refspec at all — "so `push.default` cannot change what we push
out from under us" — points the same way.

### F15 — `rev-list --left-right --count` dies on a missing upstream, so ahead/behind must be guarded

Probe P11: `git rev-list --left-right --count refs/heads/main...refs/remotes/origin/main` prints
`1\t0` (ahead, behind) and exits 0; with a nonexistent ref it exits **128** with `fatal: ambiguous
argument`. A branch with no upstream, or one whose remote-tracking ref has been pruned, is the
common case for `remote.pushPreflight` — it is what `wouldSetUpstream` exists to describe. So the
pre-flight resolves the upstream *first* and only then reads ahead/behind, rather than running the
count speculatively and swallowing an error.

### F16 — `config --null --get-regexp` frames records with NUL and separates key from value with a newline

Probe P10: `branch.main.rebase\nmerges\0pull.rebase\ntrue\0`. This is **not** the format G5 already
parses — `captureBranchDeleteUndo` (`gitsession/ops.go`) reads `config --get-regexp` *without*
`--null` and splits each line on the first space. Both formats will be in this tree after G7, in
adjacent code, and confusing them silently mis-parses a value containing a space (which
`branch.<name>.rebase` never has, and a future consumer's key might).

The `--null` form is the right one for the strategy ladder: it is unambiguous for values containing
spaces or newlines, and it collapses upstream's three separate `--get` spawns into one.

### F17 — `remote:` lines are right-padded, and the porcelain reason strings are exact

Probe P7: `remote: policy: no pushes on Fridays        ` — git pads the payload out to a fixed
column. `remoteMessage` extraction must strip the `remote: ` prefix **and** right-trim each line,
or the hook's message renders with a ragged tail.

Probe P5/P6/P7 also pin the exact reason strings the classifier keys on, each observed here:
`(fetch first)`, `(stale info)`, `(remote ref updated since checkout)`,
`(pre-receive hook declined)`, `(forced update)`, `[new branch]`, `[deleted]`.

### F18 — `ClassifyOpError`'s existing order would swallow three of this phase's six new kinds

`gitops/errors.go`'s table, read in order, contains `strings.Contains(lower, "not found")` as part
of its `NotFound` row. `Repository not found` (the GitHub shape of `RemoteNotFound`) matches it.
`already exists` sits first and would claim a hypothetical remote message containing that phrase.
And `NonFastForward`'s natural pattern (`! [rejected]`) is broad enough to swallow `LeaseViolation`
and `RemoteRefUpdated`, which is upstream's own W11 warning.

So the six new rows are **prepended**, in a fixed internal order (hook → lease → remote-ref-updated
→ non-ff → auth → network → remote-not-found → remote-ref-missing), ahead of every G5 row.

### F19 — The migrated UI's dirty-non-fast-forward pull path routes through a stash op G12 has not built

`ops.ts:1054-1085`: when `PullPreflight.blockers` is non-empty, `runPull` opens a confirmation and
then calls `#stashAndCarry`, whose first act (`:817-826`) is `op.run` with `kind: "stashPush"` —
which `opTable` refuses by name until G12 (`ErrUnservedOpKind` → `E_UNKNOWN_METHOD`, an *RPC error*,
not an `{ok:false}` result `#stashAndCarry` could render).

Two honest options: compute `blockers` faithfully and let that one path fail visibly until G12, or
suppress the blocker and ship a pull that silently rewrites history over a dirty tree. The second is
strictly worse. Recorded, scoped and handed forward (D18, §7.2 step 12, §10) rather than hidden.

### F20 — `Conn` has no signal a blocked goroutine can wait on, and the relay's central guarantee needs one

SPEC §5 item 4's hard requirement — *"If that connection dies mid-prompt, the broker fails the
credential request non-zero — never hangs"* — needs the broker's waiting goroutine to observe a
disconnect. `Conn.Close()` (`conn.go:159-174`) is called from `gitsock.handleConn`'s `defer` when
`rpcstream.Serve` returns, and it releases holds and disposes walks — but it closes no channel and
sets no flag another goroutine could `select` on.

One `done chan struct{}`, closed once in `Close`, is the whole fix, and it is the same shape
`RepoEntry.done` already has (`entry.go:65`).

---

## 2. Decisions

### D1 — Everything in this phase crosses as **JSON**; `gitwire` and `gitWire.fbs` are not touched

SPEC §4.2 puts *bulk* response and stream payloads in FlatBuffers. Nothing here is bulk: a
`RemoteOpResult` is a handful of fields plus a ref-update list that is empty or single-digit in
every realistic case; a `RemoteProgress` is six scalars emitted at most ten times a second; a
`credential.request` is two strings. None is a stream, none has a typed-array receiver, and all of
them are read directly by `packages/git-ui`, which may not change to receive a second
representation. G4 D1's and G5 D2's reasoning applies unchanged.

`packages/git-ipc/schema/`, `src/generated/`, `codec.ts` and `internal/gitwire` are untouched.

### D2 — `CONTRACT_VERSION` **15 → 16**, for exactly three additions

The standing rule (G1 D20, re-applied by G3 D6, G4 D3, G5 D1, G6 D1): bump when a wire method,
event, stream or param is added, changed or removed. G7 adds three things:

1. **`credential.request`, a new event** — server → the connection that owns the in-flight remote
   op (F1/F3).
2. **`credential.provide`, a new request** — that connection → the server, answering one
   `credential.request` by id.
3. **`strategySetting`, one optional param on `remote.pullPreflight`** — the window's own
   `kiraVersion.pull.strategy`, injected by `proxyHandlers` exactly as G6 D1 injects
   `baseCandidates` (`proxyHandlers.ts:239-247`). `remote.run` needs nothing: `ops.ts:1049` always
   passes an explicit, already-resolved `strategy`.

Nothing else in `packages/git-ipc` changes. The four `remote.*` requests, `remote.progress` and
every remote type are already declared and already admitted by `validate.ts` (F1) — a diff in any
of them is a signal something drifted out of scope.

The exact shapes:

```ts
/** G7: one prompt from git's own askpass protocol, relayed to the connection that owns the
 *  in-flight remote op (SPEC §5 item 4). `requestId` is a server-minted, unguessable id; the
 *  extension answers exactly once with `credential.provide`. Nothing here is ever logged or
 *  stored, on either side — `prompt` can itself contain a username the user just typed. */
'credential.request': {
  readonly requestId: string;
  readonly repoId: string;
  /** git's own text, verbatim: "Password for 'https://alice@github.com': ". */
  readonly prompt: string;
  /** False only for git's own `Username for …` shape; everything unrecognised is masked. */
  readonly masked: boolean;
};

'credential.provide': {
  params: {
    readonly requestId: string;
    /** The user's answer, or null when they dismissed the box. Never echoed back, never logged. */
    readonly secret: string | null;
  };
  result: Record<string, never>;
};
```

`secret: string | null` rather than an optional field, so "dismissed" is a value the wire carries
rather than an absence the server has to infer — the same `null`-vs-`undefined` discipline G4 D5
set for this chapter.

### D3 — The credential prompt is relayed to the owning connection, per SPEC §5 item 4; §6's "Kira Studio's own window" is read as being about *trust approval*, not git credentials

Resolving F2, and flagged for a human in §11.1.

**Built**: the server emits `credential.request` to the `Conn` that issued the in-flight
`remote.run`; the extension answers with `credential.provide`.

**Why, concretely:**

1. The extension already ships the implementation (`ports/credentialPrompt.ts`, migrated by G1,
   constructed by nothing), and its doc comment is a design note about this exact requirement.
2. Kira Studio's own window has no masked-input surface. Building one means a second modal-approval
   queue beside pairing's, in an app whose only git-facing surface SPEC itself limits to the
   *Connected editors* pane.
3. The prompt belongs where the work is. A user who clicked **Push** in a VS Code window and is then
   asked for a passphrase by a *different application* has no way to connect the two, and if two
   windows are pushing to two repositories the prompt carries no window identity at all.
4. The no-hang guarantee is only expressible this way. "If that connection dies mid-prompt, fail
   non-zero" presupposes the prompt is *on* a connection; a prompt in Kira Studio's own window has
   no such lifetime to bind to.
5. §6's bullet sits in a list about pairing and trust, where "Kira Studio is the one approval
   authority" is exactly right. A git credential approves nothing about Kira Studio — it is a secret
   handed to a `git` child for one network call.

**What this does not mean.** Kira Studio remains the sole authority for *pairing*: only a paired
connection can ever receive a `credential.request`, and the pairing prompt stays in Kira Studio's
window exactly as G1 built it. The relay hands a credential to a client the user already approved.

### D4 — The relay's wire shape and its no-hang guarantee: an event out, a request back, and **four** independent bounds on the wait

Resolving F3, F7 and F20, and making SPEC §5 item 4's promise concrete.

**The flow, end to end:**

```
git child ── exec ──▶ shim (sh) ── exec ──▶ kira-studio askpass ── unix socket ──▶ gitaskpass.Broker
                                                                                          │
                                                          Prompter (gitsession)  ◀─────────┘
                                                                     │
                                    conn.Emit("credential.request", {requestId, repoId, prompt, masked})
                                                                     │
                                    extension: VsCodeCredentialPrompt.ask(...)  → input box
                                                                     │
                                    conn.request("credential.provide", {requestId, secret})
                                                                     │
                                    gitsession.Conn.ProvideCredential → the waiter's channel
                                                                     │
                                    broker writes {"ok":true,"answer":"…"}\n to the helper
                                                                     │
                                    helper prints the answer on stdout, exits 0 → git proceeds
```

**Every way that wait can end, and what git sees:**

| Ending | Answer written to the helper | Helper exit | git |
|---|---|---|---|
| user typed an answer | `{"ok":true,"answer":…}` | 0 | proceeds |
| user dismissed the box (`secret: null`) | `{"ok":false}` | **non-zero** | `terminal prompts disabled`, rc 128 (P2) |
| the owning `Conn`'s `done` closes (window closed, socket dropped, client revoked) | `{"ok":false}` | non-zero | same |
| the broker's own timer fires (`credentialTimeout`, 120 s) | `{"ok":false}` | non-zero | same |
| the remote op was cancelled (`remote.cancel`) | `{"ok":false}` | non-zero | same |
| the whole Kira Studio process died | *(socket closes)* | non-zero, via the helper's own `close`/`error` path | same |
| the broker never answers *at all* | *(nothing)* | non-zero, via the helper's **own** timeout | same |

The last two rows are why the helper carries a timeout of its own rather than trusting the broker's:
the helper's bound holds even when the broker cannot honour its own.

**Anti-abuse rules on `credential.provide`, all server-side:**

- `requestId` is 16 random bytes from `crypto/rand`, hex-encoded — unguessable, single-use.
- A waiter is registered on **one `Conn`**, and `credential.provide` is resolved against *that
  connection's* map only. Another connection presenting the same id gets `E_BAD_REQUEST` and the
  waiter is untouched.
- Answering twice is a no-op: the map entry is deleted under the lock before the channel send, so
  the second call finds nothing (and answers `{}` — idempotent, never an error, since a retry after
  a dropped response is legitimate).
- The comparison of `requestId` uses `subtle.ConstantTimeCompare`, matching G1's own token check.

### D5 — `Spec` grows exactly two fields: `Env` and `OnStderr` — the tee lives inside the existing drain

Resolving F5, and cashing G2 §10's own handed-forward note.

```go
type Spec struct {
    Dir string; Args []string; ReadOnly bool; Stdin bool
    // Env is appended AFTER hygieneEnv, so a spec's own entry wins on a duplicate key. G7's
    // askpass broker is its only caller: GIT_ASKPASS/SSH_ASKPASS and the broker's own three.
    Env []string
    // OnStderr is called with each stderr chunk as it arrives, from the drain goroutine, BEFORE
    // the chunk is appended to the bounded buffer Wait() reports. One read, two consumers — never
    // a second reader that could disagree with the buffer classification depends on. Never called
    // after Wait returns. A panic in it would take the drain goroutine down, so the progress pump
    // is written not to panic; nothing else is defended here.
    OnStderr func([]byte)
}
```

`buildEnv(base)` becomes `buildEnv(base, spec.Env)` — `base`, then `hygieneEnv`, then `spec.Env`,
later wins. `drainStderr` becomes a small loop over `Read` instead of `io.Copy`, calling `OnStderr`
then `Write`. Every existing caller passes neither field and is byte-for-byte unaffected.

**Not added**: a `Stderr()` accessor on `Process`. G2 D4's reasoning (stderr is capped,
attacker-adjacent and only ever error material) stands; a tee gives progress what it needs without
handing any caller an unbounded stream.

### D6 — Every spawn moves from `Setpgid: true` to `Setsid: true`

Resolving F6 — this chapter's version of upstream's second no-hang guarantee.

`syscall.SysProcAttr{Setsid: true}` puts the child in a new session, which makes it a process-group
leader with `pgid == pid` (so `killGroup(-pid, …)` and everything G2 D3 built on it are unchanged)
**and** detaches it from any controlling terminal. After this, no git child of Kira Studio can read
or write `/dev/tty`, in a GUI launch or a `bun run dev` one, whether or not `GIT_TERMINAL_PROMPT` is
set and whichever helper program git happens to exec.

Applied to *every* spawn rather than only remote ops: the property is desirable everywhere (G5's
`GIT_EDITOR=true` exists for the same class of hazard), the change is one word, and a per-spec
variant would mean two spawn paths where G2 deliberately built one (`runner.go:153-158`'s own
comment).

Paired with it, on remote-op spawns only (D8's env delta): `SSH_ASKPASS_REQUIRE=force`, which is
what makes OpenSSH ≥ 8.4 use `SSH_ASKPASS` unconditionally rather than requiring `DISPLAY` (probed
against 9.6, P4).

### D7 — A new package `gitaskpass`, holding the broker, the shim and the helper's client half

SPEC's own package table names it: *"`gitaskpass` — Credential broker + `GIT_ASKPASS` shim over its
own private socket, the four no-hang guarantees."*

```
internal/gitaskpass/
  broker.go    Broker, Start/Close, Session env, WithOp, the connection handler
  helper.go    RunHelper(args, env, stdout) — the client half, exec'd by the shim
  prompt.go    Prompter interface, Request, deriveMasked
  interpose.go ShouldInterpose(coreAskPass, inheritedGitAskpass string) bool
```

It imports **stdlib only**. The `Prompter` seam is what keeps it that way and breaks the cycle that
would otherwise exist (the broker must reach a `gitsession.Conn`; `gitsession` must reach the
broker):

```go
// Prompter is the Go analogue of upstream's CredentialPrompt port. gitsession supplies the one
// production implementation, backed by a Conn's own credential waiters (D20).
type Prompter interface {
    // Ask returns the user's answer and true, or ("", false) for every not-answered outcome —
    // dismissed, disconnected, timed out, cancelled. It must never block past ctx.
    Ask(ctx context.Context, req Request) (string, bool)
}

type Request struct{ RepoID, Prompt string; Masked bool }
```

`deriveMasked` is ported verbatim: `!regexp.MustCompile("(?i)^Username").MatchString(prompt)` —
everything unrecognised is masked, because showing an unrecognised secret in the clear is the worse
failure of the two (upstream's own phrasing, and probe P1's second prompt shows why the set of
prompt shapes is not closed).

`ShouldInterpose` is ported verbatim too (D10).

### D8 — The shim execs **the Kira Studio binary itself** in `askpass` mode; there is no second binary and no scripting-language dependency

Resolving F7 and the phase's one genuinely open architectural question: how does a `git` child's
askpass callback reach back into this Go process?

Upstream's mechanism is a two-line `sh` shim that execs `process.execPath` (the extension host's own
Node) with a generated helper script. Go has no `process.execPath` equivalent that is also a script
interpreter, so the shape has to be adapted. Four candidates were considered:

| Option | Why not / why |
|---|---|
| A pure `sh` shim that talks to the socket itself | POSIX `sh` cannot open a unix socket. `nc -U` is not guaranteed, and a FIFO-based variant has no portable bounded read — a dead broker becomes an unbounded block, which is the exact failure this phase exists to prevent |
| A shim in `perl`/`python3` | Both are "usually there" on macOS and neither is guaranteed (`python3` only via the Command Line Tools). Making a credential path depend on an interpreter that may be absent trades one hang for one hard failure |
| A second, tiny Go binary (`cmd/kira-git-askpass`) | Cleanest process weight, but it adds a build target, a **G9 packaging dependency** (the DMG must place it and G7 must find it at a runtime path that differs between `wails3 task dev` and a signed bundle), and it is not built at all in a plain `go test` run |
| **The main binary, with an `askpass` subcommand** | **Chosen.** Zero build changes, zero packaging changes, always co-located with the running server (`os.Executable()`), works identically in dev, in a bundle and in a test |

**The mechanism, concretely:**

```
${broker dir}/shim      (0700)   #!/bin/sh
                                 exec "<helper argv[0]>" <fixed args…> "$1"
${broker dir}/s         (0600)   the unix socket
```

- The broker dir is `os.MkdirTemp("", "kira-askpass-")` — POSIX `mkdtemp(3)` creates it `0700`, so
  no other OS user can read the shim, reach the socket or see the token. The socket file is named
  `s` because macOS caps `sun_path` at 104 bytes and `$TMPDIR` there is already ~50 (probe P14).
- `GIT_ASKPASS` and `SSH_ASKPASS` both point at `shim`; `SSH_ASKPASS_REQUIRE=force` accompanies them
  (D6). Probe P4 shows ssh's protocol is byte-identical to git's, so one shim serves both.
- The shim's `<helper argv[0]>` and `<fixed args…>` come from a **`HelperCommand []string` field on
  the broker**, defaulted in production to `[]string{exePath, "askpass"}` where `exePath` is
  `os.Executable()`. The path is written into the shim through a strict quoting helper, and the
  broker refuses to start if it contains a `"` or a newline — a path that cannot be quoted safely is
  a hard error, never a best-effort escape.
- `main.go` gains, as its **first** statement, before any Wails call:

  ```go
  if len(os.Args) > 1 && os.Args[1] == "askpass" {
      os.Exit(gitaskpass.RunHelper(os.Args[2:], os.Environ(), os.Stdout))
  }
  ```

  Four lines, unambiguous (a GUI launch has no argv), and it cannot start a window because it
  returns before anything Wails-related runs.
- `HelperCommand` is also the **test seam**: `gitaskpass`'s own tests and `gitsock`'s integration
  tier set it to `{os.Args[0], "-test.run=TestAskpassHelperProcess", "--"}`, the stdlib `os/exec`
  helper-process idiom, so the entire broker — shim, socket, protocol, every timeout — is provable
  in this container without building or running the app binary.

**The socket protocol**, one NUL-free JSON line each way, deliberately as small as upstream's:

```
helper → broker   {"token":"<64 hex>","opId":"<32 hex>","prompt":"<git's text>"}\n
broker → helper   {"ok":true,"answer":"…"}\n   |   {"ok":false}\n
```

**The helper's own rules** (`RunHelper`): fail closed. Missing env → exit 1. Cannot connect → exit 1.
Malformed response → exit 1. `ok:false` → exit 1, printing nothing. Its own deadline
(`KIRA_ASKPASS_TIMEOUT_MS`, mirrored from the broker) → exit 1. Only `ok:true` prints the answer
plus `\n` to stdout and exits 0. It never writes the answer, or the prompt, anywhere else — not to
stderr, not to a log.

### D9 — Nothing about a credential is ever retained, and the security boundary is stated rather than overclaimed

The chapter's standing posture (G1: pairing tokens are stored as `sha256(salt‖token)` and never
recoverable) applied to a secret that is not stored **at all**:

- **No file.** The broker writes a shim and a socket; it never writes an answer.
- **No database.** No `kira.db` table, no new column, no `review.db`.
- **No log.** No `slog` call in `gitaskpass`, `gitsession`'s prompter, `gitrpc`'s
  `credential.provide` handler or the extension's relay ever takes the prompt or the secret as an
  argument. `gitsock`/`rpcstream` log no frames today (F4) and this phase adds none.
- **No memory beyond one prompt.** The answer lives in one channel send and one `[]byte` write to
  the helper's socket. The waiter map entry is deleted before the send; nothing caches per repo,
  per remote or per session. Two prompts in one push (probe P1) are two independent round trips.
- **No `git credential` interposition.** We neither read nor write git's own credential helpers.
  A user who has a credential manager configured keeps it, untouched (D10) — and that is also the
  reason a second prompt is rare in practice.

**What the boundary actually is, stated honestly.** The `0700` broker directory excludes other OS
users from the socket and the shim. It does *not* exclude other processes running as **the same
user**: the session token travels in the child's environment, and on macOS a same-user process can
read another same-user process's environment. That is exactly upstream's exposure and it is not
closable by any token scheme, because a same-user attacker can read the socket path the same way.
What the token *does* buy is that a stray or delayed connection — including one from a
*previous, already-finished* op — cannot be answered by the current op's prompt: the broker
validates the token **and** the op id on every message, and an op id is only registered for the
duration of one spawn. Every credential request additionally produces a **visible prompt in the
user's editor**, so a silent harvest is not available even to a same-user process that knows both
secrets.

### D10 — The broker never overrides a user's own `core.askPass` or an inherited `GIT_ASKPASS`

Ported verbatim from upstream's `shouldInterposeAskpass`, and the reason is the chapter's own
config-fidelity posture: a user who configured a credential manager configured it deliberately, and
has already solved this problem better than we can.

`ShouldInterpose(coreAskPass, inheritedGitAskpass string) bool` is pure and returns false when
either is non-empty. `RepoEntry` reads `git config --get core.askPass` **once per entry**, lazily,
on the first remote op (one spawn, exit 1 with empty output is the common case and is tolerated
through G5 D15's `runAllowingExit`), and caches it for the entry's life alongside the head; the
inherited value comes from `os.Getenv("GIT_ASKPASS")` at broker construction.

When interposition is declined the remote-op spawn gets **no** askpass env at all — not the shim,
not `SSH_ASKPASS`, not the tokens — and the user's own helper answers, exactly as it would from a
terminal.

### D11 — Remote ops do **not** take `Repo.Write`; the ≤1 slot is the mutual exclusion, and only pull's integrate phase is a real write

Resolving F8 and F9, and the decision most likely to be got wrong by analogy with G5.

| Phase | Gate | Why |
|---|---|---|
| `fetch`, and `pull`'s fetch phase | none — the shared slot only | Writes objects and remote-tracking refs under git's own locking; takes no index lock; touches no worktree file. Holding `Repo.Write` for ninety seconds would block every read in every window (F8) |
| `push`, `forcePush`, `deleteRemoteBranch` | none — the shared slot only | Same: nothing local is written but a remote-tracking ref |
| `pull`'s integrate phase (`merge --ff-only` / `merge --no-edit` / `rebase`) | **`Repo.Write`**, exactly as G5's ops | A genuine local write, with every hazard G5 D8 named: index lock, worktree files, sequencer state |
| the ref-snapshot reads that bracket a fetch (D13) | `Repo.Read` | Ordinary reads |

**The ≤1 slot** (`RepoEntry.remoteOp`, SPEC §6's own box, F9): a `remote.run` arriving while another
is in flight on the *same repository* — from any connection — answers
`RemoteOpResult{ok:false, error:{kind:"OperationInProgress", …}}` rather than queueing. Upstream's
OQ7 reasoning transfers unchanged: a push sitting invisibly behind a ninety-second fetch is worse
than being told to wait, and it makes "which op does cancel cancel?" ambiguous.

Local ops (`op.run`) and remote ops are *not* mutually exclusive with each other: they take
different gates, and git's own locking is what arbitrates. A checkout during a fetch is exactly as
safe as it is in a terminal.

`Repo` gains one accessor for D19's guardrail: `func (r *Repo) Writing() bool` — three lines under
the existing mutex.

### D12 — The argv, fixed here so nobody re-derives it

```
fetch    fetch --progress [--prune] [--prune-tags] <remote>
push     push --porcelain --progress [--set-upstream] <remote> refs/heads/<b>:refs/heads/<b>
force    push --porcelain --progress --force-with-lease --force-if-includes <remote> refs/heads/<b>:refs/heads/<b>
force!   push --porcelain --progress --force <remote> refs/heads/<b>:refs/heads/<b>
delete   push --porcelain --progress <remote> --delete refs/heads/<b>
pull     = fetch (above, --prune, never --prune-tags) then exactly ONE of
             merge --ff-only <upstream>
             merge --no-edit <upstream>
             rebase <upstream>
```

- **`--progress` always** — the child is never a tty (D6 guarantees it), and without the flag git
  emits no progress at all.
- **`--porcelain` on every push** (F10/P5) — the exact, tab-separated, locale-independent statement
  of each ref's outcome, available far below the 2.38 floor. Not on fetch: it does not exist there
  (F11/P12).
- **`--prune` on, `--prune-tags` off** by default, both carried as explicit `RemoteOpParams` fields
  the UI already sends (upstream D49): `--prune-tags` deletes local-only tags, fetch offers no undo,
  and an unpushed tag is user work.
- **Fully-qualified refspecs on both sides** (F14/P5), so neither `push.default` nor a
  same-named tag can redirect a push.
- **`--force-with-lease --force-if-includes`, bare** (upstream D48, probe P6): an explicit
  `--force-with-lease=<ref>:<sha>` satisfies the lease directly and renders `--force-if-includes`
  inert, and the two guard different hazards. The residual hazard §7.4 wanted the explicit sha for
  is closed instead by **re-reading `refs/remotes/<remote>/<branch>` immediately before the spawn and
  comparing it with `RemoteOpParams.expectedRemoteTip`** — the field the migrated contract already
  declares for exactly this, with its own doc comment stating exactly this. A mismatch fails with
  `LeaseViolation` **before any push happens**.
- `--delete` takes a fully-qualified ref too, which also removes any ambiguity with a tag of the
  same name.
- **`git pull` appears in no argv builder anywhere.** §7.3's decomposition, made structural.

`gitops/remote.go` additionally holds `RemotesArgs()` (`remote`, one name per line) and
`RemoteTipArgs(remote, branch)` (`rev-parse -q --verify refs/remotes/<remote>/<branch>`, tolerated
exit 1 through G5 D15's `runAllowingExit`).

### D13 — `RefUpdate[]` comes from a ref-snapshot diff for fetch/pull and from `--porcelain` for push

Resolving F11.

- **push family**: parse `--porcelain`'s stdout. Each line is `<flag>\t<src>:<dst>\t<summary>`;
  `flag` is one of `space` (fast-forward), `+` (forced), `*` (new), `-` (deleted), `!` (rejected),
  `=` (up to date); `summary` is `<from>..<to>`, `<from>...<to> (forced update)`, `[new branch]`,
  `[deleted]`, or `[rejected] (<reason>)`. The block ends at `Done`. This yields `from`/`to`/`forced`
  exactly, and it yields the **rejection reason** the classifier needs (D14).
- **fetch, and pull's fetch phase**: take `porcelain.RefSnapshotArgs()` before and after and diff the
  two maps. Present-after-only ⇒ `{from: null}`; present-before-only ⇒ `{to: null}`; changed ⇒ both.
  `forced` for a changed ref is one `merge-base --is-ancestor <from> <to>` (exit 0 ⇒ not forced,
  exit 1 ⇒ forced), run only for refs that changed *and* have both endpoints — a set that is empty
  or tiny in every realistic fetch, and is exactly empty for a first clone-shaped fetch where every
  ref is new.

Exact by construction, version-independent, locale-independent, correct for a **cancelled** fetch
(which is upstream's own stated requirement), and it reuses a parser G3 already wrote and tested
rather than adding a fixture corpus for a field nothing currently renders (F11).

### D14 — Error classification reads the porcelain block **first**, then stderr; six rows are prepended to `gitops`' existing table

Resolving F10, F17 and F18. `gitclient.ErrorKind` is **not** widened — it stays the five-member
spawn vocabulary (G5 D14's rule).

```go
// gitops
func ClassifyRemoteError(porcelainReason, stderr string, exitCode int) (kind, message string)
```

`porcelainReason` is the parenthesised text from the first rejected line of `--porcelain`'s block
(`""` for fetch, and for a push whose block is empty — probe P8). Matched first, exactly:

| Reason | Kind |
|---|---|
| `pre-receive hook declined`, `hook declined` (any `… hook declined`) | `HookRejected` |
| `stale info` | `LeaseViolation` |
| `remote ref updated since checkout` | `RemoteRefUpdated` |
| `fetch first`, `non-fast-forward` | `NonFastForward` |

Then stderr, as six rows **prepended** to `ClassifyOpError`'s existing table (F18 — `not found`
would otherwise swallow `RemoteNotFound`, and a broad `! [rejected]` would swallow the two lease
kinds):

| Kind | Pattern (lowercased) | Probe |
|---|---|---|
| `HookRejected` | `hook declined` | **P7** |
| `LeaseViolation` | `(stale info)` | **P6** |
| `RemoteRefUpdated` | `(remote ref updated since checkout)` | **P6** |
| `NonFastForward` | `! [rejected]`, `non-fast-forward`, `fetch first` | **P5** (no-porcelain form) |
| `AuthFailed` | `terminal prompts disabled`, `could not read username`, `could not read password`, `authentication failed for`, `unable to read askpass response` | **P1/P2** |
| `NetworkFailed` | `could not resolve host`, `connection refused`, `connection timed out`, `unable to access '` | — |
| `RemoteNotFound` | `does not appear to be a git repository`, `repository not found` | — |
| `RemoteRefMissing` | `remote ref does not exist`, `unable to delete '` | **P8** |

`ProtectedBranch` and `Cancelled` are never pattern-matched: git says neither, because both are our
own decisions (D17, D19).

**`remoteMessage`** (`RemoteOpResult.error.remoteMessage`): every stderr line beginning `remote: `,
prefix stripped and **right-trimmed** (F17/P7), joined with `\n`; `undefined` when there are none or
the kind is not `HookRejected`. The hook's own text is the only actionable content in a wall of git
output, and P7 shows it is otherwise buried and ragged.

**A classified remote failure is never an RPC error** — G5 D14's rule, applied again: a non-zero
exit becomes `RemoteOpResult{ok:false, error:{…}, updates, head, inProgress}`. Only a spawn failure
or a genuinely broken repository propagates as an `RpcError`.

### D15 — The progress parser is a pure incremental decoder in `gitops`, throttled at 100 ms server-side

Ported from upstream's `progress.ts`, in `gitops/progress.go`:

```go
type Progress struct{ Phase string; Percent, Done, Total *int; Remote bool }
type ProgressParser struct{ /* partial-line buffer */ }
func NewProgressParser(emit func(Progress)) *ProgressParser
func (p *ProgressParser) Write(chunk []byte)   // splits on '\r' AND '\n'
```

Rules, each pinned by probe P9: split on `\r` and `\n` (an update within a phase is CR-separated, a
phase ends with LF, and a chunk boundary can fall mid-percentage); strip a leading `remote: ` and
set `Remote: true`; **right-trim** (git pads `remote:` lines); then match
`^(.+?):\s+(\d+)% \((\d+)/(\d+)\)` and `^(.+?):\s+(\d+), done\.$`. Anything unmatched is dropped
from progress and still reaches the error buffer untouched — an unrecognised line is not an error,
it is just not progress. A transcript with no progress lines at all emits nothing and is **not** a
stall.

**Throttling is server-side, ~100 ms per repo, and the final state of a phase is always emitted.**
`Counting objects` alone produced dozens of CR-separated updates on a trivial local fetch; a real
clone produces thousands, and throttling client-side would mean the frames were already built,
encoded and written. The throttle wrapper takes a clock so it is testable without sleeping.

### D16 — `protectedBranches` and `fetch.autoInterval` become genuinely server-owned, in `kira.db`, edited in Kira Studio's own settings dialog; the two VS Code keys are removed

Resolving F12, and the phase's second human-flagged call (§11.2).

**Where they live**: two new leaves in the existing `settings` table, read through
`model.Settings`'s existing per-leaf mechanism —
`git.protectedBranches` (JSON string array, default `["main","master","release/*"]`) and
`git.fetchAutoIntervalMinutes` (number, default `0`, clamped `0..1440`). `SettingsRepo.Set`'s patch
is per-leaf (`repos/settings.go:66-140`), so a section the studio frontend does not know about can
never be clobbered by a frontend write.

**How the git server reads them**: a narrow interface in `gitsock`, following `TrustStore`'s exact
precedent (F12), satisfied structurally by `*repos.SettingsRepo`:

```go
// gitsock
type GitSettings interface{ GetAll() (model.Settings, error) }
```

threaded to `gitsession.Registry` as a `func() (protectedBranches []string, autoFetchMinutes int)`
accessor so `gitsession` keeps importing only `gitclient` and stdlib. Read fresh on each
`remote.pushPreflight`/`remote.run` (a single indexed SQLite read, at human speed) rather than
cached — a stale protected-branch list is a safety bug and there is no cache-invalidation design
worth building for one row.

**How a user changes them**: two fields in `SettingsDialog.vue`'s existing **Connected editors**
section (`SettingsDialog.vue:83`) — a text area of patterns and a minutes input. This is not "an
embedded git UI": SPEC's exclusion is about a graph, a panel or a tab kind, and the *Connected
editors* pane is the one git-facing surface SPEC itself grants Kira Studio.

**And the two now-dead VS Code keys are removed** from `packages/git-core/src/settings/schema.ts`
and from `apps/kira-studio-vscode/package.json`'s `contributes.configuration` (F12: after D22 they
have no reader on either side, and a user-editable setting that silently does nothing is worse than
no setting). `kiraVersion.pull.strategy` **stays** — it is a per-window preference, SPEC does not
list it as server-owned, and D2 injects it into `remote.pullPreflight` exactly as G6 injects
`baseCandidates`. `kiraVersion.git.path` **stays untouched** — it is not a remote-op setting and
`packages/git-ui`'s blocked-state copy names it in shipped, unmodifiable text (F12); handed to G8.

### D17 — Protected branches: a Go glob matcher in `gitpreflight`, consulted by exactly two places, enforced server-side

Resolving G5 F6's hand-off — the matcher whose only upstream call site was `preflight/push.ts`, and
G7 is the phase that gives it a real one.

```go
// gitpreflight/push.go
type ProtectedMatch struct{ Pattern string }
func MatchProtectedBranch(branch string, patterns []string) *ProtectedMatch
```

**Pattern syntax**, ported verbatim from upstream's `model/protectedBranch.ts`:

- `*` matches any run of characters **except `/`**. So `release/*` matches `release/1.2` and does
  **not** match `release/1.2/hotfix` or `releases/1.2`.
- `**` is **not** supported: a pattern containing it is treated literally and reported as a
  problem rather than silently doing something surprising. Upstream reported that through its
  settings-problem channel; here the problem is `slog.Warn`'d once at read time (the setting is
  server-owned and Kira Studio's own settings dialog is where a bad value is entered).
- Case-sensitive — git refnames are.
- Returns the **matched pattern**, never a bool, so the dialog can say "`release/1.2` matches your
  protected pattern `release/*`". That is the difference between friction that teaches and friction
  that annoys, and `PushPreflight.protectedBy` is already typed `string | null` for it.
- Implemented as an explicit segment walk, not `path.Match` (whose `*` also stops at `/` but whose
  `[`/`?`/`\` semantics differ from upstream's) and not a regexp built per call.

**Which operations consult it** (upstream D52, unchanged): `forcePush` in both flavours, and
`deleteRemoteBranch`. **Plain `push` is never gated** — pushing a fast-forward to `main` is the most
common thing anyone does with `main`, and gating it would make the confirmation reflexive within a
day and worthless everywhere else.

**Enforcement is server-side and unconditional.** `remote.run` re-reads the server-owned list (D16),
re-matches, and — when a pattern matches — requires `RemoteOpParams.confirmToken` to equal the
branch name exactly, failing with `ProtectedBranch` otherwise. A pre-flight is advice, not a lock;
the server never trusts that the UI asked.

### D18 — Pull is decomposed into two tracked steps, and a partial failure reports the step it failed in

Resolving F19 and porting upstream's §7.3.

**The strategy ladder** (`gitpreflight.ResolvePullStrategy`, pure, first match wins):

1. an explicit strategy in the request → `source: "explicit"`
2. `kiraVersion.pull.strategy`, unless `"auto"` → `"setting"`
3. `branch.<current>.rebase` — `true`/`interactive`/`merges` ⇒ rebase, `false` ⇒ merge →
   `"branchConfig"`
4. `pull.rebase` — same mapping → `"pullConfig"`
5. `pull.ff=only` ⇒ ff-only → `"pullConfig"`
6. fallback ⇒ **ff-only** → `"default"`

Steps 3–5 are read in **one** spawn: `config --null --get-regexp
'^(pull\.(rebase|ff)|branch\.<name>\.rebase)$'`, parsed per probe P10's framing (NUL-terminated
records, key and value separated by a **newline** — not the space-separated form G5's undo capture
already parses, F16).

**Execution**, `gitsession`'s own two steps:

```
1. fetch  <remote> <branch>          (killable; RefUpdate[] from the snapshot diff, D13)
   fetch failed  -> RemoteOpResult{ok:false, error:<classified>, updates:<whatever moved>} — STOP
2. integrate                         (NOT killable; through Repo.Write, D11)
     merge --ff-only <upstream> | merge --no-edit <upstream> | rebase <upstream>
   integrate failed -> RemoteOpResult{ok:false, error:<classified>, updates:<step 1's>,
                                      head:<read back>, inProgress:<read back>}
```

**Partial failure is attributed by construction**: `updates` describes step 1 whether or not step 2
ran, and `error` always describes the step that failed. There is no ambiguity about "did the fetch
work?" because the ref updates are right there.

**A conflicting merge or rebase lands in G5's existing in-progress banner, and this phase adds no
detection for it.** `RemoteOpResult` carries `head` and `inProgress` in exactly `OpResult`'s shape
(the contract's own doc comment says so), the read-back is G5's `statusAndInProgress`, and
`ClassifyInProgress` already recognises `rebase-merge/`, `rebase-apply/` and `MERGE_HEAD` — G5 D9
made `ContinueArgs`/`AbortArgs`/`SkipArgs` total over `InProgressKind` for exactly this reason
("the repository can *be* in any of those states when the user opens it"). G7 triggers a state the
banner already reads; it does not duplicate a single line of the detection.

**`ff-only` against a diverged branch** fails with `NonFastForward` and a message naming the other
two strategies — the decomposition's whole point is that the user chooses.

**`PullPreflight.routes` ships empty** (upstream's P9 seam), and `blockers` is computed faithfully:
`dirtyNonFastForward` when the worktree is dirty and the pull would not fast-forward. F19's
consequence is recorded rather than avoided — the migrated UI routes that case through
`#stashAndCarry`, whose `stashPush` is G12's, so a dirty non-fast-forward pull fails visibly at the
stash step until G12 lands, exactly as "Push tag" has failed since G5 (G5 D5's own precedent).
Suppressing the blocker instead would ship a pull that silently rewrites history over a dirty tree,
which is strictly worse.

### D19 — Cancellation: fetch is killable, everything else is not, and a disconnect kills nothing

Resolving G5 D8's explicit hand-off (*"G7's remote ops get real cancellation semantics of their
own"*) and confirming the asymmetry it predicted.

| Operation | Killable after it starts | Why |
|---|---|---|
| `fetch`, and `pull`'s fetch phase | **yes** | Leaves loose objects or a packfile a later `gc` collects, and moves no ref the user can see until it completes. No lock, no half-state |
| `pull`'s integrate phase | no | A local write with every hazard G5 D8 names |
| `push` / `forcePush` / `deleteRemoteBranch` | no | The remote may already have accepted it. A cancelled push has an **unknowable** outcome, and reporting "cancelled" when the remote's refs moved is worse than making the user wait |

**Mechanism.** The op's context is `context.WithoutCancel(request ctx)` (so a client disconnect
never kills it — SPEC §6's rule, unchanged from G5 D8) wrapped in the entry's own
`context.WithCancel`, whose `cancel` is stored in the shared slot together with a `killable bool`
that flips as the op moves between phases. `remote.cancel` takes the slot's lock, and:

- nothing running, or the current phase is not killable ⇒ `{cancelled: false}` — **never an error**;
  a cancel racing a just-finished op is an ordinary outcome (the contract's own doc comment says so).
- killable ⇒ `cancel()`, which reaches `exec.CommandContext`'s `Cancel` and G2 D3's group
  SIGTERM-then-SIGKILL, and `{cancelled: true}`. The op's own goroutine then classifies its outcome
  as `Cancelled`, still reads back head/in-progress, still reports whatever `updates` had already
  landed, and still clears the slot.

**A disconnect kills nothing** but does end any prompt the departed connection owed an answer to
(D4) — so a push started by a window that then closes finishes and reports nowhere, while a push
that needed a password from that window fails fast with `AuthFailed` instead of hanging. Both
outcomes are SPEC §6 read literally.

**Remote ops never touch the undo slot**, in either direction (upstream D51/OQ6). §7.12's "another
operation clears the undo slot" is read as "another operation that changes local history"; an
auto-fetch tick silently destroying the undo record for a branch the user deleted two minutes ago is
indefensible, and once auto-fetch does not clear it, an explicit fetch that does would be
unpredictable. `RemoteOpResult` has no `undo` field at all, by construction.

### D20 — The shared/private split: the **operation** is shared, the **prompt** and the **progress** are private

Resolving F9 with SPEC §6's own rule, and deciding the two things SPEC does not name.

**Shared — on `RepoEntry`** (a fact about the repository):

- `remoteOp` — the ≤1 slot: kind, phase, killable, `cancel`, started-at. SPEC §6's box lists it by
  name, and the `≤1` only means anything if it is shared: two windows fetching the same repository
  concurrently is precisely what it prevents, and `remote.cancel` from *either* window must reach
  the one op that is running.
- `autoFetch` — the timer, its disabled-for-this-entry flag, and the cached `core.askPass` answer.
  One repository, one background fetch, regardless of how many windows have it open.

**Private — on `Conn`** (a fact about one viewer's request):

- `credentials map[string]chan credentialAnswer` — the waiters. A credential prompt is addressed to
  one human at one editor window, is answered by exactly that window, and must die with it (D4's
  third row is the whole point). Putting it on `RepoEntry` would make "which window answers?"
  undefined and would destroy the disconnect guarantee.
- **`remote.progress` delivery, to the initiating connection only.** The evidence is decisive:
  `RemoteProgress` carries no op id, and `state/ops.ts:189-243` renders the bar only while
  `activeRemoteOp` is set — which a window sets **locally**, in `#runRemote`, when *it* starts an op.
  A non-initiating window that received the events would render nothing with them. Fanning out would
  cost a second fan-out channel on `RepoEntry` (the existing subscriber pipe is typed to `Event`) to
  produce output no UI can display.

So a second window learns that something happened to the repository the way it always has: through
`repo.changed`, which the watcher raises when the fetch moves a ref. The operation is shared; its
narration is not.

### D21 — `RepoEntry` grows a slot and a timer; `Conn` grows a waiter map and a `done` channel

Resolving F20 and giving D20 its shapes.

```go
// gitsession/entry.go
type remoteOpSlot struct {
    mu       sync.Mutex
    kind     string            // "" when idle
    killable bool              // flips per phase (D19)
    cancel   context.CancelFunc
    started  time.Time
}

// gitsession/conn.go
done chan struct{}                              // closed once, in Close (F20)
credMu sync.Mutex
creds  map[string]chan string                   // requestId -> waiter; "" is never a valid answer,
                                                // so a closed/abandoned channel and a dismissal are
                                                // the same "not answered" to the caller
func (c *Conn) Done() <-chan struct{}
func (c *Conn) AskCredential(ctx context.Context, req gitaskpass.Request) (string, bool)
func (c *Conn) ProvideCredential(requestID string, secret *string) error
```

`AskCredential` mints the id, registers the channel, `Emit`s `credential.request`, and then selects
on the channel, `ctx.Done()` and `c.Done()` — the three bounds of D4's table that live on this side.
It deletes its own entry on every exit path. `Close()` closes `done`, which unblocks every waiter at
once.

`*Conn` therefore satisfies `gitaskpass.Prompter` structurally, with no adapter and no import of
`gitaskpass` from `gitsession`… except for `Request`. To keep the dependency one-directional and
`gitsession` free of anything above the layering line, `gitsession` **imports `gitaskpass`** (a
stdlib-only leaf package) rather than the reverse. `internal/layering_test.go` needs no exemption:
`gitaskpass` imports stdlib only.

### D22 — `git-core` drops `preflight/push.ts`, `preflight/pull.ts` and `model/protectedBranch.ts`

Closing G5 D17's hand-off (*"**G7** owns `preflight/{push,pull}.ts`"*) with the check G5 could not
do: `grep` for `classifyPush`, `buildPullPreflight`, `resolvePullStrategy` and
`matchProtectedBranch` across `packages/git-ui`, `packages/git-core` and `apps/kira-studio-vscode`
finds their own definitions, their three `.test.ts` files, and three `index.ts` export lines —
**no live caller anywhere**.

Deleted: `preflight/push.ts`, `preflight/push.test.ts`, `preflight/pull.ts`, `preflight/pull.test.ts`,
`model/protectedBranch.ts`, `model/protectedBranch.test.ts`, and the four `index.ts` lines that
re-export them.

`model/protectedBranch.ts` goes with them even though SPEC's migrated-extension table says
`git-core` keeps `model/*`: that table describes `model/*` as "(wire types)", and the matcher is
policy, not a wire type — SPEC's own `gitpreflight` package row names the protected-branch glob
matcher as server-side. Its only importer was `preflight/push.ts`.

`preflight/types.ts` stays whole (`PullPreflight`/`PushPreflight`'s *types* are still exported and
`preflight/{reset,cherryPick,stashPop,tag}.ts` still use it). `model/remote.ts` stays — it is the
structural copy of the wire's remote vocabulary, which is exactly what SPEC says `model/*` is for.

### D23 — Auto-fetch is a per-`RepoEntry` timer, silent, credential-free, and self-disabling

Resolving F13, and adapting upstream's three guardrails to a headless backend.

| Upstream guardrail | Here |
|---|---|
| only while the window is focused | **the `RepoEntry` exists** — i.e. at least one connection holds the repository open (plus G2 D12's five-minute linger). There is no focus signal in this contract (G2 F14) and no per-window timer to attach one to |
| only while the panel is visible | same — and per D20 the timer is per-repository, not per-window, so a per-window visibility flag has no coherent meaning |
| never while another op holds the write queue | `remoteOp` is idle **and** `Repo.Writing()` is false (D11's new accessor) |
| a failure disables the timer for the session | a failure disables it for the life of the `RepoEntry`, logged once at `warn` |

Plus two rules of its own:

- **First tick waits a full interval.** An auto-fetch racing a window's cold start would compete
  with the initial graph load.
- **It never prompts.** The auto-fetch spawn is given **no askpass env at all** — no shim, no
  `SSH_ASKPASS`, no tokens — on top of `GIT_TERMINAL_PROMPT=0`. A remote that needs a credential
  therefore fails immediately with `AuthFailed`, which disables auto-fetch for the entry and is
  logged; the user finds out the next time they press **Fetch** explicitly and get a real prompt.
  This is the direct answer to "a background fetch must not pop a credential box out of nowhere":
  it cannot, structurally, rather than by policy.
- **It is silent**: it emits no `remote.progress` (there is no initiating connection to emit to —
  D20), takes the shared slot for its duration so it can never race an explicit op, and produces no
  error anywhere in the UI. Its visible effect is the `repo.changed` the watcher raises when a ref
  moves, which is indistinguishable from a `git fetch` in a terminal — which is the point.
- **Which remote**: `origin` if it exists, else the sole remote if there is exactly one, else the
  tick is skipped. No guessing among several.

Default interval is `0` (off), so an installation that never opens Kira Studio's settings dialog
never runs a background fetch.

### D24 — What gets a test, and what does not

`AGENTS.md`'s bar, applied honestly. **Tested:**

- **`gitaskpass` (broker + shim + helper), end to end over a real socket, with the helper-process
  seam** — the answer path; the dismissal path; the broker-timeout path; the owning-connection-dies
  path; a wrong token; a stale op id; a helper with no env; a broker that never answers (the
  helper's own timeout). ("concurrency — ordering, backpressure, cancellation, races", and the
  phase's own central safety property.)
- **`gitops/progress.go`** — the exact byte transcripts captured in probe P9, including a chunk
  split mid-percentage, the `remote: ` prefix with its trailing pad, the `N, done.` form, an
  unrecognised line being dropped, and a transcript with no progress at all emitting nothing.
  ("a parser/splitter with several interacting rules")
- **`gitops/push.go`'s porcelain parser** — the five flag characters and the five summary shapes
  from probes P5/P6/P7, plus probe P8's empty block. (same clause)
- **`gitops/errors.go`** — one case per row of D14's table using verbatim probe stderr, plus the
  three ordering assertions that matter: a hook rejection is `HookRejected` and not
  `NonFastForward`; `Repository not found` is `RemoteNotFound` and not `NotFound`; `(stale info)` is
  `LeaseViolation` and not `NonFastForward`.
- **`gitpreflight/push.go`'s matcher** — `main`/`main`; `release/*` against `release/1.2` (match),
  `release/1.2/hotfix` (no match), `releases/1.2` (no match); an empty pattern list; a `**` pattern
  reported and treated literally; a branch name containing a literal `*`.
- **`gitpreflight/pull.go`'s ladder** — one case per rung, in order, plus the `auto` pass-through
  and the `branch.<name>.rebase` value mapping. ("a decision structure too large to hold in your
  head")
- **`gitsession`** — the ≤1 slot's concurrency (a second `remote.run` refuses; cancel of a
  non-killable phase reports `false`; cancel of a killable one cancels), and the credential waiter's
  four exits (answered, dismissed, ctx cancelled, `Conn.Close`).
- **`gitsock` integration** — §3.11's tests, over a real socket, against **a real local bare
  remote**. **This is the phase's real end-to-end proof.**

**Not tested, deliberately**: `gitops`' argv builders (each returns one literal slice —
`AGENTS.md`'s "thin pass-through"; proven by the integration tier running them), `gitrpc`'s handlers
(thin dispatch), the ref-snapshot diff (a map comparison exercised by every integration fetch), and
`gitclient`'s two new `Spec` fields (a field appended to an env slice and a callback called in a
loop — exercised by every remote-op test).

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/internal/` unless stated.

### 3.1 `gitclient/runner.go` — edited (D5, D6)

| Change | Detail |
|---|---|
| `Spec.Env []string` | appended after `hygieneEnv` in `buildEnv(base, extra []string)`; later wins |
| `Spec.OnStderr func([]byte)` | called from `drainStderr`'s loop before the bounded write; never after `Wait` returns |
| `drainStderr` | `io.Copy` → a `Read`/`OnStderr`/`Write` loop over a 32 KiB buffer |
| `SysProcAttr` | `Setpgid: true` → `Setsid: true`, with a comment naming the controlling-terminal guarantee and stating that `pgid == pid` keeps `killGroup` unchanged |
| `hygieneEnv` | **unchanged** — `GIT_TERMINAL_PROMPT=0` is already there and is guarantee #1 |

### 3.2 `gitclient/repo.go` — edited (D11)

One accessor: `func (r *Repo) Writing() bool` — `mu.Lock()`, return `writing`. Used only by D23's
auto-fetch guardrail.

### 3.3 `gitaskpass/` — new package (D7–D10)

| File | Contents |
|---|---|
| `prompt.go` | `Request{RepoID, Prompt string; Masked bool}`, `Prompter` interface, `DeriveMasked(prompt) bool` |
| `interpose.go` | `ShouldInterpose(coreAskPass, inheritedGitAskpass string) bool` |
| `broker.go` | `Broker`, `Options{Timeout time.Duration; HelperCommand []string}`, `Start() (*Session, error)`, `Session.Env() []string`, `Session.WithOp(ctx, prompter, fn func(opEnv []string) error) error`, `Close()`, the connection handler and the token/op-id checks |
| `helper.go` | `RunHelper(args []string, env []string, stdout io.Writer) int` — the client half `main.go` dispatches to |

`Session.Env()` returns the constant three (`GIT_ASKPASS`, `SSH_ASKPASS`, plus
`SSH_ASKPASS_REQUIRE=force`) alongside `KIRA_ASKPASS_SOCK` and `KIRA_ASKPASS_TOKEN`; `WithOp` layers
`KIRA_ASKPASS_OPID` and `KIRA_ASKPASS_TIMEOUT_MS` for one spawn and unregisters the prompter on
every exit path, so a `Prompter` never outlives the op it was supplied for.

Imports stdlib only (`context`, `crypto/rand`, `crypto/subtle`, `encoding/json`, `net`, `os`,
`path/filepath`, `strings`, `sync`, `time`). No `gitsession`, no `gitclient`, no `bridge`.

### 3.4 `apps/kira-studio/main.go` — edited (D8, D16)

Four lines at the very top of `main()` for the `askpass` subcommand (D8), and, beside the existing
git wiring (`main.go:99-111`): construct the broker, pass it into `gitsock.Deps`, pass
`repos.SettingsRepo` in as `GitSettings`, and `defer broker.Close()`. A broker that fails to start
is logged at `warn` and left nil — every remote op then runs with no interposition, which is D10's
own already-supported path, not a new failure mode.

### 3.5 `gitops/` — four new files and one edited (D12–D15)

| File | Exports |
|---|---|
| `fetch.go` | `FetchArgs(remote string, prune, pruneTags bool)`, `FetchRefspecArgs(remote, branch string, prune bool)` (pull's step 1) |
| `push.go` | `PushArgs(remote, branch string, setUpstream bool)`, `ForcePushArgs(remote, branch string, plain bool)`, `DeleteRemoteBranchArgs(remote, branch string)`, `PushStatus{Flag, Src, Dst, Summary, Reason}`, `ParsePushPorcelain(stdout []byte) ([]PushStatus, error)`, `PushUpdates([]PushStatus) []RefUpdate` |
| `pull.go` | `MergeFFOnlyArgs(upstream)`, `MergeArgs(upstream)`, `RebaseArgs(upstream)` |
| `remote.go` | `RemotesArgs()`, `RemoteTipArgs(remote, branch)`, `AheadBehindArgs(branch, upstream)`, `PullConfigArgs(branch)`, `CoreAskPassArgs()`, `IsAncestorArgs(a, b)` |
| `progress.go` | `Progress`, `ProgressParser`, `NewProgressParser`, `Throttle(emit, every, now)` |
| `errors.go` (edited) | `ClassifyRemoteError(porcelainReason, stderr string, exitCode int)`, `ExtractRemoteMessage(stderr string) string`, and D14's six prepended rows on `ClassifyOpError` |

`RefUpdate` lives in `gitops` (JSON-tagged per G4 D5) since both producers — the porcelain parser and
`gitsession`'s snapshot diff — need it.

**No `git pull` argv exists anywhere in this package**, and §7.3's checklist asserts it.

### 3.6 `gitpreflight/` — two new files (D17, D18)

| File | Contents |
|---|---|
| `push.go` | `ProtectedMatch`, `MatchProtectedBranch`, `PushPreflight` (JSON-tagged), `ClassifyPush(input) PushPreflight` |
| `pull.go` | `PullStrategy`, `PullStrategySource`, `PullRoute`, `PullBlocker`, `PullPreflight` (JSON-tagged), `ResolvePullStrategy(explicit, setting string, cfg map[string]string, branch string) (PullStrategy, PullStrategySource)`, `ClassifyPull(input) PullPreflight` |

Both are pure: no spawn, no filesystem, no `gitclient` import. `gitsession` gathers the inputs
(upstream, ahead/behind, remote tip, dirty, the config map, the server-owned pattern list) and hands
them in — the same shape `ClassifyCheckout`/`ClassifyRevert` already have, which is what makes D24's
matrices testable without a repository.

### 3.7 `gitsession/remote.go` — new (D11, D13, D18, D19, D20)

| Export | Contents |
|---|---|
| `(*RepoEntry).PushPreflight(ctx, remote, branch, protectedBranches)` | upstream resolution → guarded ahead/behind (F15) → remote tip → `MatchProtectedBranch` |
| `(*RepoEntry).PullPreflight(ctx, branch, strategySetting)` | one `config --null --get-regexp` (F16) → `ResolvePullStrategy` → upstream/ahead/behind/dirty → `ClassifyPull` |
| `(*RepoEntry).RunRemote(ctx, conn, params, deps)` | the executor below |
| `(*RepoEntry).CancelRemote()` | D19's slot check |
| `refSnapshot(ctx)` | `porcelain.RefSnapshotArgs()` through `Repo.Read`, for D13's diff |

**`RunRemote`, in this exact order:**

```
0. ctx is already WithoutCancel'd by gitrpc (D19/G5 D8); wrap it in the entry's own WithCancel
1. claim the shared slot; already claimed -> {ok:false, OperationInProgress} with NO write at all
2. protected-branch re-check for forcePush/deleteRemoteBranch (D17) -> {ok:false, ProtectedBranch}
3. forcePush only: re-read the remote tip and compare with expectedRemoteTip (D12)
                                                          -> {ok:false, LeaseViolation}
4. askpass: ShouldInterpose? -> broker.WithOp(conn as Prompter) supplying opEnv; else no env at all
5. ref snapshot BEFORE (fetch/pull only)
6. spawn, with Spec.OnStderr -> ProgressParser -> Throttle -> conn.Emit("remote.progress", …)
     fetch/push/force/delete: outside any gate, killable per D19
     pull: step 1 as above, then step 2 through Repo.Write with killable=false
7. ref snapshot AFTER + the forced check (D13)  |  or the porcelain block (push family)
8. read back head + in-progress, ALWAYS — success or failure (G5's own rule)
9. release the slot; return RemoteOpResult{ok, error, updates, head, inProgress}
```

Step 1 before anything else and step 9 in a `defer` are what make the `≤1` invariant hold across
every early return. Step 8 after **both** outcomes is what makes a conflicting pull's `inProgress`
arrive in the operation's own reply rather than waiting on a watcher tick — G5 D8's step 4, applied
again.

### 3.8 `gitsession/autofetch.go` — new (D23)

`(*RepoEntry).startAutoFetch(minutes int)` / `stopAutoFetch()`, armed by `newRepoEntry` when the
server-owned interval is non-zero and stopped by `teardown`. One `time.Timer`, rescheduled after
each tick; the tick checks the slot and `Repo.Writing()`, resolves the remote, and calls the same
`RunRemote` path with a nil `Conn` (no progress emission, no prompter, no askpass env) under
`context.WithoutCancel(context.Background())`.

### 3.9 `gitsession/{entry,conn,registry}.go` — edited (D16, D20, D21)

| File | Change |
|---|---|
| `entry.go` | `remoteOp remoteOpSlot`, `autoFetch autoFetchState`, `askPassChecked/askPassValue` (D10's per-entry cache); `teardown` stops the timer and cancels any in-flight op's context |
| `conn.go` | `done chan struct{}` closed once in `Close`; `Done()`; `creds` map + `AskCredential`/`ProvideCredential` (D21) |
| `registry.go` | a `Settings func() (protected []string, autoFetchMinutes int)` field, defaulted to the Go defaults, set by `main.go` from `repos.SettingsRepo` (D16) |

### 3.10 `gitrpc/` — edited (D2)

| File | Change |
|---|---|
| `wire.go` | params/results for the five methods, mirroring `contract.ts` field for field; `RemoteOpParams` decodes `expectedRemoteTip` as `*string` with a presence flag so `null` and absent stay distinguishable (G4 D5) |
| `remote.go` (new) | `remote.pullPreflight`, `remote.pushPreflight`, `remote.run`, `remote.cancel`, `credential.provide` |
| `handlers.go` | five new cases; `remote.run` detaches its context (D19) |
| `contract.go` | `ContractVersion` 15 → **16** (D2) |

`credential.provide`'s handler is three lines: decode, `c.ProvideCredential(id, secret)`, answer
`{}`. It never logs, never echoes, and never returns the secret in an error message.

### 3.11 `gitsock/` — edited, plus the integration tier

`clients.go` gains `GitSettings` (D16); `Deps` gains `Askpass *gitaskpass.Broker` and `Settings`;
`server.go` needs no change beyond passing them through (the `Conn`'s `done` channel is
`gitsession`'s own, closed by the `defer gconn.Close()` that already exists).

`gitsock/remote_test.go` (new), over G5 F19's existing harness, against a fixture built with
`fixtureEnv()` — a work repo, a **real local bare remote** (`git init --bare`, `symbolic-ref HEAD`),
a second clone used to diverge it, and an installable `pre-receive` hook:

- **`TestIntegration_FetchUpdatesRefsAndReportsProgress`** — a fetch moves `refs/remotes/origin/main`,
  `updates` names it with the right `from`/`to`, and at least one `remote.progress` event reached the
  initiating connection.
- **`TestIntegration_PushSetsUpstreamAndReportsUpdates`** — a new branch pushed with
  `setUpstream: true`; `branch.<n>.remote`/`.merge` are set in the fixture afterwards; `updates`
  carries `from: null`.
- **`TestIntegration_PushNonFastForwardIsClassified`** — the diverged remote; `ok:false`,
  `NonFastForward`, and the remote ref **unchanged** (F10's whole point: this fails if the
  classifier reads only stderr).
- **`TestIntegration_ForcePushLeaseViolation`** — never fetched ⇒ `LeaseViolation`; fetched but not
  integrated ⇒ `RemoteRefUpdated`; remote unchanged in both.
- **`TestIntegration_ForcePushStaleExpectedTipIsRefusedBeforeSpawning`** — a correct lease but a
  stale `expectedRemoteTip` ⇒ `LeaseViolation` with the remote ref untouched **and no push process
  spawned** (D12's mitigation), observed through an injected `Runner`.
- **`TestIntegration_HookRejectionCarriesTheHooksOwnMessage`** — `HookRejected` and
  `remoteMessage == "policy: no pushes on Fridays"`, right-trimmed (P7).
- **`TestIntegration_ProtectedBranchNeedsTheTypedName`** — force-push to `main` with no
  `confirmToken` ⇒ `ProtectedBranch`; with a wrong one ⇒ `ProtectedBranch`; with the right one ⇒
  succeeds. Driven with a server-owned pattern list injected through `Registry.Settings`, proving
  the check does not consult the request.
- **`TestIntegration_PullDecomposesAndAConflictLandsInTheBanner`** — ff-only against a diverged
  branch ⇒ `NonFastForward`; merge against a conflicting one ⇒ `ok:false`, `Conflict`, and
  `inProgress.kind == "merge"` **in the operation's own reply**; then `op.run{kind:"opAbort"}`
  clears it — proving G5's banner is the one that renders it (D18).
- **`TestIntegration_CredentialRelayAnswersAndNeverHangs`** — against a `git http-backend`-free
  stand-in: a local HTTP 401 server, so a real `AuthFailed` is reachable in this container. Four
  scenarios in one fixture: the client answers and the op proceeds past the prompt; the client
  dismisses ⇒ `AuthFailed` promptly; the client is **closed mid-prompt** ⇒ `AuthFailed` promptly;
  the client never answers and the broker's (millisecond) timeout fires ⇒ `AuthFailed` promptly.
  Every one asserts inside a per-test deadline, so a hang fails **as a hang**.
- **`TestIntegration_SecondRemoteOpIsRefusedAndCancelIsHonest`** — two connections, one repository:
  B's `remote.run` during A's ⇒ `OperationInProgress`; `remote.cancel` during a push ⇒
  `{cancelled:false}`; during a (blocked, injected-runner) fetch ⇒ `{cancelled:true}` and the op
  resolves `Cancelled`.
- **`TestIntegration_AutoFetchNeverPrompts`** — with an interval set and an auth-requiring remote,
  the tick completes without any `credential.request` reaching the connected client, and the timer
  disables itself.

### 3.12 `storage/` — edited (D16)

`model.Settings` gains a `Git` section with two leaves and matching `SettingsPatch` fields;
`repos/settings.go` gains two `leafValid` reads and two patch arms following the file's existing
shape exactly. **No migration**: the `settings` table is key→JSON and a leaf absent from it falls
back to its default, which is the mechanism `repos/settings.go:26` already documents.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ipc` — three additions and the version (D2)

`contract.ts`: the `credential.request` event, the `credential.provide` request, and
`strategySetting?: PullStrategy | 'auto'` on `remote.pullPreflight`'s params.
`validate.ts`: `CONTRACT_VERSION = 16`, plus `'credential.provide': true` in `REQUEST_KEY_MAP` and
`'credential.request': true` in `EVENT_KEY_MAP` — both maps are `Record<Key, true>`, so omitting
either is a compile error, which is exactly the guard upstream's own W21 had to add after this class
of bug shipped silently (its F1).

### 4.2 `apps/kira-studio-vscode` — the relay, the progress fan-out, one injection

**`extension.ts`** — three additions inside the existing `context.subscriptions.push(...)` block:

1. Construct `new VsCodeCredentialPrompt()` (the migrated, previously unused port) and subscribe:

   ```ts
   dispose: manager.on('credential.request', (req) => {
     void (async () => {
       const secret = await prompt.ask({ prompt: req.prompt, masked: req.masked });
       await manager.request('credential.provide', {
         requestId: req.requestId, secret: secret ?? null,
       });
     })().catch(() => { /* a failed provide is answered by the broker's own bound; never log it */ });
   })
   ```

   No `try`/`catch` that logs, no telemetry, no `logger.log` anywhere on this path — the prompt text
   can itself contain a credential (F4). If the `credential.provide` call fails (the socket dropped
   between prompt and answer), the broker's own disconnect bound has already fired.
2. Forward `remote.progress` to the **graph** provider only, not the review provider — the review
   view renders no operation UI (upstream's W16, and G6's own `reviewView.ts` has no
   `notifyRepoChanged` twin for a reason). `panelView.ts` gains a four-line `notifyRemoteProgress`
   beside its existing `notifyRepoChanged`.
3. Nothing else. No focus signal, no visibility signal, no auto-fetch scheduler — all server-side
   (D23).

**`proxyHandlers.ts`** — two entries:

- `'remote.pullPreflight'` stops being a bare `forward` and injects
  `strategySetting: snap['kiraVersion.pull.strategy']`, exactly as `review.resolveBase` injects
  `baseCandidates` (`:239-247`).
- `'credential.provide'` is added — `ServerHandlers.requests` is total over `RequestKey` — and it
  **throws**: `"credential.provide is answered by the extension, never proxied from the webview"`.
  The webview must never be able to answer a credential prompt, and a thrown handler is the way to
  say so in a total map (G4's `editor.resolveConflict` uses the same throw-on-impossible shape).

### 4.3 `packages/git-core` — deletions and two settings keys (D16, D22)

Delete `src/preflight/push.ts`, `src/preflight/push.test.ts`, `src/preflight/pull.ts`,
`src/preflight/pull.test.ts`, `src/model/protectedBranch.ts`, `src/model/protectedBranch.test.ts`
and the four `index.ts` lines that re-export them (`:74-75`, `:130-131`).

Remove `kiraVersion.protectedBranches` and `kiraVersion.fetch.autoInterval` from
`src/settings/schema.ts`, and the matching two blocks from
`apps/kira-studio-vscode/package.json#contributes.configuration`. `kiraVersion.pull.strategy` and
`kiraVersion.git.path` stay.

`bun run typecheck:git` is what proves nothing depended on any of it.

### 4.4 `apps/kira-studio/frontend` — two fields (D16)

`workbench/SettingsDialog.vue`'s existing **Connected editors** section gains a "Git remote
operations" sub-label with two controls — protected-branch patterns (one per line) and auto-fetch
interval in minutes — following the file's own `draft`/`pendingPatch`/`resetLeaf` conventions
verbatim. Bindings are regenerated per `AGENTS.md` (`wails3 task common:generate:bindings`, with
`-names`) if and only if a bound service's method set changes; adding leaves to `model.Settings`
does not change one, so this is expected to be a plain frontend edit.

### 4.5 What does **not** change

**`packages/git-ui` is byte-for-byte untouched by this phase.** `AppToolbar.vue`,
`ForcePushDialog.vue`, `PullStrategyPicker.vue`, `pullStrategyModel.ts` and `state/ops.ts`'s whole
`#runRemote`/`#applyRemoteResult`/`cancelRemote` executor are migrated, correct, and already wired to
every method this phase serves. If an implementer finds themselves editing that directory, something
has drifted out of scope.

---

## 5. Dependencies and tooling

**No new dependency, in either language.** No FlatBuffers schema change, so `bun run generate:wire`
is not run and `internal/gitwire`/`src/generated` do not move (D1). `go.mod` and `bun.lock` are
expected to be **unchanged**; a diff in either is a signal something was reached for that this plan
did not sanction.

The only new *runtime* artefacts are the broker's own temp directory, its `sh` shim and its socket
— created at startup, deleted at shutdown, and never committed.

---

## 6. Implementation order

Ten commits. `go build ./apps/kira-studio/internal/...`, `go test` over the packages touched, `bun
run lint` and `bun run typecheck` run after **each** — they are fast. The expensive tier (§7.1) runs
once at C10, per `AGENTS.md`'s "implement the whole plan first, then test once".

- **C1** `feat(gitclient): a stderr tee, per-spec env, and a session-detached spawn`
  — §3.1 + §3.2 (D5/D6/D11). Three fields and one word; kept its own commit because it is the one
  edit to the package five phases have already stabilised, and `Setsid` is a behaviour change every
  later commit inherits.
- **C2** `feat(gitaskpass): the credential broker, its private socket and the askpass shim`
  — §3.3 in full plus D24's broker tests, driven entirely through the `HelperCommand` seam. No
  production caller yet.
- **C3** `feat(kira-studio): dispatch the askpass helper subcommand and start the broker`
  — §3.4's four lines and the wiring. This is what makes C2 reachable by a real `git`.
- **C4** `feat(gitops): fetch, push and pull argv, the porcelain parser and the stderr progress parser`
  — §3.5's five new files plus D24's two parser suites. Nothing imports them yet.
- **C5** `feat(gitops): classify the remote error family, ahead of the local rows`
  — `errors.go`'s six prepended rows, `ClassifyRemoteError`, `ExtractRemoteMessage`, and D24's
  ordering assertions.
- **C6** `feat(gitpreflight): the push and pull classifiers and the protected-branch matcher`
  — §3.6 in full with D24's two matrices. Pure; closes G5 F6's hand-off.
- **C7** `feat(storage): server-owned git settings, read per operation`
  — §3.12 plus §4.4's two dialog fields (D16). Small and self-contained; landing it before C8 means
  the executor has a real list to read rather than a constant to replace later.
- **C8** `feat(gitsession): the shared remote-op slot, the executor, the credential relay and auto-fetch`
  — §3.7 + §3.8 + §3.9, with D24's slot and waiter tests. **This is where the phase meets itself.**
- **C9** `feat(git): serve remote.* and credential.provide; CONTRACT_VERSION 16`
  — §3.10 + §3.11's wiring + §4.1 + §4.2. The contract bump is stated in the commit body with its
  three reasons (D2) so the version move reads as a decision.
- **C10** `refactor(git-core): drop the push and pull pre-flights and the protected-branch matcher`
  — §4.3, then §3.11's integration tier and the full §7.1 run.

Dependency order: C1 before C2 and C4; C2 before C3 and C8; C4, C5, C6, C7 before C8; C8 before C9;
C9 before C10's integration tier.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 What is proven automatically, in this container

Per SPEC's **"Full verification scope, 2026-09-07"**, the once-per-phase race run is scoped to the
git packages actually in play plus the layering test — **not** the whole `apps/kira-studio/internal/`
tree, whose `adapters/*`/`storage/repos` suites take real minutes under `-race` and cannot be touched
by any git-chapter change. For G7 that list is SPEC's own, plus `gitreview` (added by G6, after the
note was written) and `gitaskpass` (added here), plus `storage/repos` **only because D16 edits it**:

```
go test -race \
  ./apps/kira-studio/internal/gitclient/... \
  ./apps/kira-studio/internal/gitaskpass/... \
  ./apps/kira-studio/internal/gitpreflight/... \
  ./apps/kira-studio/internal/gitops/... \
  ./apps/kira-studio/internal/gitsession/... \
  ./apps/kira-studio/internal/gitreview/... \
  ./apps/kira-studio/internal/gitrpc/... \
  ./apps/kira-studio/internal/gitsock/... \
  ./apps/kira-studio/internal/gitstore/... \
  ./apps/kira-studio/internal/gitwire/... \
  ./apps/kira-studio/internal/bridge/... \
  ./apps/kira-studio/internal/storage/repos/... \
  ./apps/kira-studio/internal/
```

The last entry is `TestDomainPackagesDoNotImportBridge`, with **nothing added to
`packagesExemptFromBridgeCheck`**: `gitaskpass` imports stdlib only and `gitsession` imports it,
so both stay under the line. The full unscoped tree is a backstop to run occasionally, not this
phase's default cost.

**(a) `gitaskpass`** — D24's eight broker scenarios over a real unix socket and a real shim,
including the two that *are* the exit criterion: a prompter that dismisses and a prompter that never
answers both end with the helper exiting non-zero, inside a per-test deadline.

**(b) `gitops`** — the progress parser against probe P9's exact transcripts (chunk-split
mid-percentage included), the porcelain parser against probes P5/P6/P7/P8, and D14's error table
with its three ordering assertions.

**(c) `gitpreflight`** — the glob matcher's six cases and the strategy ladder's six rungs.

**(d) `gitsession`** — the ≤1 slot under concurrency and the credential waiter's four exits.

**(e) `gitsock`** — §3.11's eleven integration tests over a real socket. **Fetch, push, force-push,
delete, decomposed pull, non-fast-forward, lease violation, `--force-if-includes` violation, hook
rejection, protected-branch refusal and the whole credential relay are all genuinely provable here**,
because a `git remote add` pointing at a local bare repository is, to git, an ordinary remote:
`git init --bare`, `symbolic-ref HEAD`, a real `pre-receive` hook, and a second clone to diverge it
are all confirmed working in this container (§0.1's probes were run exactly that way). The auth
paths use a nine-line local HTTP 401 listener, also confirmed here (probes P1/P2). **This is the
phase's real end-to-end proof.**

**(f) `GIT_CONFIG_GLOBAL=/dev/null KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the
tree clean** — G4 D15's machine-independence check. This phase adds no golden fixture (D13 chose a
snapshot diff over a stderr parser precisely so it would not have to), so this is a regression
check.

**(g) `bun test packages/git-ipc/src`**, `bun run lint`, `bun run typecheck`, `bun run build:vscode`
— green. `typecheck:git` is what proves D22's six deletions broke nothing.

**(h) `bun run test:e2e-real`** — green, adding no new spec, but **updating the
`CONTRACT_VERSION` assertion in `tests/e2e-real/git-pairing-real.spec.ts` from 15 to 16** (the third
hand-maintained copy — G6's own baseline names all three).

**(i) `go build ./apps/kira-studio/...`** including `main` — C3 edits `main.go`, so the one package
that needs the GTK/WebKit headers must still build (`scripts/setup.sh` provides them here).

### 7.2 What genuinely cannot be proven here, and the macOS script for it

Four things are structurally out of reach in this container, and none of them is a substitute for
§7.1 — they are the parts §7.1 cannot see:

1. **A real network remote.** Every §7.1 test uses a local bare repository or a local 401 listener.
   Latency, a real TLS proxy, a real `github.com`, a real 502 and a real slow transfer are not
   reproducible here — which matters most for the progress affordance and for cancelling something
   that actually takes time.
2. **Real SSH credential prompting.** Probe P4 proves the `SSH_ASKPASS` protocol with `ssh-add`;
   it does not prove a real `git fetch` over `git@github.com` with an encrypted key and no agent.
3. **VS Code's own credential UI.** `VsCodeCredentialPrompt` is `vscode.window.createInputBox` —
   it exists only inside a real extension host.
4. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin (G2 F18).

**The macOS script, run once on real hardware before G7 is called done:**

1. The §7.1 scoped run, on macOS.
2. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository with a real
   `origin`; pair.
3. **Fetch** against a real remote: the toolbar's progress affordance moves, shows a
   `Remote: compressing`-style phase for server work and a local phase for `Receiving objects`, and
   the graph reconciles when it finishes. **Cancel** a fetch of a large repository mid-transfer: it
   stops promptly, reports cancelled, and `ps` shows **no orphaned `git`/`git-remote-https`/`ssh`
   process** (D6's session detachment and G2 D3's group kill, together).
4. **Push** to a real remote over **HTTPS with no credential helper configured**
   (`git -c credential.helper= …` equivalent: temporarily unset it for a scratch clone): a VS Code
   input box appears, **twice** (username then password, probe P1), the second one masked; answering
   both completes the push. **This is the phase's headline manual check.**
5. **Dismiss** that box instead: the push fails promptly with an auth error and **does not hang**.
   Then start a push, and **close the VS Code window while the box is open**: the push fails
   promptly, and Kira Studio is still running and still serving the other window.
6. **Push over SSH with an encrypted key and no `ssh-agent`** (`SSH_AUTH_SOCK=` in the launching
   environment): the passphrase box appears and the push completes. This is the one path §7.1 cannot
   reach at all.
7. **A user's own askpass wins**: set `git config core.askPass /usr/bin/true` in the fixture repo and
   confirm no Kira Studio box appears (D10).
8. **Force-push** to a protected branch: the dialog names the matched pattern, demands the typed
   branch name, and refuses a wrong one. Then edit the pattern list in **Kira Studio's own settings
   dialog**, confirm the *second* VS Code window sees the new behaviour immediately (D16's whole
   point), and confirm a plain fast-forward push to `main` is **never** gated.
9. **A conflicting `pull --merge`** lands in G5's existing in-progress banner, offering Abort; a
   `pull --rebase` conflict lands in the same banner offering Abort and **not** Continue (SPEC's own
   v1 rebase posture). No second banner exists anywhere.
10. **Auto-fetch**: set the interval to 1 minute in Kira Studio's settings, watch a real remote move
    from elsewhere, and confirm the graph reconciles on its own — and that **no credential box ever
    appears** for a remote that needs one, and that the timer stops after that failure (D23).
11. **Two windows, one repository**: start a fetch in A and confirm B's `remote.run` is refused with
    "another operation is in progress"; confirm B's toolbar shows **no** progress bar for A's fetch
    (D20's deliberate choice) but does reconcile when it lands.
12. Confirm what is *expected to still be broken*, so it is not mistaken for a regression: the stash
    list is still empty and the console still carries its one unhandled `stash.list` rejection
    (G12); "Push tag" and "Delete on remote" still fail by name (G5 D5 — they are `op.run` kinds, and
    §10 hands the question of moving them under `remote.run` to G12/G13); and a **dirty
    non-fast-forward pull** fails at the stash step with a clear error (F19/D18, G12's).

### 7.3 The checklist

- [ ] `CONTRACT_VERSION` is **16** in all three hand-maintained places, and the only wire additions
      are `credential.request`, `credential.provide` and `strategySetting` (D2).
- [ ] `packages/git-ui` is byte-for-byte unchanged.
- [ ] `packages/git-core`'s only diff is D22's six deletions, four `index.ts` lines and two removed
      settings keys; `kiraVersion.pull.strategy` and `kiraVersion.git.path` survive.
- [ ] `go.mod` and `bun.lock` are unchanged; `gitWire.fbs` and `src/generated/` are unchanged.
- [ ] **No credential is written anywhere**: `grep -rn "secret\|answer\|prompt" internal/gitaskpass
      internal/gitsession internal/gitrpc apps/kira-studio-vscode/src` shows no `slog`, no
      `logger.log`, no file write and no DB write carrying one (D9).
- [ ] `gitaskpass` imports stdlib only; `packagesExemptFromBridgeCheck` is unchanged.
- [ ] Every spawn is `Setsid`, and `killGroup` is unchanged (D6).
- [ ] `Spec.Env` and `Spec.OnStderr` are the only two new `Spec` fields, and `Process` still exposes
      no stderr accessor (D5).
- [ ] **`git pull` appears in no argv builder** anywhere in `internal/` (D12), asserted by grep in
      the review.
- [ ] Every push carries `--porcelain` and a **fully-qualified refspec on both sides** (D12/F14).
- [ ] Force-push is bare `--force-with-lease --force-if-includes`, and `expectedRemoteTip` is
      re-read and compared **before** the spawn (D12).
- [ ] `--prune` defaults on, `--prune-tags` defaults off (D12).
- [ ] The protected check is re-run server-side against the **server-owned** list on every
      `remote.run`, and gates only force-push and remote-branch delete (D17).
- [ ] No remote op takes `Repo.Write` except pull's integrate phase (D11).
- [ ] No remote op sets or clears the undo slot (D19).
- [ ] A second concurrent `remote.run` on one repository is refused, from any connection (D11/D20).
- [ ] `remote.cancel` reports `false` honestly for a non-killable phase and never errors (D19).
- [ ] Every credential wait has all four bounds of D4's table, and every one of them ends with the
      helper exiting non-zero.
- [ ] Auto-fetch runs with **no askpass env at all** and disables itself after one failure (D23).
- [ ] `credential.provide` is refused when proxied from the webview (§4.2).
- [ ] No test, fixture or script runs `git config --global` or `--system`; the bare-remote fixture
      builder uses `fixtureEnv()` (D24/§0.4).
- [ ] §7.1(a)–(i) all green; §7.2's twelve macOS steps all pass.

---

## 8. Sequencing — one implementer

**Recommendation: one sequential Sonnet subagent for the whole phase.** G1–G6 all made the same call
and all six carried it through.

1. **The phase is one dependency chain with an unusually tight centre.** The broker (C2) is
   meaningless without the runner's new env field (C1) and unreachable without `main.go`'s dispatch
   (C3); the executor (C8) needs the argv, the classifier, the pre-flights, the settings *and* the
   broker at once. That is `AGENTS.md`'s textbook case of *not* "genuinely independent".
2. **C8 is where the phase's real risk lives** and it is a risk of *interaction*, not of volume: the
   shared slot, the detached context, the credential relay's four bounds and the progress tee all
   meet in `RunRemote`, and its correctness claims are negative ones ("this cannot hang", "this
   cannot block a read", "this cannot be answered twice") that only an agent holding C1–C7's context
   will assert convincingly.
3. **The one piece that looks separable is genuinely separable, and is still not worth splitting.**
   C7 (server-owned settings + the two dialog fields) touches `internal/storage` and
   `apps/kira-studio/frontend`, which no other commit in this phase goes near, and `go test
   ./…/storage/repos/...` plus `bun run typecheck:web` is its whole proof. If the orchestrator does
   choose to parallelise, **C7 alone** is the only defensible cut.

---

## 9. Explicit non-goals for G7

| Not in G7 | Owner |
|---|---|
| `stash.list`, `stash.show`, the stash pre-flights, the five stash `op.run` kinds — and therefore a working dirty-non-fast-forward pull (F19) | G12 |
| `preflight.reset`, `preflight.cherryPick` and their operations | G13 |
| `op.run`'s `tagPush`/`tagDeleteRemote` — and the question of whether they should move under `remote.run` at all | G12/G13 (§10) |
| `search.run` and the RE2-vs-`RegExp` reconciliation | G14 |
| Command-palette commands for fetch/push/pull | **G9**, whose own row owns the one-time audit "wiring a command for every mutating operation that exists by this point (checkout/revert/branch/tag from G5, **fetch/push/pull from G7**)" |
| `kiraVersion.git.path`'s server-side consumption | G8 (§10) |
| A focus/visibility signal of any kind | never in v1.3 — D23 replaces it with the `RepoEntry`'s own lifetime |
| Credential *storage*, a `Secrets` port, reading or writing git's credential helpers | **never** — D9 |
| A credential prompt in Kira Studio's own window | not built; §11.1 |
| Remote management (add/remove/rename a remote) | unassigned — not in SPEC's G7 row and not needed to fetch/push/pull |
| Submodule fetch/update, SSH key management, GPG-signed pushes | out of scope for v1.3 |
| Interactive rebase, or starting/continuing a rebase at all | out of scope for v1.3 (SPEC's v1 posture: report and refuse to interfere) |
| A Windows askpass shim | **never** — this app is macOS-only (SPEC §3.1); upstream's OQ8 has no analogue here |
| A perf budget for remote ops | never — remote-op latency is dominated by the network; a budget over it would measure the fixture |
| Any change to `packages/git-ui` | never, per SPEC §5 |

---

## 10. Handed forward

- **`stash.list` is still the last of G3 F16's four rejections**, and G7 adds a *second* visible
  stash-shaped gap: the dirty non-fast-forward pull path (F19/D18). **G12** closes both, and should
  re-run §7.2 step 12 to confirm the pull path comes alive with no server change.
- **`op.run`'s `tagPush`/`tagDeleteRemote` are still unserved** (G5 D5). Now that `remote.run`
  exists, G5's own hand-off question can be answered: they are pushes, they are killable-adjacent,
  they want progress, and every mechanism they need is in `gitsession/remote.go`. **G12/G13** should
  either add them as `remote.run` kinds (a contract change, since `RemoteOpKind` has five members)
  or as `opTable` entries that delegate to the remote executor — a real design choice, not a
  copy-paste, and it is why this phase did not do it speculatively.
- **`kiraVersion.git.path` is the last server-owned setting with no server** (F12). **G8** owns it:
  `Discovery.Status(ctx, path)` already takes the parameter, `packages/git-ui`'s blocked-state copy
  already names the key, and the only missing piece is deciding whether it stays a per-window VS Code
  setting (which contradicts SPEC) or joins D16's `git.*` leaves (which contradicts shipped copy).
- **Auto-fetch has no user-visible indication that it disabled itself** (D23). Upstream rendered "a
  subdued marker in the toolbar's fetch affordance"; `packages/git-ui` may not change here, and no
  wire field carries the flag. **G8** is the phase with a multi-client matrix in front of it and is
  where "did anyone notice auto-fetch silently stopped" gets a real answer.
- **`remote.progress` reaches only the initiating connection** (D20). If a later phase gives the
  webview a "someone else is fetching this repository" affordance, the change is a second fan-out
  channel on `RepoEntry` beside the subscriber pipe, plus an op-id or origin field on
  `RemoteProgress` — additive, not a rework.
- **The broker is one per process and its temp dir leaks on a hard crash** (D8). A `kira-askpass-*`
  directory in `$TMPDIR` after a crash is inert (its socket is closed with the process) and the OS
  reaps it; if that ever becomes untidy, a startup sweep is the fix, not a different directory.
- **The credential relay is one prompt at a time per connection, and nothing enforces that.** Git
  asks serially (probe P1) and the ≤1 slot means one op per repository, but two repositories on one
  connection could in principle prompt concurrently, producing two VS Code input boxes. Harmless
  today (each is independently addressed by `requestId`); named so **G8**'s matrix can decide whether
  to queue them.
- **`ClassifyOpError` now has seventeen ordered rows across two phases** (D14/F18). The next phase to
  add one should add a table-ordering test case beside G5's and G7's rather than trusting the
  comment.

---

## 11. Three calls worth a human eye before implementation starts

All three are judgment calls the orchestrator or the user may reasonably decide differently, and all
three are cheap to change *now* and awkward to change after C8. None is a blocker: the plan takes a
position on each and can be implemented as written.

### 11.1 Where does the credential prompt appear? (F2/D3) — **security-relevant**

**As planned**: relayed to the VS Code connection that owns the in-flight remote op, per SPEC §5
item 4, which the plan treats as the operative text.

**The alternative**: SPEC §6's literal bullet — the prompt appears in Kira Studio's own window,
"never the VS Code window that started the remote operation". That would mean building a masked-input
modal in Kira Studio's frontend, queueing it alongside the pairing prompt, and finding a different
answer to "what happens if nobody is looking at that window" (the pairing broker's answer — hold for
120 s — is exactly what a credential prompt must **not** do while a `git push` waits).

**Why this is the security-shaped one.** The two designs differ in *who can see and answer* a
credential request. Under the relay, any paired VS Code client that owns an in-flight remote op can
be asked for a credential and can answer it; under §6's reading, only Kira Studio's own window can.
The plan's position is that this is not a meaningful weakening — the client is already paired,
already approved by a human in Kira Studio's own window (G1), and already able to run arbitrary git
operations against the repository — but it is a real difference, it is the first time a user secret
crosses the pairing boundary in this chapter, and a human should say so out loud rather than have it
decided by which SPEC paragraph a planning agent read last.

A third option, not taken: relay by default and fall back to a Kira Studio prompt when no connection
owns the op. There is no such case — auto-fetch is the only connectionless op and it never prompts
(D23) — so the fallback would be unreachable code.

### 11.2 Do `protectedBranches` and `fetch.autoInterval` really move out of VS Code's settings? (F12/D16)

**As planned**: yes. They become `git.*` leaves in Kira Studio's own `settings` table, edited in its
own settings dialog, and the two VS Code keys are deleted from the schema and the manifest.

**The alternative**: leave them as VS Code settings and inject them into `remote.pushPreflight`/
`remote.run` the way G6 injects `baseCandidates`, accepting that the protected-branch list is then
client-supplied. A middle option exists and is worth naming: inject the client's list but have the
server **union** it with its own built-in defaults, so a window can only ever *add* protection, never
remove it. That keeps the familiar VS Code settings UI and still makes "two windows disagreeing"
safe in the only direction that matters — at the cost of a setting whose removals silently do
nothing, which is its own kind of lie.

The cost of the plan's choice is real and worth confirming: a VS Code user loses per-workspace
protected-branch patterns, and gains a setting in a different application. The benefit is that SPEC's
"server-owned … because two windows disagreeing about them is a correctness/safety issue" becomes
literally true rather than approximately true.

### 11.3 Is `Setsid` for **every** spawn too broad? (F6/D6)

**As planned**: yes, every spawn. The controlling-terminal detachment is desirable everywhere, the
change is one word, `killGroup` is unaffected because a session leader is also a process-group
leader with `pgid == pid`, and G2 deliberately built exactly one spawn path so that hygiene cannot
diverge between callers.

**The alternative**: a `Spec.Detached bool` set only by remote ops, leaving G2–G6's spawns exactly as
they are today. That is more conservative and more surgical, at the cost of two spawn shapes and of
leaving the weaker guarantee in place for every other command — including `merge --continue`, whose
`GIT_EDITOR=true` guard (G5 F11) exists because that command, too, can block forever waiting on
something interactive.

The reason to flag it rather than settle it quietly: it is the one change in this phase that alters
behaviour for code five previous phases already proved, and its effect is invisible in every
automated test here (no test in this container has a controlling terminal to lose).
