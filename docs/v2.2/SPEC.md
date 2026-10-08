# v2.2 SPEC

Branch `v2.0`. Max 2 concurrent streams. Stream A: P210 then P211 (memory, same subsystem). Stream B: P212. Stream C: P213 (user override of the 2-stream cap).

| Phase | Title | Status |
|---|---|---|
| P210 | Memory embedding search: local embedding model (best quality under 500 MB RAM, less if possible), vectors in SQLite, hybrid with existing FTS recall-first search | Done |
| P211 | Memory bulk import: pick file or folder; chunk to a Sonnet-friendly size; per-chunk clean-context agent extracts atomic facts; one final agent holding all chunk facts of the file adds memories through the MCP; progress and failure shown | Not started |
| P212 Part 1 | Mobile agents web: local web server in Kira Space serving a read-only mobile-laid-out Vue agents module; first-load device approval in Kira Space like the git extension pairing; installable PWA | Done |
| P212 Part 2 | Mobile agents web writes (amendment): backlog add and reorder, TUI input for stuck agents, start/next/prev workflow stage, phone attach of the Claude Code terminal (desktop shows disconnected plus a reconnect button) | Not started |
| P213 | Tailwind audit (user-requested, runs now on stream C as an exception to row order): replace hand-written CSS with Tailwind utilities across both apps and shared packages, including partial matches; skips files owned by P210–P212 | Done |
| P214 | Memory manual add, free text: Add memory dialog gets a single free-text box (no per-row fact/reason; reason auto-filled as manual). Submits through the unchanged store path: the gate already splits into atomic facts, challenges and reconciles; stored only when every step passes. No dependency on P211 | Done |
| P215 | Code review (one Opus round) and fixes | Not started |

## Requirements (user's words, condensed)

- P210: search over embeddings too; SQLite; local model; best under 500 MB RAM, maybe less.
- P211: import lots of docs; select file or folder, import starts; each file chunked; chunk size suits Sonnet; step 1 extract atomic facts per chunk (agent with clean context each); step 2 one agent sees all chunks' facts of the file and adds memories via MCP so context of whole file is kept.
- P212: local web server serves mobile version of agents module; first load on phone must be allowed in Kira Space (like git extension); Vue, mobile layout, read-only for now; PWA so it runs outside browser.

## P210 result

Hybrid keyword and semantic memory search, local model, vectors in `memory.db`. Facts live in
`docs/ARCHITECTURE.md` ("Memory MCP server and module", Stack table, Known open items) and
`docs/DEV_ENVIRONMENT.md` (Memory MCP section).

