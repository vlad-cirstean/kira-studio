# P273 plan: memory text formats: code comment and doc file, grep first

Ask (SPEC row P273, user requirements): facts and reasons short, per `CLAUDE.md` "Communication
style"; gate rewrites them without changing meaning. Strict comment format: atomic facts, each with
reason and nanoid, citing others only by id. `store_memory` flag that runs split, challenge and
wording, persists nothing, returns code comments. Doc format over `.md`/`.txt`: metadata header for
grep, then facts with id and reason; re-ingests by parse alone (P274). Both formats grep-first: one
field per line, fixed prefixes, ids as plain tokens, no Markdown markup in text, no per-fact
boilerplate. One regex per format. Validator usable as a git hook in any repo, legacy comments not
flagged, with install instructions. Parser and validator unit tested.

Base: `v2.0` at `ccf3b8e80` (P272 close-out). Discovery ran through `codegraph_explore` (store
pipeline `Service.Store`/`validateRequest`/`runGate`/`validateGate`/`prepare`/`reconcile`/`commit`;
`mcpserver.Build`/`storeSchema`/`requestFor`/`storeMemory`/`renderStore`/`writeMemory`/
`renderContext`; registry gate, reconcile and MCP entries; argv dispatch and binaries
(`memorycli.Run`, `flowharness.Main`, `checkprompts`); MCP install and settings UI
(`mcpinstall.StdioCommand`, `ClaudeCodeMcpSection.vue`, `queries.ts`, `@shared/domain/memory`)),
plus targeted reads of `apps/kira-space/internal/appwire/wire.go` (not indexed), `memorycli/run.go`,
`bridge/memory.go`, `MemoryPane.vue`, `memoryflow` tests and `tests/claude/memory_gate_test.go`.

Out of scope (decided): caller-supplied ids on store, ingest by path, doc write-back and
idempotent re-ingest (P274); ranking and score parts (P275); full rewrite of MCP instructions and
descriptions (P276). P273 adds only the text the new flag and formats need.

## 1. Today (line numbers at base)

- `internal/memory/service.go:268` `Store`: `normalizeItems`, `validateRequest` (:211), semaphore,
  `runGate`, challenge returns early, `work` per gate fact, `prepare` + `reconcile`, `commit` per
  work with `requestGroups` (:343). `StoreResult{Status, Challenges, Outcomes}` (:99).
- `gate.go:52` `runGate` sends items, clarifications, related memories; `validateGate` (:88) trims
  and bounds facts. Prompt `memory.gate.system` (`registry.go:194`) step 1 says "Otherwise keep the
  author's wording". No style rule anywhere.
- `reconcile.go:70` `prepare` (hash noop, candidates), `:133` `reconcile` (one call, `checkDecision`
  grade guard). Prompt `memory.reconcile.system` (`registry.go:249`).
- `mcpserver/server.go:68` `Build`; `storeInput` (:22) items, clarifications, session, groups;
  `requestFor` (:174); `storeMemory` (:206); `renderStore` (:227); `writeMemory` (:278) prints
  `- km_x v2 user project:...: fact` plus `  reason: ...`; `renderContext` (:290). P272 §2.9 named
  P273 as the owner of these text formats.
- `ids.go`: `FactIDPattern` `\bkm_[0-9a-hjkmnp-tv-z]{12}\b`, group ids `kg_` + 12, `newFactID`.
- Binaries: Space `main.go:44` and `flowharness.Main` call `appwire.RunArgvShim` (`wire.go:47`):
  `askpass`, `memory-mcp`, `memory-embed`. Bridge `McpStatus` (`bridge/memory.go:359`) shows
  `mcpinstall.StdioCommand(name, exe, ["memory-mcp"])`; Settings > Memory (`MemoryPane.vue`) mounts
  `ClaudeCodeMcpSection.vue` (command card plus copy) and `SemanticModelSection.vue`.
- No comment or doc format, no non-persisting store, no validator exists.

## 2. Design (all decisions final)

### 2.1 Fact style (gate rewrite)

- `memory.gate.system` step 1 changes from "keep the author's wording" to a rewrite rule:
  one claim per fact, one sentence, about 20 words max, active voice, present tense where true; cut
  filler, hedges (just, really, basically, actually, simply) and pleasantries; drop articles only
  where meaning stays clear. Keep exactly: negations (not, never, no, only, except), numbers, units,
  names, code identifiers, paths, error strings, ids. Reason gets the same treatment. Plain text: no
  Markdown, no backticks, no line breaks. Cite another memory or doc only by its id (`km_...`,
  `kg_...`), never by pasting its text. Never change meaning; when a shorter form could change it,
  keep the original words. Why: SPEC (1); `CLAUDE.md` rules, clarity wins over compression.
- `memory.reconcile.system`: one added sentence: "fact" and "reason" of an update or add follow the
  same short plain style; merged reasons stay one or two sentences. Why: an update writes text the
  gate never saw.
