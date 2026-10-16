# P96 — full-suite flake sweep (P94's unlanded pass 4)

`docs/v1.9/SPEC.md`'s P96 row, turned into concrete steps. This is pass 4 of P94
(`docs/v1.8/plans/P94-code-quality-tooling.md` §2, §11), planned against the tree v1.9 opens on
(`v1.9` at `6e420c7`, P71-P94-pass-3 landed). It enables **no new rule** and adds **no tooling** —
passes 1-3 already landed every linter, hook and CI patch. It fixes what genuinely-clean full runs
of `test:unit`, `test:webview`, `test:ui` and `go test ./...` surface.

Every number below is a real measurement taken in this container against `6e420c7`, not an
estimate inherited from a prior pass's prose. Two of the three named inherited items are now
**diagnosed to root cause**, one of them exactly; §1's method governs the rest.

## 0. What the parent plan left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| `http-request-body.spec.ts`'s form-data case: is `Received: 657` a real bug or a wrong assertion? | **Wrong assertion, root-caused exactly.** 657 is the byte length of the *first* `tabsSave` args — `{"windowKey":"main","tabs":[<one default http-request tab record>]}` — emitted the instant `new-request-start` opens the tab, before the picked file exists. Reconstructed byte-for-byte: 657, matching the observed number exactly. Nothing file-sized ever crosses; the 500 bound simply became smaller than an empty persisted tab record as `httpRequestTabStateShape` grew | §3 |
| Is it a flake at all? | **No — deterministic.** `openTab` calls `saveNow()` unconditionally, so that `tabsSave` always precedes the assertion. Pass 1/2/3 all recorded it failing; pass 3 recorded it failing in isolation too. "Flake" is the inherited label, not the behaviour | §3.1 |
| `internal/grpcclient`'s reflection port race — pass 1 said "did not fire this run" | **Reproduced here, and it is not a port race.** `TestDescribe_Reflection_NoReflection_YieldsSchemaError` fails with `error = EOF, want a *Error with code E_GRPC_SCHEMA` at roughly 1 run in 25. Measured: 1 failure in the first `-count=5` run, then 1 more across 3×`-count=10`. `startEchoServer` already has P81's readiness probe; this is the residual that probe's own comment names | §4 |
| Is the grpcclient one a test bug or a product bug? | **Undecided by design — §4 names the deterministic-repro step that decides it**, and both branches' fixes. `startStubReflectionServer` has no readiness wait at all (a separate, definite test-side gap, fixed regardless) | §4 |
| The two long-standing Biome findings | **Both read and classified.** `UncommittedChangesStrip.vue:49` is a genuine `useShorthandFunctionType` hit — fix the code. `RequestSettingsPane.vue:2`'s `useImportType` is a **false positive**: all four imported constants are used as values, but only in `<template>`, which Biome does not see. `biome.json` already turns `noUnusedImports`/`noUnusedVariables` off for `**/*.vue` for exactly this reason — same override, same reason | §5 |
| Parent §11's other named flakes (`cell-editor`, `grpc-request`, `sql-schema`, `repo-workspace`, `scroll-trace`, the Monaco storm) | **The list is stale and must be re-verified, not re-derived.** P81 already fixed `cell-editor.spec.ts`'s and `grpc-request.spec.ts`'s named assertions; §11 was re-grepped from result sections written before P81 landed. Passes 1-3's own runs show 310/311 of 316 passing, not P90/P93's 47-failure Monaco storm | §6 |
| Can a genuinely clean run be had in this container? | **Yes, with setup.** `node_modules` is absent, webkit is absent (`/opt/pw-browsers` ships chromium only), and `go build ./...` fails on `main.go:69` (`pattern all:frontend/dist: no matching files found`) until the frontend is built | §2 |
| `git blame` archaeology on a failing assertion | **Not available as cloned.** This checkout is shallow (50 commits, grafted at `8d7abdf`); `git log -S` finds nothing older. `git fetch --unshallow` first, or use the chapter result sections as the record | §2.3 |
| One subagent or several? | **One sequential.** Triage is inherently serial — a full run, then a per-failure isolation rerun, then a fix, then another full run. Nothing here is independent enough to fan out | §8 |

