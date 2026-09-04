# P4b — Removing the Electron host, keeping the seam that made it possible

Plan for a **scope reduction**, not for one of `docs/SPEC.md` §10's numbered phases. It sits
between P4 and P5 and is numbered `P4b` for that reason: P0–P11 describe what v1 builds, and this
unit of work removes something P3 already built. Written before implementation per `AGENTS.md`.

**The directive, verbatim:** *"Update the plan to drop any Electron support… it should be modular
so that in the future it could run [again]."*

**What that means concretely, and it is two things, not one:**

1. The standalone Electron desktop app stops being a shipped target of v1. `packages/host-electron`
   and everything that exists only to build, test, theme or package it is deleted.
2. **The port-per-capability architecture stays exactly as it is, on purpose.** Not one line of
   `packages/core/src/ports` changes, not one line of `packages/host-vscode` changes, not one line
   of `packages/ui` or `packages/ipc`'s `Transport` changes. Adding Electron back later — or adding
   a different host entirely — must be *"implement these twelve interfaces again"*, never
   *"restructure `core` and `ui` first"*.

This is not an architectural rewrite. It is removing one of two implementations of an interface
set, and it is small precisely because the interface set was there.

---

## Why the seam stays, stated plainly

`docs/SPEC.md`'s hard constraint C1 currently reads *"The whole app must run in a plain Electron
shell with no VS Code present"* — an Electron requirement is what forces every VS Code API touch
behind a port today. Delete the requirement naively and the constraint has no stated justification
left, and the next person to read the spec reasonably concludes the ports are dead weight and
starts inlining `vscode` calls into `packages/ui`. That would be the actual damage of this change,
and it is the one thing the user explicitly asked us to prevent.

So C1 is **reworked, not deleted**, and the justification is rewritten to the three things that
are true today with no second host in the tree:

- **The harness is a real second consumer, running on every commit.** `apps/harness` mounts the
  identical `packages/ui` against a mock bridge in a plain browser with no host present at all.
  That is not a speculative future host — it is the Playwright suite's primary target (§8.4), and
  it only works because `core`/`ipc`/`ui` compile and run with no host API reachable from them.
  The seam is exercised continuously, not maintained on faith.
- **A narrow, named boundary is worth having for its own sake.** Twelve small interfaces with one
  implementation each is a legible surface: it is the complete list of what the app asks of its
  environment, it makes each capability independently fakeable in unit tests (`ports/testFakes.ts`
  exists for exactly this), and it keeps `packages/ui` from growing host-shaped assumptions that
  are painful to unpick later.
- **A future host is then an addition, not a rewrite.** This is the user's stated requirement and
  it is worth writing down as a checklist rather than a sentiment. A new host is: a `Transport`
  implementation, one file per port under its own `packages/host-<name>/src/ports/`, an entry that
  mounts `packages/ui` unchanged, and a build target. Nothing to the left of that boundary moves.

Both the plan and the SPEC rewrite (W8) must carry this reasoning. A future reader of `SPEC.md`
has to be able to see *why* the seam exists when only one host uses it, or the seam will not
survive the next person who tidies up.

**What is deliberately not preserved:** the Electron *implementations* themselves. Keeping
`packages/host-electron` around unbuilt, untested and unshipped would be exactly the
half-implemented scope `AGENTS.md` forbids, and D24 already set the precedent for this project
(no l10n scaffolding carried for a future that may not come). The interfaces are the seam; the
adapters are not. Re-adding Electron means writing those adapters again — and `docs/plans/P3.md`
stays in the tree as an accurate, unedited record of how they were written the first time.

---

## Scope boundary

**Removed:**

| | |
|---|---|
| `packages/host-electron/` | the whole package: main process, `BrowserWindow`, menu, recent-repos store, `MessagePortMain` channel, preload `contextBridge`, renderer entry, and the six Electron port adapters with their unit tests |
| `scripts/gen-theme-palettes.ts` | exists solely to emit `packages/host-electron/src/theme/palettes.generated.css` |
| `tests/e2e/electron/` | `shell.spec.ts`, the `_electron.launch` suite over our own build |
| the `electron` Playwright project | `playwright.config.ts`; `harness` and `vscode` stay |
| two of `scripts/build.ts`'s four bundles | `dist/electron/main.js`, `dist/electron/preload.cjs` |
| the `renderer` input of `packages/ui/vite.config.ts` | one Vite build, one entry |
| `electron@43.4.1` | the only real Electron dependency in the tree |
| `"electron"` as a `HostKind` | in both `packages/ipc/src/contract.ts` and `packages/core/src/settings/schema.ts` |
| `kiraVersion.theme.kind` | the one Electron-only setting, and with it `SettingDef.hosts` |

**Untouched, and this is the point of the exercise:**