Decisions taken (user's deferred defaults): D1 English-only arctic-embed-s int8; D2 download on click
(35 MB, pinned SHA-256) rather than bundling the model; D3 semantic candidates in reconcile on, cosine
floor 0.85.

Runtime and model choice, measured on Linux x86_64 (4 cores, ORT CPU, 2 intra-op threads):

| Option | Result |
|---|---|
| hugot pure-Go backend, bge-small | 458 MB loaded, 1.05 GB peak, 40x slower than ORT: declined |
| hugot ORT backend | works, drags GoMLX and go-xla into `go.mod`: declined |
| `yalue/onnxruntime_go` + `hftokenizer`, arctic-embed-s int8 | 95 MB loaded, 137 MB peak, 4 ms short, 35 ms long: chosen |
| llama.cpp, sqlite-vec | second native toolchain; native SQLite extension `modernc.org/sqlite` cannot load: declined |
| multilingual-e5-small int8 | 362 MB peak, weaker English retrieval: D1 alternative |
| EmbeddingGemma (Gemma terms), jina v3 (CC-BY-NC) | not open-source licences: declined |

Verification (this environment, network reachable):

- Pinned URLs and SHA-256 of `model.onnx` and `tokenizer.json` re-verified against the pinned HF
  revision; ORT tgz hashes for `osx-arm64` and `linux-x64` verified by `scripts/fetch-onnxruntime.sh`.
- `go test -tags embedsmoke ./internal/memory/embed/ -run Smoke`: real download via `embed.Install`,
  real worker, dim 384, unit norm, top-1 9/10 on the 10-query paraphrase probe (miss: "what hardware
  does the user work on").
- `memory-mcp` end to end (built binary, real model, `KIRA_ORT_LIB`): first `search_memories` ran while
  indexing and returned keyword-only; the second, a no-shared-word query ("which relational database
  serves live traffic"), returned the PostgreSQL fact first with `[semantic]` and state `ready`. Worker
  RSS 146 MB after backfill plus query; the worker was gone 300 s after the last search; the MCP process
  exited 0.
- `go test -race ./internal/memory/... ./apps/kira-space/internal/bridge/`, `bun run test:unit`,
  typecheck and lint pass; Space UI spec `memory-module.spec.ts` passes (4/4). `CGO_ENABLED=0` and
  `GOOS=darwin CGO_ENABLED=0` builds of `internal/memory/...` compile (stub path). Visual baselines not
  regenerated.

Deviations from the plan:

- `Command` in `embed.ClientOptions` takes only `modelDir` (the plan's `ctx` had no use).
- `Memory.seq` is an unexported field set by `memoryColumns` (now ends in `m.seq`) instead of a variant
  scanner; `searchFTS` returns `[]Memory`.
- `Installed` and the manifest live in `embed/manifest.go` (commit 2) because the client needs them
  before the installer (commit 4). `normalize` moved to `vector.go` so the fake-worker tests run with
  `CGO_ENABLED=0`.
- Added `progress` shadcn-vue set uses `bg-field` instead of the registry's `bg-muted` (retired alias
  guard in `check-theme-classes.sh`).
- The plan's `CGO_ENABLED=0 go build ./apps/kira-space/...` check cannot pass here (Wails needs cgo on
  Linux); the stub was checked on `./internal/memory/...`.

Unverified: macOS (dylib load from `Contents/Frameworks`, arm64 int8 kernels, worker footprint,
`codesign --verify --deep --strict`), the Download model click in the real app (covered by the same
`embed.Install` the smoke test runs, UI states by typecheck only), and tokenizer parity beyond the 9/10
ranking probe. Recorded in Known open items.

## P212 Part 1 result

Done. Read-only phone web app served by Kira Space; design facts in `docs/ARCHITECTURE.md` "Mobile
agents web (P212, Kira Space)".

- Scope narrowed by the user to three tabs: Backlog, Need You, Plan. Server allowlist stays GET only
  plus `POST /api/pair`; auth (per-device cookie token, `csrfGuard`, route table) is built so a write
  endpoint is one row. No terminal/PTY attach.
- Landed: generic `internal/pairing` and `internal/embedded`, `appevent.Tap`, `mobileweb` server with
  local CA, migration 0021, desktop Mobile access pane and pairing dialog, transport-agnostic ADE
  reader, second Vite build, installable PWA, Playwright mobile projects.
- Verified: Go race tests on the touched packages, `bun run test:ui:space` (221 pass),
  `test:ui:space-mobile` (iOS WebKit and Pixel Chromium emulation), lint, golangci-lint, knip,
  typecheck. Not verified: a real phone (CA install, installed PWA, WebKit offline shell).
- `test:visual:space`: the four Settings dialog snapshots differ because the nav gained a "Mobile
  access" row. Baselines not regenerated here (sandbox fonts); regenerate on the reference machine.
- Follow-up amendment P212 Part 2: backlog add and reorder, TUI input for stuck agents,
  start/next/prev workflow stage, phone attach of the Claude Code terminal (desktop shows
  disconnected plus a reconnect button).

## P213 result

12 commits on `v2.1-stream-C` (`393978d04`..`f262f96dd`, plus docs). Hooks green on each.

Done:
- Connection and type colours: `connBgClass`/`connTextClass`, `columnTypeTextClass` literal maps replace direct `:style` colour paints (plan classes C, D: 19).
- Static `:style` keys moved to classes; bindings keep runtime geometry only. `:style` bindings 250 to 142 (same grep).
- ADE: tone `@theme` tokens in `ade/v2/tones.css`; `tones.ts` keeps class maps only. `tagStyle`/`solidStyle`/`actionStyle` deleted (no use in `kira-v21-G` or `origin/v2.0`).
- git-ui commit grid: cell, badge, ref-strip CSS to `kv:` utilities; `CommitGrid.vue` SlickGrid overrides via `@apply`. Style block 47 to 16 rule blocks.
- Studio `slickTheme.css`: 70 to 63 rule blocks, 825 to 715 lines; safe single-declaration subset via `@apply`. Host, mount, no-rows, nav button, header badge, select zone moved to class strings.
- Space review load-error zone: utilities; retry via `buttonVariants`. Rules deleted from `review-decorations.css`.
- `base.css` html/body and `MonacoHost.vue` find-match tints via `@apply`.

Kept CSS: 5 `<style>` blocks unchanged in count; `slickTheme.css` 63 rules (vendor DOM, composites, raw px sizes, `.cell-input` states, scrollbar pseudo rules).

Verification: `test:unit` 1810 pass; `test:webview` 64 pass; `test:ui:space` 217 pass; `test:ui:studio` 337 pass after one fix (`f262f96dd`: `.is-fk` marker read by `slick-grid.spec.ts`). Visual before/after in scratch worktree at `363cb6622`: Studio 13 and Space 4 specs, zero diff. No baseline touched. Excluded paths (section 3.1) untouched.

Accepted drift:
- Retry button in review load-error zone: `dialog-danger`/`xs` variant, so height, radius, hover tint differ from old rule (D5). Not covered by a visual spec.
- `bg-error/12` mixes in oklab, old rule in srgb. Imperceptible.
- `antialiased` also sets `-moz-osx-font-smoothing`. No effect in Chromium/WebKit.

Unverified: Retry-button and load-error zone appearance (no spec renders it); real-hardware scrolling not checked.

## P214 result

`AddMemoryDialog.vue`: rows UI replaced by one free-text box (1000-char cap, counter). Sends one item with fixed manual reason; gate splits, challenges, reconciles. Challenge block and outcomes list unchanged. No Go, store-path or model change. `memory-module` Playwright test updated for free text and two outcomes.

Checks: typecheck, lint (no errors), lint:dead, `test:ui:space -- memory-module` 4 pass.