Genuinely left out, named rather than half-built:

- **Disabling, skipping, quarantining or `test.fixme`-ing any test.** Forbidden outright by
  `CLAUDE.md`; not an option for any finding here, however inconvenient.
- **Raising a tolerance to make a number pass.** P81 §1's rule stands: a widened bound is a
  tolerance change wearing a disguise. §3's fix *derives* its bound from the fixture rather than
  widening a magic constant.
- **A client-side retry in `internal/grpcclient`'s production dial path**, unless §4's root-cause
  step proves the defect is there. That is a real design decision about reflection retry policy; if
  it is the answer, §4 says so explicitly rather than smuggling it in.
- **`tests/e2e-real/`, `test:compat`, `test:matrix`, `test:visual`, `test:ipc:fe`.** SPEC names four
  suites. The container tiers need Docker and are their own environment problem
  (`docs/DEV_ENVIRONMENT.md`); `visual` is a screenshot-baseline tier whose authority is a CI image,
  not this container.
- **Any `playwright.config.ts` change.** P27's `ui`/`ui-timing` split and `workers: '100%'` stay as
  they are, for P81 §8's reason. If §7's triage finds a failure that only a config change fixes,
  that is a finding to state, not a change to make silently.
- **Any new linter, rule, hook or CI step.** Pass 4 enables nothing.

---

# 1. Method: what counts as fixed

Inherited verbatim from `docs/v1.8/plans/P81-fix-flaky-ui-tests.md` §1, because this phase is the
same kind of work and that phase's discipline is why its four fixes held:

**(a) Deterministic repro before the fix.** Not "run it under load and hope" — an edit, a flag or a
loop count that makes the test fail every time (or at a measured, stated rate) by supplying the
condition load supplies at random. Each section below names its own.

**(b) The fix passes under that same condition, unchanged.** If the repro's knob has to be turned
back down for the fix to pass, the fix is a tolerance change.

**(c) A mutation check.** Removing the thing that made an assertion fail is worthless evidence on
its own. Reintroduce — temporarily, in application code — the regression the assertion exists to
guard, and confirm the rewritten assertion still fails. Revert immediately; nothing from (a) or (c)
is committed.

Record the observed numbers in the commit message (failure counts before and after), not a claim
that it was checked.

## 1.1 The triage protocol for every failure the full run surfaces

Applied identically to every red test, inherited one, or newly surfaced:

1. **Isolate.** Rerun that test alone:
   `bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --workers=1 <file> -g "<title>"`.
   Passing alone and failing under the 4-worker concurrent run is the signature passes 1-3 used to
   classify resource contention (pass 1's `tree.spec.ts`, pass 3's `api-ui-consistency`,
   `sql-schema`, `data-view`). Reproducing in isolation means a real defect.
2. **Date it.** `git diff --stat 6e420c7` must touch nothing in the failing file's own dependency
   chain for "pre-existing" to hold. `CLAUDE.md`: pre-existing justifies skipping the *did this
   phase cause it* investigation, never skipping the fix.
3. **Classify.** Wrong/too-tight assertion, real race, real timing dependence, or a genuine product
   bug. The fourth is the one that changes scope — if a failure is the app misbehaving rather than
   the test mis-asserting, say so plainly in the plan-deviation record and the commit, and scope the
   product fix.
4. **Fix under §1's three obligations.** One commit per finding.

