# P67e — Relaxed git read-only, native credential prompt

> **What this phase is.** `docs/v1.6/SPEC.md`'s P67e row. It is the section P67b's own planning pass
> split off (`docs/v1.6/plans/P67b-git-module-peer-nav.md` §5, OQ-1), now given the full independent
> treatment. Every file, line number and literal below was re-opened against the tree at `4980eaf1`
> — the commit P67b's four parts actually landed on — never carried over from that document's prose.
> §0 lists the four places where re-verification changed the design.

The mandate, in the user's own words from the dogfooding report both rows derive from:

> *"The readonly is about modifing files. I should be able to pull, merge rebase etc. only in case of
> conflicts i can t continue."*

---

## 0. What re-verification changed

P67b's §5 held up on the load-bearing claims: every `gitstream.go`, `hostHandlers.ts` and
`gitstream_test.go` line number it named is still exact (§1.1's table re-checks each). Four things
changed.

**C1 — `worktreeAdd`/`worktreeRemove` are admitted, not refused.** §5.2 proposed a `refusedOpKinds`
map and an `allowedOpRun` wrapper to keep those two `op.run` kinds out, and to keep their two
preflights off the allowlist. Reading `WorktreeList.vue` directly shows that breaks the very
property §5.3 claims to establish: `Create Worktree…` (`:118`), `Switch to this worktree` (`:140`)
and `Remove worktree` (`:158`) are gated on `writeCapability` alone, so flipping that flag renders
three buttons layer 1 would then refuse — exactly the "a confirm dialog whose confirm button then
fails at this layer" failure `gitstream.go:47-51` exists to prevent. And the premise does not
support the refusal anyway: `worktreeAdd`'s `Prepare` (`ops.go:290-292`) is a plain `git worktree
add`; the prepare **script** is a separate `worktree.prepare` request (`ops.ts:1144`), already
gated by its own `capabilities.runPrepareScript: false` and already explained in the dialog
(`WorktreeDialog.vue:341`). D2 takes the two kinds in. The `refusedOpKinds` map and `allowedOpRun`
wrapper are deleted from the design entirely — a simplification, not a loosening.

**C2 — the conflict banner already has its explanatory line.** §5.4 proposed adding one. It exists:
`ConflictBanner.vue:130-135` already renders *"Resolve the remaining N files first, then Continue"*,
already wired to `aria-describedby` through `CONTINUE_REASON_ID`. The real gap is narrower: it never
says *where* to resolve, which only matters on a host with no resolve action. D8 adds a
`!resolveConflictEnabled` variant of the line that already exists, instead of a second line beside it.

**C3 — the credential dialog mounts in `App.vue`, not `TitleBar.vue`'s `<Teleport>`.** §5.5 named
`TitleBar.vue:124-126`. P67b moved that block to `:92-94`, but more to the point this app already
has the right precedent and it is not there: `ConfirmDialog.vue` and `GitPairingDialog.vue` are
always-mounted, self-gating dialogs at `App.vue:93-94`, with `GitPairingDialog.vue:7-9`'s own doc
comment stating the reason ("a pairing request must be able to appear with nothing else open").
A credential prompt has the identical requirement. D10 follows that precedent.

**C4 — `preflightMethods` is deleted, not shrunk.** §5.2 proposed shrinking it to the two worktree
preflights. With C1 those two are admitted as well, so every one of the eleven entries moves to the
allowlist and the list — plus `TestReadOnlyRequest_PreflightMethodsAreRefused` — has nothing left to
pin. D3 removes both, and removes the list's loop from
`TestGitrpcDispatch_EveryMethodIsClassified`'s union.

Two smaller corrections: `gitrpc.Router.ForConn` dispatches **55** request methods, not 56 (§1.2
enumerates them); `RepoSettingsDialog.vue`'s `writeCapability` prop is at `:53` and its gated Pull
section at `:259`, not `:49`.

OQ-4, OQ-5 and OQ-6 from P67b's §13 are **adopted unchanged** — nothing in re-verification argued
against any of them. §9 restates each with this phase's own evidence.

---

## 1. Confirmed current state

### 1.1 The read-only boundary, all three layers

Every line below re-read at `4980eaf1`. P67b touched none of these files.

| File:line | What is there |
| --- | --- |
| `internal/bridge/gitstream.go:42-69` | the allowlist's doc comment — states the default-deny property, the preflight exclusion, the `review.*` exception |
| `internal/bridge/gitstream.go:70-92` | `readOnlyMethods` — 34 entries, the load-bearing allowlist |
| `internal/bridge/gitstream.go:97-99` | `readOnlyStreamMethods` — `graph.stream` only |
| `internal/bridge/gitstream.go:108-116` | `readOnlyRequest` — refuses with `E_READ_ONLY` before the router runs |
| `internal/bridge/gitstream.go:124-135` | `repoSettingsSetTouchesRestrictedField` — the four restricted patch leaves |
| `internal/bridge/gitstream.go:143-151` | `readOnlyRepoSettingsSet` — the field-level wrapper |
| `internal/bridge/gitstream.go:172-176` | the `DisableAutoFetch()` call and its comment (which itself cites "provably read-only") |
| `internal/bridge/gitstream.go:182-183` | the wrapper composition in `ServeGitStream` |
| `repo/git/hostHandlers.ts:154` | `readOnlyRefusal` — the local-throw helper |
| `repo/git/hostHandlers.ts:176-197` | `capabilities` — `goToFile:false` (`:181`), `resolveConflict:false` (`:187`), `openWorktreeWindow:false` (`:190`), `runPrepareScript:false` (`:193`), `write:false` (`:196`) |
| `repo/git/hostHandlers.ts:367` | `editor.goToFile` refusal |
| `repo/git/hostHandlers.ts:371-374` | `credential.provide` refusal |
| `repo/git/hostHandlers.ts:375-378` | `editor.resolveConflict` refusal |
| `repo/git/hostHandlers.ts:379-382` | `settings.setGitPath` refusal |
| `repo/git/hostHandlers.ts:383-386` | `worktree.openWindow` refusal |
| `internal/bridge/gitstream_test.go:29-34` | `writeMethods` — 11 entries |
| `internal/bridge/gitstream_test.go:36-38` | `hostAnsweredMethods` — 4 entries |
| `internal/bridge/gitstream_test.go:48-53` | `preflightMethods` — 11 entries |
| `internal/bridge/gitstream_test.go:91-110` | `TestReadOnlyRequest_AllowlistedMethodsReachInnerHandler` — loops the allowlist |
| `internal/bridge/gitstream_test.go:237-298` | the two `readOnlyRepoSettingsSet` tests |
| `internal/bridge/gitstream_classification_coverage_test.go:33-64` | `TestGitrpcDispatch_EveryMethodIsClassified` — unions all five lists against handlers.go's real AST |
| `internal/bridge/gitstream_classification_coverage_test.go:91-103` | `knownFields` — the per-patch-field expectation map |

The architecture doc's claims, at their current lines: `docs/ARCHITECTURE.md:2630-2638` (*"a second,
read-only frontend … The native mount is provably read-only (below); nothing in this window can
write to a repository through any route the VS Code extension can"*) and `:3006-3021` (*"The
read-only boundary is three layers, and only one of them is load-bearing"*). `:3023-3040` (the
auto-fetch paragraph) stays factually true but opens by citing the same posture.

### 1.2 What `gitrpc` actually dispatches

`internal/gitrpc/handlers.go:132-245` is one `switch method` with **55** request cases, plus
`:247-254`'s one stream case (`graph.stream`). Grouped:

| Group | Methods | On the allowlist today |
| --- | --- | --- |
| Reads | `app.init`, `repo.open`, `repo.close`, `graph.status`, `graph.loadMore`, `graph.refresh`, `commit.detail`, `commit.fileDiff`, `file.read`, `file.goToTarget`, `blame.line`, `working.detail`, `refs.list`, `status.get`, `stash.list`, `stash.show`, `globalStash.list`, `undo.peek`, `search.run`, `commit.resolvePr`, `branch.resolvePr`, `worktree.list`, `stack.list`, `repoSettings.get` | yes (24) |
| Kira-storage writes | `repoSettings.set`, `review.resolveBase`, `review.files`, `review.fileDiff`, `review.mark`, `review.comment.add/list/remove/clear/export` | yes (10) |
| Preflights | `preflight.checkout/revert/reset/cherryPick/stashPop/stashBranch/worktreeAdd/worktreeRemove/restack`, `remote.pullPreflight`, `remote.pushPreflight` | no (11) |
| Repository writes | `op.run`, `remote.run`, `remote.cancel`, `undo.run`, `stack.restack`, `stack.cancelRestack` | no (6) |
| Credential | `credential.provide` | no (1) |
| Shell execution | `worktree.prepare`, `worktree.cancelPrepare` | no (2) |
| App-global | `settings.setGitPath` | no (1) |

24 + 10 = 34, matching the allowlist exactly. `editor.resolveConflict`, `worktree.openWindow`,
`review.session.save/.load`, `review.open` and `editor.openRangeDiff` are **not** dispatched at all —
`handlers.go` has no case for any of them.

### 1.3 The write machinery already in Go

Built for the VS Code extension, which is not read-only, and live on this same router today.

| Method | Backing | Re-verified at |
| --- | --- | --- |
| `op.run` | `opTable` — 22 served kinds of `OpRequest`'s 24 (`tagPush`/`tagDeleteRemote` answer `ErrUnservedOpKind`) | `gitsession/ops.go:187-325` |
| `op.run` kinds `opContinue`/`opAbort`/`opSkip` | `prepareSequencerVerb` over `gitops.ContinueArgs`/`AbortArgs`/`SkipArgs` | `gitsession/ops.go:224-241` |
| `op.run` kinds `worktreeAdd`/`worktreeRemove` | `prepareWorktreeAdd`/`prepareWorktreeRemove` — plain `git worktree add`/`remove`, no script | `gitsession/ops.go:287-302` |
| `remote.run` | kinds `fetch`, `push`, `forcePush`, `deleteRemoteBranch`, `pull` | `gitsession/remote.go:405-415` |
| `remote.run` kind `pull` | `runPullOp` — fetch the one branch (killable), then exactly one of `merge --ff-only` / `merge --no-edit` / `rebase` | `gitsession/remote.go:534-539` |
| `PullStrategy` | `'ff-only' \| 'merge' \| 'rebase'` | `packages/git-ipc/src/contract.ts:782` |
| conflict state | `RemoteOpResult.InProgress`, set on both the success and failure returns | `gitsession/remote.go:111`, `:321`, `:429` |
| `worktree.prepare` | executes the user's stored shell script | `gitsession/ops.ts` caller at `packages/git-ui/src/state/ops.ts:1144` |

**There is still no standalone merge or rebase operation anywhere in this stack.** Re-grepped:
`opTable` has no such kind, `contract.ts`'s `OpRequest` has none, `packages/git-ui/src` has no
`MergeDialog`/`RebaseDialog`. Merge and rebase are reachable only as pull strategies and inside
`stack.restack`. §7 records that.

### 1.4 The credential half: Go is live, the renderer is missing

| Piece | Where | State |
| --- | --- | --- |
| broker construction | `apps/kira-studio/main.go:139-142` | live |
| broker wired into the router `ServeGitStream` serves | `apps/kira-studio/main.go:150` (`Askpass: askpassBroker`) | live |
| askpass interposition per remote op | `gitsession/remote.go:161-165` (`withAskpass`), called at `:444`, `:496`, `:556` | live |
| `credential.request` reaches the renderer | `gitstream.go:186` (`gconn.Emit = sess.Emit`) | live |
| unanswered-prompt bound | `gitaskpass/broker.go:24` — `DefaultTimeout = 120 * time.Second` | live |
| never-log rule, Go side | `gitaskpass/prompt.go:11-13` | stated |
| wire shapes | `contract.ts:2219-2226` (`credential.request`), `:2006-2012` (`credential.provide`) | present |
| wire validity | `packages/git-ipc/src/validate.ts:215`, `:253` | both already `true` |
| renderer subscriber | — | **absent** |
| `credential.provide` | `hostHandlers.ts:371-374` | **refused locally** |

`grep -rn "credential" packages/git-ui/src` returns nothing: the package has never owned this. Under
VS Code the *extension host* does (`extension.ts:545`, `:547-557`, `ports/credentialPrompt.ts`), and
`proxyHandlers.ts:579-582` throws on the webview's behalf for the same reason `hostHandlers.ts:371`
does. Natively there is no third tier, so Kira Studio's own window must answer.

> `contract.ts:2214-2216` says `credential.request` goes to *"the connection that owns the in-flight
> remote op — never Kira Studio's own window"*. That sentence is about an **external paired
> client's** op, owned by that client's `gitsession.Conn`. The native stream's own op is owned by the
> native `Conn` (`gitstream.go:171`), so routing its prompt to this window applies the rule rather
> than breaking it. The doc comment needs the clarification (§4); the routing needs nothing.

### 1.5 The native dialog precedent this app already has

| File:line | Shape |
| --- | --- |
| `frontend/src/App.vue:93-94` | `<GitPairingDialog />` and `<ConfirmDialog />` — always mounted, self-gating on their own state |
| `frontend/src/workbench/GitPairingDialog.vue:7-9` | states the reason: "a separate, always-mounted dialog at App.vue's root … a pairing request must be able to appear with nothing else open" |
| `frontend/src/state/confirmDialog.ts:16-36` | `reactive` state + a settle function that clears the resolver — the module shape to mirror |
| `frontend/src/theme/primitives/DialogFrame.vue` | the frame both use (`title`, `width`, `test-id`, `@close`) |
| `frontend/src/theme/primitives/TextField.vue:23`, `:40` | already supports `type: 'text' \| 'password' \| 'number'`, already emits `enter` |
| `frontend/src/theme/primitives/AppButton.vue` | `kind="dialog"`, `variant="primary"` |

Nothing new is needed from the design system. No new dependency of any kind — §7.

---

## 2. Decisions

### D1 — the mandate, taken literally: refuse exactly three methods

Checked method by method against §1.2, three of the 55 dispatched methods genuinely need something
this app does not have:

| Refused | Why, and what already hides it |
| --- | --- |
| `worktree.prepare` | **Executes a user-supplied shell command.** `gitstream.go:79-87` records that `RunPrepare`'s only gate is "does this match what is currently stored" — there is no human-approval gate anywhere in this codebase. A security boundary, not a file-editing one. Hidden by `capabilities.runPrepareScript: false`, and `WorktreeDialog.vue:341` already renders a stated reason |
| `worktree.cancelPrepare` | its pair; cancelling a run that can never start has nothing to cancel |
| `settings.setGitPath` | writes the global git path, which this app's own Settings dialog owns. No git-ui affordance calls it at all — it is the VS Code extension's own migration routine (`extension.ts:188`) |

Plus two methods `handlers.go` never dispatches, refused as defence in depth and hidden by their own
flags: `editor.resolveConflict` (`capabilities.resolveConflict: false` — the premise's own carve-out,
it needs a merge editor this app has none of) and `worktree.openWindow`
(`capabilities.openWorktreeWindow: false` — `vscode.openFolder`, no native meaning).

Everything else writes refs, the index or the working tree **through git itself** and needs no
in-app editor. So the rule is: admit all 55 but three.

### D2 — `worktreeAdd`/`worktreeRemove` are admitted (C1)

P67b's §5.2 would have refused these two `op.run` kinds and their two preflights. Rejected on
re-verification, for two independent reasons.

1. **It breaks the property it was meant to serve.** `WorktreeList.vue:118`, `:140` and `:158` gate
   Create / Switch / Remove on `writeCapability` alone. Refusing the kinds while flipping that flag
   renders three buttons that fail at layer 1 — the precise failure `gitstream.go:47-51` names.
2. **The premise does not support it.** `worktreeAdd` is `git worktree add` (`ops.go:290-292`);
   `worktreeRemove` is `git worktree remove` behind git-ui's own typed-confirmation dialog
   (`WorktreeList.vue:67-110`). Neither runs the prepare script — that is the separate
   `worktree.prepare` request `ops.ts:1144` issues *after* `worktreeAdd` (`ops.ts:1104`) succeeds.
   Creating a worktree and declining to run its script is a complete, coherent operation, and
   `WorktreeDialog.vue:210`/`:341`/`:375` already implements exactly that path when
   `runPrepareScriptCapability` is false.

Consequence: **no `refusedOpKinds` map, no `allowedOpRun` wrapper, no per-kind decoding at layer 1
at all.** `op.run` is allowlisted as one method, like every other. The only field-level guard this
stream keeps is `repoSettings.set`'s (D4), which exists for a different reason — staging a script
body for later execution.

### D3 — layer 1: `internal/bridge/gitstream.go`

1. **Rename `readOnlyMethods` → `allowedMethods`.** The name is now a lie in the other direction, and
   `readOnlyRequest`/`readOnlyStream`/`readOnlyRepoSettingsSet` rename to
   `allowedRequest`/`allowedStream`/`guardRepoSettingsSet` with them. The wrapper composition at
   `:182-183` and the test names follow. This is a rename, not a redesign: **it stays a default-deny
   allowlist**, which is the one property this file exists for and the argument that replaces
   "read-only" in §4.
2. **Widen it to 52 entries** — every method §1.2 lists except the three in D1. The 18 added:
   `preflight.checkout`, `preflight.revert`, `preflight.reset`, `preflight.cherryPick`,
   `preflight.stashPop`, `preflight.stashBranch`, `preflight.worktreeAdd`,
   `preflight.worktreeRemove`, `preflight.restack`, `remote.pullPreflight`, `remote.pushPreflight`,
   `op.run`, `remote.run`, `remote.cancel`, `undo.run`, `stack.restack`, `stack.cancelRestack`,
   `credential.provide`.
3. **Rewrite the doc comment at `:42-69`.** Three of its five paragraphs are now false: the
   preflight-exclusion paragraph (`:47-52`) goes entirely; the `review.*` paragraph (`:54-62`) keeps
   its "writes land in Kira's own storage" explanation but drops the "looks like a write, therefore
   needs justifying" framing; `:64-69` keeps `review.session.save/.load`, `review.open` and
   `editor.openRangeDiff` as the not-dispatched-anywhere entries. A new opening paragraph states the
   boundary as it now is: default-deny, three named refusals, each paired with a capability flag or
   with no affordance at all.
4. **`readOnlyStreamMethods` is unchanged** beyond its rename — `graph.stream` is still the only
   stream `handlers.go:247-254` serves.

### D4 — layer 1: the field-level guard narrows to two fields

`repoSettingsSetTouchesRestrictedField` (`:124-135`) drops `PullStrategy` and `CheckoutAutoStash`,
keeping `WorktreePrepareScript` and `WorktreeBasePath`.

- `PullStrategy` and `CheckoutAutoStash` are settings for the operations this phase exists to enable.
  `RepoSettingsDialog.vue:259` renders the Pull strategy section under `v-if="writeCapability"` — it
  becomes visible and must work.
- `WorktreePrepareScript` and `WorktreeBasePath` stay restricted for the D1 reason, and only that
  reason: a patch accepted here is a script body a later `worktree.prepare` would execute verbatim.
  Refusing the execution but accepting the storage would leave a loaded gun for any future host that
  flips `runPrepareScript`.

`restrictedRepoSettingsFields`' doc comment and
`TestRepoSettingsSetTouchesRestrictedField_CoversEveryPatchField`'s `knownFields` map
(`gitstream_classification_coverage_test.go:91-103`) both flip those two entries to `false`. The
test's presence-check mechanism is untouched — it is what forces a future field to be classified.

### D5 — background auto-fetch stays disabled

`gconn.DisableAutoFetch()` (`:176`) stays. Its comment cites "provably read-only" as the reason and
must be rewritten to the real one: a periodic background `git fetch --prune` is a network write the
user never pressed a button for, and every fetch this phase admits is one they did. One deleted line
whenever someone actually wants it. OQ-5, adopted.

### D6 — layer 2: `repo/git/hostHandlers.ts`

| Entry | Change |
| --- | --- |
| `capabilities.write` (`:196`) | `false` → **`true`** |
| `capabilities.resolveConflict` (`:187`) | stays `false` |
| `capabilities.runPrepareScript` (`:193`) | stays `false` |
| `capabilities.openWorktreeWindow` (`:190`) | stays `false` |
| `capabilities.goToFile` (`:181`) | stays `false` |
| `'credential.provide'` refusal (`:371-374`) | **deleted** — D9/D10 answer it for real, and layer 1 now forwards it |
| `'editor.resolveConflict'` refusal (`:375-378`) | stays; message rewritten — "needs a merge editor this window does not have; resolve the files in your own editor, then Continue", not "the native graph is read-only (§4.2)" |
| `'settings.setGitPath'` refusal (`:379-382`) | stays, message unchanged (already states the real reason) |
| `'worktree.openWindow'` refusal (`:383-386`) | stays; message rewritten — "has no native meaning: there is no second window to open a worktree into", not "is a write — the native graph is read-only" |
| `'editor.goToFile'` refusal (`:367`) | stays, message unchanged |

Each `capabilities.*` comment that says "read-only" or cites C10 §4.2 is rewritten to the reason that
is actually still true (`:183-196`).

### D7 — the two-way property that replaces "provably read-only"

After D3 and D6 this holds in both directions, and it is the invariant `gitstream_test.go` and
`docs/ARCHITECTURE.md` now assert instead:

- **Every `capabilities.*` flag that is `false` corresponds to something layer 1 refuses.**
  `resolveConflict` ↔ `editor.resolveConflict`; `runPrepareScript` ↔
  `worktree.prepare`/`worktree.cancelPrepare`; `openWorktreeWindow` ↔ `worktree.openWindow`;
  `goToFile` ↔ `editor.goToFile`.
- **Every method layer 1 admits has a reachable affordance, or no affordance anywhere.** The one
  refusal with no flag is `settings.setGitPath`, which has no git-ui caller at all
  (`grep` over `packages/git-ui/src` returns nothing) — nothing can render a button for it.

That is the checklist item in §8.3, not just a claim here.

### D8 — conflicts surface; Resolve stays gated; Continue goes live (C2)

`ConflictBanner.vue` needs one edit, smaller than P67b's §5.4 assumed.

Already correct with no change: it renders whenever `ops.statusSummary.value?.inProgress !== null`
(`:34`), which every `op.run` result and `RemoteOpResult.InProgress` (`remote.go:111`) already
carries; **Resolve** is gated on `resolveConflictEnabled` (`:99`), which stays `false`, so the button
never renders; **Continue / Skip / Abort** are gated on `writeCapability` (`:106`, `:114`, `:121`)
and become live — `opContinue`/`opAbort`/`opSkip` are ordinary `op.run` kinds (`ops.go:224-241`),
admitted by D3, reached through `ops.continueOp/skipOp/abortOp` (`state/ops.ts:1412`, `:1420`,
`:1428`).

The one edit: the existing reason paragraph at `:130-135` says *"Resolve the remaining N files first,
then Continue"* without saying where, which only matters on a host with no Resolve button. Add a
`!resolveConflictEnabled` variant of that same paragraph — same `:id="CONTINUE_REASON_ID"`, same
`aria-describedby` wiring, same `.kv-conflict-banner-reason` class — reading *"Resolve the remaining
N files in your own editor and stage them, then Continue"* (keeping the existing `canSkip` tail).
A host with `resolveConflictEnabled: true` renders exactly what it renders today. This is the only
edit this phase makes to `packages/git-ui`.

**Continue is deliberately allowed, not blocked.** The user cannot *resolve* a conflict in this app;
they can resolve it in their own editor and then tell git to carry on. Blocking Continue would
strand a half-finished rebase with Abort as its only exit — worse, not safer. That is the user's own
sentence read correctly: "only in case of conflicts I can't continue" names what the app cannot do
*for* them, not a state it should trap them in.

### D9 — `state/gitCredential.ts`: the queue

New file, mirroring `state/confirmDialog.ts`'s shape (`reactive` state module + a settle function),
which is the existing mechanism for exactly this job. No library is reached for and none applies:
this is ~40 lines of app-specific state, not infrastructure.

```
apps/kira-studio/frontend/src/state/gitCredential.ts
```

```ts
interface PendingCredential {
  readonly codeRepoId: string;       // for the repo label, and for dropping on workspace close
  readonly prompt: string;           // git's own text, rendered verbatim
  readonly masked: boolean;
  readonly answer: (secret: string | null) => void;   // closes over requestId + this workspace's client
}
```

- `gitCredentialState = reactive<{ active: PendingCredential | null }>({ active: null })`, plus a
  module-private FIFO array for the rest.
- `enqueueCredentialRequest(pending)` — becomes `active` if nothing is active, else queues.
- `answerCredential(secret: string | null)` — calls `active.answer(secret)`, clears `active`, pumps
  the next entry. A second call with nothing active is a no-op.
- `dropCredentialRequests(codeRepoId)` — removes that workspace's entries, including `active`, called
  from `disposeGitTransport`. **Does not answer them**: the transport is gone, so there is nothing to
  send `credential.provide` on; `gitaskpass/broker.go:24`'s 120 s bound and the op's own cancellation
  end the Go-side wait.

**Why a queue at all.** `RunRemote` (`remote.go:336-343`) claims one shared slot per repository, so a
single repository can have at most one prompt outstanding — but each open repo workspace has its own
`gitsession.Conn` and its own op slot, so two can prompt at once. One modal at a time, FIFO, is the
honest answer; two stacked modals is not.

**No client-side timer.** The Go broker already bounds the wait, and answering a `requestId` the
server has already given up on is *"a no-op, never an error"* (`contract.ts:2004-2005`). A second
timer here would only be a second thing to get wrong.

**`transport.ts` wiring.** In `createNativeGitTransport` (`transport.ts:130-138`), once per repo
workspace, right after `remote` is created:

```ts
remote.on('credential.request', (req) => {
  enqueueCredentialRequest({
    codeRepoId,
    prompt: req.prompt,
    masked: req.masked,
    answer: (secret) => {
      void remote.request('credential.provide', { requestId: req.requestId, secret })
        .catch(() => { /* the broker's own bound already ended the wait */ });
    },
  });
});
```

Deliberately not via a lease (`leaseOf`, `:219-250`): the subscription belongs to the shared client's
own lifetime, not to any one mount's, and `remote.dispose()` in `disposeGitTransport` (`:279`)
releases it. `disposeGitTransport` gains one line, `dropCredentialRequests(codeRepoId)`, beside its
existing `localEmittersByCodeRepoId.delete(codeRepoId)` (`:277`).

The swallowed `.catch` with no logging is not sloppiness — it is `extension.ts:541-556`'s own
documented rule, for the same reason: the failure path must not be a place where a prompt (which can
contain a pasted credential) reaches a log.

### D10 — `workbench/GitCredentialDialog.vue`: the modal (C3)

```
apps/kira-studio/frontend/src/workbench/GitCredentialDialog.vue
```

Mounted in `App.vue` beside `<GitPairingDialog />` (`:93`), always present, rendering nothing while
`gitCredentialState.active === null`. A pull started in the Git module must stay answerable after
switching to Studio, and this is the precedent that already gives that for free.

- `DialogFrame` with `title="Git credentials"`, `:width="440"`, `test-id="git-credential-dialog"`.
- `codeRepoRecord(active.codeRepoId)?.name` as a subtitle line, so a prompt arriving while a
  different repository is on screen says which one is asking.
- `active.prompt` rendered **verbatim** — it is git's own text (`contract.ts:2222`), never
  reformatted, never parsed.
- `TextField` with `:type="active.masked ? 'password' : 'text'"` — `masked` is `false` only for git's
  own `Username for …` shape (`contract.ts:2224`). Focused on mount (`GitPairingDialog.vue:17-21`'s
  precedent, opposite default: here the input, not the safe button). `@enter` submits.
- Submit → `answerCredential(value)`. Cancel, Escape and the frame's own close → `answerCredential(null)`.
  `null` is what the wire carries for a dismissal — an absence the server would have to infer is
  explicitly not the contract (`contract.ts:2002-2003`).
- The field's `ref` is cleared in the same statement that settles, before the next queue entry is
  pumped.

`RemoteOpError`/`ClassifyRemoteError` already render the resulting cancellation or auth failure —
no new error state anywhere.

### D11 — never log, never store: stated as a property, not an aspiration

The security property this phase must not violate, spelled out so a reviewer can check it
mechanically:

1. No credential value is passed to `console`, `slog`, the op log, `localStorage`, IndexedDB, the
   SQLite database, or any `state/*` module other than the one `PendingCredential` in flight.
2. The value lives in exactly two places and dies with both: the `TextField`'s own `ref`, cleared on
   settle, and the argument to `answer()`, which is consumed synchronously by
   `remote.request('credential.provide', …)`.
3. The **prompt text** is treated the same way — `gitaskpass/prompt.go:11-13` records why: it can
   itself contain a username the user just typed. It is rendered and discarded, never logged.
4. No `catch` on this path logs anything (`extension.ts:541-545`'s own rule, adopted verbatim).
5. `data-testid` attributes go on the dialog and its buttons; the input's **value** never appears in
   a test assertion, a snapshot, or a visual baseline.

§8.3 turns 1, 4 and 5 into grep-able checklist items.

### D12 — what this costs, stated plainly

`docs/ARCHITECTURE.md:2637-2638` and `:3006-3021` become **false** and are rewritten, not patched
(§4). This is a real posture change: after this phase Kira Studio's own window is a writing git
client. It is what the row asks for. The safety argument that replaces "provably read-only" is D7's:
layer 1 stays a default-deny allowlist, three named methods stay refused there, two more that Go
never dispatches stay refused at layer 2, and every capability flag matches what layer 1 admits — in
both directions, pinned by a test.

---

## 3. Files

**Go — changed**

| File | Change |
| --- | --- |
| `apps/kira-studio/internal/bridge/gitstream.go` | D3, D4, D5: rename the four identifiers, widen the allowlist 34 → 52, rewrite `:42-69` and `:172-175`, drop two fields from `:133-134` and rewrite `:118-123` |
| `apps/kira-studio/internal/bridge/gitstream_test.go` | `writeMethods` → 4 entries (`worktree.prepare`, `worktree.cancelPrepare`, `settings.setGitPath`, `editor.resolveConflict`); `preflightMethods` and `TestReadOnlyRequest_PreflightMethodsAreRefused` deleted (C4); `hostAnsweredMethods` unchanged; every test renamed off `ReadOnly`; new `repoSettings.set` cases (D4) |
| `apps/kira-studio/internal/bridge/gitstream_classification_coverage_test.go` | drop the `preflightMethods` loop from the union (`:52-54`); flip `PullStrategy`/`CheckoutAutoStash` to `false` in `knownFields` (`:94-95`); update both doc comments |

`internal/gitrpc`, `internal/gitsession`, `internal/gitaskpass` and `main.go` are **unchanged** — the
whole write path already exists and is already wired to this router (§1.3, §1.4).

**Frontend — changed**

| File | Change |
| --- | --- |
| `apps/kira-studio/frontend/src/repo/git/hostHandlers.ts` | D6 |
| `apps/kira-studio/frontend/src/repo/git/transport.ts` | D9's subscription in `createNativeGitTransport` (`:130-138`); `dropCredentialRequests` in `disposeGitTransport` (`:273-280`) |
| `apps/kira-studio/frontend/src/App.vue` | one import + `<GitCredentialDialog />` beside `:93` |

**Frontend — new**

| File | What |
| --- | --- |
| `apps/kira-studio/frontend/src/state/gitCredential.ts` | D9 |
| `apps/kira-studio/frontend/src/workbench/GitCredentialDialog.vue` | D10 |
| `apps/kira-studio/tests/unit/git-credential-queue.spec.ts` | §5's one new unit test — the directory and `*.spec.ts` naming `bun run test:unit` already covers (`package.json:42`) |

**Packages — changed**

| File | Change |
| --- | --- |
| `packages/git-ui/src/components/ConflictBanner.vue` | D8 — one `v-if`/`v-else-if` variant of the existing reason paragraph. The only edit to this package |

`packages/git-ipc` is **unchanged**: no new method, no new capability, no `ContractVersion` bump.
`contract.ts:2214-2216`'s doc comment gets a clarifying sentence (§4) — prose only, no type change.

---

## 4. Documentation

| Doc | Change |
| --- | --- |
| `docs/ARCHITECTURE.md:2630-2638` | "a second, **read-only** frontend" → a second frontend onto the identical backend, writing through the same allowlist; delete the "provably read-only … nothing in this window can write" sentence outright and replace it with D7's two-way property |
| `docs/ARCHITECTURE.md:3006-3021` | rewrite the whole "three layers, only one load-bearing" block: layer 1 is still the only load-bearing one and still default-deny, but it now admits 52 of 55 methods; name the three refusals and their reasons; state the flag↔refusal correspondence in both directions |
| `docs/ARCHITECTURE.md:3023-3040` | keep the auto-fetch paragraph (still true) but restate its opening reason as D5's, not "the doc documents this surface as read-only" |
| `docs/ARCHITECTURE.md` "Known open items" | add: **no standalone merge or rebase operation exists** — reachable only as pull strategies and inside `stack.restack` (§7). Delete `:3625-3628`'s entry (*"`readOnlyMethods` allowlist comment doesn't note that `branch.resolvePr`/`commit.resolvePr` have a `review.db` purge side effect"*) — but only because D3's rewrite of that comment **must carry the note**, which is the whole fix. Write the note first, then delete the entry; do not delete it merely because the comment was rewritten |
| `docs/ARCHITECTURE.md` | new short paragraph in the Git module section: the native credential prompt (D9/D10), what it never stores, and the 120 s broker bound |
| `packages/git-ipc/src/contract.ts:2214-2216` | one sentence: "never Kira Studio's own window" scopes an *external paired client's* op; the native stream's own op is owned by the native `Conn` and its prompt is answered by this window |
| `docs/v1.6/SPEC.md` | **not touched by this plan.** The main session owns the row's status line |

---

## 5. Testing

Per `CLAUDE.md`'s narrow bar, judged case by case.

**Go: existing tests change, no new test file.** The allowlist is already pinned in both directions
by `TestReadOnlyRequest_AllowlistedMethodsReachInnerHandler` (loops the map) and
`TestReadOnlyRequest_WriteMethodsAreRefused` (loops the refusal list, spying that the inner handler
is never called), and `TestGitrpcDispatch_EveryMethodIsClassified` cross-checks both against
`handlers.go`'s real AST. Widening the allowlist moves entries between those tables — it does not
need a new mechanism. Two cases are added to the existing `readOnlyRepoSettingsSet` tests: a patch
carrying `kiraVersion.pull.strategy` now **reaches** the handler, and one carrying
`kiraVersion.worktree.prepareScript` still does not. That is D4's whole behaviour change, and both
halves belong in the tests that already own that function.

**Frontend: one new unit test, for the queue only.** `state/gitCredential.ts` clears the bar on
`CLAUDE.md`'s "concurrency (ordering, backpressure, cancellation)" clause — three interacting rules
whose failure mode is a silently stuck modal:

1. Two enqueues while none is active → the second becomes active only after the first is answered.
2. `answerCredential` twice → the second is a no-op, the queue is not double-pumped.
3. `dropCredentialRequests(codeRepoId)` with that workspace's prompt active → it is removed, the next
   workspace's prompt becomes active, and no `answer` callback fires for the dropped one.

Nothing else here earns a test. `GitCredentialDialog.vue` is a `DialogFrame` with one field and two
buttons — a thin pass-through the bar explicitly excludes. `hostHandlers.ts`'s capability literal is
a constant; no existing test pins it (grepped: no frontend test references `capabilities.write`).
`ConflictBanner.vue`'s change is one template branch.

**End-to-end (`bun run test:ui`) runs once near the end**, per `CLAUDE.md`'s "implement the whole
plan first, then test once". No existing UI spec asserts git read-only behaviour (grepped:
`E_READ_ONLY`, `capabilities.write` and `credential.provide` appear in no test under `apps/` or
`packages/` except `packages/git-ipc/src/rpc.test.ts`, which is transport-level and unaffected).

**`bun run test:visual` should produce no diff.** Nothing on this phase's path renders until a
conflict or a credential prompt occurs, neither of which a visual baseline exercises. A diff here is
a finding, not something to re-baseline.

---

## 6. Sequencing

One Sonnet subagent, sequential — the layers are order-dependent (flipping `capabilities.write`
before the allowlist widens produces exactly the broken-confirm-button state this plan exists to
avoid). Commits land incrementally:

1. `feat(git)!: widen the native git stream's allowlist to every non-shell operation` — D3, D4, D5
   and the three Go test files. `go build ./... && go test ./apps/kira-studio/internal/bridge/...`
   per commit (cheap).
2. `feat(git): enable write affordances on the native git surface` — D6. `bun run typecheck`.
3. `feat(git): native credential prompt for HTTPS remotes` — D9, D10, the `transport.ts` wiring,
   `App.vue`, and the one unit test.
4. `fix(git): name the real reason a conflict cannot be resolved in this window` — D8.
5. `docs: the native git mount is no longer read-only` — §4, including the `contract.ts` comment.
6. Then `bun run test:ui` / `test:visual` once, with any fix as its own follow-up commit.

Commit 1 carries the `!` and a `BREAKING CHANGE:` footer — it changes a documented security posture,
which is the honest reading of Conventional Commits here even though no API signature moves.

---

## 7. Explicitly out of scope

- **A standalone merge or rebase operation.** §1.3: none exists anywhere in this stack. Building one
  means a new `OpRequest` kind, a new `opSpec` with an undo policy, a new preflight, a new dialog and
  a `ContractVersion` bump. Merge and rebase are reachable here as *pull strategies*
  (`ff-only`/`merge`/`rebase`, `contract.ts:782`) and inside `stack.restack`. Recorded in
  "Known open items" (§4), never silently half-built.
- **Conflict resolution of any kind.** The user's own carve-out. `editor.resolveConflict` stays
  refused at layer 2 and `capabilities.resolveConflict` stays `false`.
- **The worktree prepare script.** D1 — arbitrary shell execution with no approval gate anywhere in
  this codebase. Creating and removing worktrees *is* admitted (D2); running the script is not.
- **Background auto-fetch.** D5 / OQ-5.
- **A finer `Capabilities` vocabulary.** OQ-4 — a `ContractVersion` bump and a second flag threaded
  through ~10 git-ui components and the VS Code extension, for a distinction the user never drew.
- **Credential storage of any kind** — no keychain, no "remember me", no helper configuration UI.
  D11 is the opposite property. A user who wants persistence configures git's own credential helper,
  which `gitaskpass/broker.go`'s `ShouldInterpose` (`:178`) already steps aside for.
- **SSH key passphrases as a distinct flow.** `SSH_ASKPASS` goes through the same broker and the same
  prompt; nothing special-cases it and nothing needs to.
- **A new dependency of any kind.** Every primitive this phase needs already exists (§1.5).
- **The VS Code extension.** Unchanged in every respect.
- **`packages/git-ui` beyond `ConflictBanner.vue`'s one template branch.** Every write affordance in
  that package is already written and already gated on flags this phase flips; none of it is new
  code.

---

## 8. Verification

### 8.1 Mechanical

```
go build ./...
go test ./apps/kira-studio/internal/bridge/...
bun run typecheck
bun run lint
bun run build
bun test apps/kira-studio/tests/unit/git-credential-queue.spec.ts
bun run test:ui
bun run test:visual        # expect NO diff — see §5
```

### 8.2 Manual recipe

Against a real local repository opened in the Git module, with an HTTPS remote:

1. Toolbar shows Fetch / Pull / Push. Branch rows, stash rows and tag rows offer their write actions.
2. Fetch completes; the graph updates.
3. Pull with strategy `ff-only`, then `merge`, then `rebase` in turn (Repository settings → Pull →
   Strategy is now visible and settable — D4). Each completes.
4. Pull into a deliberate conflict. The banner appears; **Resolve is absent**; the reason line reads
   "…in your own editor and stage them, then Continue"; Abort works; Continue works after resolving
   and staging externally.
5. Push, then force-push. Force-push still requires its typed confirmation (`ForcePushDialog.vue`).
6. Pull from an HTTPS remote with no credential helper configured. The dialog appears, names the
   repository, renders git's prompt verbatim, masks the password field, does **not** mask the
   `Username for …` prompt, and Cancel ends the op promptly rather than hanging.
7. Start a credential-requiring pull in Git, switch to Studio while it is prompting. The dialog is
   still there and still answerable.
8. Close the repository's workspace while a prompt is open. The dialog goes; nothing throws; the
   window stays usable.
9. Create a worktree with a non-empty prepare script configured. The worktree is created; the
   run-script checkbox is disabled with its stated reason; no `worktree.prepare` is issued.
10. Repository settings: the prepare script and base-path fields are still not settable from here.
11. Undo a `reset`; restack a stacked branch. Both work.

### 8.3 Checklist

- [ ] `gitstream.go` is still a default-deny allowlist — an unknown method is still refused
      (`TestAllowedRequest_UnknownMethodIsRefused` passes).
- [ ] `TestGitrpcDispatch_EveryMethodIsClassified` passes with every dispatched method in exactly one
      list, and `preflightMethods` no longer exists.
- [ ] The allowlist has exactly 52 entries; exactly `worktree.prepare`, `worktree.cancelPrepare` and
      `settings.setGitPath` of the 55 dispatched methods are absent.
- [ ] D7 both ways: every `false` capability flag maps to a layer-1 refusal, and every admitted
      method has a reachable affordance or none anywhere.
- [ ] `grep -rn "read-only\|readOnly" apps/kira-studio/internal/bridge/gitstream.go` returns nothing.
- [ ] `docs/ARCHITECTURE.md` contains no surviving claim that the native git mount is read-only or
      that nothing in this window can write to a repository.
- [ ] `grep -n "console\.\|localStorage\|sessionStorage\|indexedDB\|slog" ` over
      `state/gitCredential.ts` and `workbench/GitCredentialDialog.vue` returns nothing (D11.1).
- [ ] No `catch` on the credential path logs (D11.4); `grep` the two new files plus `transport.ts`'s
      new block.
- [ ] No test, snapshot or visual baseline contains a credential value (D11.5).
- [ ] `packages/git-ipc` has no diff beyond `contract.ts`'s one comment; `ContractVersion` is
      unchanged.
- [ ] `packages/git-ui` has no diff beyond `ConflictBanner.vue`.
- [ ] `apps/kira-studio-vscode` has no diff at all.
- [ ] `bun run test:visual` produced zero diffs (§5).
- [ ] A repo-map MCP `tools/call` answered correctly during the phase; logged in
      `docs/v1.6/mcp-repo-map-issues.md` only if it did not.

---

## 9. Open questions

**OQ-1 — `capabilities.write` stays one boolean.** (P67b OQ-4, adopted.) The UI's write gate is a
single flag read by `AppToolbar.vue:272`, `BranchPicker.vue:58`, `StashList.vue:35`,
`GlobalStashList.vue:30`, `TagList.vue:25`, `WorktreeList.vue:31`, `UndoButton.vue:24`,
`ConflictBanner.vue:29` and `RepoSettingsDialog.vue:53` — re-grepped, nine components. Splitting it
means widening `Capabilities` in `@kira/git-ipc`, bumping `ContractVersion`, and threading a second
flag through all nine **and** the VS Code extension. *Recommendation: accept the boolean.* D1 and D2
show the remaining refusals each already have their own flag, and the distinction a finer vocabulary
would express ("pull yes, cherry-pick no") is one the user never drew — their premise is that
read-only was about editing files, and no admitted operation edits a file in-app.

**OQ-2 — background auto-fetch stays disabled.** (P67b OQ-5, adopted.) *Recommendation: keep
`DisableAutoFetch()`.* Every fetch this phase admits is one the user pressed a button for. Lifting it
is one deleted line whenever someone wants it, and it is far easier to explain adding automatic
background fetching later than to explain why the app started talking to remotes on its own.

**OQ-3 — push and force-push are admitted, though the report named only pull/merge/rebase.**
(P67b OQ-6, adopted.) *Recommendation: admit them.* A pull-merge-rebase workflow that cannot push has
no ending; force-push is already behind its own typed-confirmation dialog (`ForcePushDialog.vue`);
and D1's all-but-three rule is simpler to keep honest than a hand-drawn line through one method's
five kinds.

**OQ-4 — `worktreeAdd`/`worktreeRemove` are admitted, diverging from P67b's §5.2.** New to this pass
(C1/D2). *Recommendation: admit them.* Refusing them with `capabilities.write: true` renders three
`WorktreeList.vue` buttons that fail at layer 1 — the exact failure mode the allowlist exists to
prevent — and the operations themselves are plain `git worktree add`/`remove`, not shell execution.
The prepare script, which *is* shell execution, stays refused and already has its own flag and its
own stated reason in the dialog. If a human wants worktree creation out anyway, the honest way is a
new capability flag, which is OQ-1's rejected contract bump — not a silent layer-1 refusal behind a
`true` flag.

**OQ-5 — the conflict banner's Continue stays enabled.** *Recommendation: keep it enabled.* Read
literally, "only in case of conflicts I can't continue" names what the app cannot do *for* the user
(resolve the files), not a state it should trap them in. Blocking Continue leaves Abort as the only
exit from a half-finished rebase, which loses work the user may have already resolved by hand. D8's
reason line is what makes the division legible.

**OQ-6 — the credential dialog is not a "remember this" surface, and this phase adds no storage.**
*Recommendation: keep it stateless.* D11 is a hard property, and git already has a real answer
(`credential.helper`) that the broker steps aside for (`broker.go:178`). Adding Kira's own credential
store is a separate feature with its own threat model, not a checkbox on this modal.