| | |
|---|---|
| `packages/core/src/ports/*` | every interface stays byte-identical except for doc comments that name Electron as an example implementation (W4) |
| `packages/host-vscode/` | except two doc comments that point at `host-electron` paths (W2) |
| `packages/ui/` | except two doc comments and one literal that only existed because of the Electron host (W2, W4) |
| `packages/ipc/src/transport.ts` | the `Transport` interface is the transport half of the seam and does not change |
| `apps/harness/` | except one stale comment pointing at the deleted generator (W3) |
| `packages/core`, `packages/git` | no behaviour change anywhere |
| `docs/plans/P0.md` … `P4.md` | **never edited.** They are the record of what was built, including what this unit of work removes. Removal, not history-rewriting |

**Also verified as needing no change:** `docs/design/panel-mockup.html` contains no Electron,
desktop or standalone references at all — it draws the panel inside a VS Code window and always
did. `README.md`, `AGENTS.md` and `resources/` likewise have zero hits. This was checked at
planning time against the current tree; W10 re-checks it rather than trusting this sentence.

**Explicitly *not* removed:** `@vscode/test-electron` (root `devDependencies`) and the
`_electron.launch` calls in `tests/e2e/vscode/panel.spec.ts`. Those drive **VS Code's own Electron
binary** — VS Code is an Electron app — which is a different thing from our deleted standalone
shell and is how the `vscode` Playwright tier works at all (§8.4). Deleting them by string-match
would delete the VS Code integration suite. Read the import before touching any line matching
`electron`.

---

## Ordering

| # | Work item | Depends on |
|---|---|---|
| W1 | Delete `packages/host-electron/` and its workspace wiring (`tsconfig.json` solution reference) | — |
| W2 | Build pipeline: `scripts/build.ts` down to two bundles, `packages/ui/vite.config.ts` down to one entry, and the two `host-vscode` comments that coordinate with the deleted paths | W1 |
| W3 | Delete `scripts/gen-theme-palettes.ts`, its two `package.json` scripts and its `check` link; re-comment `gen-lane-palette.ts` and the harness's `themeSwitcher.ts` | W1 |
| W4 | `HostKind` and settings: drop `"electron"` from both unions, delete `kiraVersion.theme.kind` and `SettingDef.hosts`, fix the tests and the three UI/core doc comments that name Electron | W1 |
| W5 | Biome boundaries: delete the `packages/host-electron/**` override, keep and re-word the repo-wide `electron` import ban | W1 |
| W6 | Playwright: delete `tests/e2e/electron/`, drop the `electron` project and its `webServer` comment, fix the two `vscode`/`support` spec comments | W1, W4 |
| W7 | `bun install` — drop `electron@43.4.1` from `bun.lock`; confirm `@vscode/test-electron` survives | W1 |
| W8 | `docs/SPEC.md` §1–§3: the product goal, C1, §2.1/§2.1.2, the new §2.2, the §3.1 tree, §3.2's topology, §3.3's ports table, §3.4's theming, §3.5's transports — **including the modularity rationale as spec prose** | W1–W7 |
| W9 | `docs/SPEC.md` §7.11, §8, §9, §10's P3/P11 rows, §11's D5/D6/D13/D15/D26, §12 | W8 |
| W10 | Docs sweep: `docs/plans/README.md`, and a re-verification that `docs/design/`, `README.md`, `resources/` and `AGENTS.md` genuinely need nothing | W8, W9 |
| W11 | Verification pass: `check`, `test`, `build`, `test:e2e`, `test:perf`, plus the residual-`electron` grep | all |

W1 first is not a formality: several later items (W4's `HostKind`, W5's biome override, W2's build
targets) would break the typecheck or the lint if they landed while `packages/host-electron` still
compiled against them.

---

## W1 — Delete the package

```
packages/host-electron/          entire directory, 26 files
tsconfig.json                    remove { "path": "packages/host-electron" } from references
```

The root `package.json` needs **no** workspace edit — `workspaces` is `["packages/*", "apps/*"]`,
a glob, so removing the directory removes the member. Confirm this rather than assuming it: after
W7's `bun install`, `bun pm ls` (or the lockfile) must no longer list `@kira-version/host-electron`.

The deleted unit tests (`channel.test.ts`, `recentRepos.test.ts`, `kiraBridge.test.ts`, and the
five `ports/*.test.ts`) go with their subjects. They are not being "skipped" — their subjects no
longer exist, so `bun run test`'s count drops and that drop is expected, not a regression. Record
the before/after count in Findings so the next reader can see the arithmetic.

## W2 — The build pipeline

**`scripts/build.ts`:**

- Remove the `electron main` and `electron preload` entries from `BUN_TARGETS`. One target remains
  (`vscode extension`); keep the `BunTarget` shape and the loop rather than inlining the single
  case — the loop is what makes the second host a data addition.