- `validateGate` and `checkDecision` collapse internal whitespace runs (newlines included) to one
  space in fact and reason. Why: every format is one field per line; Go enforces what the prompt asks.
- No Go length cap beyond `MaxFactLen`/`MaxReasonLen`. Why: meaning beats length; the prompt steers.

### 2.2 Shared line grammar (both formats)

- A fact is a fixed line block. Each line: `<fact id> <field>: <text>`.
  - `km_7h3kq9x2mfa4 fact: Billing API listens on port 9090 in production.`
  - `km_7h3kq9x2mfa4 reason: Deploy manifest changed in March release; see km_2b8c4d6f8g0h.`
  - Docs only, optional third line: `km_7h3kq9x2mfa4 keywords: billing, port, deploy`.
- Id leads every line. Why: `grep km_7h3kq9x2mfa4` returns the whole fact; `grep ' fact: '` lists
  facts; no line needs its neighbour to be found.
- Field names `fact`, `reason`, `keywords`: same terms as the store and the gate. Why: one term per
  concept.
- Text: single line, non-empty, starts with a non-space character, no trailing space.
- No inline markup pairs in text: `**x**`, `__x__`, `*x*`, `_x_` at word edges, `` `x` ``, `~~x~~`,
  `[x](y)`, `<tag>`. Lone `*`, `_` inside words (`snake_case`, `*.go`) stay legal. Why: a phrase grep
  must match the raw line; markup between words breaks it (SPEC 5).
- Citations: any token starting `km_` or `kg_` in text must be a full id. Why: a malformed id
  greps to nothing.
- No version numbers in any format. Why: the fact id is stable across versions (P272).

### 2.3 Comment format

```
// kira-memory origin=user scope=project
// km_7h3kq9x2mfa4 fact: Billing API listens on port 9090 in production.
// km_7h3kq9x2mfa4 reason: Deploy manifest changed in March release.
// km_2b8c4d6f8g0h fact: Staging deploys at 09:00 UTC.
// km_2b8c4d6f8g0h reason: Release calendar fixes it.
```

- Block = one header line, then 1 or more fact/reason pairs, contiguous lines, same marker, same
  indentation. Block ends at the first line that is not a fact or reason line.
- Header: `kira-memory origin=<user|agent|external> [source=<tag>] scope=<company|project|personal>`,
  keys in that order, `source` present only for external. Why: provenance once per block, not per
  fact; `kira-memory` greps every memory comment and doc in a repo.
- No project key in comments: the repository is the project. No session: sessions are transient.
  Why: no boilerplate that the file location already says.
- No keywords line in comments. Why: code comments stay minimal; docs carry search aids.
- Facts with different provenance go in separate blocks, each with its own header.
- In scope (validator): a comment line whose text after the marker starts with `kira-memory ` or
  `km_`. Every other comment is legacy and never flagged. Why: self-marking lines need no
  file-level opt-in; prose that mentions an id mid-sentence stays legal.

Per-language markers (by extension, base name for `Dockerfile`, `Makefile`):

| Marker | Files |
|---|---|
| `//` | go, ts, tsx, mts, cts, js, jsx, mjs, cjs, java, kt, kts, scala, groovy, swift, rs, c, h, cc, cpp, hpp, cs, dart, php, zig, proto, jsonc, scss, less |
| `#` | py, sh, bash, zsh, fish, rb, pl, r, yaml, yml, toml, tf, hcl, ex, exs, nim, ps1, cmake, mk, Dockerfile, Makefile |
| `--` | sql, lua, hs, elm |
| `;` | clj, cljs, el, lisp, scm, ini |
| `%` | erl, tex |
| `<!-- ... -->` per line | html, xml, svg |
| `/* ... */` per line | css |
| `//` or `<!-- ... -->` | vue, svelte |

- Wrapped markers wrap each line (`<!-- km_x fact: ... -->`), one space inside each delimiter.
- Text may not contain the closer (`-->`, `*/`); in xml and svg text may not contain `--` (XML forbids
  it in comments). Why: the comment must stay a comment.
- Unlisted extension: not scanned; `asComment` refuses it with the supported list. Why: a guessed
  marker can break the file.

Comment regex (one line, ERE subset valid in Go RE2 and `grep -E`):

```
^[[:space:]]*(//|#|--|;|%|<!--|/\*) (kira-memory origin=(user|agent|external source=[a-z0-9-]{1,32}) scope=(company|project|personal)|km_[0-9a-hjkmnp-tv-z]{12} (fact|reason): [^[:space:]].*)$
```

Matches every line of a valid comment block. Block rules (§2.6) need the parser.

### 2.4 Doc format