Contention-classified failures are **not** left alone by default. A test that only fails under four
workers is still a test whose assertion depends on wall-clock luck; if it has a removable timing
proxy (P81 §2's shape), remove it. If it genuinely has none — a 120s Playwright timeout on a
crashed worker, say — record it as contention with the isolated-rerun evidence, as pass 1 and pass 3
both did, and move on. Do not manufacture a fix.

---

# 2. Environment: getting a genuinely clean run

This container starts with nothing installed. Do all of this before the first measurement, or the
first "full run" is not one.

## 2.1 Setup, once

```
bun install                                  # node_modules is absent as cloned
bunx playwright install webkit               # /opt/pw-browsers has chromium only, no webkit
apt-get install -y libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1 gstreamer1.0-libav
```

Install exactly the libraries webkit's own post-install warning names — not a generic
`playwright install-deps` (`docs/DEV_ENVIRONMENT.md`'s own note). If the warning names a different
set at run time, follow the warning, not this list.

## 2.2 `go build ./...` needs the frontend built first

Measured at `6e420c7` with a clean tree:

```
apps/kira-studio/main.go:69:12: pattern all:frontend/dist: no matching files found
```

`main` embeds `frontend/dist`, so `go build ./...` and `go test ./...` both fail on it until
`bun run build` (or `bun run build:test`, which `test:ui` runs anyway) has produced that directory.
Passes 1-3 reported both clean because they had already built. Order the verification run so the
frontend build happens first, and do not mistake this for a regression.

## 2.3 The checkout is shallow

`git log` reaches 50 commits and stops at the graft `8d7abdf`; `git log -S"toBeLessThan(500)"`
therefore finds nothing. Run `git fetch --unshallow` before any `git blame`/`git log -p` archaeology
on an old assertion. Where archaeology is not worth the fetch, the chapter result sections
(`docs/v1.8/SPEC.md`'s `## P90`/`## P92`/`## P93`/`## P94 result`) are the durable record of what
already failed and when.

## 2.4 Quiet, and the baselines to beat

Take the full run with nothing else competing — no parallel build, no other test tier, no
background container. The numbers to reproduce or improve on, from pass 3's own run:

| Suite | Pass 3 baseline |
|---|---|
| `bun run test:unit` | 1543 passed, 0 failed |
| `bun run test:webview` | 55 passed, 0 failed |
| `bun run test:ui` | 316 tests: 310-311 passed, 1-3 failed, 4 did not run |
| `go test ./...` | clean (the grpcclient flake did not fire in passes 1-3) |

Take **two** full `test:ui` runs, not one. Pass 3's own two runs produced different failure sets;
one run cannot distinguish a contention flake from a deterministic failure, and §1.1 step 1 needs
both data points.

---

# 3. Item 1 — `http-request-body.spec.ts`'s 500-byte bound

`apps/kira-studio/tests/ui/http-request-body.spec.ts:153`, in
*"Http request body — form-data with a real file field sends a path, never bytes"*:

```ts
for (const entry of control.log()) {
  const size = entry.args === undefined ? 0 : JSON.stringify(entry.args).length;
  expect(size).toBeLessThan(500);
}
```

## 3.1 Root cause, exactly

The loop walks **every** logged bound call, not just `httpSend`. The first entry over 500 is the
`tabsSave` that `openTab`'s unconditional `saveNow()` emits the moment `new-request-start` opens the
tab — before the body pane is opened, before the file is picked, before anything form-data-shaped
exists.

`bridge/index.ts:420` sends `{ windowKey, tabs }`; `state/window.ts` resolves `windowKey` to
`'main'` under `tests/ui` (a static file server, no `?window=`); the single tab is a default
`http-request` record. Serialising exactly that — `windowKey: 'main'`, one record with
`connectionId: null`, `path: 'request'`, `kind: 'http-request'`, `order: 0`, `active: true`,
`workspaceId: null`, and `defaultHttpRequestTabState()` — gives **657 bytes**, which is the observed
`Received: 657` to the byte. (With `workspaceId: 'api'` it is 658, which it is not: `openTab` stores
`opts.workspaceId ?? null`.)

The runner-up, `httpSend`'s own args for this test, is **511** bytes — also over 500, and also
carrying no file bytes. So the assertion is over its bound twice, on two unrelated payloads.

Neither number reflects a defect. `httpRequestTabStateShape` has grown since the bound was written —
P4's `itemId`/`name`, P22b's `paramDescriptions`/`fieldDescriptions` and the per-row `description`,
P90's seven-null `settings` object — and `httpSend`'s args grew with P5/P6's
`collectionId`/`environmentId`, P8's `itemId`, P71's `incognito` and P90's `options`. 500 was never
a property of anything; it was a round number that used to be comfortably above an empty tab record
and no longer is. The test's real claim (D4/F7 — the picked file's bytes never cross the bridge) is
fully intact: 657 bytes of empty tab state cannot contain a 2048-byte file.

## 3.2 The fix

Make the bound a property of the fixture instead of a magic constant, and give it enough headroom
that ordinary schema growth can never erode it again.

1. Raise the fixture file's size so it is unambiguously "file-sized":
   `file: { path: '/tmp/report.csv', name: 'report.csv', size: 4 * 1024 * 1024 }`.
2. Update the caption assertion that reads it — `format.ts`'s `formatBytes` renders
   `4 * 1024 * 1024` as `4.0 MB`, so line 125 becomes
   `await expect(fileCaption).toHaveText('report.csv (4.0 MB)')`.
3. Bound every logged call against that same size:
   `expect(size).toBeLessThan(PICKED_FILE.file.size)`.
4. Rewrite the comment above the loop to say what the bound now means: no logged argument is as
   large as the file itself, so no logged argument can be carrying it. Drop "500".

Margin after the change: the largest entry this test produces is the post-fill `tabsSave` at ~1125
bytes, about 3700× under the bound. A regression that actually put the file on the wire would carry
≥4 MB (≥5.6 MB base64) and fail.

**Declined, with reasons:**

- *Bound at the current 2048.* Only 1.8× over the largest real entry; it rots the same way 500 did,
  just later.
- *Exclude `tabsSave` from the loop.* Weakens the assertion to "no file bytes on the channels we
  thought of" and adds a channel list to maintain. The whole point is that it walks everything.
- *Assert only on `httpSend`.* Same objection, and `httpSend` alone is already 511 — the bound would
  still need re-deriving.

## 3.3 §1's three obligations for this item

- **(a) Repro:** deterministic. `bunx playwright test --config=apps/kira-studio/playwright.config.ts
  --project=ui --workers=1 tests/ui/http-request-body.spec.ts -g "form-data"` fails every time,
  `Received: 657`. Confirm that before touching anything, so the fix is measured against a known
  number and not a hope.
- **(b) Same condition:** the same isolated command passes after, and the test also passes inside a
  full concurrent `test:ui` run.
- **(c) Mutation check:** temporarily make `buildBodyWire`'s `formdata` arm put file *content* on
  the wire (read the fixture path into `value`, or just inline a ≥4 MB string literal into the
  emitted field) and confirm the rewritten loop still fails. Revert; do not commit it.

---

# 4. Item 2 — `internal/grpcclient`'s reflection test

Pass 1 deferred a "known port race in `internal/grpcclient`'s reflection test" to pass 4 and
recorded that it "did not fire this run"; passes 2 and 3 likewise saw `go test ./...` clean. It
fires here.

## 4.1 Measured, at `6e420c7`

```
go test ./apps/kira-studio/internal/grpcclient/ -count=5
--- FAIL: TestDescribe_Reflection_NoReflection_YieldsSchemaError (0.00s)
    descriptors_test.go:101: error = EOF, want a *Error with code E_GRPC_SCHEMA
```

Rate in this container: 1 failure in that first `-count=5`, then 1 more across three consecutive
`-count=10` runs. Call it ~1 in 25 iterations, and re-measure rather than trusting that figure — it
is load-dependent by construction.

## 4.2 What is actually happening

`startEchoServer` already carries P81's `waitEchoServerReady` probe, so this is not the
listener-not-yet-serving race that probe fixed. The probe's own comment predicted this residual:
*"any fresh connection's first RPC, not only one made right after a listener opens."*

The path: `Describe` → `resolveReflection` → `dialConn` (a **new** `grpc.ClientConn`, not the
probe's) → `negotiateAndListServices` → `newV1Transport` → `listServices()`. `Recv()` returns
`io.EOF`; `status.Code(io.EOF)` is `codes.Unknown`, not `codes.Unimplemented`, so the v1alpha
fallback is skipped, the error propagates, and `resolveReflection` wraps it as `Transport("EOF")`.
The test wants `SchemaError` (`E_GRPC_SCHEMA`), which is only produced when the code *is*
`Unimplemented` — which is what a reflection-less grpc-go server normally answers with.

So the failing step is: the first RPC on a fresh connection to an already-serving server
occasionally ends the stream without a status instead of with `Unimplemented`.

## 4.3 Establish the deterministic repro first

Do not fix before this step; §1(a) is not optional and the classification in §4.4 depends on it.

- `go test ./apps/kira-studio/internal/grpcclient/ -run TestDescribe_Reflection_NoReflection -count=500`,
  and the same under an all-cores CPU stressor (P81's own technique, and the one this test file's
  comment says reproduced the residual with zero Docker involvement).
- Also `-race`, and also with `-count=1` in a fresh process per iteration (a shell loop), to
  separate "first RPC on a fresh connection" from "state left over by an earlier test in the same
  process". Two hypotheses worth separating explicitly:
  1. **Transport-level:** grpc-go ends the stream with OK/EOF before the `Unimplemented` status is
     written, under scheduling pressure.
  2. **Ephemeral-port reuse:** `t.Cleanup(s.Stop)` frees a loopback port that a later
     `net.Listen("tcp", "127.0.0.1:0")` in the same process immediately reclaims, while a connection
     aimed at the old server is still winding down. The per-process loop above falsifies this one
     cheaply.

## 4.4 The fix, per branch

- **If the repro shows a test-side ordering gap** (hypothesis 2, or the probe's connection
  interfering): fix it test-side. The definite, unconditional piece either way is
  `startStubReflectionServer` (`descriptors_test.go:256`), which does `net.Listen` + `go s.Serve` and
  returns immediately with **no readiness wait at all** — the exact shape `waitEchoServerReady`
  exists to close. It registers `ServerReflection` and answers `ListServices`, so
  `waitEchoServerReady(t, lis.Addr().String())` applies verbatim. Land that regardless of what the
  repro shows; it is a real gap in the same file, found by reading it.
- **If the repro shows a genuine product gap** (hypothesis 1 — a transport-level first-RPC failure
  that `grpcclient` surfaces to a user as the literal word `EOF`): that is a product bug, not a test
  bug, and this plan says so. Two candidate fixes, to be decided by the repro and stated in the
  commit: `grpc.WaitForReady(true)` on the reflection stream's own call options, or a bounded retry
  of the first `listServices()` round trip when the failure is transport-level rather than a real
  status. Either way `resolveReflection`'s error classification also deserves a look — `D17`'s whole
  premise is that a reflection failure is legible, and `Transport("EOF")` is not.
- **Never** loosen `descriptors_test.go:101` to accept `CodeTransport`. That assertion is the F11
  behaviour under test.

## 4.5 §1's obligations for this item

- **(a)** §4.3's loop, with the observed failure count stated.
- **(b)** the same loop, same iteration count, same stressor, zero failures after.
- **(c)** mutation: temporarily unregister reflection handling so the server answers something other
  than `Unimplemented`, and confirm the test still fails — the fix must not have turned the
  assertion into one that passes for the wrong reason.

---

# 5. Item 3 — the two long-standing Biome findings

Both are `warn`/`info`, so `biome check` exits 0 and both have survived a dozen phases. Pass 3's
result section confirms both still present. Both were explicitly assigned to pass 4.

## 5.1 `UncommittedChangesStrip.vue:49` — `useShorthandFunctionType` (info)

`packages/git-ui/src/components/UncommittedChangesStrip.vue:45-51`:

```ts
const emit = defineEmits<{
  /** P7 (item 2): … */
  (e: 'select'): void;
}>();
```

A real hit: an object type whose only member is a call signature. Rewrite to Vue 3.3+'s named-tuple
emit shape, which is not a call signature and so satisfies the rule while staying idiomatic:

```ts
const emit = defineEmits<{
  /** P7 (item 2): … */
  select: [];
}>();
```

Keep the doc comment attached to the member. `vue` is pinned at `3.5.42`, so the shorthand is
available. Check the emit's call sites compile unchanged (`emit('select')` is identical under both
shapes) — `bun run typecheck` covers it via `typecheck:git`'s `vue-tsc` on `packages/git-ui`.

**Scope note:** many other `.vue` files use the same call-signature shape
(`packages/kira-ui/src/KuiMenuList.vue`, `KuiContextMenu.vue`, `KuiSearchInput.vue`,
`packages/git-ui/src/components/*` and more). Only the one Biome actually flags is in scope. A
repo-wide emit-shape migration is not this phase's work, and converting files Biome does not flag
would be churn with no check behind it — if Biome flags more of them once P97 widens `.vue`
coverage, P97 owns them.

## 5.2 `RequestSettingsPane.vue:2` — `useImportType` (warning)

`apps/kira-studio/frontend/src/views/httprequest/RequestSettingsPane.vue` imports four constants
from `@shared/domain/settings`. Read the whole file before touching it: **all four are used as
values** —

| Constant | Value use |
|---|---|
| `HTTP_VERSIONS` | `<option v-for="v in HTTP_VERSIONS">` (line 108) |
| `REQUEST_TIMEOUT_MS_RANGE` | `:min`/`:max` bindings (127-128) |
| `MAX_RESPONSE_MB_RANGE` | `:min`/`:max` bindings (154-155) |
| `MAX_REDIRECTS_RANGE` | `:min`/`:max` bindings (223-224) |

— but every one of those uses is in `<template>`, which Biome does not analyse. Inside
`<script setup>`, `HTTP_VERSIONS` appears only as `(typeof HTTP_VERSIONS)[number]` (line 30), a type
position, and the other three appear nowhere. So the rule concludes "type-only import". **Applying
its fix breaks the component at runtime**: `import type` is erased, and the template's
`v-for="v in HTTP_VERSIONS"` would read `undefined`.

`biome.json` already carries a `**/*.vue` override turning `correctness/noUnusedImports` and
`correctness/noUnusedVariables` off, for precisely this root cause. `useImportType` is the same
class of template-blind false positive, so it belongs in the same override:

```json
{
  "includes": ["**/*.vue"],
  "linter": {
    "rules": {
      "correctness": { "noUnusedImports": "off", "noUnusedVariables": "off" },
      "style": { "useImportType": "off" }
    }
  }
}
```

Extend the override's inline reason to name the third rule and why — Biome lints the `<script>`
block only, so a value used solely in `<template>` reads as unused or type-only, and acting on
either verdict is a runtime break.

**Declined:** a per-line `// biome-ignore lint/style/useImportType: …`. It fixes one occurrence of a
rule that is wrong for every `.vue` file in the repo, and the next file to hit it gets the same
misleading suggestion with no record that it was already judged wrong. The two rules already off for
the identical reason are the precedent.

**P97 interaction, stated rather than left to collide:** P97 extends Biome's `.vue` coverage and
owns that override thereafter. P96 lands this entry now because pass 4 was assigned it; P97's own
planning pass re-reads the override rather than assuming it.

## 5.3 Verify the level, do not assume it

Re-run `bun run lint` first and confirm both findings are still exactly where pass 3 left them, at
the same rule names and levels. If either has moved or vanished (the pinned Biome version is
`2.5.13` and nothing here upgrades it, so it should not have), record that and work the real output.

---

# 6. Item 4 — parent §11's list, re-verified not re-derived

`P94-code-quality-tooling.md` §11 named seven more suspects. That list was assembled from result
sections written **before P81 landed**, and P81 fixed several of them. `CLAUDE.md`'s rule that a
planning pass re-reads the current source applies here: check each against the tree before acting,
and state plainly where there is nothing left to fix.

| §11 item | Status at `6e420c7` | Action |
|---|---|---|
| `cell-editor.spec.ts`'s timing bound | **Fixed by P81.** Line 770's comment records the `Date.now()` budget's removal | Confirm it passes in the full run; no change |
| `grpc-request.spec.ts`'s debounce assertion | **Fixed by P81.** Lines 224-227 now assert the absence after the debounce has provably elapsed | Same |
| `sql-schema.spec.ts`'s `.suggest-widget.visible` case | Still present (6 sites; line 501's `waitForTimeout(300)` is an explicit absence assertion). Failed once in pass 3's run 1, **passed in isolation** | Only act if the full run reproduces it; §1.1 |
| `repo-workspace.spec.ts`'s search-ordering case | No timing proxy found by reading | Only act if the run reproduces it |
| `scroll-trace.spec.ts`'s load-timing case | No timing proxy found by reading | Same |
| The Monaco-loading storm (47 failures in P90 and P93) | **Did not reproduce in any of passes 1-3** (310/311 of 316 passing). Environment-dependent, not a standing defect in 56 spec files | Watch for it in §2.4's two runs. If it fires, treat it as **one** root cause, not 47 findings, and re-read `playwright.config.ts`'s own worker-count comments before changing anything |
| Pass 1's `tree.spec.ts` 120s timeout | Contention-classified by pass 1's own isolated rerun (21.8s clean) | Same |

Pass 3 additionally saw `api-ui-consistency.spec.ts`'s hover z-index case and `data-view.spec.ts`'s
pagination case fail once each and pass in isolation. Same treatment.

---

# 7. Item 5 — whatever the clean run surfaces

This is the open half of the phase and it cannot be enumerated in advance. §1.1 is the protocol;
these are the standing rules for what comes out of it:

- **Every red test gets fixed, pre-existing or not.** `CLAUDE.md` is explicit. "Pre-existing" buys a
  skipped root-cause-attribution step, never a skipped fix.
- **A finding that is a genuine product bug gets named as one** and its fix scoped in the commit —
  not filed under "flaky test".
- **A finding whose fix needs work genuinely outside this phase** (another subsystem, a real design
  decision) becomes its own named row in `docs/v1.9/SPEC.md`, the way P94 pass 1 opened P95. It does
  not become a line in a result section.
- **A pass that finds nothing real says so.** Do not manufacture a finding to justify the run.

---

# 8. Commits

One sequential subagent. Conventional Commits; each message ends with this session's two
attribution lines. Every commit is a normal, non-bypassed commit — `--no-verify` buys time inside an
investigation and never ends one.

1. `test(ui): derive http-request-body's form-data size bound from the fixture file` — §3.2's four
   edits in one commit, with the 657/511 measurements and the mutation-check result in the body.
2. `test(grpcclient): wait for the stub reflection server before returning its address` — §4.4's
   unconditional test-side piece.
3. `fix(grpcclient): …` **or** `test(grpcclient): …` — §4.4's root-caused fix, worded for whichever
   branch the repro proves, with the before/after failure counts in the body.
4. `refactor(git-ui): use the named-tuple emit shape in UncommittedChangesStrip` — §5.1.
5. `chore: turn useImportType off for .vue, alongside the two rules already off for it` — §5.2,
   reason inline in `biome.json`.
6. …one commit per finding from §6/§7, each naming its isolation evidence and its classification.
7. `docs(v1.9): record P96` — §10's `SPEC.md` result section.

Commits land incrementally as each finding is fixed; the expensive full-suite verification runs once
near the end, per `CLAUDE.md`. Cheap checks (`bun run lint`, `bun run typecheck`) run per commit.

---

# 9. Verification

**Per commit (cheap):** `bun run lint` and `bun run typecheck`, on a normal commit. From commit 5
onward `bun run lint` must show **zero** findings at any level for the two files §5 touches.

**Once, near the end**, in this order (§2.2: the frontend build must precede the Go build):

1. `bun run build` and `bun run build:vscode` — both succeed.
2. `bun run lint:all` — Biome **0 errors, 0 warnings, 0 info** (this is the change: passes 1-3 all
   ended with 1 warning + 1 info); `golangci-lint` 0 across pass 2's 11 linters; `knip` exits 0 (the
   6 `duplicates` findings stay at `warn` and stay untouched, the 4 declined compiler hints stay
   declined).