- Remove the `text.includes("electron")` clause from `checkUiHostAgnostic()`. The literal it
  guarded against cannot be produced any more (W4 deletes the last source of it), and a check for a
  string that no longer has a source is noise, not safety. **Keep the `require("vscode")` clause** —
  that one is live and is the mechanical half of C1. Update the function's doc comment, which
  currently explains at length why `renderer.js` is allowed to say `host: "electron"`.
- Update the file's header comment ("P3 needs four… three Bun bundles") and the final
  `"build: all four bundles produced"` message. There are now two build outputs: the UI (Vite) and
  the VS Code extension bundle.

**`packages/ui/vite.config.ts`:**

- Drop the `renderer` input. `webview` is the only entry.
- **Keep `root` at `packages/` and keep `base: "./"`.** Both are now justified differently than the
  header comment claims, and the comment must be rewritten to say so honestly — but neither value
  should change in this unit of work. `root` was pushed up to `packages/` to be a common ancestor
  of both entries; it is also simply a correct root for a build whose source is
  `packages/ui` + `packages/host-vscode`, and moving it down to `packages/host-vscode` would change
  every manifest key and force a matching edit in `html.ts`'s `WEBVIEW_ENTRY` and in the visual
  baselines' asset paths — churn with a real breakage risk, bought for nothing. `base: "./"` is
  inert for the webview path (`html.ts` renders its own document and reads the manifest only for
  hashed filenames) and harmless. Say exactly that in the rewritten comment; do not leave a comment
  standing that explains these values by an entry that no longer exists.

**`packages/host-vscode/src/html.ts`:** two doc comments reference `host-electron` paths — the
`dist/` layout note (`RENDERER_HTML_PATH` reaches `dist/ui` the same way) and the `WEBVIEW_ENTRY`
manifest-key note (which explains `root: packages/` by the renderer entry). Rewrite both to match
W2's actual reasoning. `KIRA_REPO`'s comment also contrasts with Electron's `loadFile` query — trim
to the VS Code half.

**`packages/host-vscode/src/extension.ts`:** the `Storage`-not-constructed-here comment names
Electron's recent-repos as `Storage`'s only P3 consumer. That is still a true statement about P3,
but it now reads as a pointer to code that is gone. Reword to state the live fact — `ports/storage.ts`
is written and has no VS Code caller yet — without citing the deleted package.

## W3 — The theme-palette generator

`scripts/gen-theme-palettes.ts` writes exactly one artifact, into `packages/host-electron`. It
goes, and with it:

- root `package.json`: the `gen:theme-palettes` and `check:theme-palettes` scripts, and
  `check:theme-palettes` from the `check` chain.
- `scripts/gen-lane-palette.ts`'s header carries a three-sentence paragraph explaining that the
  single literal fallback governs Electron because `gen-theme-palettes.ts` cannot see contributed
  colour ids. **The literal fallback chain itself stays** — it is what makes
  `packages/ui/src/theme/vscode-tokens.css` legible when a `--vscode-*` variable is absent, which
  is the harness's everyday situation. Only the Electron half of the explanation goes; the
  fallback's own justification has to survive the edit, so rewrite rather than delete the paragraph.
- `apps/harness/src/themeSwitcher.ts`'s header says its hand-written dev palette is a stand-in
  "until generated-from-VS-Code palettes (`scripts/gen-theme-palettes.ts`) land later". That
  generator is not landing. The harness's palette is now simply the harness's palette — a
  deliberate, permanent, hand-maintained dev fixture. Say that.

Check `scripts/check-tokens.ts` for any dependency on the generated file before deleting (planning
grep found none; verify).

## W4 — `HostKind`, the settings schema, and the literals they leaked into

**The unions.** `"vscode" | "electron" | "harness"` becomes `"vscode" | "harness"` in both
`packages/ipc/src/contract.ts` and `packages/core/src/settings/schema.ts`. These are two structural
copies of the same type (B3 forbids `core` importing `ipc`), kept honest by
`tests/unit/ipc/wireConformance.test.ts` — they must change in the same commit, and that test is
the thing that proves they did.

Note what stays: `HostKind` remains a *union*, with two members. The concept "which shell mounted
this bundle" is load-bearing (`app.init` reports it; `gitBlockedCopy.ts` reasons about it) and is
part of the seam. Adding a member back is a one-token change.

**The setting.** `kiraVersion.theme.kind` — *"Electron shell theme. VS Code's own theme is VS
Code's business."* — is deleted. It is the only setting with a `hosts` clause.