```
---
kira-memory: 1
group: kg_4m9xq2c7v8ab
title: Billing deploys
origin: external
source: confluence
scope: project
project: github.com/acme/billing
keywords: billing, deploy, release
updated: 2026-10-12
---

## Ports

km_7h3kq9x2mfa4 fact: Billing API listens on port 9090 in production.
km_7h3kq9x2mfa4 reason: Deploy manifest changed in March release.
km_7h3kq9x2mfa4 keywords: billing-api, port, production

km_2b8c4d6f8g0h fact: Staging deploys at 09:00 UTC.
km_2b8c4d6f8g0h reason: Release calendar fixes it.
```

- Front matter fenced by `---` on line 1 and after the last field. Second line `kira-memory: 1`
  (format version). Why: GitHub renders front matter as a table (human second); `key: value` lines
  grep; line 1-2 mark the file in scope.
- Fields, fixed order, each at most once:
  - `kira-memory` required, `1`.
  - `group` required: the doc id, a `kg_` id; P274 creates the document group under it. Other facts
    and docs cite the doc by it. Why: P272 groups already carry `kg_` nanoids; one id kind per doc.
  - `title` required, one line.
  - `origin` required; `source` required for external, forbidden otherwise.
  - `scope` required; `project` required for scope project, forbidden otherwise. Docs travel, so
    the project is explicit (once per file).
  - `session` optional, agent or user docs only.
  - `keywords` optional, comma-separated, file-level.
  - `updated` optional, `YYYY-MM-DD`.
  - No list of fact ids in the header. Why: each fact line already carries its id; a list drifts.