3. `go build ./...`, `go vet ./...`, `go test ./...` — all clean.
4. `go test ./apps/kira-studio/internal/grpcclient/ -count=100` — **0 failures**, stated as a number.
   This is the only proof §4's fix holds; a single clean `go test ./...` is exactly the evidence
   passes 1-3 had, and it was wrong.
5. `bun run test:unit` — expect **1543 passed, 0 failed** (pass 3's count). Any change is this
   phase's doing and gets explained.
6. `bun run test:webview` — expect **55 passed, 0 failed**.
7. `bun run test:ui` — **two** full runs (§2.4). Target: **316 passed, 0 failed, 0 did not run**.

"Done" is: both `test:ui` runs fully green, `test:unit`/`test:webview` at or above their baselines,
`go test ./...` clean plus the 100-iteration grpcclient loop clean, `lint:all` with no Biome finding
at any level, and every commit a normal non-bypassed one.

If a `test:ui` run still shows a failure at that point, it is not done. The two admissible endings
are: it is fixed, or it is a resource-contention case with an isolated-rerun record and a stated
reason why no removable timing proxy exists — recorded in §10, never left silent.

**Phase-specific checks:**

1. Re-run §3's isolated form-data command before *and* after the fix, and record both numbers.
2. Run §3.3(c)'s and §4.5(c)'s mutation checks and confirm both assertions still fail under the
   reintroduced regression. Revert both; neither is committed.
3. Confirm `git status` is clean of every temporary repro edit before the final commit — P81's rule
   that nothing from (a) or (c) is committed.
4. Confirm §5.2's `biome.json` override changed exactly one rule's level and nothing else, by
   diffing Biome's full finding set before and after it.

---

# 10. `docs/v1.9/SPEC.md`'s P96 result section

Append a `## P96 result` section in the shape v1.8's own result sections use. It must state, because
each is a correction to what this phase inherited rather than a restatement of it:

- The 500-byte bound's **exact** root cause (the first `tabsSave`'s 657 bytes, reconstructed
  byte-for-byte; `httpSend`'s own 511), that it was **deterministic and not a flake**, and the
  fixture-derived bound that replaces it.
- That `internal/grpcclient`'s deferred item **is not a port race**, the measured failure rate, the
  root cause the repro established, which branch of §4.4 was taken and why, and the 100-iteration
  result.
- That parent §11's flake list was **stale** — `cell-editor` and `grpc-request` already fixed by
  P81 — with what was re-verified versus what actually needed work.
- `RequestSettingsPane.vue`'s `useImportType` as a **template-blind false positive**, not a code
  defect, and the override that records that judgement for every `.vue` file.
- The full-run numbers as observed, both `test:ui` runs, and any failure left standing with its
  isolation evidence and reason.
- Any deviation from this plan, stated as a deviation with its reason.

No separate findings document. Each finding is fixed and committed one at a time; the commit log is
the durable record.

---

# 11. Out of scope — confirmed, not forgotten

- **P95** (`errcheck`, `staticcheck`). Its own phase, opened by P94 pass 1. No `.golangci.yml` change
  here at all.
- **P97** (dropping repo-map/tree-sitter; widening Biome's `.vue` coverage) and **P98** (the UI/state
  stack). Later rows; nothing here anticipates them beyond §5.2's stated interaction.
- **Every rule, linter, hook and CI step.** Pass 4 enables nothing new, by the parent plan's own
  pass table.
- **`playwright.config.ts`.** P27's project split, `workers: '100%'` and `retries` stay as they are.
- **`tests/e2e-real/`, `test:compat`, `test:matrix`, `test:visual`, `test:ipc:fe`.**
- **A repo-wide `defineEmits` shape migration** (§5.1) and **`knip`'s 6 `duplicates` findings**
  (deliberate, reasoned in `knip.json`, left at `warn` by pass 1).
- **Disabling, skipping or quarantining any test**, and **widening any tolerance to make a number
  pass**.