**`SettingDef.hosts` goes too, and this is a judgment call worth stating.** With the only scoped
setting gone, `hosts` and the `if (def.hosts !== undefined && !def.hosts.includes("vscode")) continue;`
filter in `toVsCodeConfiguration()` have zero consumers. `AGENTS.md` forbids carrying
half-implemented scope, and D24 already refused l10n scaffolding on precisely this reasoning. Ten
lines re-added when a second host brings a host-scoped setting is an addition, not a rewrite — the
same standard the rest of this plan is held to. **Remove it.** (The alternative — keep the field
because `harness` is still a `HostKind` and could scope a setting — was considered and declined: no
such setting exists, and inventing one to justify the mechanism would be manufacturing scope.)

Consequences to verify rather than assume:

- `bun run check:settings` must stay green **without regenerating** `packages/host-vscode/package.json`.
  `kiraVersion.theme.kind` was already excluded from the contributed configuration by its own
  `hosts` clause, so the generated output is byte-identical. If it is not, stop and understand why
  before regenerating.
- `packages/core/src/settings/schema.test.ts`'s `toVsCodeConfiguration` test is titled *"has one
  property per non-electron-only setting"* and asserts `kiraVersion.theme.kind` is absent. Rewrite
  it to "one property per setting" and drop the absence assertion, which no longer has a subject.
- `tests/integration/transportContract.test.ts` builds its handlers with `host: "electron"` and
  asserts `app.init` echoes it. Change both to `"vscode"`. The test is about the RPC round-trip,
  not about the host, so this is a fixture change with no loss of coverage.

**The three doc comments that name Electron as an example implementation:**

- `packages/core/src/ports/{dialogs,fileWatcher,storage,logger,workspaceRoots,theme}.ts` — six
  headers, each of the form "…VS Code's `Memento`, or a JSON file under Electron's `userData`".
  These are the most sensitive edits in this work item, because they are where a reader learns the
  port is an *interface with implementations* rather than a VS Code wrapper with extra steps.
  **Do not simply delete the second clause.** Reword each so the interface's independence from any
  one host survives: name VS Code's implementation as *the* implementation today, and where the
  original comment used the second host to show what varies, keep that shape by naming the fake
  (`ports/testFakes.ts`) or the harness instead — both are real, present, second implementations.
- `packages/ui/src/state/viewState.ts` — two comments enumerating "the three hosts choosing an
  implementation at mount". There are two now (VS Code's `getState`/`setState` and the harness's
  in-memory store). Update the count and the list; the enumeration itself is worth keeping, since
  it is the clearest statement in `packages/ui` that the UI does not know which host it is in.
- `packages/ui/src/components/gitBlockedCopy.ts` — "only the host *kind* — vscode/electron/harness".
  Two-item list now.
- `apps/harness/src/sessionViewStateStore.ts` — "a VS Code/Electron webview's `getState`/`setState`".
  Trim to VS Code.

**`packages/ui/src/App.vue`'s `FALLBACK_PAGE_SIZE`.** A five-line comment explains that
`defaultSettings()` is *not* imported because the settings schema carries the literal
`hosts: ["electron"]`, which `scripts/build.ts`'s bundle check forbids in the shared UI chunk — so
`5000` is duplicated by hand instead. W2 and this work item together delete both halves of that
constraint. **Replace the literal with the imported default** (`SETTINGS["kiraVersion.graph.pageSize"].default`
or `defaultSettings()`, whichever reads better at the call site) and delete the comment with it.
This is a real de-duplication the removal unlocks, not opportunistic refactoring: a hand-copied
default that drifts from its schema is a live bug the comment itself apologises for. Gate it on
`bun run build` staying green — `checkUiHostAgnostic()` still runs over the shared chunk and must
still pass.

## W5 — The import boundaries

`biome.json` mentions `electron` on twelve lines:

- **Delete** the `"includes": ["packages/host-electron/**"]` override block — the one exception that
  let that package import `electron`.