- Header values: one line, no `: `, no ` #`, not starting with a YAML indicator
  (`[{&*!|>'"%@` or `` ` ``). Why: the table must parse as YAML on GitHub without quoting rules.
- One provenance per doc. Why: a doc is one source; per-fact provenance would be per-fact
  boilerplate. Mixed provenance means two docs.
- Body allows only: blank lines, Markdown headings `#`-`######` plus space plus text, fact blocks.
  Why: parse-only re-ingestion (P274) must lose nothing; free prose would need an LLM.
- Fact block: fact line, reason line, optional keywords line, contiguous, same id. Blocks separated by
  at least one blank line or a heading. Why: rendered Markdown shows one paragraph per fact.
- The nearest heading above a fact is its section (parsed, not stored by P273).
- `.md` and `.txt` share the format. A `.md`/`.txt` file is in scope only when line 1 is `---` and
  line 2 is `kira-memory: 1`. Why: legacy docs never flagged.

Doc regex (every line of a valid doc matches):

```
^(---|kira-memory: 1|(group|title|origin|source|scope|project|session|keywords|updated): [^[:space:]].*|km_[0-9a-hjkmnp-tv-z]{12} (fact|reason|keywords): [^[:space:]].*|#{1,6} [^[:space:]].*|)$
```

### 2.5 Package `internal/memory/memfmt`

Pure Go, no I/O, no import of `internal/memory` (memory imports it).

- `IDPattern` source strings: `FactID` (`km_[0-9a-hjkmnp-tv-z]{12}`), `GroupID` (`kg_` + same).
  `internal/memory/ids.go` builds `FactIDPattern` and `factIDExact` from them. Why: one definition.
- `CommentLine`, `DocLine`: the two regexes of §2.3 and §2.4, exported as `*regexp.Regexp` and as
  source strings (validator `--print-regex`).
- Types: `Provenance{Origin, Source, Scope, Project, Session string}`, `Fact{ID, Fact, Reason string;
  Keywords []string; Line int; Section string}`, `Block{Provenance; Facts []Fact; Line int}`,
  `Doc{Group, Title string; Provenance; Keywords []string; Updated string; Facts []Fact}`,
  `Problem{Line int; Msg string}`.
- `Marker{Open, Close string}`; `MarkersFor(path string) ([]Marker, bool)` per §2.3 table.
- `FormatComment(m Marker, blocks []Block) (string, error)`: errors on text the marker cannot hold.
- `FormatDoc(d Doc) (string, error)`.
- `ParseComments(path string, src []byte) ([]Block, []Problem)`: in-scope lines only.
- `ParseDoc(src []byte) (Doc, inScope bool, []Problem)`.
- `CheckText(s string) string`: "" or the reason text breaks the rules of §2.2 (shared by parser,
  formatter and `Service.Prepare`).

### 2.6 Validation rules (parser, unit tested)

Comments:

1. Header grammar and key order; `source` iff external.
2. A fact line follows a header or a reason line of the same block; its reason line follows at once
   with the same id.
3. `km_` line outside a block: "fact line without kira-memory header".
4. Header with no fact pair: "empty kira-memory block".
5. Same marker and indentation through a block; wrapped markers closed on every line.
6. Closer or (xml, svg) `--` inside text.
7. Text rules (§2.2): non-empty, no markup pairs, citations well formed.
8. Same id twice as a fact in one file.

Docs: 9. header fields, order, required/forbidden pairs, value rules, closing fence;
10. body line kinds; 11. block shape (fact, reason, optional keywords, same id, separation);
12. text rules; 13. duplicate id in file; 14. `group` is a `kg_` id.

Across files (validator only): 15. one id carries the same fact and reason text everywhere in the
scanned set, else "km_x differs from <path>:<line>". Why: a copied fact must not drift.

No check against `memory.db`. Why: a hook runs on teammates' machines and CI without the user's
store; format is checkable everywhere, content is not.

### 2.7 Prepare-only flag on `store_memory`

- **Name** `asComment` (string): path or extension of the file the comment goes in (`internal/x.go`,
  `go`, `.py`). Set means persist nothing and return a comment. Why: one argument says both "do not
  store" and which marker; a separate bool plus language would allow an invalid pair.
- Marker from `memfmt.MarkersFor`; for `vue`/`svelte` the first (`//`). Unsupported extension:
  `ErrInvalid` listing the supported ones. `md`/`txt` refused: docs are P274's writer. Why: one
  meaning per flag; doc headers carry file-level fields P274 owns.
- `groups` with `asComment`: `ErrInvalid`. Import mode (`--import-ref`) with `asComment`: `ErrInvalid`.
  Why: both need persistence.
- **Pipeline**: `Service.Prepare(ctx, req) (PrepareResult, error)` runs the same validate, gate
  (split, challenge, rewrite), `prepare` and `reconcile` as `Store`, read-only, then stops before
  `commit`. Refactor: `Store` and `Prepare` share one unexported `decide(ctx, req)
  (verdicts, works, StoreResult, error)`; `Store` keeps its behaviour. Same semaphore. No
  `OnChange`, no backfill kick, no event, no revision change.
- **Ids, no reservation**: noop → the matched fact's id; update → the target's fact id (the comment
  states the newer text of that fact); add or a per-fact decision error → fresh `newFactID()`, not
  written anywhere; error text goes to `why`. Grade guard applies as in `Store`. Why: nothing persists
  by contract; 60 random bits make collision negligible; a reservation table would need orphan
  cleanup; reused ids keep comments aligned with stored lineages.
- `PrepareResult{Status "prepared"|"challenged", Challenges, Facts []PreparedFact, Comment string}`;
  `PreparedFact{ID, Fact, Reason, Keywords, Origin, SourceTag, Scope, Project, Action, Why}`.
- Comment blocks: one per distinct (origin, sourceTag, scope), in item order. `CheckText` runs on
  every rewritten fact and reason; a violation (model put markup in) is stripped of markup pairs only
  when markers are the whole difference, else `ErrClaudeOutput`. Why: never ship a comment the
  validator rejects.
- **MCP**: `storeInput.AsComment`; handler output type `storeOutput{memory.StoreResult; Comment
  string omitempty; Prepared []memory.PreparedFact omitempty}`, `Status "prepared"`. Text result:
  `memory.mcp.store.prepared` line, blank line, the comment verbatim. Challenge text unchanged.
  IPC is untouched (UI never prepares).

### 2.8 MCP text outputs (search, history, context)

P272 left these to P273. `writeMemory` renders the shared grammar plus one meta line:

```
km_7h3kq9x2mfa4 fact: Billing API listens on port 9090 in production.
km_7h3kq9x2mfa4 reason: Deploy manifest changed in March release.
km_7h3kq9x2mfa4 meta: v2 origin=user scope=project project=github.com/acme/billing match=both historical
```

- `meta` keys: version `vN`, `origin`, `source`, `scope`, `project`, `match` (search only), flag
  `historical`. Blank line between facts. Why: same grep prefixes as files; provenance differs per
  result, so here it is per fact. P275 appends score parts to `meta`.
- Context: `group kg_x <kind> <key>[ (<title>)][ [<n> of <total> other facts]]` then fact blocks.
- Store outcomes (`renderStore`) unchanged: transient, already id-led.

### 2.9 Validator `memory-check` (Kira Space subcommand)

- **Shipped as** `kira-space memory-check`, a new `RunArgvShim` case, body in package
  `internal/memory/memcheck` (`Run(args []string, stdout, stderr io.Writer) int`). Why: the parser is
  Go and shared with P274; the target repo needs no Go, Node or shell grep features; same shipping
  path as `memory-mcp`. Rejected standalone script: a second parser in another language, drift.
- Usage:
  - `memory-check [paths...]`: in a git work tree scans `git ls-files -z -- <paths>` (default whole
    tree); outside git walks the paths (default `.`), skipping dot dirs and `node_modules`.
  - `memory-check --staged`: staged blobs of `git diff --cached --name-only -z --diff-filter=ACMR`,
    read through one `git cat-file --batch`. Rule 15 runs over that set. Why: a hook must check what
    is committed, not the work tree.
  - `memory-check --install-hook`: writes `<git rev-parse --git-path hooks>/pre-commit` (honours
    `core.hooksPath`), mode 0755. Existing file carrying the `# kira-memory-check` marker line:
    rewritten (exe path refresh). Existing foreign file: exit 1, prints the hook line to add by hand.
    Why: never edit a user's own hook script.
  - `memory-check --print-regex`: prints both regexes. Why: CI or editors can grep without the app.
- Hook file:
  ```sh
  #!/bin/sh
  # kira-memory-check: installed by Kira Space
  exe='<abs exe, ShellQuote>'
  if [ ! -x "$exe" ]; then echo "kira-memory-check: $exe not found, skipped" >&2; exit 0; fi
  exec "$exe" memory-check --staged
  ```
  Missing app skips with a warning. Why: a hook must not block a commit on a machine without Kira.
- Hook line for managers (husky, lefthook): `if [ -x '<exe>' ]; then '<exe>' memory-check --staged; fi`.
- Scanned files: extensions of §2.3 plus `md`, `txt`; skip files over 4 MiB or containing NUL in the
  first 8 KiB.
- Output: `path:line: message`, sorted, then `memory-check: N problem(s)` on stderr. Exit 0 clean, 1
  problems, 2 usage or git error. Clean run prints `memory-check: N file(s), M fact(s) ok`.
- Git runs through `os/exec` with a 30 s timeout, same pattern as `memory.DetectProject`.

### 2.10 Install instructions (UI-visible part)

- Bridge `MemoryService.CommentCheck() MemoryCommentCheck{Executable, InstallCommand, HookLine}`:
  `InstallCommand` = `'<exe>' memory-check --install-hook` (run in the repo root), `HookLine` per
  §2.9. Same `memoryExecutable()` as `McpStatus`. Why: absolute path of this install, shell-quoted.
- Settings > Memory gains `CommentCheckSection.vue` (`packages/workbench/src/memory/settings/`),
  mounted in `MemoryPane.vue` after `ClaudeCodeMcpSection`: `FieldSet` + `FieldLegend` + description
  (what the check does, that it runs on staged files, skips when the app is missing), two `Card`
  blocks (install command, hook line) in `font-data`, each with a copy `Button` (`useCopy`). Query
  `useMemoryCommentCheck()` (TanStack, key `['memory','commentCheck']`), `MemoryControl.
  memoryCommentCheck()`, `ipcChannels` entry, `mockRuntime` default, zod
  `memoryCommentCheckSchema`. Tailwind utilities, shadcn-vue primitives, `<script setup lang="ts">`,
  catalog keys `memory.commentCheck.*`. Why: same pattern as the MCP command card users know.
- `data-testid`: `memory-check-section`, `memory-check-install`, `memory-check-hook`,
  `memory-check-copy-install`, `memory-check-copy-hook`.
- `docs/ARCHITECTURE.md` memory section documents both formats, the regexes, `asComment` and
  `memory-check` with the same commands.

### 2.11 Registry edits (`internal/llmprompts/registry.go` only)

- `memory.gate.system` step 1 and output rules per §2.1; schema unchanged.
- `memory.reconcile.system`: style sentence per §2.1.
- `memory.mcp.tool.store_memory`: append "With asComment, stores nothing and returns the facts as a
  kira-memory comment for that file."
- New arg `memory.mcp.tool.store_memory.arg.asComment`: "path or extension of the file the comment
  goes in, such as internal/billing/api.go or py; when set, nothing is stored and the facts come
  back as a comment; groups are not allowed".
- New `memory.mcp.store.prepared` (toolResult, catalog title/description/usedBy keys): "Nothing was
  stored. Paste this comment above the code it explains; keep every id as it is:".
- Registry count +2 (Space 74 → 76); implementer recounts and updates `llmpromptsflow` `TestList`.
  `checkprompts` passes.

## 3. Execution

One sequential Sonnet implementer, main checkout. Why: `memfmt` feeds `Service.Prepare`, which feeds
MCP; `memcheck` and the bridge depend on `memfmt`; one chain (SPEC Process). Typecheck and lint per
commit; no expensive suites until §3.2.

### 3.1 Order and commits

1. `internal/memory/memfmt/{memfmt,markers,format,parse,text}.go` + `memfmt_test.go`; `ids.go` uses
   `memfmt` patterns. Commit `feat(memory): comment and doc text formats`.
2. `service.go` (`decide`, `Prepare`, `PrepareResult`), `gate.go` and `reconcile.go` whitespace
   collapse, `service_test.go`. Commit `feat(memory): prepare facts without storing`.
3. Registry edits §2.11, en.json keys. Commit `feat(memory): succinct fact style in gate and reconcile`.
4. `mcpserver/server.go` (`asComment`, `storeOutput`, text outputs §2.8), `server_test.go`. Commit
   `feat(memory-mcp): asComment and grep-first text output`.
5. `internal/memory/memcheck/` + `wire.go` case. Commit `feat(memory): memory-check validator and hook`.
6. Bridge `CommentCheck`, Wails bindings (`docs/DEV_ENVIRONMENT.md` regen), shared domain,
   `memoryControl.ts`, `module.ts`, `queries.ts`, `ipcChannels.ts`, `mockRuntime.ts`,
   `CommentCheckSection.vue`, `MemoryPane.vue`, en.json. Commit `feat(memory-ui): comment check
   install instructions`.
7. Flow tests, contracts, UI spec, real `claude` test edits, `llmpromptsflow` count. Commit
   `test(memory): text formats, prepare and comment check`.

### 3.2 Serial test-and-fix (one Sonnet, after 3.1)

`bun run lint`, `bun run lint:go`, `bun run typecheck`, `go test ./... -count=1`,
`bun run test:flows:space`, `bun run test:ui:space`, `bun run test:unit`, `bun run test:visual:space`
(Settings > Memory baseline changes; update it). Then real `claude` (§6). Fix at cause; commit per
group.

### 3.3 Close-out (one Sonnet)

`docs/ARCHITECTURE.md` "Memory MCP server and module": formats, regexes, style rule, `asComment`,
`memory-check`, hook install. `docs/DEV_ENVIRONMENT.md` real `claude` table: add
`internal/memory/mcpserver/**` to the "Memory MCP and install" row (missing today). Result section
here. SPEC P273 Done. Commit `docs: P273 close-out`.

## 4. File ownership (single implementer)

No streams. Why: `memfmt` → `Prepare` → MCP and `memfmt` → `memcheck` → bridge → UI is one
dependency chain; no split passes the zero-overlap and no-ordering rule.

| Area | Files |
|---|---|
| Formats | `internal/memory/memfmt/*.go`, `internal/memory/ids.go` |
| Service | `internal/memory/{service,gate,reconcile}.go`, `internal/memory/service_test.go` |
| Prompts | `internal/llmprompts/registry.go`, `packages/theme/src/i18n/en.json` |
| MCP | `internal/memory/mcpserver/{server,server_test}.go` |
| Validator | `internal/memory/memcheck/*.go`, `apps/kira-space/internal/appwire/wire.go` |
| Bridge, TS | `apps/kira-space/internal/bridge/memory.go`, Space Wails bindings, `packages/shared/domain/memory.ts`, `apps/kira-space/frontend/src/bridge/memoryControl.ts`, `packages/workbench/src/memory/{module,queries}.ts` |
| UI | `packages/workbench/src/memory/settings/CommentCheckSection.vue`, `apps/kira-space/frontend/src/workbench/settings/MemoryPane.vue` |
| Tests | `apps/kira-space/internal/flows/memoryflow/{format_test.go,testdata/*}`, `provenance_test.go` and `store_test.go` text asserts, `apps/kira-space/internal/flows/llmpromptsflow/llmprompts_test.go`, `apps/kira-space/tests/contract/{memory,memory-settings}.json`, `apps/kira-space/tests/ui/{settings-memory.spec.ts,support/ipcChannels.ts,support/mockRuntime.ts}`, `apps/kira-space/tests/claude/{memory_test,memory_gate_test}.go`, Space visual baseline for Settings > Memory |
| Docs | `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, this plan, `docs/v2.5/SPEC.md` |

A needed file outside this table: edit it and name it in the commit body.

## 5. Tests

Unit (interacting rules only):

- `memfmt_test.go` `TestParseComments`: table over valid blocks per marker family (`//`, `#`, `--`,
  `<!-- -->`, `/* */`, vue both), multi-block with differing provenance, and each rule 1-8 failing
  alone with its line number; legacy comments and prose mentioning an id produce nothing.
