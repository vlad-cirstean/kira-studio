# P6 — Faker-backed dynamic values

> **What this phase is.** `docs/v1.2/SPEC.md`'s P6 row: **Postman/Bruno-style dynamic value
> generation inside a request** — a `{{$...}}` variable form (random name, email, UUID, timestamp,
> and so on) **resolved via `@faker-js/faker` fresh on every send, rather than a stored value**. The
> row's own reason for sitting here: it *"extends the same `{{...}}` substitution engine P5 builds —
> a generator function resolved in place of a stored variable — rather than needing a second
> substitution mechanism."*
>
> **The phase is small because P5 built the seam on purpose, and this plan verified that rather than
> trusting it.** `$` is not a name that fails to match and falls through to `unknown`: it is a
> **token kind of its own, tested before the value lookup ever happens**, on both sides —
> `substitute.ts:69-73` and `resolve.go:71-73` — and the shared corpus already pins it
> (`internal/httpvars/testdata/substitution.json`, *"a $-prefixed name is dynamic, left verbatim"*,
> `{{$randomEmail}}`). P5 D17 said as much in advance: *"P6 adds a resolver behind the existing
> `dynamic` branch and changes no scanning."* That is exactly what happens below.
>
> **The finding that shapes the whole design (F2).** `HttpRequestView.vue:98-108`'s
> `unresolvedRefs` is a Vue `computed` that runs the **entire** stage-1 resolution over the tab's
> current state — on every keystroke, as a live preview of what would go out. If generation lived
> inside that path, typing one character into a URL containing `{{$guid}}` would mint a new UUID,
> and the preview would show a value that is not the value the send will use. So generation cannot
> be a property of the engine; it has to be an **opt-in the send path supplies and the preview does
> not** (D2/D6).
>
> **The behaviour question the brief asked to settle from evidence, settled the other way round
> (F7/D3).** The suspicion was that `{{$guid}}` twice in one request should produce the *same*
> UUID within one send. Postman's real behaviour is the opposite: every occurrence is generated
> independently, and Postman's own documented workaround for wanting one value twice is a
> pre-request script. This phase matches Postman — **per occurrence, not per send** — which is also
> what falls out of a callback-shaped resolver with no memo map, so the fidelity choice and the
> simple implementation are the same choice. §8 OQ-1 records the sourcing honestly and names the
> one-`Map` fix if it is ever wrong.
>
> **Where it lands: stage 1, the renderer, and Go is not touched at all (F9/D6).** A dynamic value
> is neither a secret (nothing to gate, nothing to decrypt) nor a stored variable (nothing to look
> up), so P5 D6's reason for a second stage — *"a secret's plaintext must never reach the
> renderer"* — has no counterpart here. `@faker-js/faker` is a renderer dependency
> (`package.json:47`, `10.6.0`), stage 1 is the renderer, and that is the end of it: **no Go file,
> no migration, no bound method, no bindings regeneration, no `packages/shared` change.** The
> corpus and `internal/httpvars/resolve.go` are byte-identical after this phase.
>
> **`op_log.command` is fine, and that is stated rather than assumed (F8).** P5 F3 made the
> persisted command column load-bearing. It stays load-bearing and it stays correct: `SetCommand`
> is called with `args.URL`, which is the **post-stage-1** URL, so a generated value already lands
> in `op_log.command` the same way a resolved non-secret variable already does today. That is not a
> leak — it is the log recording what was actually sent, which is the only thing that makes a
> dynamic value's op-log row useful at all. The invariant F3 protects is about **secrets**, and
> stage 2 still keeps those out by construction.
>
> **The generator vocabulary is finite, Postman-spelled, and every entry was executed against the
> installed faker before being written down (F6/F11/D4).** 58 names, using Postman's own `$name`
> spellings so a collection imported from Postman keeps working, each mapped to a
> `@faker-js/faker@10.6.0` call this plan actually ran. Postman's full set is ~100+; the ~45 left
> out are named with the reason, category by category, rather than trailed off with "and so on".
>
> **What does not land here.** Curl parse/generate (P7 — D12 hands it the two facts it needs),
> response history (P8), the raw inspector (P9), the timeline (P10), gRPC (P11). Also explicitly
> not here: argument syntax (`{{$randomInt:1,100}}` — D10), a way to pin one generated value across
> two occurrences (§8 OQ-2), any locale but `en`, any seed/determinism control, and any pre-request
> scripting. Nothing is half-built toward any of them (`AGENTS.md`: *"Scope left out of a phase is
> left out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, and the one bundling question was measured
> rather than reasoned about (F5).** Base: branch `claude/feature-v1-2` at `3692813` (*"docs: fill
> in P5's acceptance checklist and real-hardware notes"*), i.e. P5's fifteen commits have landed.
> File:line citations point at that content.
>
> **The one-sentence design.** `resolve()` gains one optional argument — a `(name) => string | null`
> the send path supplies and the live preview does not — and behind it sits a
> `Record<DynamicName, (faker) => string>` in its own lazily-imported chunk, so a `{{$name}}` is
> substituted at each occurrence it appears, freshly, with nothing else in the engine changing.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/frontend/src/http/dynamic/catalog.ts` | **new** — `DYNAMIC_NAMES` (the 58-name `const` tuple), `DynamicName`, `isDynamicName()`, and the memoised `loadDynamicGenerator()` that `await import()`s the lazy half (D4/D5) |
| `apps/kira-studio/frontend/src/http/dynamic/fakerEntry.ts` | **new** — one line: `export { faker } from '@faker-js/faker/locale/en';`. The Http module's own point of contact, because `http/**` may not reach into `views/**` (F4), and it costs no extra chunk (F5) |
| `apps/kira-studio/frontend/src/http/dynamic/generators.ts` | **new** — the lazy half: `Record<DynamicName, (f: Faker) => string>`, one line per name (D4) |
| `apps/kira-studio/frontend/src/http/substitute.ts` | one **optional** fourth parameter, `dynamic?: (name: string) => string | null`, consulted only in the existing `$` branch (D2) |
| `apps/kira-studio/frontend/src/http/state/dynamicValues.ts` | **new** — the reference dialog's open/close state, mirroring `state/fakeData.ts`'s ten-line shape (D11) |
| `apps/kira-studio/frontend/src/http/DynamicValuesDialog.vue` | **new** — the read-only name + live-sample reference list (D11) |
| `apps/kira-studio/frontend/src/http/menus.ts` | one `CollectionMenuActions` member and one background-menu item (*Dynamic values…*) |
| `apps/kira-studio/frontend/src/http/CollectionsPanel.vue` | one `registerCommand('http.dynamicValues', …)` beside the two P5 added (`:78-79`) |
| `apps/kira-studio/frontend/src/views/httprequest/state.ts` | `resolveTabState` gains the same optional parameter and forwards it; `send()` gains D7's short-circuit and the one `await` |
| `apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue` | the chip's warning rule (`:98-115`) — a catalogued `$name` stops being a warning, an uncatalogued one starts saying so; the *"dynamic values arrive in a later phase"* string is deleted (D8) |
| `apps/kira-studio/frontend/src/shortcuts/state.ts` | one palette entry, beside `http.variables`/`http.environments` (`:34-35`) |
| `apps/kira-studio/frontend/src/App.vue` | one `<DynamicValuesDialog v-if=…>` beside the other overlays (`:70-76`) |
| `apps/kira-studio/tests/unit/http-substitution.spec.ts` | three TS-only cases appended below the corpus loop — the callback branch and per-occurrence freshness (§6.2). The corpus JSON itself is **not** edited |
| `apps/kira-studio/tests/ui/http-dynamic-values.spec.ts` | **new** — §6.3 |
| `docs/ARCHITECTURE.md` | the substitution section (`:808-842`) gains its P6 half; the Vite row (`:28`) gains the second entry file with F5's measurement |

**That is the complete list.** Nothing under `internal/**`, nothing under `packages/**`, no
migration, no binding, no mock-runtime channel.

### 0.2 Out of scope, explicitly

- **Any Go change at all.** F9: `Resolve` already classifies `$` and leaves it verbatim, which
  after this phase means "a generator name nobody recognises", and leaving it literal is the same
  honest signal P5 D10 already chose for a secret whose decrypt fails. `internal/httpvars/**`,
  `internal/bridge/**`, `internal/postman/**` and `testdata/substitution.json` are byte-identical.
- **Argument syntax** — `{{$randomInt:1,100}}`, `{{$randomAlphaNumeric:32}}`. Postman has none for
  dynamic variables either (`$randomInt` is a fixed 0–1000). D10 states the consequence for the
  test bar; §8 OQ-3 states the cost if it is ever built.
- **Pinning one generated value across two occurrences.** D3 matches Postman: every occurrence is
  independent. Postman's own answer is a pre-request script, which this app does not have and this
  phase does not add. §8 OQ-2.
- **Any locale but `en`.** P15 D2/F7 chose the `/locale/en` subpath because `en`'s locale data is
  one non-tree-shakeable 415 KB object; a multi-locale surface would multiply that. §8 OQ-5.
- **A seed, a "repeat the last values" control, or any determinism knob.** *"Fresh on every send"*
  is the SPEC row's own wording, and a request sent twice is meant to differ. §8 OQ-6.
- **Substituting a dynamic value into a local file path.** P5 D7 excluded `binaryFile.path` and a
  form-data file row's `path` from substitution entirely; that exclusion is a property of the field
  list, not of the reference kind, so it covers `{{$...}}` unchanged and needs no new rule.
- **Re-expansion.** P5 D17/OQ-3's one-pass rule is unchanged: a stored variable whose *value*
  contains `{{$guid}}` is **not** expanded, in either direction. D6 states why the ordering makes
  that automatic rather than a rule someone has to remember.
- **A dynamic value in a *variable's* value, in the variables dialog.** Same rule, same reason. The
  dialog stores text; the engine expands the request, once.
- **Any new tab kind, op kind, shortcut id, menu template or accelerator.** §3.
- **Any new dependency**, Go or TypeScript (D1).

### 0.3 Ground rules

- **The live preview must never generate.** This is the phase's own invariant and it is checkable:
  §6.3's UI spec asserts the chip renders a `{{$guid}}` request without the value ever changing
  under typing, and §6.5 names it as the most plausible regression this phase could introduce.
- **`http/**` may not import `views/**` or `project/**`** (`biome.json:127-149`, P1 D7). This is
  what forces F4's own `fakerEntry.ts` rather than reusing `views/grid/fakeData/fakerEntry.ts`, and
  F5 is the measurement showing that costs nothing.
- **New test files, per module.** §6.3's spec is its own file. The three unit cases go into
  `tests/unit/http-substitution.spec.ts`, which is already the Http module's own spec for exactly
  this source file — not into `go-ts-vocabulary-parity.spec.ts` (P4's mixed file, untouched since
  P5) and not into `fake-data-recipes.spec.ts` (Studio's).
- **Reuse before invention.** D5 follows P15's own faker-adoption shape — eager names, lazy calls,
  one re-export module — rather than designing a second one, and says where it deliberately
  improves on it (one source of truth for the vocabulary instead of two).
- **Where a Postman claim cannot be verified from a first-party source, it says so** (§8 OQ-1),
  exactly as P5 §8 OQ-1 did for `variable.type: "secret"`.

---

## 1. What the code does today

### 1.1 `$` is already a distinct token kind, checked before any lookup

Verified on both sides, not assumed. `frontend/src/http/substitute.ts:65-85`, in order:

```ts
if (name === '')            { out += span; continue; }              // :65-68
if (name.startsWith('$'))   { refs.push({name, kind:'dynamic'}); out += span; continue; }  // :69-73
if (secrets.has(name))      { refs.push({name, kind:'deferred'}); out += span; continue; } // :74-78
if (Object.hasOwn(values, name)) { … 'resolved' … }                 // :79-83
refs.push({ name, kind: 'unknown' }); out += span;                  // :84-85
```

`internal/httpvars/resolve.go:68-85` is the same `switch`, in the same order. So a `{{$randomEmail}}`
is **never** an `unknown`: the `$` test runs before the values map is consulted at all, which means
a user's `values` could not shadow a dynamic name even if a variable were somehow called `$x`.
`testdata/substitution.json` pins it as a corpus case (*"a $-prefixed name is dynamic, left
verbatim"*, `template: "{{$randomEmail}}"`, `want: "{{$randomEmail}}"`,
`refs: [{name:"$randomEmail", kind:"dynamic"}]`).

The engine is pure and dependency-free on both sides — `substitute.ts` imports nothing, which is
what makes `tests/unit/http-substitution.spec.ts` a plain import (P5 D17).

### 1.2 The send path, and the live preview that shares it

`views/httprequest/state.ts` has three exported pieces this phase touches:

- `resolveTabState(state, values, secretNames)` (`:102-118`) — stage 1 over P5 D7's exact field
  list: `state.url`, each enabled header's name and value, and `substituteBody`'s own per-mode
  fields (`:62-83`). It threads one closure, `sub`, through all of them and accumulates every
  `Reference` it produced.
- `mergedValuesAndSecrets(collectionId, environmentId)` (`:127-145`) — D2's precedence, read from
  the store's cache.
- `send(tabId)` (`:179-…`) — sets `rt.status = 'running'`, computes `collectionId`/`environmentId`,
  calls `mergedValuesAndSecrets` (`:192`), calls `resolveTabState` **synchronously** (`:193`), and
  posts the result through `control.httpSend`.

`HttpRequestView.vue:98-108` calls the **same** `resolveTabState`, over `props.tab.state`, inside a
`computed` — with a comment saying what it is for: *"a live preview of what would actually go out,
without ever sending anything or reaching Go"*. Its filter is
`r.kind === 'unknown' || r.kind === 'dynamic'` (`:105`), and `:112` renders a dynamic one as
`` `${r.name} (dynamic values arrive in a later phase)` `` — a string written to be deleted by this
phase.

`send()` is already `async` and already `await`s a bound call, so an `await` added before
`control.httpSend` costs no new asynchrony at the call site (`onSend` is already `void send(...)`).

### 1.3 v1.1 P15 already adopted faker, and its adoption has a shape worth copying

`@faker-js/faker` is `package.json:47`, exactly `10.6.0`. Four files under
`views/grid/fakeData/` make up the whole adoption, and the split between them is deliberate:

- **`fakerEntry.ts`** — one line, `export { faker } from '@faker-js/faker/locale/en';`, and a
  six-line comment explaining that it exists *"purely to give that cost its own emitted chunk rather
  than folding it into index-*.js"* (`en`'s locale data being one non-tree-shakeable object).
- **`types.ts:6-30`** — `GeneratorId`, a 24-member string union, with its own comment: *"an id, not
  a faker call, so this file (and recipeFor's whole decision table) never imports
  `@faker-js/faker`"*.
- **`recipes.ts:16-41`** — `RECIPE_CATALOG`, one row per id (`{id, label, typeClasses}`), plus the
  name-heuristic table. Eager, no faker import.
- **`generate.ts:19-32`** — the memoised loader (`fakerPromise` at module scope, `getFaker()`), and
  **`fakerCall` (`:77-137`)** — a `switch` over `GeneratorId` returning `() => string`, one case per
  id, **with no `default`**, so `tsc` rejects the file if a union member has no case.

So the answer to *"is there an existing generator-registry/dispatch pattern to follow"* is yes, and
it is: **an eager id vocabulary that never imports faker, a lazy dispatch that does, and a one-line
re-export module between them.** D5 follows it. The one place D5 deliberately does better: P15 keeps
the vocabulary in `types.ts` and the dispatch in `generate.ts`, two files that must be kept in step
(`tsc` does keep them in step, via the exhaustive `switch`) — D5 keeps the same eager/lazy split but
derives the union from the tuple the UI already needs, so there is one list, not two.

Nothing in P15's *vocabulary* is reusable here: `GeneratorId` is dotted faker paths
(`person.fullName`, `location.zipCode`) chosen for a column-type heuristic, keyed to
`TypeClass`, and shaped for a `<select>` in a grid dialog. Postman's `$name` spellings are what a
`{{$...}}` reference has to match (F6/D4), and the two vocabularies overlap only in what they
generate, never in what they are called. Sharing the *dispatch* across both would mean one table
serving two naming schemes and two consumers on opposite sides of the `http/**` ↔ `views/**`
boundary — the coupling P12 exists to remove, bought for nothing.

### 1.4 The bundle has exactly two dynamic chunks, and the module boundary blocks the obvious reuse

`docs/ARCHITECTURE.md:28` states it as a fact about the build: *"Two dynamically-imported chunks as
of P15, still split under Vite 8/Rolldown (P19 C6)"* — the SQL formatter and faker. P5 §6.5 carries
it forward as a must-not-regress, and `docs/PERF.md:1420-1421` records the current sizes.

`biome.json:127-149` is the rule that makes it interesting: `http/**` may not import `**/views/**`
(*"P1 D7: http/ must not import views/ directly"*). `views/grid/fakeData/fakerEntry.ts` is therefore
unreachable from the Http module, so P6 needs a second entry file — and whether that produces a
third chunk is a real, concrete question. F5 measured it.

### 1.5 Go's side of the engine, and why it has nothing to do here

`internal/httpvars/resolve.go` holds `Resolve` (`:41`), `Names` (`:93`) and `ResolveRequest`
(`:156`). `ResolveRequest` is stage 2, called from `bridge/http.go:71-73` **after**
`op.SetCommand` (`:68`), and it early-outs (`:159-168`) when no field carries any `{{` reference at
all, so a request with nothing left to resolve never touches the secrets table. `Resolve`'s `$`
branch (`:71-73`) leaves the reference verbatim and classified `KindDynamic`; nothing downstream
acts on that classification.

---

## 2. Findings

### F1 — The seam P5 promised is real, and it is a token kind rather than a fall-through
§1.1. The brief's own question — *"is `$` already reserved/detected as a distinct token kind, or
does it currently just fail to match a plain `{{name}}` and fall through to unresolved?"* — answers
**reserved and detected**, on both sides, before the values lookup, with a corpus case pinning it.
P6 therefore adds a resolver *behind* an existing branch and touches no scanning, exactly as P5 D17
predicted. This is the finding that makes the phase seven commits rather than twenty.

### F2 — The unresolved chip runs the whole resolution on every keystroke
`HttpRequestView.vue:98-108` is a `computed` over `props.tab.state` calling `resolveTabState`. Vue
re-evaluates it whenever any reactive dependency changes — every character typed into the URL field,
every header edit, every body keystroke. Any generation placed inside `resolveTabState`'s default
path would therefore run on every keystroke, and the value the chip's preview implies would never be
the value the send actually uses. **This is the single most load-bearing finding in the phase**: it
is why D2 makes generation an *optional argument supplied only by `send()`* rather than a capability
of the engine, and why D8 has to re-derive the chip's warning rule from the catalogue instead of
from the resolution's output.

### F3 — faker is already a dependency, already lazy, and already has a dispatch shape
§1.3. `package.json:47`, `10.6.0`, adopted by v1.1 P15 with an eager-names/lazy-calls split and a
one-line entry module. P6 needs no new dependency (D1), no new bundling technique, and no invented
registry pattern.

### F4 — but the Http module cannot import P15's entry file
`biome.json:127-149` restricts `http/**` from `**/views/**`. `views/grid/fakeData/fakerEntry.ts` is
under `views/`. Moving that file to a neutral directory both modules may import was weighed and
declined in D5: a shared one-line dependency re-export would be a new Studio↔Http shared module
created inside the chapter whose stated goal is removing them (P5 D8 declined a shared reveal
composable for the same reason), and it would make `git diff` touch `views/grid/**`, which P5's own
regression list treats as the signal that Studio was disturbed. A duplicated one-line re-export is
the cheaper side of that trade by a wide margin — **provided it costs no chunk**, which is F5.

### F5 — *Measured*: a second faker entry module produces no third chunk, and no byte of change
The question F4 leaves open cannot be settled by reading Rolldown's chunking rules, so it was run.
Baseline (`bun run build`, this tree, unmodified):

```
dist/assets/sqlFormatterEntry-Dtw5O8j2.js    130.74 kB │ gzip:  37.41 kB
dist/assets/fakerEntry-CeVM5OhR.js           415.80 kB │ gzip: 155.46 kB
dist/assets/index-8PWN3-Q1.js              1,392.66 kB │ gzip: 423.22 kB
✓ 729 modules transformed.
```

Then, with a throwaway `frontend/src/http/_probe/fakerEntry.ts` containing only
`export { faker } from '@faker-js/faker/locale/en';` and a `substitute.ts` function doing
`await import('./_probe/fakerEntry')`:

```
dist/assets/sqlFormatterEntry-Dtw5O8j2.js    130.74 kB │ gzip:  37.41 kB
dist/assets/fakerEntry-CeVM5OhR.js           415.80 kB │ gzip: 155.46 kB
dist/assets/index-8PWN3-Q1.js              1,392.66 kB │ gzip: 423.22 kB
✓ 730 modules transformed.
```

**Every chunk name, content hash and size is identical**, main chunk included; only the module count
moves, by one. Repeated with the probe file renamed `dynamicFaker.ts` to rule out name-based
chunking — identical again. Rolldown resolves both dynamic entries to the same locale module and
emits one shared chunk for it; a bare re-export contributes no chunk of its own. The probe was
removed and the baseline build re-run to confirm the tree was left clean.

So D5's own `http/dynamic/fakerEntry.ts` costs **nothing**: `ARCHITECTURE.md:28`'s "two
dynamically-imported chunks" stays literally true, `docs/PERF.md:1420-1421`'s figures stay current,
and P5 §6.5's chunk line survives into §6.5 here unchanged.

### F6 — Postman's own dynamic variables are faker-backed, and Postman says so
[Postman's dynamic-variables reference](https://learning.postman.com/docs/tests-and-scripts/write-scripts/variables-list/),
fetched during planning, states: *"The Faker library enables you to generate sample data in Postman
using predefined variables"*, and identifies the source as the npm package `@faker-js/faker` — the
same package, by name, that `package.json:47` already pins. That is what turns D4 from an invention
into a **mapping**: adopting Postman's `$name` spellings is adopting the names of calls this app can
already make, and a Postman collection whose URL says `{{$randomEmail}}` works here for the same
reason it works there.

### F7 — Postman generates per **occurrence**, not per send — the brief's assumption inverted
The brief asked this to be verified rather than assumed, and verifying it flipped it.

- Postman's own page says the values *"are generated when the request runs"* — generation-time, but
  it does **not** state what happens when one name appears twice. (Fetched; the silence is real, not
  a summary artefact.)
- The [Postman Quick Reference Guide](https://postman-quick-reference-guide.readthedocs.io/en/latest/dynamic-variables.html)
  states it outright: *"If used multiple times, they can return different values per request."*
- The consistently reported behaviour, and the reason
  [postman-app-support#7618](https://github.com/postmanlabs/postman-app-support/issues/7618) exists,
  is that two `{{$guid}}` references in one request yield two different GUIDs — with the documented
  workaround being a pre-request script that generates once and stores the result in a variable.

So the "same value within one send" assumption is **not** Postman's behaviour, and matching Postman
means per-occurrence. D3 takes that, and §8 OQ-1 records that the explicit statement is
third-party rather than first-party, along with the one-`Map` change that would reverse it.

### F8 — A generated value reaches `op_log.command`, and that is correct
P5 F3 established that `op_log.command` is a persisted SQLite column (`repos/ops.go:16-18`) rendered
in the Operations panel, and that resolving *secrets* before `op.SetCommand` would write a plaintext
credential into `kira.sqlite`. `bridge/http.go:68` and `:88` both call `SetCommand` with
`args.Method`/`args.URL`.

The thing to notice, because it decides whether P6 needs to do anything here: **`args.URL` is
already the post-stage-1 URL.** `views/httprequest/state.ts:193` computes `resolved` and passes
`resolved.url` as the wire's `url`, so every non-secret `{{name}}` a user has defined is *already*
substituted in the persisted command today. A generated `{{$guid}}` lands there identically. It is
not a secret, it is exactly what was sent, and a log that recorded `GET /orders/{{$guid}}` would be
strictly less useful than one recording the real id. **No ordering change, no masking, no new rule
— stated explicitly so the implementing session does not go looking for one.** The asymmetry is
also right: a secret shows as `{{token}}` in the op log and a dynamic shows as its value, because
one is a credential and the other is not.

### F9 — Go needs no change, and its `dynamic` branch is already the correct behaviour for what is left
After stage 1, the only `{{$...}}` that can still reach Go is one whose generator name is not in
D4's catalogue (D13) — a typo, or a Postman name this phase deliberately left out. `Resolve`
(`resolve.go:71-73`) classifies it `KindDynamic` and leaves it verbatim; `ResolveRequest` never
resolves it and never fails over it. That is the same treatment P5 D10 chose for a secret whose
decrypt fails: *"leaving the token literal is visible in the response the server gives back, which
is the honest signal."* So the correct Go change is **none**, and `ResolveRequest`'s existing
early-out (`resolve.go:159-168`) even skips the secrets query for a request whose only remaining
references were dynamic ones stage 1 could not name.

### F10 — *Verified safe*: no wire change, therefore no bindings step and no mock-runtime edit
Nothing in §0.1 adds a bound method, a `Deps` field, a struct field or a `packages/shared` type. So:
`apps/kira-studio/frontend/bindings/**` needs no regeneration (P5 C5's mandatory `scripts/setup.sh`
does **not** apply this phase — `AGENTS.md`'s `-names` warning has nothing to bite on);
`tests/ui/support/ipcChannels.ts` and `mockRuntime.ts` gain no channel, no FQN and no
`WILDCARD_DEFAULTS` entry (P5's `variablesList`/`variablesListEnvironments` wildcards already cover
the boot path §6.3's new spec takes); `tests/unit/go-ts-vocabulary-parity.spec.ts` stays
byte-identical for the second phase running.

### F11 — faker 10.6.0's API was probed, not guessed — and two obvious mappings do not exist
Every call in D4's table was executed against the installed
`node_modules/@faker-js/faker@10.6.0` via `@faker-js/faker/locale/en` before being written down.
The probe covered ~140 candidates across every category Postman names. What it caught, which
guessing would not have:

- **`faker.internet.color()` does not exist** — `TypeError: faker.internet.color is not a function`.
  The colour generators live under `color.*` (`color.human()` → `"tan"`,
  `color.rgb({format:'hex'})` → `"#a2c4eb"`).
- **`faker.location.streetName()` does not exist** in 10.x, though `location.streetAddress()`,
  `location.buildingNumber()` and `location.secondaryAddress()` all do. So Postman's
  `$randomStreetName` has no single-call mapping and is excluded.
- **`faker.airline.airport()` returns an object**, not a string (`{name, iataCode}`), so any
  mapping would need a member access — one of several reasons the airline family is excluded.
- **`faker.image.urlLoremFlickr()` is deprecated since v10.1.0 and slated for removal in v11**, and
  prints a deprecation warning when called. Nothing in D4 uses it.
- Everything else in the table returned a plausible value on the first call.

The dispatch is typed `(f: Faker) => string`, so the several calls that return a non-string
(`location.latitude()`, `location.longitude()`, `number.int()`, `datatype.boolean()`,
`internet.port()`) are `String(...)`-wrapped at the call site and `tsc` enforces it.

### F12 — Catalogue↔dispatch drift is a compile error, not a test's job
D5's dispatch is `Record<DynamicName, (f: Faker) => string>` where
`DynamicName = (typeof DYNAMIC_NAMES)[number]` over a `const`-asserted tuple. A name in the tuple
with no entry in the record fails `tsc` with a missing-property error; an entry whose key is not in
the tuple fails with an excess-property error. This is the same guarantee P15 gets from
`fakerCall`'s `default`-less `switch` over `GeneratorId` (`generate.ts:83-136`), and it is why §6.2
adds **no** test for the dispatch table: `bun run typecheck` already cannot pass with it wrong.
`AGENTS.md`'s bar names *"thin pass-through wrappers"* as the category that gets nothing, and a
58-entry map of one-line faker calls whose completeness the compiler proves is squarely that.

---

## 3. Checked, and not fired

- **No `internal/**` change of any kind.** F9. `git diff --stat` must list no `.go` file (§6.5).
- **No `internal/httpvars/testdata/substitution.json` change.** The grammar is unchanged and Go has
  no dynamic branch to pin; TS-only behaviour gets TS-only cases (§6.2).
- **No `packages/shared/**` change.** F10 — no wire shape moves, so no Zod mirror and no
  `HttpRequestWire` field.
- **No bindings regeneration, no `scripts/setup.sh` prerequisite.** F10, and the contrast with P5
  C5 is stated there because it is the one place a session might reflexively run it.
- **No `views/grid/fakeData/**` change.** D5 declines moving `fakerEntry.ts`; P15's four files are
  byte-identical, and `tests/ui/fake-data.spec.ts` and `tests/unit/fake-data-recipes.spec.ts` pass
  unedited.
- **No `TreeHost.vue`, `LeftPanel.vue`, `TitleBar.vue`, `WorkbenchShell.vue` or `ViewChrome.vue`
  change.** D11's one surface is a `DialogFrame` mounted from `App.vue` beside the five already
  there (`App.vue:70-76`).
- **No new `theme/primitives/` component.** `DialogFrame` and `.p-chip`/`.p-row` cover D11 entirely,
  exactly as P5 D11 found for its own four surfaces.
- **No new tab kind and no new op kind.** The reference list is a dialog; the send is the existing
  `"http"` op (`bridge/http.go:59`). P5 F10's whole vocabulary-parity argument carries over
  unchanged.
- **No new shortcut id in the closed map.** One palette entry (`{id:'http.dynamicValues'}`);
  `registerCommand`'s id is a plain `string` (`shortcuts/commands.ts:7`), so
  `packages/shared/domain/shortcuts.ts` is untouched — P4 D15's and P5's own bar.
- **No `menutemplate.go` change, no accelerator.** §0.2.
- **No new dependency.** D1.
- **No `docs/PERF.md` change.** §6.5 explains why the one hot path this phase touches needs no
  budget.

---

## 4. Decisions

### D1 — No new library, and the check rather than the assertion
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Here the library question is mostly already answered — `@faker-js/faker` *is* the
library, adopted in v1.1 P15 and named by the SPEC row itself — so what is left is three narrower
candidates, weighed honestly:

- **A second, smaller random-data library** (`chance`, `casual`) for the handful of non-faker
  generators. Declined against a concrete requirement: the only two names in D4 that faker does not
  produce are `$timestamp` and `$isoTimestamp`, and both are *the current clock*
  (`Math.floor(Date.now() / 1000)` and `new Date().toISOString()`) rather than random values at all.
  A dependency for two expressions that must not be random would be worse than useless.
- **`@faker-js/faker`'s `allFakers` / multi-locale surface**, so `{{$randomFirstName}}` could be
  localised. Declined on P15 D2/F7's own measurement, restated by F5 here: one locale is a
  non-tree-shakeable 415 KB object, and `allFakers` is that cost multiplied by ~70. §8 OQ-5.
- **A template engine** for the substitution. Already declined by P5 D1 on three named requirements
  (HTML-escaping corrupts a substituted `&`/`<`/`"` in a JSON or XML body; the "render or fail"
  contract has no seam for the classified per-reference report; Postman's names are not identifiers,
  so a path-expression grammar is the wrong shape). Nothing about P6 changes any of the three, and
  the engine this phase extends is unchanged in structure.

### D2 — One optional argument on the TS `resolve()`, and Go's signature does not move
`http/substitute.ts` gains an optional fourth parameter:

```ts
export function resolve(
  text: string,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
  dynamic?: (name: string) => string | null,
): SubstitutionResult
```

and the existing `$` branch (`:69-73`) becomes: if `dynamic` was supplied and returns a non-null
string, substitute it and classify the reference **`resolved`**; otherwise behave exactly as today
(classify `dynamic`, emit the span verbatim).

Four properties this buys, each of which was a requirement rather than a nicety:

1. **One scan, one pass, no re-expansion.** A dynamic value is produced *during* the same walk that
   resolves variables, so a generated value is never re-scanned for `{{`, and a variable's value
   containing `{{$guid}}` is never expanded — P5 D17's one-pass rule holds unchanged in both
   directions, with no ordering question to get wrong. A pre-pass or post-pass design would have had
   to answer "which runs first" and would have re-expanded one side's output.
2. **Per-occurrence freshness for free** (D3). The callback is invoked at each occurrence site, so
   two `{{$guid}}` references call it twice. A `Record<string,string>` of pre-generated values —
   the obvious alternative, since that is what `values` already is — would have been per-*name* by
   construction and silently wrong.
3. **The corpus stays byte-identical.** `tests/unit/http-substitution.spec.ts` calls
   `resolve(c.template, c.values, c.secrets)` positionally with three arguments, so every existing
   case runs on the exact path it runs on today, and Go's `Resolve` remains its twin for every case
   in the shared fixture. D18's parity guard is not weakened; it is simply not extended to a branch
   Go does not have.
4. **Go gains no dead parameter.** Adding a resolver argument to `httpvars.Resolve` that nothing
   could ever supply is precisely the half-implementation `AGENTS.md` forbids.

**Why `resolved` and not a fifth kind.** `ReferenceKind` is a four-member union mirrored in Go
(`resolve.go:13-18`) and used by the corpus JSON. A generated reference is, from every consumer's
point of view, *finished* — the text is final and nothing downstream has work to do — which is
exactly what `resolved` already means. A fifth member would have to be added to Go's union too (for
a state Go can never produce), and every consumer would then have to treat it identically to
`resolved` anyway. The information a consumer genuinely needs — *"is this `$name` one we know how to
generate"* — is answered by the catalogue (D8), synchronously, without running the engine at all.

### D3 — Generation is per **occurrence**, not per send, because that is what Postman does
F7 is the evidence: Postman's quick-reference states *"If used multiple times, they can return
different values per request"*, the reported behaviour of two `{{$guid}}` in one request is two
GUIDs, and Postman's own documented workaround for wanting one value twice is a pre-request script —
which would be unnecessary if Postman already pinned per-request.

So `{{$guid}}` twice in one body yields two UUIDs, and the same request sent twice yields four in
total. This falls out of D2's callback with no extra machinery: there is **no memo map**, and adding
one is the entire change if OQ-1 ever needs reversing.

Two consequences, stated rather than left to be discovered:

- **`{{$timestamp}}` twice in one send will usually agree anyway**, because it is the clock in whole
  seconds, not a random draw. That is a property of the generator, not an exception to this rule.
- **There is currently no way to use one generated value in two places** — this app has no
  pre-request scripts, and P5 D17/OQ-3's one-pass rule means storing `{{$guid}}` as a *variable's*
  value does not work either (it would be emitted literally). §8 OQ-2 records that honestly instead
  of pretending the workflow is covered.

### D4 — The vocabulary: 58 names, Postman's own spellings, every call verified against 10.6.0
**The naming scheme is Postman's, not this app's**, and that is the whole point: F6 shows Postman's
dynamic variables are `@faker-js/faker` under a set of `$name` labels, so adopting the labels makes
an imported Postman collection work rather than making it look like it should. P4 built real
Postman-format import/export for the same reason; inventing `{{$faker.internet.email}}` here would
break interop for the aesthetic gain of a tidier namespace.

**The inclusion rule**, applied uniformly: a Postman name is in **iff** (a) `@faker-js/faker@10.6.0`
has a *single* call producing it, verified by execution (F11), and (b) it is plausibly useful in a
URL, header or body of an HTTP request. Everything else is out, and the exclusions are enumerated
below rather than implied.

| Name | Call | Name | Call |
|---|---|---|---|
| `$guid` | `string.uuid()` | `$randomUUID` | `string.uuid()` |
| `$timestamp` | `Math.floor(Date.now()/1000)` | `$isoTimestamp` | `new Date().toISOString()` |
| `$randomInt` | `number.int({min:0,max:1000})` | `$randomBoolean` | `datatype.boolean()` |
| `$randomAlphaNumeric` | `string.alphanumeric()` | `$randomColor` | `color.human()` |
| `$randomHexColor` | `color.rgb({format:'hex'})` | | |
| `$randomFirstName` | `person.firstName()` | `$randomLastName` | `person.lastName()` |
| `$randomFullName` | `person.fullName()` | `$randomNamePrefix` | `person.prefix()` |
| `$randomNameSuffix` | `person.suffix()` | `$randomJobTitle` | `person.jobTitle()` |
| `$randomPhoneNumber` | `phone.number()` | | |
| `$randomEmail` | `internet.email()` | `$randomExampleEmail` | `internet.exampleEmail()` |
| `$randomUserName` | `internet.username()` | `$randomPassword` | `internet.password()` |
| `$randomUrl` | `internet.url()` | `$randomDomainName` | `internet.domainName()` |
| `$randomDomainSuffix` | `internet.domainSuffix()` | `$randomProtocol` | `internet.protocol()` |
| `$randomIP` | `internet.ipv4()` | `$randomIPV6` | `internet.ipv6()` |
| `$randomMACAddress` | `internet.mac()` | `$randomUserAgent` | `internet.userAgent()` |
| `$randomSemver` | `system.semver()` | | |
| `$randomCity` | `location.city()` | `$randomCountry` | `location.country()` |
| `$randomCountryCode` | `location.countryCode()` | `$randomStreetAddress` | `location.streetAddress()` |
| `$randomLatitude` | `location.latitude()` | `$randomLongitude` | `location.longitude()` |
| `$randomDatePast` | `date.past().toISOString()` | `$randomDateFuture` | `date.future().toISOString()` |
| `$randomDateRecent` | `date.recent().toISOString()` | `$randomMonth` | `date.month()` |
| `$randomWeekday` | `date.weekday()` | | |
| `$randomCompanyName` | `company.name()` | `$randomCatchPhrase` | `company.catchPhrase()` |
| `$randomProductName` | `commerce.productName()` | `$randomDepartment` | `commerce.department()` |
| `$randomPrice` | `commerce.price()` | `$randomCurrencyCode` | `finance.currencyCode()` |
| `$randomBankAccount` | `finance.accountNumber()` | `$randomBitcoin` | `finance.bitcoinAddress()` |
| `$randomWord` | `word.sample()` | `$randomWords` | `word.words()` |
| `$randomLoremWord` | `lorem.word()` | `$randomLoremWords` | `lorem.words()` |
| `$randomLoremSentence` | `lorem.sentence()` | `$randomLoremParagraph` | `lorem.paragraph()` |
| `$randomLoremSlug` | `lorem.slug()` | | |
| `$randomFileName` | `system.fileName()` | `$randomFileExt` | `system.fileExt()` |
| `$randomMimeType` | `system.mimeType()` | | |

**58 names.** Each is one tuple entry and one record line; the whole eager half is a list of short
strings (~1 KB in the main chunk) and the whole lazy half is 58 one-line closures inside a chunk
that already exists (F5).

**What is deliberately left out, and why** — Postman's own set is 100+, and the residue is not
arbitrary:

- **The ~17-name image family** (`$randomImageUrl`, `$randomAvatarImage`, `$randomAbstractImage`,
  `$randomCatsImage`, `$randomFoodImage`, …). faker 10 has only `image.url()` and `image.avatar()`;
  every category-specific variant maps onto the same call or onto `image.urlLoremFlickr()`, which is
  deprecated since 10.1 and removed in 11 (F11). Seventeen names for one generator is a vocabulary
  that lies about what it does.
- **The `$randomBs*` / `$randomCatchPhrase*` word-fragment families** (`$randomBsAdjective`,
  `$randomBsBuzz`, `$randomCatchPhraseNoun`, …). faker 10 removed `company.bs*`, and the surviving
  `company.catchPhraseAdjective()`/`buzzPhrase()` produce fragments nobody puts in a request field.
  `$randomCatchPhrase` alone is kept.
- **`$randomArrayElement` / `$randomObjectElement`.** Postman's own return a member of a fixed
  sample array — meaningless without a source the user supplies, which is argument syntax (D10/OQ-3).
- **`$randomStreetName`, `$randomAirport`, and anything else with no single-call mapping.** F11:
  `location.streetName()` does not exist in 10.x, `airline.airport()` returns an object.
- **`$randomDatabase*`, `$randomLocale`, `$randomTransactionType`, `$randomCurrencyName/Symbol`,
  `$randomJobDescriptor/Area/Type`, `$randomIngverb`, `$randomPhrase`, and the `$randomLorem*s`
  plurals** (`$randomLoremSentences`, `$randomLoremParagraphs`, `$randomLoremLines`,
  `$randomLoremText`). Every one of these *does* have a working faker call — they fail (b), not (a).
  They are names a user would have to be told exist before they would ever type one, generating text
  no API contract asks for. `AGENTS.md`'s no-gold-plating rule is the reason they are absent, and
  §8 OQ-4 states exactly what adding one later costs: one tuple entry, one record line, nothing else.
- **`$randomCreditCardMask`.** Postman returns a 4-digit tail; faker's nearest
  (`finance.creditCardNumber()`) is a full number, which is a different thing wearing the same name.
  A name that quietly means something else is worse than a missing name.

**Case-sensitive, exact match.** `{{$randomEmail}}` resolves; `{{$randomemail}}` does not and is
reported as an unknown generator (D13). Postman's names are camelCase and case-sensitive, and a
case-insensitive lookup would make `{{$RANDOMEMAIL}}` work here and fail there.

### D5 — Three files under `http/dynamic/`, following P15's shape with one improvement
Directory placement is the SPEC's module-boundary section read literally: Http-specific frontend
code lives under `frontend/src/http/`, which is where P5 put `substitute.ts`, and this phase adds a
subdirectory rather than four loose files.

**`http/dynamic/fakerEntry.ts`** — one line,
`export { faker } from '@faker-js/faker/locale/en';`, with a comment pointing at F5's measurement
and at `views/grid/fakeData/fakerEntry.ts` as its deliberate twin. **Why a duplicate rather than a
shared module** (F4): the alternative is moving P15's file into a directory both `views/**` and
`http/**` may import — i.e. creating a new Studio↔Http shared module inside the chapter whose stated
goal is removing them, which P5 D8 declined for the same reason over a bigger prize (a shared reveal
composable). It would also make this phase's diff touch `views/grid/**`, which P5 §6.5 treats as the
signal Studio was disturbed. And it buys nothing measurable: F5 shows the second entry costs zero
bytes and zero chunks. If P12 later decides both modules should share one dependency-entry
directory, moving two one-line files is a two-minute change — which is exactly the "mechanical move"
property the boundary section asks for.

**`http/dynamic/catalog.ts`** — eager, imports nothing from faker:

```ts
export const DYNAMIC_NAMES = ['$guid', '$randomUUID', /* …58… */] as const;
export type DynamicName = (typeof DYNAMIC_NAMES)[number];
export function isDynamicName(name: string): name is DynamicName { /* a Set lookup */ }

// The lazy half, memoised at module scope exactly as views/grid/fakeData/generate.ts:19-32 does.
export async function loadDynamicGenerator(): Promise<(name: string) => string | null>
```

`loadDynamicGenerator` is a **dynamic** `import('./generators')`, so nothing about this module being
eager pulls the generators — or faker — into the boot bundle. It returns the callback D2's
parameter takes: a non-`DynamicName` argument returns `null` rather than throwing (D13).

**`http/dynamic/generators.ts`** — the lazy half. Statically imports `./fakerEntry`, and exports:

```ts
export const GENERATORS: Record<DynamicName, (f: Faker) => string> = { … };
```

one line per name, `String(...)`-wrapping the five calls that return a non-string (F11). F12 is why
this needs no test: a name in the tuple with no entry here, or an entry here not in the tuple, is a
`tsc` error.

**The one improvement over P15's shape.** P15 keeps the vocabulary in `types.ts` and the dispatch in
`generate.ts` and relies on an exhaustive `switch` to keep them in step; here the union is *derived
from* the tuple the reference dialog already needs to render, so there is one list in the codebase
rather than two kept equal. Same guarantee, one fewer place to edit.

### D6 — Dynamic generation belongs in stage 1, and Go is not involved
The brief asked this to be settled rather than assumed. The answer is stage 1, the renderer, and it
follows from P5 D6's own reasoning rather than contradicting it:

- **Stage 2 exists for exactly one reason** — *"a secret's plaintext must never reach the
  renderer"* (P5 D5/D6, inheriting v1.1 P14's headline finding). A dynamic value has no plaintext to
  protect, no store to read, no cipher, no gate and no reveal. Every argument for stage 2 evaluates
  to nothing here.
- **Stage 1 is where the dependency is.** `@faker-js/faker` is a root `package.json` dependency
  (`:47`), renderer-only. P5 D6 chose a renderer-side engine *specifically* so that P6 could reach
  it: *"All in Go would put the engine somewhere `@faker-js/faker` cannot reach."* Putting
  generation in Go now would need a Go faker — a new dependency, for a value the renderer can
  produce, contradicting the SPEC row that named the JS package by name.
- **Go's existing behaviour is already right for the remainder** (F9), so there is nothing to
  change even for the failure case.
- **`op_log.command` needs no new rule** (F8): a generated value already travels in `args.URL` the
  same way a resolved variable does, it is not a secret, and the log recording what was actually
  sent is the useful outcome. This is stated as a decision rather than left implicit precisely
  because P5 F3 made the column something every phase now has to think about once.

So the pipeline after this phase reads: **renderer resolves variables *and* dynamics in one pass →
`op.SetCommand` records that text → Go resolves secrets → `httpclient.Send`.** Exactly P5's shape
with one branch filled in.

### D7 — `send()` short-circuits, so a request with no `{{$...}}` pays nothing
`send()` (`state.ts:179-…`) already computes `values`/`secretNames` and calls `resolveTabState`
once. The new shape:

```ts
const first = resolveTabState(tab.state, values, secretNames);          // exactly today's call
const resolved = first.refs.some((r) => r.kind === 'dynamic')
  ? resolveTabState(tab.state, values, secretNames, await loadDynamicGenerator())
  : first;
```

- **The common case is byte-for-byte today's behaviour**: no `await`, no module load, no second
  pass. A request that references no dynamic value never causes the faker chunk to be fetched or
  parsed at all — which matters because that chunk is 415 KB raw (F5) and Send is this mode's most
  common action.
- **The dynamic case costs one extra pass** over a handful of short strings — the identical
  computation the chip already runs on every keystroke (F2), so it is provably affordable, and it
  reuses `resolveTabState` rather than duplicating P5 D7's field walk to answer "does this request
  contain a dynamic reference".
- **The load is memoised at module scope**, so only the first such send in a session pays the parse
  — `views/grid/fakeData/generate.ts:19-32`'s exact technique, for the exact reason.

**Why `$timestamp`/`$isoTimestamp` are not special-cased out of the lazy path**, even though they
need no faker: splitting the dispatch into a clock half and a faker half would mean two code paths,
two lookups and a rule ("does this name need the chunk?") for the sole benefit of skipping one
memoised parse of an already-embedded local module on the first send of a session that used only
those two names. The app already accepts exactly this cost for *Generate data…*. Not worth two
paths.

### D8 — The chip now distinguishes a known generator from an unknown one, and still never generates
F2 forbids the preview from generating, so the chip cannot learn a `$name`'s fate by resolving it.
It asks the catalogue instead — synchronously, with no chunk load:

| Reference | Before P6 | After P6 |
|---|---|---|
| `resolved` | not shown | unchanged |
| `deferred` (a secret) | not shown | unchanged |
| `dynamic`, name in `DYNAMIC_NAMES` | **shown as unresolved**, tooltip *"(dynamic values arrive in a later phase)"* | **not shown** — it resolves at send, like a secret does |
| `dynamic`, name not in `DYNAMIC_NAMES` | shown, same tooltip | **shown**, tooltip *"`<name>` — unknown dynamic value"* |
| `unknown` | shown | unchanged |

Concretely, `:105`'s filter becomes
`r.kind === 'unknown' || (r.kind === 'dynamic' && !isDynamicName(r.name))`, and `:109-115`'s tooltip
mapper loses the "later phase" string and gains the unknown-generator wording. `isDynamicName` is a
`Set` lookup over the eager tuple — no `await`, no chunk, nothing generated, so the preview stays a
pure function of the tab's text exactly as its own comment promises.

`http/**` may be imported by `views/**` (P5 F8, and `HttpRequestView.vue` already imports
`http/state/variables` and `http/substitute`), so importing `http/dynamic/catalog` there is the
same permitted edge.

### D9 — `$timestamp` and `$isoTimestamp` are the clock, and that is a deliberate exception
Postman defines `$timestamp` as *"The current UNIX timestamp in seconds"* and `$isoTimestamp` as the
current time in ISO-8601 UTC. Neither is random, so neither goes through faker: they are
`String(Math.floor(Date.now() / 1000))` and `new Date().toISOString()`. They live in the same
`GENERATORS` record as everything else (D7 explains why they are not split out), with a one-line
comment saying they read the clock rather than the RNG — the one place in that file where a comment
earns its keep under `AGENTS.md`'s rule, because a reader would otherwise wonder why two entries
ignore their `f` argument.

`$randomDatePast`/`Future`/`Recent` are the opposite and *do* go through faker, ISO-formatted with
`.toISOString()` — the same `formatTemporal`-free treatment, since an HTTP body wants a full
timestamp rather than P15's column-type-dependent truncation.

### D10 — No argument syntax, and therefore no new parsing — which decides the test bar
`{{$randomInt:1,100}}`, `{{$randomAlphaNumeric(32)}}` and every other parameterised form are out.

- **Postman has none either.** Its `$randomInt` is a fixed 0–1000, and there is no documented
  argument form for any dynamic variable — so supporting one would be this app's own extension, not
  interop.
- **It would be real parsing.** A separator, an argument list, quoting, escaping, per-generator
  arity and per-generator type coercion — a genuinely new grammar inside the reference name, on top
  of an engine whose whole virtue (P5 D1) is having no expression language.
- **The consequence for tests, stated plainly because `AGENTS.md` asks for it**: with no argument
  syntax there is **no new parsing in this phase at all** — the scanner is byte-identical and only
  the `$` branch's *action* changes. So the parser-shaped test the brief asked about does not apply,
  and the one unit test §6.2 does add is for a different property (per-occurrence freshness), not
  for parsing. If OQ-3 is ever built, *that* phase's argument parser earns a test.

A name carrying a colon or parentheses is simply not in the catalogue, so it lands in D13's path:
left verbatim, flagged by the chip, send proceeds.

### D11 — One discovery surface: a read-only reference dialog, mounted the way P5 mounted its two
A 58-name vocabulary nobody can see is a feature that does not work — no user guesses
`$randomExampleEmail`. So this phase ships exactly one surface, and no more:

**`http/DynamicValuesDialog.vue`** — the existing `DialogFrame` (`width: 480`, `maxHeight: '70vh'`),
a scrollable list of `DYNAMIC_NAMES`, each row showing the reference as it would be typed
(`{{$randomEmail}}`) and **one live sample** generated on open, plus a click-to-copy on the row.
Read-only: nothing here edits, saves, or reaches Go.

- **The sample is the description.** Postman's own docs give each name a sentence; a generated
  example says the same thing more precisely and costs one call to a record the dialog is loading
  anyway. So `catalog.ts` carries *names only*, no description strings, and the eager cost stays
  ~1 KB.
- **The dialog awaits `loadDynamicGenerator()` on open** — a user-initiated action, exactly like
  *Generate data…*'s own first open, and the same memoised promise a send would use.
- **Opened three ways**, all existing seams: the collections panel's background context menu
  (*Dynamic values…*, through `menus.ts`'s existing injected-`CollectionMenuActions` shape), a
  command-palette entry (`{id:'http.dynamicValues', label:'Dynamic values…'}` beside `http.variables`
  at `shortcuts/state.ts:34-35`), and `CollectionsPanel.vue`'s `registerCommand` (`:78-79`) wiring
  the two together. State lives in `http/state/dynamicValues.ts`, a ten-line reactive open flag
  mirroring `state/fakeData.ts`'s own shape.

**The alternative — ship no UI at all and let P13 do it — was weighed and declined.** P13 is a
consistency/polish pass over surfaces that exist, not the phase that invents a missing one, and a
dynamic-values feature whose vocabulary is documented only in a plan file is not shippable. The
counter-pressure (`AGENTS.md`'s no-gold-plating, and the SPEC row asking only for resolution) is why
the surface is one read-only dialog reusing an existing primitive and an existing menu seam, rather
than an autocomplete inside the URL and body editors — which is the genuinely expensive version,
touches CodeMirror, and is handed to P13/§8 OQ-7 instead.

### D12 — What P7 inherits, written down now so it is not rediscovered
P7's SPEC row: *"generate an equivalent curl command … with any `{{variable}}`/`{{$dynamic}}`
reference resolved to its real value in the generated command, since curl itself has no notion of
either."* Three facts, on top of P5 D21's two:

1. **`loadDynamicGenerator()` is the curl generator's resolver too.** `resolve()`'s optional
   parameter is the whole integration; P7 supplies the same callback and gets the same substitution.
2. **A generated curl command is a snapshot, not a template.** D3's per-occurrence rule means the
   command P7 puts on the clipboard freezes one particular draw — running it twice hits the server
   with the same UUID, which is *different* from pressing Send twice in this app. That is inherent
   to curl having no notion of a dynamic value, it is what the SPEC row asks for, and P7 should say
   so in the UI rather than let a user assume the command re-randomises.
3. **A dynamic value in a generated command is not a reveal.** P5 D9/D21 put a *secret* substituted
   into a curl command behind the reveal gate because it turns a credential into visible text. A
   faker-generated value is not a credential and needs no gate — so P7's *Copy as curl* prompts for
   secrets only, never for dynamics.

### D13 — An unrecognised `$name` is left verbatim, flagged, and never fails a send
The three ways to get one: a typo (`{{$randomemail}}`), a Postman name D4 deliberately excluded
(`{{$randomAvatarImage}}`), and an argument form D10 does not parse (`{{$randomInt:1,100}}`).

All three take the same path: `loadDynamicGenerator()`'s callback returns `null`, `resolve()` keeps
its existing behaviour (classify `dynamic`, emit the span verbatim), the chip flags it as an unknown
dynamic value (D8), Go leaves it alone (F9), and **the send proceeds**. Refusing the send would turn
one bad reference into a dead request; leaving the token literal makes it visible both in the chip
before sending and in whatever the server says about it afterwards — P5 D10's own reasoning for an
undecryptable secret, applied unchanged. Nothing throws, nothing is logged per-reference, and there
is no error state to design.

---

## 5. Implementation order

Seven commits. C1–C2 add capability with nothing mounted (each builds and tests on its own); C3–C5
are one user-visible slice each; C6–C7 are the tests and the docs. Per `AGENTS.md`, run the fast
checks (`lint`, `typecheck`, `build`) per commit and the expensive suites once at the end.
**No Go command is needed at any point** (F9), and **no bindings regeneration** (F10).

### C1 — `feat(http): the dynamic-value catalogue and its faker-backed generators`
`http/dynamic/catalog.ts`, `http/dynamic/fakerEntry.ts`, `http/dynamic/generators.ts` (D4/D5).
Nothing calls them yet.
**Guards, both of which are the real proof rather than a formality:** `bun run typecheck` — which is
what enforces catalogue↔dispatch exhaustiveness (F12) *and* type-checks all 58 faker calls against
the installed 10.6.0 types; and `bun run build` — which must still print **exactly two** dynamic
chunks with `fakerEntry-*.js` at F5's baseline size, proving the second entry file cost nothing.

### C2 — `feat(http): resolve {{$name}} through an optional generator callback`
`http/substitute.ts`'s optional fourth parameter and the changed `$` branch (D2), plus §6.2's three
TS-only cases in `tests/unit/http-substitution.spec.ts`.
**Guards: `internal/httpvars/testdata/substitution.json` is unedited, `internal/httpvars/**` is
unedited, and every existing corpus case passes on both sides unchanged** — if either side needed a
change, D2 was not honoured. `bun run test:unit` covers the TS half; the Go half needs no run to
prove a file nobody touched still passes, but running `go test ./apps/kira-studio/internal/httpvars/...`
once here is free and forecloses the question.

### C3 — `feat(http): generate dynamic values on every send`
`views/httprequest/state.ts`: `resolveTabState` gains and forwards the optional parameter, and
`send()` gains D7's short-circuit and the single `await`.
**Guard: `tests/ui/http-request.spec.ts`, `http-request-body.spec.ts` and `http-variables.spec.ts`
pass unedited** — a request with no `{{$...}}` must take a path indistinguishable from today's,
including not loading the faker chunk.

### C4 — `feat(http): the unresolved chip tells a known generator from an unknown one`
`HttpRequestView.vue:98-115`'s filter and tooltip (D8), and the deletion of the *"dynamic values
arrive in a later phase"* string.
**Guard: the chip still generates nothing** — the computed calls `resolveTabState` with three
arguments, never four, and imports only `isDynamicName` from the eager catalogue.

### C5 — `feat(http): a dynamic values reference dialog`
`http/state/dynamicValues.ts`, `http/DynamicValuesDialog.vue`, `menus.ts`'s background item and its
`CollectionMenuActions` member, `CollectionsPanel.vue`'s third `registerCommand`,
`shortcuts/state.ts`'s palette entry, `App.vue`'s mount (D11).
**Guard: `tests/ui/collections.spec.ts` passes unedited** — one added background-menu item must not
disturb P4's own menu assertions; if it does, the assertion was over-tight and the fix belongs in
that spec, deliberately, not silently.

### C6 — `test: dynamic values generated per occurrence, end to end through a send`
`tests/ui/http-dynamic-values.spec.ts` (§6.3), its own file per §0.3.

### C7 — `docs(architecture): faker-backed {{$name}} dynamic values`
`docs/ARCHITECTURE.md`: the `{{name}}`-substitution section (`:808-842`) gains its P6 half — the
`$` form, the 58-name Postman-spelled vocabulary and its inclusion rule, per-occurrence generation
and why it matches Postman, the renderer-only placement and why Go is untouched, and the explicit
note that a generated value does reach `op_log.command` and that this is correct. The Vite row
(`:28`) gains the second entry file with F5's measurement, so the "two dynamically-imported chunks"
sentence stays true and says why a third entry did not become a third chunk.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`
— the Go commands not because anything changed there, but because §6.5 asserts nothing did.

**`scripts/setup.sh` is *not* mandatory this phase**, unlike P5's (F10): no bound service, no
`Deps` field, no wire shape, so `apps/kira-studio/frontend/bindings/**` is unchanged and there is no
`-names` regeneration hazard to guard against. Said explicitly because P5's own §6.1 made it
mandatory and a session working from that precedent would otherwise regenerate for nothing.

**One build check is load-bearing** and must be read from the output rather than assumed: after C1,
`bun run build`'s asset list must show **exactly two** dynamically-imported chunks —
`sqlFormatterEntry-*.js` and `fakerEntry-*.js` — with the latter at F5's baseline (415.80 kB raw /
155.46 kB gzip) and the main `index-*.js` unchanged in size. A third chunk, or faker appearing
inside `index-*.js`, means the eager/lazy split in D5 leaked and the fix is in `catalog.ts` (a
static import where a dynamic one belongs).

### 6.2 The unit tests, and what deliberately gets none
`AGENTS.md`'s bar: a test earns its keep only for *"a parser/splitter with several interacting
rules"*, *"a decision structure too large to hold in your head"* and similar; *"thin pass-through
wrappers"* and *"anything that mostly restates a short function body"* get nothing.

**Gets nothing, for a stated reason:**

- **The 58-entry generator record.** F12: exhaustiveness against the name tuple and the validity of
  every faker call are both *compile* errors, caught by `bun run typecheck`, which runs on every
  commit. A test asserting `GENERATORS['$randomEmail']` returns a string would restate the type. A
  test asserting all 58 return non-empty strings would be a smoke test for a dependency whose API
  the compiler already checks — and would not catch the one drift that matters (a method that still
  exists but changed meaning), which no test can catch either.
- **`isDynamicName`.** A `Set` lookup.
- **The dialog, the menu item, the palette entry, the store's open flag.** CRUD-grade UI wiring;
  §6.3's spec covers the one behaviour that matters.
- **`{{$name}}` *parsing*.** There is none (D10): the scanner is byte-identical and only the `$`
  branch's action changed. Had argument syntax landed, this line would read the other way.

**Earns its keep — three cases appended to `tests/unit/http-substitution.spec.ts`**, below the
corpus loop and clearly separated from it (the corpus is Go↔TS parity; these are TS-only, because
Go has no dynamic branch to be in parity with):

1. **Two occurrences of one name produce two different values.** `resolve('{{$guid}}/{{$guid}}', …)`
   with a counter-backed callback yields two distinct substitutions, and `refs` has two entries.
   This is D3's whole behavioural claim, it is invisible to the type system, and the most natural
   wrong implementation — pre-generating a `Record<string,string>` and merging it into `values` —
   passes every other check while silently producing one value. That is precisely the *"guarding
   something genuinely hard to get right"* the bar asks for.
2. **A callback returning `null` leaves today's behaviour exactly** — span verbatim, classified
   `dynamic` — so D13's unknown-generator path and the no-callback path cannot diverge.
3. **A dynamic reference adjacent to a variable, a secret and an unknown in one string** all resolve
   to their own kinds in one pass, and the dynamic result is classified `resolved` (D2). This is the
   interaction between the five branches, which is the part of the scanner a change to one branch
   can break in another.

Three, not more: `AGENTS.md`'s *"when torn between two similar tests, delete"*.

### 6.3 The new UI spec — `tests/ui/http-dynamic-values.spec.ts`
Its own file (§0.3). `tests/ui` drives the real built bundle in real WebKit with both wire planes
mocked, so it exercises the real lazy chunk load through a real dynamic `import()` — the one tier
that proves D5/D7's split actually works at runtime rather than only at build time. **Four tests:**

1. **A dynamic reference is generated, and reaches the wire.** Open a request tab, set the URL to
   `https://api.example.com/orders/{{$guid}}?t={{$timestamp}}`, press Send. Assert the `httpSend`
   args' `url` matches `/orders/<uuid-v4 shape>?t=<10-digit integer>` — shape, not a fixed value
   (there is no seed and D-nothing promises one). Assert no `{{` survives anywhere in the args.
2. **Per-occurrence freshness (D3).** A body containing `{{$guid}}` twice: assert the two
   substitutions in the sent body are both uuid-shaped and **different from each other**. Then press
   Send a second time and assert all four values are distinct — *"fresh on every send"* and "fresh
   per occurrence" are two claims and this asserts both.
3. **The preview never generates (§0.3's invariant).** With the URL set to `{{$guid}}` and **no**
   Send pressed: assert the unresolved chip is absent (a catalogued name is not a warning, D8), then
   type a character into the header name field and assert the URL field's own text is still the
   literal `{{$guid}}` — the preview must not have rewritten anything — and that **no** bound call
   fired. Then set the URL to `{{$nope}}` and assert the chip appears reading `1 unresolved` with a
   tooltip naming `$nope` as an unknown dynamic value.
4. **The reference dialog lists the vocabulary with live samples.** Open it from the collections
   panel's background menu; assert it renders 58 rows, that `{{$randomEmail}}`'s row shows a sample
   containing `@`, and that closing and reopening shows a *different* sample for `{{$guid}}` (the
   samples are generated, not baked).

No `mockRuntime.ts` or `ipcChannels.ts` change is needed for any of them (F10): the boot path's
`variablesList`/`variablesListEnvironments` wildcards P5 added already cover a tab opened with no
variables fixture, and `httpSend` is an existing channel.

### 6.4 What only a real Mac can settle
Short, because this phase is renderer-only and `tests/ui` runs the real bundle in real WebKit.

1. **The lazy chunk loading through Wails' own `wails://` asset handler** rather than over the
   plain HTTP file server `tests/ui` uses. `AGENTS.md` records that `/wails/runtime` and the custom
   scheme are unreachable from a desktop build on Linux, so no tier here can observe it.
   **Stands in for it:** *Generate data…* already fetches a chunk the identical way in production
   (`views/grid/fakeData/generate.ts`'s `await import()`, shipped since v1.1 P15), and §6.3's tests
   exercise the same dynamic import against the same built asset over http. Nothing about the
   mechanism differs between the two entry modules (F5 shows they resolve to the same chunk).
2. **A real Postman round trip of a collection whose fields carry `{{$randomEmail}}`.** P4 already
   keeps `{{...}}` opaque through the format (`internal/postman/url.go:75-77`'s `containsVariable`,
   and `roundtrip_test.go:635`'s `"host": ["{{baseUrl}}"]` assertion), and this phase changes no
   import/export code at all, so the expected answer is "unchanged".
   **Stands in for it:** the existing round-trip tests, unedited and green.
3. **Whether Postman really is per-occurrence** (F7/§8 OQ-1) — settleable only against the real
   product, by putting `{{$guid}}` twice in one request and reading the two values.
   **Stands in for it:** two third-party sources agreeing, plus the existence of Postman's own
   pre-request-script workaround, which would be unnecessary if it pinned per request.

### 6.5 What must not regress
- **Go is byte-identical.** `git diff --stat` for this phase must list **no `.go` file and no file
  under `internal/**`** — the strongest form of P5's own "Studio renders identically" line, and the
  direct check on F9/D6.
- **`internal/httpvars/testdata/substitution.json` is byte-identical**, and every existing corpus
  case passes unchanged on both sides (D2's property 3).
- **Studio renders identically.** Nothing under `project/**`, `views/grid/**`, `views/console/**`,
  `packages/**` or `apps/kira-studio/frontend/bindings/**`. **`views/grid/fakeData/**` in
  particular is untouched** — D5 declined moving P15's entry file, so if that directory appears in
  the diff, F4's decision was reversed without saying so.
- **These specs pass unedited:** `tests/ui/http-variables.spec.ts` (all five of P5's),
  `credential-reveal.spec.ts`, `mode-switch.spec.ts`, `http-request.spec.ts`,
  `http-request-body.spec.ts`, `collections.spec.ts`, `fake-data.spec.ts`, and
  `tests/unit/fake-data-recipes.spec.ts`.
- **`tests/unit/go-ts-vocabulary-parity.spec.ts` is byte-identical** — second phase running, per
  §0.3's no-new-debt rule.
- **`bun run test:ipc:fe` passes unedited** — no data-plane, adapter or fixture change.
- **The live preview generates nothing.** The single most plausible regression this phase can
  introduce (F2). Checked three ways: §6.3's third test; `HttpRequestView.vue` calling
  `resolveTabState` with three arguments and never four; and `http/dynamic/generators` appearing in
  no static import chain reachable from the boot bundle (which the build's chunk list proves).
- **The bundle keeps exactly two dynamic chunks**, `fakerEntry-*.js` stays at 415.80 kB raw /
  155.46 kB gzip, and `index-*.js` grows only by this phase's own app code (F5 measured all three).
- **No file under `http/**` imports `views/**` or `project/**`** — `bun run lint` is the check, and
  F4 is the reason it could plausibly have been violated this phase.
- **`NOTICES.md`, both `package.json`s and `go.mod` are unchanged** — D1.
- **`docs/PERF.md` gains no budget and needs none.** The one path on a hot surface is the chip's
  preview, whose cost is unchanged (a `Set` lookup replaces a string comparison); `send()`'s dynamic
  branch is a second linear pass over a handful of short strings, only when a dynamic reference is
  present, on a user-initiated action that already awaits a network round trip.
- **No new plaintext-secret sink.** P5's own check, restated because this phase touches the send
  path: `git grep secret_value` must still show it only in `migrations/0007_p5_variables.sql`,
  `repos/variables.go` and `model/variables.go`.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — the three files under `http/dynamic/` land; `bun run typecheck` proves catalogue↔dispatch
      exhaustiveness and all 58 faker calls; `bun run build` still prints exactly two dynamic chunks
      with `fakerEntry-*.js` at F5's baseline size.
- [ ] C2 — `resolve()`'s optional parameter lands; the shared corpus JSON and `internal/httpvars/**`
      are unedited and both sides still pass every existing case; the three TS-only cases are green.
- [ ] C3 — a request with no `{{$...}}` takes today's exact path (no `await`, no chunk load); a
      request with one resolves it; the three existing http specs pass unedited.
- [ ] C4 — a catalogued `$name` is no longer a warning; an uncatalogued one says so; the chip still
      calls `resolveTabState` with three arguments.
- [ ] C5 — the reference dialog opens from all three entry points and lists 58 names with live
      samples; `collections.spec.ts` passes unedited.
- [ ] C6 — `http-dynamic-values.spec.ts`'s four tests, each passing twice in a row; nothing appended
      to `http-variables.spec.ts` or the mixed parity spec.
- [ ] C7 — `docs/ARCHITECTURE.md` updated (the `$` form and its vocabulary, per-occurrence
      generation, renderer-only placement, the `op_log.command` note, and the Vite row's second
      entry file).
- [ ] §6.1's full command set green at the end, not just per-commit — including
      `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...` run precisely to
      show nothing there moved.
- [ ] §6.5's regression list verified item by item, with the `git diff --stat`-shows-no-`.go`-file
      check done explicitly.
- [ ] §6.4's three real-hardware/real-Postman steps — record what was done instead of each.

---

## 8. Open questions, handed forward

**OQ-1 — Postman's per-occurrence behaviour is documented third-party, not first-party.** F7: the
explicit statement (*"If used multiple times, they can return different values per request"*) is the
Postman Quick Reference Guide's, not Postman's own; Postman's own page says only that values *"are
generated when the request runs"*. Everything else points the same way (the reported two-different-
GUIDs behaviour, and the existence of a documented pre-request-script workaround that would be
pointless otherwise), and §6.4 step 3 settles it against the real product. If it turns out to be
per-request after all, the fix is contained and named: a `Map<string,string>` inside
`loadDynamicGenerator()`'s returned closure, created per send, with **no** grammar change and no
change to `substitute.ts` — the callback shape is what makes both behaviours one line apart.

**OQ-2 — There is no way to use one generated value in two places.** D3's direct consequence, and
the same gap Postman has; Postman's answer is a pre-request script, which this app does not have.
P5 D17/OQ-3's one-pass rule closes the obvious workaround too (a variable whose value is
`{{$guid}}` is emitted literally). The cheap version, if anyone asks: a second reference form —
`{{$$guid}}`, say — meaning "generate once per send and reuse", which is OQ-1's `Map` plus one
grammar character and a corpus decision about whether Go must know about it. Not built now because
nobody has asked and Postman does not have it either.

**OQ-3 — No argument syntax** (D10). `{{$randomInt:1,100}}` and `{{$randomAlphaNumeric:32}}` are the
two anyone would want first, and Postman has neither. Building it means a real grammar inside the
reference name — separator, quoting, per-generator arity and coercion — on top of an engine whose
whole virtue is having no expression language, and it would need to be decided whether Go's twin
parses it too (it would have to, or the two scanners diverge on what a *name* is). If it is built,
that phase's parser earns a dedicated test; this one's does not.

**OQ-4 — Names outside the 58** (D4). The excluded set is enumerated with reasons rather than
hand-waved, and the ones excluded on usefulness rather than on faker's API (`$randomDatabase*`,
`$randomLocale`, the `$randomLorem*s` plurals, `$randomJobDescriptor`, …) are one tuple entry plus
one record line each, with `tsc` refusing a half-done addition. The rule for adding one is D4's own
(a single verified faker call, plus a plausible use in a request), and the trigger should be a real
user asking, not a completeness urge.

**OQ-5 — `en` only.** `$randomFirstName` is always an English-locale name (P15 D2/F7: one locale is
a non-tree-shakeable 415 KB object; `allFakers` is that × ~70). If localisation is ever wanted, the
contained shape is a per-collection or per-environment locale setting plus a per-locale dynamic
import — which turns one lazy chunk into one-per-used-locale and needs a real measurement before it
is chosen.

**OQ-6 — No seeding, and therefore no reproducible send.** *"Fresh on every send"* is the SPEC's own
wording and D3 takes it literally, so there is no way to replay a request with the values it used
last time. P15 has `faker.seed()` and exposes it (`generate.ts:213-221`), so the mechanism exists —
but the natural home for "what exactly did that request send" is **P8's response history**, which
stores the request as sent, rather than a seed control here. Worth revisiting when P8 lands, not
before.

**OQ-7 — Discovery stops at a reference dialog.** D11 ships one read-only list; Postman offers
inline autocomplete as you type `{{$` in a URL or body. That is the genuinely useful version and it
is also the expensive one: it touches the URL field and CodeMirror's own completion source, which is
`AutocompleteField.vue`/editor territory rather than `http/`'s. Handed to P13 (the Api-module UI
pass) as a candidate, with the note that it would want the same catalogue module and no new data.

**OQ-8 — P5's OQ-10 now has a second, stronger reason to exist.** P5 recorded that nothing shows a
request's *resolved* form before it is sent, and that a preview would be the one surface where a
secret becomes visible text (hence a reveal). Dynamic values add a different obstacle: a preview of
`{{$guid}}` would necessarily show a value that is **not** the value the send uses (F2/D3), so an
honest preview would have to either say "a fresh value will be generated here" or lie. Both P5 OQ-10
and P7's *Copy as curl* (D12) hit this, and all three should be settled together.

**OQ-9 — A faker major bump will remove methods.** F11 already found two names that no longer exist
in 10.x (`internet.color`, `location.streetName`) and one deprecated-since-10.1 slated for removal
in 11. `bun run typecheck` catches every such removal at build time, at the exact line, which is why
§6.2 adds no test — but a session doing the next dependency bump should expect D4's table to need
edits, and should re-run a probe against the new version rather than assume a compiling call still
means the same thing.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/substitute.ts` *(the one engine change in the phase — an optional fourth parameter and one branch's action, D2)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/dynamic/generators.ts` *(new — D4's 58 verified mappings, the lazy half)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/dynamic/catalog.ts` *(new — the eager vocabulary the chip reads without loading faker, and the memoised loader)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/state.ts` *(D7's short-circuit: the common send must stay exactly as fast and as chunk-free as it is today)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue` *(F2's live preview — the one place a mistake mints values on every keystroke)*
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/grid/fakeData/generate.ts` *(read, copied in shape, and not changed — P15's memoised lazy-import pattern, `:19-32`)*
- `/home/user/kira-studio/apps/kira-studio/internal/httpvars/resolve.go` *(read, and deliberately not changed — F9: its `dynamic` branch is already the right behaviour for what stage 1 leaves behind)*