- **Delete** the `"@kira-version/host-electron"` entries from `core`/`ipc`/`git`/`ui`'s
  `noRestrictedImports` maps (B3's "nothing depends on a host" list). The remaining
  `@kira-version/host-vscode` entries carry the rule.
- **Keep** the plain `"electron"` bans — now with no override anywhere, so the module is banned
  repo-wide. This is deliberate and is part of the seam, not a leftover: it states mechanically
  that a host runtime API is reachable only from a host package, and a future
  `packages/host-electron` would re-earn its access with its own override exactly as
  `packages/host-vscode` does for `vscode` today. Rewrite the message, which currently reads
  *"Only packages/host-electron may import 'electron'"* and would otherwise point at a package that
  does not exist — something like *"No package imports 'electron': v1 ships no Electron host. A
  future host package would get its own override, as `host-vscode` has for `vscode` (§1.2 C1,
  §2.2)."* Every message also cites `§3.1 C1`; C1 lives in §1.2, and W8 rewrites it — fix the
  cross-reference while here.

## W6 — Playwright and the e2e tier

- Delete `tests/e2e/electron/` (`shell.spec.ts`, 137 lines).
- `playwright.config.ts`: remove the `electron` project and its comment. Two projects remain:
  `harness` and `vscode`. The `webServer` block's trailing comment explains that it "only ever
  starts a server the `electron`/`vscode` projects don't reach" — still true of `vscode` alone;
  update the enumeration. The header comment ("Three projects declared, only `harness` runnable in
  P0") is a P0-era statement that is now doubly stale; rewrite it to describe the two projects that
  exist and what each drives.
- `tests/e2e/vscode/panel.spec.ts` — **read carefully before editing.** Its `_electron.launch` and
  `@vscode/test-electron` imports drive VS Code's own binary and **stay**. What must change are the
  comments: one explains that this file mirrors `electron/shell.spec.ts` (deleted), one explains
  that `kiraVersion.theme.kind` is excluded from the contributed configuration because of
  `hosts: ["electron"]` (a setting deleted in W4 — check whether the assertion around that comment
  needs to go with it), and two more reference "the Electron spec's own update"/"the Electron
  spec's first test" as the source of a piece of reasoning. Where a comment cites the deleted spec
  as authority for something, restate the reasoning here rather than dropping the pointer and
  leaving an unexplained line.
- `tests/e2e/support/generateRepo.ts` — "every Electron/VS Code spec's module graph". Trim.

## W7 — Dependencies

Run `bun install` after W1. Expected: `electron@43.4.1` (the only Electron dependency, declared in
the deleted `packages/host-electron/package.json`) leaves `bun.lock`, and
`@kira-version/host-electron` stops being a workspace member. **`@vscode/test-electron@3.1.0` must
remain** in the root `devDependencies` — it downloads and drives VS Code for the `vscode` Playwright
tier and has nothing to do with our removed shell. Commit the lockfile change; note the removed
package count in Findings.

## W8 — `docs/SPEC.md`, §1 through §3

This is the substantive documentation work, and it is where the modularity rationale has to land in
a form a future reader will actually encounter.

**Preamble (lines 3–5).** *"…the same application must run unmodified as a standalone Electron
desktop app"* is the product goal that this whole unit of work retracts. Replace with a statement of
what is true: a VS Code extension rendering into the bottom panel, built as a host-agnostic core
and UI behind narrow capability ports, of which VS Code is the one host implemented today. The word
"unmodified" is worth keeping in some form — that the UI bundle is host-agnostic is still a fact
about the build, and the harness proves it daily.

**§1.2 C1.** The constraint stays; its statement and its justification change. Suggested shape,
which the implementer should improve rather than transcribe:

> | C1 | Every host capability the app needs is a narrow port in `packages/core/src/ports` (§3.3); no host API is reachable from outside its own host package. | Zero `import * as vscode` outside `packages/host-vscode`, enforced by lint rule and a build-time import check. `core`, `git`, `ipc` and `ui` therefore compile and run with no host present at all — which is what makes `apps/harness` a real Playwright target rather than a stub (§8.4, C4), what makes each capability independently fakeable in unit tests, and what makes a second host an addition rather than a rewrite (§2.2). |

C4 currently reads *"This falls out of C1 for free"* — still true under the reworked C1, and the
relationship is now the *reason* C1 is worth keeping rather than a side effect. Say so.

**§2.1 (line ~64).** "…so it behaves identically in Electron" — the detail pane is a column inside
the webview for reasons that survive (it is not a separate VS Code view, so the panel owns its own
layout at every breakpoint). Restate the reason without the Electron clause.

**§2.1.2 (line ~91).** *"Today that is exactly two places - Git binary discovery (§4.2) and Electron
packaging (P11)."* One place now: Git binary discovery. The paragraph's point — platform-conditional
code sits behind named strategies with unimplemented platforms as explicit failing cases — is
unchanged and stays.

**§2.2 — rewrite the section, keep the slot.** Currently "Electron", describing
`packages/host-electron`. It becomes the home of the modularity rationale, under a heading like
**"A second host is an addition, not a rewrite"**. It must say, in the spec's own voice:

- v1 ships one host: local desktop VS Code (§2.1.1, D6).
- An Electron shell *was* built at P3 and removed when the standalone desktop app left v1's scope.
  Cite `docs/plans/P4b-remove-electron.md`, and note that `docs/plans/P3.md` remains in the tree as
  the unedited record of how it was built — this document does not pretend it never existed.
- The port seam that host required is kept deliberately, for the three reasons in this plan's
  "Why the seam stays" section: the harness is a live second consumer, a named boundary is worth
  having on its own, and re-adding a host must be implementation rather than restructuring.
- **What adding a host actually costs, as a list**, so the claim is checkable: a `Transport`
  implementation (§3.5), one file per port under `packages/host-<name>/src/ports/` (§3.3's table
  gains a column), an entry that mounts `packages/ui` unchanged, a build target in
  `scripts/build.ts`, a Biome override granting that package its host module, and a Playwright
  project. Nothing in `core`, `git`, `ipc` or `ui` changes. For Electron specifically, add back
  what P4b deleted: main process and window, a preload `contextBridge`, a renderer HTML entry, a
  palette source for the `--vscode-*` variables VS Code would otherwise inject, and packaging.

**§3.1's normative tree.** Remove the `packages/host-electron/` subtree and
`scripts/gen-theme-palettes.ts`. Update three annotations: `playwright.config.ts`'s *"projects:
harness (fast), electron, vscode"*, `packages/ui/vite.config.ts`'s *"one build, two entries
(webview + Electron renderer)"*, and `tests/integration/`'s *"real git + real hosts (electron,
vscode)"*. The tree is normative and later phases fill it in rather than reorganising it — so it
must match the tree W1–W7 leave behind, exactly.

**§3.2's topology diagram.** `┌─ host process (extension host | electron main) ─┐` → `extension
host` alone. Keep the box: "host process" as a labelled boundary is the diagram's whole point, and
it is where a second host would slot in.

**§3.3's ports table.** Drop the `Electron impl` column; **keep the table's shape**. Add a lead-in
sentence making the shape explicit — one column per shipped host, v1 ships one, a second host adds a
*column* here (and a directory under `packages/`) and changes nothing to the left of it. Head the
remaining column with the package it lives in (`VS Code impl — packages/host-vscode/src/ports`).
The row set is unchanged: all twelve ports stay, including `Secrets`, whose only listed Electron
implementation was `safeStorage` — a port with one implementation is still the app's complete
statement of what it needs from a host.

The paragraph below the table — *"`EditorIntegration` is the one port whose Electron implementation
is genuinely different…"* — needs care, because it is load-bearing beyond Electron. **The in-app
read-only unified diff view stays a v1 deliverable**: §6.4 makes clicking a file open its diff
in-panel the pane's primary interaction, and D13/D14 both rest on it. Only its *justification*
changes: it exists because it is the primary interaction and keeps both the port's contract and the
panel's flow satisfiable, not because it "avoids an Electron feature hole". "Open in editor" via
`vscode.diff` remains the VS Code addition on top.

**§3.4.** Delete the *"The Electron side"* paragraph wholesale (its subject, the generator, is gone
in W3). The token layer's own justification is unaffected and stays. Add one sentence in its place
noting what the fallback chains in `vscode-tokens.css` are for now that nothing else injects
`--vscode-*`: they are what makes the UI legible in the harness, and they are what a future host
would sit on top of. Do not overclaim — the harness supplies a small hand-written dev palette
(`apps/harness/src/themeSwitcher.ts`), not a complete one; describe that accurately.

**§3.5.** *"in Electron it is `ipcRenderer.invoke` + `MessagePort` for streams. Both implement the
same `Transport` interface."* Rewrite so the `Transport` interface's role survives the loss of its
second implementer: the contract is defined once in `packages/ipc`, VS Code's transport is
`webview.postMessage`, and a host supplies a `Transport` rather than a protocol.

## W9 — `docs/SPEC.md`, §7 through §12

- **§7.11 — "The Electron gap, stated plainly."** Delete the paragraph. But two things in it must
  survive relocation, so read before cutting: (a) the sentence that `EditorIntegration` exposes
  conflict resolution as an **optional capability the UI feature-detects rather than assumes** —
  that is a real design property of the port and belongs in §3.3 or in §7.11's remaining prose; and
  (b) the fallback affordances it describes (abort, continue, open in the system editor, read-only
  hunk view) are the behaviour any host without a merge editor gets. Keep the *statement* that the
  banner's Resolve action is a VS Code capability the port advertises, not a hard requirement of
  the port. §7.11's VS Code delegation flow is otherwise unchanged.
- **§8.1.** The bullet *"Electron likewise runs Node, not Bun — same rule"* goes. The rule itself
  (no `Bun.*`, no `bun:` in shipped code) is unchanged and is already stated for the extension host
  above it. Note if useful that VS Code's extension host *is* Node inside Electron, which is why
  the rule was never really about our own shell.
- **§8.4.** In the Integration-suite paragraph, delete *"Under Electron this is Playwright's
  `_electron.launch` directly."* The VS Code sentence stays verbatim in substance — Playwright
  driving the downloaded VS Code build through the webview frame, with `@vscode/test-electron` for
  extension-host-level tests. Make sure the surviving text does not read as though `_electron.launch`
  is gone from the repo; it is still how the `vscode` project launches VS Code.
- **§8.6.** Remove `electron-builder` from the toolchain list.
- **§9.** Two entries change: *"a built-in three-way merge editor for the Electron build"* — the
  Electron-only framing is gone; what remains deferred is a built-in conflict resolver, which under
  VS Code is genuinely unnecessary (D15). Consider whether the entry survives at all now that VS
  Code's native merge editor covers every shipped host, and if it does not, say plainly in §12 that
  it was resolved by the scope change rather than silently dropping it. The *side-by-side diff*
  entry's justification cites *"the Electron minority"* — rewrite to the surviving reason ("Open in
  editor" already gives VS Code users a native side-by-side view).
- **§10 phasing table.** Two rows. **P3**: drop "Electron shell booting the same bundle" and
  "Electron palette generation from VS Code theme JSON" from the deliverable, and "Electron app
  shows the same" from the exit criteria. **P11**: drop `electron-builder` from the deliverable and
  "a signed, notarized macOS build" from the exit criteria (the `.vsix` is not notarized). Because
  P3 is complete and this edit changes what its row claims it delivered, **add a short note under
  the table** recording that P3 originally also delivered a standalone Electron shell, removed by
  P4b, with `docs/plans/P3.md` kept as that work's record. The table is the map of scope; the note
  is what keeps it from also being a lie about history.
- **§11 decisions.** D5 (Theme) — drop *"Electron wears the same variable names, generated from VS
  Code's own theme JSON."* D6 (Supported hosts) — becomes *"Local desktop VS Code."*, and should
  carry a pointer to §2.2 for why the host seam outlives the second host; this is the decision row a
  future reader checks first. D13 — drop "the Electron minority". D15 — drop "The Electron build is
  deliberately weaker and gets a resolver in v2". D26 (Licensing and distribution) — **the Apple
  Developer account and notarization requirement goes with the Electron build**; MIT plus
  Marketplace and OpenVSX publishing stay, and the row should say the notarization cost was retired
  by the scope change rather than just deleting the sentence, since it was flagged as a
  decide-before-P11 item and someone will look for it.
- **§12.** *"A built-in conflict resolver for the Electron build (D15)"* — remove or restate per the
  §9 decision above.

## W10 — The rest of `docs/`

- `docs/plans/README.md` says the directory holds phase plans "one per phase (P0–P11)". It now also
  holds this one. One sentence.
- Re-run the sweep this plan ran at planning time (`grep -rniE 'electron|standalone desktop'` over
  `docs/design/`, `README.md`, `resources/`, `AGENTS.md`) and confirm zero hits. If the tree has
  moved since and there are hits, they belong here, not in a later work item.
- `docs/plans/P0.md`–`P4.md`: **no edits.** If a genuine contradiction between a historical plan and
  the current tree bothers you, it goes in this plan's Findings, not in that plan's text.

## W11 — Verification

The whole point of the exercise is that removing a host is small and that nothing else moved. The
verification has to show both.

1. `bun install && bun run check` — green. Note that `check` is now a six-step chain
   (`check:theme-palettes` is gone).
2. `bun run test` — green. The count drops by the deleted `host-electron` unit tests; record
   before/after.
3. `bun run build` — produces the UI bundle and `dist/vscode/extension.js`, and **nothing under
   `dist/electron/`**. Delete any stale `dist/electron/` from a previous build before running, so a
   leftover directory cannot be mistaken for a fresh one.
4. `bunx playwright test --project=harness` — green, all specs, including the visual baselines. No
   baseline should need regenerating: nothing in `packages/ui`'s rendered output changes in this
   unit of work. **If a baseline does shift, stop** — something in W2 or W4 changed the UI bundle in
   a way this plan did not intend.
5. `bunx playwright test --project=vscode` — expected to remain blocked in this sandbox (the VS Code
   download is blocked; P0's and P3's V3, carried forward by P4). Carry it forward as
   inherited-open with the closing command, per the precedent P4's Findings set. Note the one real
   improvement: the `electron` project's standing pre-existing failure (P4's Findings — 8 of 10
   `.slick-row`s under Xvfb) is retired by deletion rather than left as permanent noise, and there
   is now no third project to explain away.
6. `bun run test:perf` — unchanged expectations. Nothing in this unit of work touches a hot path;
   any movement is sandbox noise and should be attributed as such, against P4's recorded figures.
7. **The residual grep.** `grep -rniE 'electron' --include='*.ts' --include='*.vue' --include='*.json'
   --include='*.css' --include='*.html' --include='*.md' .` (excluding `node_modules`,
   `docs/plans/P0..P4.md` and `bun.lock`) must return only:
   - `@vscode/test-electron` and `_electron.launch` in `tests/e2e/vscode/panel.spec.ts` and root
     `package.json` — VS Code's own binary,
   - `biome.json`'s deliberate repo-wide ban messages (W5),
   - `docs/SPEC.md`'s §2.2 and §10 note, and this plan — the deliberate record of what was removed
     and why the seam stayed.

   Anything else is an incomplete edit. Paste the surviving list into Findings; it is the artifact
   that proves the removal was complete rather than approximately complete.
8. **The seam check, by inspection and by diff.** `git diff --stat` must show **zero** changes under
   `packages/core/src/ports/*.ts` other than doc comments, and zero changes to
   `packages/ipc/src/transport.ts`. State this explicitly in Findings with the file list — it is the
   evidence that the user's actual requirement (removing a host does not restructure the app) held.

---

## Exit criteria

Complete when all of the following hold, verified by running them:

- [ ] `packages/host-electron/`, `scripts/gen-theme-palettes.ts` and `tests/e2e/electron/` do not
      exist; `electron` is not in `bun.lock`; `@vscode/test-electron` still is.
- [ ] `bun install && bun run check && bun run test` green; `bun run build` produces two build
      outputs and no `dist/electron/`.
- [ ] `bunx playwright test --project=harness` green with **no regenerated visual baselines**.
      `--project=vscode` in its unchanged, documented sandbox-blocked state, carried forward with
      the closing command.
- [ ] `bun run test:perf` at parity with P4's recorded figures, with any delta attributed.
- [ ] The residual-`electron` grep returns only the deliberate survivors listed in W11.7, and that
      list is recorded in Findings.
- [ ] `packages/core/src/ports/*` changed in doc comments only; `packages/ipc/src/transport.ts`,
      `packages/host-vscode/src/ports/*`, `apps/harness/src/mockBridge.ts` and every `packages/ui`
      component unchanged in behaviour. Diff stat recorded.
- [ ] `docs/SPEC.md` describes a one-host application: no §2.2 Electron section, no `Electron impl`
      column, no `electron-builder`, no notarization requirement, no Electron gap in §7.11, and a
      §3.1 tree that matches the tree on disk exactly.
- [ ] **`docs/SPEC.md` states why the port seam exists with only one host** — in the reworked C1 and
      in the new §2.2 — including the explicit claim that adding a host back is implementing the
      port interfaces again, not restructuring `core` or `ui`, and a checkable list of what that
      would involve. This is the user's direct requirement and is the one criterion that cannot be
      satisfied by deletion alone.
- [ ] `docs/plans/P0.md`–`P4.md` are byte-identical to their state at `ce36d5a`.

---

## Judgment calls this plan made

Recorded here so the implementer knows which lines were decided rather than derived, and can
overrule one with a reason rather than by accident:

1. **`SettingDef.hosts` is removed, not kept** (W4). Zero consumers once the Electron-only setting
   goes; re-adding is ten lines. The competing argument — `harness` is still a `HostKind` — has no
   setting behind it today.
2. **`packages/ui/vite.config.ts` keeps `root: packages/` and `base: "./"`** (W2). Both are now
   justified differently than their comment claims, and the comment is rewritten; the values are
   not, because changing `root` would move every manifest key and force matching edits in
   `html.ts` and the built asset paths for no benefit.
3. **The repo-wide `electron` import ban in `biome.json` stays** (W5), with no override anywhere.
   It reads as a rule about a module nobody imports; it is kept as the mechanical statement that
   host runtimes live in host packages, which is the seam this whole unit of work exists to protect.
4. **`scripts/build.ts`'s UI-bundle `"electron"` substring check is dropped** (W2) while the
   `require("vscode")` check stays. The dropped one can no longer have a source; the kept one can.
5. **`App.vue`'s `FALLBACK_PAGE_SIZE` literal is replaced by the schema default** (W4). This is a
   behaviour-neutral de-duplication that only became possible because the constraint forcing the
   copy was removed — the kind of stale workaround `AGENTS.md` asks us to prune while we are here,
   not opportunistic refactoring.
6. **§10's P3 row is edited and annotated rather than left alone** (W9). §10 is the map of scope, so
   it must describe the tree that exists; the annotation under the table is what keeps that from
   misrepresenting what P3 actually shipped.
7. **The in-app unified diff view is explicitly *not* in scope for removal** (W8, §3.3). It reads
   like an Electron accommodation in the current text and is not one — §6.4, D13 and D14 all depend
   on it. Its justification is rewritten; the deliverable is untouched.

---

## Findings

_Recorded during implementation — the residual-`electron` grep, the diff stat proving the ports
and the VS Code host did not move, the test-count arithmetic, suite status at hand-off, and any
decision made at the keyboard that this plan did not anticipate. Later phases read this section as
part of the context they inherit; P5 in particular inherits a one-host tree and should not look for
`packages/host-electron`._