- `TestParseDoc`: valid doc with headings and keywords lines; rules 9-14 each failing alone; legacy
  `.md` (no header) out of scope; header value YAML-indicator and `: ` cases.
- `TestCheckText`: markup pairs flagged, `snake_case`, `*.go`, `a * b`, `__init__`-free identifiers
  legal; malformed `km_`/`kg_` tokens flagged.
- `TestFormatRoundTrip`: `FormatComment`/`FormatDoc` output parses back to equal blocks and doc;
  every output line matches `CommentLine`/`DocLine`; formatter refuses `-->` in an html comment.
- `TestRegexMatchesParser`: every line the parser accepts in the fixtures matches the regex, and
  every fixture line the regex rejects is a parser problem. Why: the published regex must not drift
  from the parser.
- `memcheck`: `TestCrossFileDrift` (rule 15 over two files, `--staged` blob reader faked by an
  in-memory source). Hook install is covered by the flow test, not a unit test.
- `service_test.go` `TestPrepareMapsDecisionsToIDs`: fake runner; noop reuses the stored id, update
  reuses the target's fact id, add mints a fresh id, grade guard downgrade mints, a reconcile error
  mints with why; store revision and row count unchanged afterwards. Why: decision structure with
  several interacting rules.

New-feature split at the IPC boundary (same scenario, same asserted result; contracts in
`apps/kira-space/tests/contract/memory-settings.json`):

| Scenario | Go flow (`memoryflow/format_test.go`) | UI spec (`settings-memory.spec.ts`) |
|---|---|---|
| Comment check install | `TestCommentCheckHook`: `CommentCheck()` → absolute exe, commands contain `memory-check --install-hook` and `--staged`; contract `MemoryService.CommentCheck` (exe replaced by `<bin>/kira-space`). Temp git repo: run `<exe> memory-check --install-hook` → `pre-commit` written with the marker; `git commit` of a file with an orphan `km_` line fails with `path:line`; a valid block commits; a foreign `pre-commit` makes install exit 1 | Settings > Memory: `memory-check-section` shows both commands equal to the contract; copy buttons put each command on the clipboard |

Backend-only (no UI state, no spec; P272 grade-guard precedent):

- `TestMcpPrepareComment`: fakeagent drives `memory-mcp` `store_memory` with `asComment`
  `internal/billing/api.go`, scripted gate accept (two facts) and reconcile add → structured
  `status` `prepared`, `comment` parses with `memfmt.ParseComments` into one block of two facts with
  `km_` ids, text result starts with the prepared line; `Recent` empty, no `kira:memory:changed`.
  Second case: stored fact, identical prepare → comment carries the stored fact id.
- `TestMcpSearchTextFormat`: stored fact, `search_memories` text → every non-blank line matches
  `^km_[0-9a-hjkmnp-tv-z]{12} (fact|reason|meta): `.
- Existing `provenance_test.go`, `store_test.go`, `server_test.go` move to the new text output.

## 6. Real `claude` rows (opt-in, after 3.2)

Changes touch `internal/llmprompts/**`, gate, MCP server and memorycli, so run the prompt registry
row (it covers the memory rows):
`bun run test:claude:space -run 'TestMemoryGate|TestMemoryMcpThroughClaude|TestMemoryInstallRegisters|TestMemoryImport|TestAdeHeadlessRun|TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun|TestSmartScriptRun'`
and `bun run test:claude:studio`.

Test edits:

- `TestMemoryGate` gains a wordy item ("Basically, the billing-api service is actually really
  listening on port 8080 in production, I think, because ...") → stored fact keeps `8080` and
  `billing-api`, has none of `basically`, `actually`, `really`, no `**` or backtick, at most 25 words;
  `memfmt.CheckText` is "" for fact and reason.
- `TestMemoryMcpThroughClaude` gains an `asComment` step: claude calls `store_memory` with
  `asComment` `go`; assert `status` `prepared`, comment parses with no problems, store count
  unchanged.
- Report spend per run.

## 7. Verification (orchestrator, real checks)

1. `rg -n 'memfmt\.' internal/memory --glob '!*_test.go'` shows real callers in `ids.go`,
   `service.go` (`Prepare`), `mcpserver/server.go` and `memcheck`.
2. `rg -n '"memory-check"' apps/kira-space/internal/appwire/wire.go` shows the shim case;
   `rg -n 'memcheck.Run' apps` shows its caller.
3. `rg -n 'AsComment|asComment' internal/memory/mcpserver internal/llmprompts/registry.go` shows
   input field, schema arg and registry entry.
4. `rg -n "keep the author's wording" internal/llmprompts` → none; gate default contains the
   style rule.
5. Take the comment regex from the built binary's `memory-check --print-regex`; `printf '// kira-memory
   origin=user scope=company\n// km_7h3kq9x2mfa4 fact: A.\n// km_7h3kq9x2mfa4 reason: B.\n// legacy\n'
   | grep -cE "$REGEX"` = 3. Same for a doc fixture with the doc regex (free prose line unmatched).
   Planner checked both regexes this way with GNU grep: 4 of 5 and 7 of 8 lines, as intended.
6. Built Space binary: `memory-check --install-hook` in a scratch repo, then a bad commit fails and
   a good one passes (by hand, once).
7. UI libraries: `CommentCheckSection.vue` uses TanStack through `queries.ts`, shadcn `Card`,
   `Button`, `Field*`, `useCopy`; no `<style` in `packages/workbench/src/memory/`.
8. Registry count equals `TestList`; `go run ./internal/llmprompts/cmd/checkprompts` passes.
9. Suites in §3.2 green; real `claude` rows run and reported.
10. This planner's and the implementer's tool logs show real `codegraph_explore` calls where they
    discovered code.

## 8. Decisions log (final)

- Gate rewrites to `CLAUDE.md` style, keeping negations, numbers, names, ids: SPEC (1), clarity first.
- Go collapses whitespace in fact and reason: formats are one field per line.
- Line grammar `<id> <field>: <text>`, id first: grep by id returns the whole fact.
- Fields `fact`, `reason`, `keywords`: same terms as the store.
- No inline markup pairs; lone `*`, `_` legal: phrase grep works, identifiers survive.
- Citations by `km_`/`kg_` id only, shape-checked: a broken id greps to nothing.
- No version in any format: fact id is stable across versions.
- Comment block header with provenance once: no per-fact boilerplate, keeps grading.
- No project, session or keywords in comments: the repo says the project; code stays lean.
- In scope = line text starts `kira-memory ` or `km_`; docs = `---` + `kira-memory: 1`: legacy
  never flagged, no opt-in file.
- Per-extension marker table, unlisted refused: a guessed marker can break code.
- Doc header as YAML-safe front matter: greps, renders as a table on GitHub.
- Doc id = `group` `kg_` id: reuses P272 document groups.
- One provenance per doc; body only headings and fact blocks: parse-only re-ingest loses nothing.
- Keywords line optional in docs: grep by synonym; re-ingest keeps search aids without an LLM.
- One regex per format in POSIX ERE subset: works in Go and `grep -E` alike.
- Flag `asComment` (path or extension): one argument says "do not store" and which marker.
- `asComment` refuses md, txt, groups and import mode: those need persistence or P274's writer.
- Prepare shares the store pipeline through `decide`: same split, challenge, wording, reconcile.
- No id reservation; noop/update reuse the stored fact id, add mints: nothing persists, 60-bit ids.
- MCP search, history and context text use the same grammar plus `meta`: one way to read facts.
- Validator is `kira-space memory-check`, not a script: one Go parser shared with P274.
- No `memory.db` check in the validator: hooks and CI run without the user's store.
- `--staged` reads blobs via `cat-file --batch`: checks what is committed.
- `--install-hook` refuses a foreign hook; hook skips when the app is missing: safe for teammates.
- Install instructions in Settings > Memory with copy buttons: same pattern as the MCP command.
- One sequential implementer: one dependency chain, SPEC Process.

## 9. Result

### 9.1 Test run

- Green: `lint`, `lint:go`, `typecheck`, `go test ./... -count=1` (after fix below), `test:flows:space`,
  `test:flows:studio`, `test:unit` 1902 pass, `test:ui:space` 566 pass, `test:ui:space-mobile` 81 pass 1 skipped,
  `test:visual:space` 12 pass after baseline regen, `test:ui:studio` ui project 540 pass.
- Fix: `TestGoConventions` G4 flagged `os.WriteFile` in `memcheck/run.go`; hook install now uses `renameio.WriteFile`.
- Fix: real-claude `asComment` step asserted the text prefix; claude shows the structured JSON result, so the
  test now reads `status` and `comment` from it.
- Visual: `settings-memory` diff was the new "Check memory comments" section only (3634 px, scroll bar appears);
  baseline regenerated.
- Flake, not P273: `adapters/clickhouse` `QUERY_WITH_SAME_ID_IS_ALREADY_RUNNING` once under load; passes on rerun.
- Not green, not P273: `ui-timing` project, `budgets.spec.ts:382` and `perf.spec.ts:105` (scroll and frame budgets).
  No Studio, api-core or docker-ui file differs from `ccf3b8e80`. Budgets untouched.
- Real `claude` 2.1.296 (env auth): `TestMemoryGate` (wordy item) 22 s, `TestMemoryImport` 78 s (0.162 USD),
  `TestMemoryMcpThroughClaude` incl. `asComment` 33 s, `TestMemoryInstallRegisters` 2 s, Ade and SmartScript rows
  pass, `test:claude:studio` pass. Spend about 0.20 USD.
- Observed: claude receives the structured JSON (`status`, `comment`, `prepared`) for tool results, not the
  text content, so the grep-first `meta` text and the prepared line reach claude only where a client reads text.
- §7: 1-4 clean (`memfmt` callers in `ids.go`, `service.go`, `mcpserver/server.go`, `memcheck`; shim case
  `wire.go:59`; `rg "keep the author.s wording" internal/llmprompts` no hit); 5: comment regex 3 of 4 lines,
  doc regex 12 of 13 (prose line unmatched); 6 by hand below; 7 no `<style` in `memory/`; 8 count 76 = `TestList`.
- By hand, temp repo: `--install-hook` wrote an executable `pre-commit`; legacy comment commit passed;
  orphan `km_` line blocked (`bad.go:2: fact line without kira-memory header`, exit 1); valid block committed;
  foreign hook made install exit 1 and print the hook line.

### 9.2 Close-out

`docs/ARCHITECTURE.md` memory section (formats, regexes, style rule, `Prepare`/`asComment`, `memory-check`,
grep-first MCP text), `docs/DEV_ENVIRONMENT.md` real-claude row (`mcpserver/**`, `memfmt/**`). SPEC P273 Done.
