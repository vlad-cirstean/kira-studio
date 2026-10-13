# P284 plan: Documentation site in the Astro page

Ask (SPEC row P284): public end-user and developer docs inside the P280 Astro site. Starlight
preferred (MIT). Every docs page follows `CLAUDE.md` "Communication style", without exception.
A check script in `bun run lint` enforces the mechanical rules; a documented manual pass covers the
rest. Content derives from the real app. Screenshots reuse `screenshots/`. Workflow change, if any,
through `docs/pending-workflows/`.

Base: `v2.0` at `fe8fb9fc8` (P280 close-out). Ordering: the user asked for docs now ("continue with
the public documentation"), ahead of P281-P283 in table order. P279 runs at the same time in worktree
`/home/user/wt-p279`; it owns `apps/**`, `packages/**`, `internal/**`. This phase never edits those
paths (section 9.4).

Discovery ran through `codegraph_explore`: `SettingsDialog`/`sections` (Studio), Space `sections`,
`settingsDomain` defaults, `DbMcpSettings`, `MemoryMcpInstructions` and every `KindTool` entry in
`internal/llmprompts/registry.go`, `Entry`/`Kind`/`Applies`, `PromptsPane` areas, `memfmt`
(`FormatComment`, `ParseDoc`, `parseHeader`, `MarkersFor`, `CommentLineSource`, `DocLineSource`),
importer (`ingestFiles`, `ChunkMarkdown`, `writeDocFile`, `.memory.md`), `scriptruns.Service`,
`RunScriptDialog`, `ScheduleFields`, `McpServerTools`, adapter `Caps`/`RelationalCaps`. Targeted
reads where the index has no hit: `docs/ARCHITECTURE.md` (ADE, Memory, App prompts, Presentation
site, Known open items), `docs/DEV_ENVIRONMENT.md` headings, root and Space `README.md`, every
`site/` file, `knip.json`, `.githooks/pre-commit`, `pr.yml` steps, `pages.yml` paths,
`scripts/copy/*` (existing copy guard and its `BANNED` term list), P279 plan ownership.
npm registry read for Starlight and every new dependency (versions, peers, licences).

Facts that shape the design (each checked by grep or registry read):

- `site/`: Astro 7.3.8, Tailwind 4 via `@tailwindcss/vite`, `base: '/kira-studio'`,
  `trailingSlash: 'ignore'`, zero client JS on the landing page. `global.css` imports full
  `tailwindcss` (with preflight). `nav.ts` holds header links. `lib/shots.ts` resolves screenshots
  but exports only `resolveAllShots`.
- `@astrojs/starlight` latest 0.42.6 (MIT, 2026-10-08) peers `astro ^7.2.10` and
  `@astrojs/markdown-remark ^7.3.0`. Astro 7.3.8 lists `@astrojs/markdown-remark` as an optional peer
  only, so the site must declare it. Starlight depends on `pagefind`, `astro-expressive-code`,
  `@astrojs/mdx`, `@astrojs/sitemap`, `remark-directive` (all MIT).
- Bun uses the isolated linker: `site/node_modules` holds only `site/package.json` deps. A script
  outside `site/` cannot import Starlight's or remark's packages without root declarations.
- `bun run lint` (pre-commit and `pr.yml`) runs Biome over `**` plus fixed-directory guards; none scan
  Markdown. `scripts/copy/catalogRules.ts` `BANNED` already fixes UI terms: repository not repo,
  folder not directory, Settings not Preferences, Colour, cancelled, "for example" not "e.g.".
- Settings sections: Studio `Appearance, Data, Cache, Api, Database MCP, Prompts, Advanced`
  (`apps/kira-studio/frontend/src/state/settings.ts`); Space `Appearance, Git, Mobile access, Claude
  Code, Memory, Prompts, Advanced` (`apps/kira-space/frontend/src/state/settings.ts`).
- MCP tool names in the registry: memory `store_memory`, `search_memories`, `memory_history`,
  `memory_context`, `ingest_files`, `ingest_status`, prompt `remember`; Database MCP
  `list_connections`, `list_children`, `describe_table`, `describe_schema`, `run_query`,
  `explain_query`; agent tools `finish_step`, `task_info`, `declare_repos`, `request_branch`,
  `branch_status`, `run_outcome`, `git`.
- App homes: Studio `~/.kira-studio` (`KIRA_HOME`, database `kira.db`), Space `~/.kira-space`
  (`KIRA_SPACE_HOME`), memory `~/.kira-memory/memory.db` (`KIRA_MEMORY_HOME`).
- `pages.yml` triggers on `site/**` and builds with `bun run site:build`; Starlight runs Pagefind
  inside `astro build`.

## 1. Decisions (final)

1. Starlight, not hand-rolled under `src/content`: MIT, ships search, sidebar, mobile nav, a11y and
   code blocks that a hand-rolled docs layout would rebuild.
2. Version: exact pin of the newest `@astrojs/starlight` 0.42.x whose peer range admits Astro 7.3.8
   (0.42.6 at planning); no Astro upgrade, P280's pin stands.
3. Docs live under `/kira-studio/docs/`: content in `site/src/content/docs/docs/**`, so Starlight
   routes never collide with the landing page at `/kira-studio/`.
4. Landing page stays as P280 built it, zero client JS. Docs pages accept Starlight's own small
   scripts (search dialog, mobile menu, table of contents): search is part of the ask.
5. Starlight's 404 route off (`disable404Route: true`): P280's `404.astro` stays the one 404.
6. Dark only, like the apps: override `ThemeSelect` and `ThemeProvider` with one empty component;
   without a `data-theme="light"` attribute Starlight renders its dark palette.
7. CSS: split P280's `@theme` block into `src/styles/theme.css`. `global.css` keeps full Tailwind for
   the landing page; new `docs.css` uses Starlight's Tailwind 4 layer setup
   (`@astrojs/starlight-tailwind`, Tailwind `theme.css` and `utilities.css`, no preflight) and maps
   `--sl-color-*` and `--sl-font*` to the `--kira-*` tokens. Why: preflight would undo Starlight's base
   styles; one token source stays. This replaces P280's note "add the Starlight layer to
   `global.css`".
8. Header: `nav.ts` gains `Docs` (before GitHub) pointing at `${BASE_URL}docs/`. Starlight's site
   title links back to the landing page; GitHub sits in Starlight `social`.
9. Logo `apps/kira-studio/build/appicon.icon/Assets/kira_icon_vector.svg` by relative path, no copy.
   Favicon: a static endpoint `src/pages/favicon.svg.ts` returns that same SVG at the exact name
   Starlight links (`favicon: '/favicon.svg'`). Why: no copied asset, no 404 favicon link.
10. Sidebar: `autogenerate` per group folder, order from each page's `sidebar.order`. Why: a new page
    cannot be missing from the nav.
11. Page format: `.md`; `.mdx` only for the six pages that show a screenshot.
12. Screenshots: only P280's six shots, through a `DocShot.astro` wrapper that calls an exported
    `resolveShot(id)` and renders P280's `Shot.astro` (crop on phone, framed window from `md`). No new
    captures: new shots would need `apps/*/tests/screenshots` edits, which P279 owns.
13. Every page declares `sources:` in frontmatter (Starlight `docsSchema({ extend })`): repo-relative
    paths the page's claims come from. Lint checks each path exists. Why: a later phase greps
    `sources:` for files it changed and finds the docs page to update.
14. Docs check lives at `site/scripts/`: its Markdown parser deps resolve from the site workspace
    under the isolated linker. Wired into root `lint`.
15. Parser: `unified` + `remark-parse` + `remark-gfm` + `remark-frontmatter` + `remark-mdx` +
    `remark-directive` + `unist-util-visit`, frontmatter through `yaml`. Why (library rule): the
    Markdown AST gives code, links, tables and asides exactly; a regex scan would misread them.
16. Terms follow the UI catalog: the docs check carries the `BANNED` term subset that applies to prose.
    UI labels are quoted from `packages/theme/src/i18n/en.json`, never paraphrased.
17. Features still landing (P279 resume and quit prompt, P285 ingest quality, P286 review step, P287
    sandbox): omitted, no "coming" note. Why: a note goes stale; each of those phases updates the
    page it changes (close-out, section 9.6). The agents page also says nothing about restart
    behaviour, since P279 changes it.
18. No workflow change: `pages.yml` already triggers on `site/**` and runs `site:build`, which now
    builds docs and the Pagefind index. Nothing goes to `docs/pending-workflows/`.
19. One sequential Sonnet implementer in the main checkout `/home/user/kira-studio` (branch `v2.0`):
    one site, order-dependent steps; no stream split.

## 2. Site configuration

Files (all under `site/` unless named):

- `package.json` dependencies, exact versions: `@astrojs/starlight`, `@astrojs/starlight-tailwind`,
  `@astrojs/markdown-remark` (the version Astro 7.3.8 tests with, 7.3.2); for the docs check
  `unified`, `remark-parse`, `remark-gfm`, `remark-frontmatter`, `remark-mdx`, `remark-directive`,
  `unist-util-visit`, `yaml`, `@types/mdast`. No other new dependency.
- `astro.config.mjs`: `starlight({ title: 'Kira Studio', logo, favicon: '/favicon.svg', social:
  [{ icon: 'github', label: 'GitHub', href: REPO_URL }], customCss: ['./src/styles/docs.css'],
  disable404Route: true, components: { ThemeSelect, ThemeProvider }, sidebar })`, Tailwind plugin
  kept. Sidebar groups, each `autogenerate: { directory }`: Start (`docs/start`), Kira Studio
  (`docs/studio`), Kira Space (`docs/space`), Both apps (`docs/shared`), Reference
  (`docs/reference`), Develop (`docs/develop`).
- `src/content.config.ts`: `docs` collection, `docsLoader()`, `docsSchema({ extend: z.object({
  sources: z.array(z.string()).min(1) }) })`.
- `src/components/Empty.astro` (theme overrides), `src/components/DocShot.astro`.
- `src/lib/shots.ts`: export `resolveShot`.
- `src/styles/theme.css`, `global.css` (imports it), `docs.css`. Phone (below 768 px): sidebar links
  and header buttons at least 44 px tall, body text at least 16 px.
- `src/pages/favicon.svg.ts`.
- `src/data/nav.ts`: `Docs` entry.
- `tsconfig.json`: exclude `scripts` (own tsconfig, section 4.5).
- Root `knip.json` `site` workspace: entry adds `src/content.config.ts`, `src/pages/**/*.ts`,
  `scripts/check-docs.ts`, `scripts/**/*.spec.ts`; project adds `src/content/**/*.{md,mdx}`,
  `scripts/**/*.ts`. Knip's MDX compiler is on with Astro; if `lint:dead` still flags `DocShot.astro`,
  add it to `entry` with a one-line comment naming why.

## 3. Pages and their sources

Writing rules for every page:

- `CLAUDE.md` "Communication style": terse, one idea per sentence, about 20 words, active voice,
  present tense, imperative instructions, one term per concept. Normal prose only inside a
  `:::caution` or `:::danger` aside (security warning, irreversible action, real ambiguity).
- Menu paths read `Settings > Memory`; shortcuts read `Cmd+Shift+R` (Space README form).
- Accuracy: every claim (label, default, limit, path, tool name, behaviour) comes from a file in the
  page's `sources:`. Before writing a claim, grep it in the source; UI labels come from `en.json`.
  A claim that cannot be traced is cut, not softened. A doc fact that contradicts code follows the
  code and is reported (section 10).
- Links between pages are relative with a trailing slash (`../sql-console/`); the site check crawls
  every one.

Path prefix `site/src/content/docs/docs/`. `en` stands for `packages/theme/src/i18n/en.json`, a
source of every page that names a UI label.

| Page | File | Sources |
|---|---|---|
| Overview | `index.md` | `README.md`, `apps/kira-space/README.md` |
| Install and update | `start/install.md` | `README.md` (Status, Install), `scripts/install.sh`, `docs/PACKAGING.md`, `internal/appupdate` |
| Databases and connections | `studio/databases.md` | `README.md` (Supported engines, Studio), `apps/kira-studio/internal/adapters/caps.go`, `apps/kira-studio/internal/adapters/*/caps.go`, `apps/kira-studio/internal/mask`, en |
| Data grid | `studio/data-grid.mdx` | `README.md` (Studio), `apps/kira-studio/frontend/src/views/grid`, `apps/kira-studio/frontend/src/views/documents`, `apps/kira-studio/frontend/src/views/keyvalue`, `apps/kira-studio/frontend/src/views/stream`, en; shot `studio-data-grid` |
| SQL console | `studio/sql-console.mdx` | `README.md` (Studio), `apps/kira-studio/frontend/src/views/console`, `apps/kira-studio/internal/adapters/adapter.go` (console cap), en; shot `studio-sql-console` |
| API client | `studio/api-client.mdx` | `README.md` (Api), `packages/api-core/src`, `apps/kira-studio/frontend/src/views/httprequest`, `apps/kira-studio/frontend/src/views/grpcrequest`, `apps/kira-studio/frontend/src/state/settingsDomain.ts` (Api defaults), en; shot `studio-api` |
| Docker | `studio/docker.md` | `README.md` (Docker), `packages/docker-ui/src`, `internal/docker`, en |
| Database MCP server | `studio/database-mcp.md` | `README.md` (Database MCP server), `apps/kira-studio/internal/dbmcp`, `internal/llmprompts/registry.go` (dbmcp entries), `docs/ARCHITECTURE.md` (Database MCP server), en |
| Git | `space/git.mdx` | `apps/kira-space/README.md` (Git features, Requirements), `packages/git-ui/src`, `packages/git-core/src`, `apps/kira-space/internal/gitsession`, `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue`, en; shot `space-git-graph` |
| Code workspace | `space/workspace.md` | `apps/kira-space/README.md` (Code workspace features), `apps/kira-space/internal/codeworkspace`, en |
| Agents | `space/agents.mdx` | `apps/kira-space/README.md` (Agents), `docs/ARCHITECTURE.md` (ADE sections except restart recovery), `apps/kira-space/internal/ade`, `apps/kira-space/internal/adeflow`, `apps/kira-space/internal/adeflow/testdata`, `apps/kira-space/frontend/src/ade`, `internal/claudeheadless`, en; shot `space-agents-board` |
| Phone view | `space/phone.md` | `apps/kira-space/README.md` (Phone view), `docs/ARCHITECTURE.md` (Mobile agents web, Known open items mobile entries), `apps/kira-space/internal/mobileweb`, `apps/kira-space/internal/lannet`, en |
| Memory | `space/memory.mdx` | `apps/kira-space/README.md` (Memory), `docs/ARCHITECTURE.md` (Memory MCP server and module), `internal/memory/memfmt`, `internal/memory/importer`, `internal/memory/embed`, `packages/workbench/src/memory`, `apps/kira-space/frontend/src/workbench/settings/MemoryPane.vue`, en; shot `space-memory` |
| Automations and smart scripts | `shared/automations.md` | `README.md` (Automations), `apps/kira-space/README.md` (Automations), `packages/workbench/src/automations`, `internal/scriptruns`, `internal/scripts`, en |
| Settings | `reference/settings.md` | both `frontend/src/state/settings.ts` and `settingsDomain.ts`, `apps/kira-studio/frontend/src/workbench/settings`, `apps/kira-space/frontend/src/workbench/settings`, `apps/kira-studio/internal/config/paths.go`, `apps/kira-space/internal/config/paths.go`, `internal/kirapaths/paths.go`, en |
| Prompts | `reference/prompts.md` | `internal/llmprompts/entry.go`, `internal/llmprompts/registry.go`, `packages/workbench/src/llmPrompts`, `docs/ARCHITECTURE.md` (App prompts), en |
| MCP tools | `reference/mcp-tools.md` | `internal/llmprompts/registry.go` (every `KindTool` entry and its arguments), `internal/memory/mcpserver`, `apps/kira-studio/internal/dbmcp`, `internal/claudeheadless`, `internal/mcpinstall` |
| Memory formats | `reference/memory-formats.md` | `internal/memory/memfmt/memfmt.go`, `parse.go`, `format.go`, `markers.go`, `internal/memory/importer/writedoc.go`, `docs/v2.5/plans/P273-memory-text-formats.md` |
| Architecture | `develop/architecture.md` | `README.md` (Architecture), `docs/ARCHITECTURE.md` (Stack, Invariants, Process model, Git module, ADE, Memory), `apps/kira-studio/internal/adapters/adapter.go` |
| Build and test | `develop/build-and-test.md` | `README.md` (Requirements, Development), `package.json` scripts, `docs/ARCHITECTURE.md` (Testing), `docs/DEV_ENVIRONMENT.md` (Real `claude` tests, Presentation screenshots and site check), `.githooks/pre-commit` |
| Contributing | `develop/contributing.md` | `CLAUDE.md`, `docs/HUMAN_CODE_REVIEW.md`, `site/scripts/docsRules.ts`, this plan (section 5) |

Content per page (what to cover; facts only from the sources):

- Overview: both apps in two lines each, platform (macOS 14+, Apple Silicon, dark only, beta), a map
  of the docs groups.
- Install: the `curl` command per app (`--app=studio`, `--app=space`), what the script does, Keychain
  "Always Allow" note (caution aside, normal prose), update flow (app offers, installs only on
  Update), build from source pointer to Develop.
- Databases: engines table (Engine, Default view, Query console, Writes: four columns, ten rows),
  Stop cancels server side, SQS polls only on Poll, connections (fields or URI, read-only guard,
  pre-connect script, DataGrip import, paste credentials, Update credentials), project panel,
  column masking.
- Data grid: paging sizes, count on request, projection, server filter and sort, history and saved
  filters, find, staged edits and the commit preview, cell editor formats, foreign key navigation,
  Generate data, Operations panel.
- SQL console: per-connection consoles, run statement or all, saved queries, Format, EXPLAIN,
  auto-explain and the expensive-query threshold (Settings > Advanced), DDL document for completions,
  result cap.
- API client: request builder, body kinds, gRPC, collections and Postman import and export,
  environments and variables, Faker values, secret masking, curl in and out, history (last 30) and
  timeline, incognito tabs, Settings > Api defaults.
- Docker: engines and contexts, containers, images, volumes, networks, logs, stats, exec terminal;
  insecure `tcp://` engine flag.
- Database MCP: off by default, Settings > Database MCP, loopback port 8766, bearer token, deny by
  default, per-connection read, write and DDL modes and their defaults, the approval dialog,
  heavy-query approval, masking before the client sees results.
- Git: requirements (Git 2.38+, optional `gh`), graph, detail and Go to file, refs and history
  rewriting, pre-flight and undo, remote operations and credentials, stash, branch review and AI
  review comments, search, worktrees and stacks, PR links, repository settings.
- Code workspace: repository import, file tree, viewer, diff tabs, search, blame, Markdown view.
- Agents: tasks and branches, base branch and stacking, workflows as YAML in the Space home
  `workflows` folder, stage kinds, step results and routes, graph editor, headless runs and
  `finish_step`, interactive sessions and Take over, Review code, rebase runs, agent tools behind
  `kira_space_mcp`, notifications, usage in the status bar. No restart or resume behaviour.
- Phone view: Settings > Mobile access, QR pairing and desktop approval, 30-day device tokens;
  plaintext LAN as a caution aside in normal prose.
- Memory: what a memory is (fact, reason, origin, scope, groups), add by hand, import files and
  folders (Memory > Import, job confirmation for large jobs, optional `.memory.md` write-back),
  search behaviour (keyword plus optional semantic), the semantic model download in Settings >
  Memory, registering the MCP server with Claude Code (Settings > Memory), storage path and
  `KIRA_MEMORY_HOME`. No ranking constants, no prompt text (P285 may change both).
- Automations: collections, run folder, run history, terminals, smart scripts (prompt, typed
  parameters text, select, multi-select, secret; model, budget, timeout; tool and MCP allowlist),
  schedules (cron, time zone, confirm each due run, no replay of missed runs), Space: run on a task
  or branch, as a workflow step.
- Settings: one section per app listing each Settings section and what it holds; defaults only where
  `settingsDomain.ts` states them; where data lives (homes, env vars, `kira.db`).
- Prompts: what Settings > Prompts shows (areas Memory, Agent runs, Rebase and review, Database MCP),
  edit and reset, badges (edited, default changed, invalid), when an edit applies (next call or new
  session).
- MCP tools: one section per server (`kira-memory`, Database MCP, Kira Space agent tools), each tool
  with its one-line purpose and arguments, taken from the registry defaults.
- Memory formats: the code comment block (header, `km_` fact and reason lines, comment markers per
  extension) and the doc file (front matter keys in order, sections, fact, reason and keywords
  lines), each with one fenced example that the parser accepts.
- Architecture: one Go process per app (Wails v3), Vue 3 in the system WebView, bindings plus the
  FlatBuffers data plane, capability-driven adapters, repository layout, pointer to
  `docs/ARCHITECTURE.md` on GitHub.
- Build and test: requirements, `bun run` scripts by purpose, hooks, test tiers, opt-in real `claude`
  tests, screenshots and site commands.
- Contributing: phase loop and plans (short), Conventional Commits, communication style, docs rules
  (section 5), the manual review checklist, how to add a docs page (folder, frontmatter, `sources:`).

## 4. Docs style check

### 4.1 Scope

`site/src/content/docs/**/*.{md,mdx}`. Landing copy (`site/src/data/*.ts`) stays out: P280 reviewed
it and the row asks for docs content.

### 4.2 Rules (each a pure function in `site/scripts/docsRules.ts`)

- D1 sentence length: more than 25 words fails. Sentences split at `.`, `?`, `!` followed by space
  or end; every list item, table cell and paragraph is its own unit. An inline code span counts as
  one word; link text counts, link URLs do not. Headings are exempt.
- D2 filler, case-insensitive, whole words: just, really, basically, actually, simply, very, quite,
  rather, somewhat, fairly, pretty much, easily, obviously, clearly, of course, certainly, sure
  (not after "make"), happy to, feel free, please, note that, in order to, it is worth, keep in
  mind, as you can see, a lot of, lots of, various.
- D3 invented abbreviations, whole words: cfg, conf, impl, req, reqs, res, resp, fn, func, msg,
  msgs, ctx, tmp, btn, approx, w/, w/o, b/c.
- D4 arrows: `→ ← ↔ ⇒ ⇐ ⟶ ⟵` and `->`, `=>`, `<-` in prose. `>` in menu paths stays legal.
- D5 emoji: any `\p{Extended_Pictographic}` code point in prose.
- D6 decorative tables: a table needs at least 3 columns and 3 body rows, and no empty cell;
  otherwise use a list.
- D7 terms (from the UI catalog): repo, repos, dir, dirs, directory, directories, preferences,
  color, canceled, e.g., i.e., etc., Github, MacOS, Postgres. Each message names the replacement.
- D8 markers: TODO, TBD, FIXME, XXX.
- D9 frontmatter: `title` present; `description` present, one sentence, D1-D8 apply; `sources`
  present, each path exists relative to the repo root.

### 4.3 Allow-list

Never checked: fenced and indented code, inline code, link and image URLs, autolinks, definitions,
HTML nodes, MDX ESM (`import`/`export`), JSX element names and attributes, frontmatter keys other
than `title`, `description`, `sources`. Inside a `:::caution` or `:::danger` aside, D1 and D2 are
off (normal prose allowed there by `CLAUDE.md`); D3-D8 still apply. No per-file or per-line
exemption mechanism: a page that needs one gets rewritten.

### 4.4 CLI

`site/scripts/check-docs.ts`: resolves paths from its own location, never `process.cwd()`. Prints
`check-docs: <file>:<line>: D<n> <message>`, then a count line; exit 1 on any hit. Root `lint` gains
`&& bun site/scripts/check-docs.ts` at the end.

### 4.5 Types and tests

- `site/scripts/tsconfig.json` mirrors `scripts/copy/tsconfig.json` (`types: ["bun-types"]`,
  resolved from root). Root `typecheck:docs-check` runs `tsgo --noEmit` over it with the repo's
  incremental cache flags, added to the `typecheck` aggregate with its own `wait`.
- One test file, `site/scripts/docsRules.spec.ts`: sentence splitting and allow-list masking are a
  splitter with interacting rules (`CLAUDE.md` unit-test bar). Cases: each rule fires once on a bad
  line; inline code, URLs, code fences, MDX imports and JSX do not fire; a 26-word sentence fails and
  a 25-word one passes; a caution aside allows a long sentence but still flags an arrow; version
  numbers (`1.29.1`) do not split sentences. Root `test:unit` gains `site/scripts`.

## 5. Manual review pass

After all pages land, read each page once against this checklist and fix in place:

1. One idea per sentence; active voice; present tense where true.
2. Instructions are imperative ("Open Settings > Memory", not "Settings can be opened").
3. One term per concept across all pages (task, run, session, step, stage, workflow, fact, memory,
   connection, repository, folder), matching UI labels in `en.json`.
4. A pronoun only with one possible referent.
5. Normal prose only in caution or danger asides, and only for security, irreversible actions or
   real ambiguity.
6. Every claim traced to `sources:`; grep it again if unsure. No feature from P279, P285-P287.
7. Not shorter when terse? Use the plain phrasing (`CLAUDE.md` governing rule).

Record the pass per page in section 12 (page, fixes made). `develop/contributing.md` carries the
same checklist for later edits.

## 6. Site check extension

New `site/tests/docs.spec.ts`, same config (`phone` 375 px WebKit, `desktop` 1280 px WebKit). Page
list: glob of `src/content/docs/docs/**` turned into URLs (a missing route fails as non-200).
Per page, both projects:

1. Answers 200; `h1` text equals the frontmatter title.
2. No horizontal scroll (`scrollWidth <= innerWidth`); `html` and `body` `overflow-x` not `hidden`
   or `clip`.
3. Every `<img>` loads and fits the viewport width.
4. Every same-origin link and asset under `/kira-studio/` answers 200 (one shared visited set).
5. No console errors.
6. Phone: content `p` and `li` at least 16 px; sidebar links and header buttons at least 44 px tall.
7. Desktop: sidebar visible, the current page link has `aria-current="page"`.

Flows:

- Search, both projects: open the search dialog, type `store_memory`, expect a result linking
  `docs/reference/mcp-tools/`, follow it, expect that page's `h1`.
- Phone nav: open the menu button, tap the "SQL console" link, expect its URL and `h1`.
- Landing to docs: the landing header `Docs` link answers 200; the docs site title links back to
  `/kira-studio/`.
- Dark only: with `colorScheme: 'light'` emulated, `html` has no `data-theme="light"`.
- Shots: on the six `.mdx` pages, phone shows the `-detail` crop, desktop the framed image.

The landing `site.spec.ts` stays as is; its crawl now covers the `Docs` link too.

## 7. Workflow

None (decision 18). Verify: `pages.yml` unchanged; `git diff fe8fb9fc8 --stat -- .github/workflows
docs/pending-workflows` empty.

## 8. Licences

All MIT unless named: `@astrojs/starlight` 0.42.x, `@astrojs/starlight-tailwind` 5.0.0,
`@astrojs/markdown-remark` 7.3.2, transitive `pagefind` and `@pagefind/*` platform binaries 1.5.2,
`astro-expressive-code` 0.44.x, `@astrojs/mdx`, `@astrojs/sitemap`, `i18next`, `satteri`;
checker `unified` 11, `remark-parse` 11, `remark-gfm` 4, `remark-frontmatter` 5, `remark-mdx` 3,
`remark-directive` 4, `unist-util-visit` 5, `@types/mdast` 4; `yaml` 2 (ISC). Implementer
re-checks at the installed versions: `jq -r .license` over each new direct dependency's installed
`package.json`, plus Pagefind's platform package; every value MIT, ISC or Apache-2.0. Anything else
stops the step.

## 9. Execution

### 9.1 Steps and commits (each passes the pre-commit hook, no `--no-verify`)

1. Scaffold: deps, `astro.config.mjs`, `content.config.ts`, CSS split, `Empty.astro`, favicon
   endpoint, `nav.ts` Docs link, `resolveShot` export, `DocShot.astro`, knip block, site tsconfig
   exclude, one placeholder `index.md` (real `sources:`). `bun install`; `bun run site:build`;
   `bun run lint:dead`. Commit `feat(site): Starlight docs scaffold`.
2. Docs check: `docsRules.ts`, `check-docs.ts`, `tsconfig.json`, `docsRules.spec.ts`, root `lint`,
   `typecheck:docs-check`, `test:unit` wiring. `bun test site/scripts`. Commit `feat(lint): docs
   style check`.
3. Start pages: Overview, Install. Commit `docs(site): start pages`.
4. Kira Studio pages (six). Commit `docs(site): Kira Studio pages`.
5. Kira Space pages (five). Commit `docs(site): Kira Space pages`.
6. Both apps and Reference pages (five). Commit `docs(site): automations and reference pages`.
7. Develop pages (three); root `README.md` "Documentation" gains the docs site link (normal prose).
   Commit `docs(site): developer pages`.
8. Site check: `site/tests/docs.spec.ts`. Commit `test(site): docs pages at phone and desktop
   widths`.
9. Manual pass (section 5). Commit `docs(site): manual style pass`.

Content steps write each claim only after grepping it in a listed source. Use `codegraph_explore`
for any behaviour question the sources do not settle (which component, which default, which call
path); record the calls in section 12.

### 9.2 Serial test-and-fix (same implementer, after step 9)

`bun run lint`, `bun run typecheck`, `bun test site/scripts`, `bun run site:check`,
`bun run lint:dead`. Fix at cause, commit per group (`fix(site): ...`). Machine is shared with P279:
no `test:ui`, flow, Go, visual or `screenshots` runs in this phase.

### 9.3 Close-out

1. `docs/ARCHITECTURE.md` "Presentation site": docs under `/docs/` with Starlight, CSS split,
   dark-only override, `sources:` frontmatter, docs check and its rules file, docs JS accepted for
   search. Replace the stale "Starlight (P284)" bullet.
2. `docs/DEV_ENVIRONMENT.md` presentation section: `site:check` covers docs; Pagefind runs in
   `astro build` (Linux binary from the optional dep).
3. `docs/v2.5/SPEC.md`: P284 `Done` with a one-line result.
4. This plan, section 12.
5. Commit `docs: P284 close-out`. `git pull --rebase origin v2.0` first (P279 also closes out in
   `ARCHITECTURE.md`, `DEV_ENVIRONMENT.md`, `SPEC.md`; different sections, keep both). Push
   `origin v2.0`.

### 9.4 File ownership

| Owner | Paths | Note |
|---|---|---|
| P284 | `site/**` | new content, scripts, tests, config |
| P284 | root `package.json` (`lint`, `typecheck`, `typecheck:docs-check`, `test:unit` only), `bun.lock`, `knip.json` (`site` block), `README.md` (Documentation) | P279 adds no dependency or script per its plan |
| P284 close-out | `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/v2.5/SPEC.md`, this plan | P279 close-out edits other sections |
| Never | `apps/**`, `packages/**`, `internal/**`, `screenshots/**`, `.github/**`, `CLAUDE.md` | P279 owns code; shots stay P280's |

### 9.5 After P284

Report to the orchestrator: P279, P285, P286 and P287 each update the docs page their change
affects at close-out (find it with `rg -l "<changed path>" site/src/content`), and P283's docs update
covers the docs site. Recording that as a standing rule in `CLAUDE.md` is the user's call; this phase
does not edit `CLAUDE.md`.

## 10. Finding during planning (not fixed here)

Studio Settings footer shows `~/.kira-studio/kira.sqlite`
(`apps/kira-studio/frontend/src/workbench/SettingsDialog.vue:20`, `SETTINGS_DB_PATH`), but the
database is `kira.db` (`apps/kira-studio/internal/config/paths.go` `DbPathAt`). Docs state `kira.db`.
The fix is in `apps/**` (P279's area during this phase): report it for a named follow-up phase in
`SPEC.md`, per `CLAUDE.md`.

## 11. Verification (orchestrator, real checks)

1. `git log fe8fb9fc8..v2.0 --format=%s` shows the section 9.1 commits in order, then fixes, then
   close-out.
2. `git diff fe8fb9fc8 --stat -- apps packages internal screenshots .github CLAUDE.md` lists no P284
   commit (`git log` per path).
3. `rg -n "starlight\(" site/astro.config.mjs` one hit; `rg -n "disable404Route: true"` one hit;
   `rg -n "docsSchema" site/src/content.config.ts` one hit.
4. `fd -e md -e mdx . site/src/content/docs/docs | wc -l` is 21; every file has `sources:`.
5. `rg -n "DocShot" site/src/content` lists six files; `ls site/public` shows no favicon copy.
6. `rg -n "check-docs" package.json` inside `lint`; `bun site/scripts/check-docs.ts` exits 0; a
   scratch page with `→` and "just" makes it exit 1 (delete after).
7. `bun test site/scripts` passes; `rg -n "site/scripts" package.json` inside `test:unit`.
8. `bun run site:check` passes; the log shows `docs.spec.ts` under both projects, including the
   search flow.
9. Licence values per section 8.
10. Section 12 lists the manual pass for all 21 pages and the omitted-feature check.
11. Planner and implementer tool logs show real `codegraph_explore` calls.

## 12. Result

Accuracy pass (serial verifier). Implementer ran no `codegraph_explore`; it checked deep UI claims
against README wording only. Verifier ran 15 `codegraph_explore` calls plus targeted grep of source
and `packages/theme/src/i18n/en.json`.

Fixed or removed:

- data-grid: cell formats now text/json/xml/csv/sql/iso8601/epochSeconds/epochMillis/base64/hex (UUID and URL removed in P42). Beautify only for JSON and XML. FK works on PostgreSQL, MySQL, MariaDB, SQLite; popover opens a new tab, edit through cell menu. Generate data: read-only connections excluded. Operations: cancel and re-run wording.
- sql-console: explain scope is SELECT/WITH on PostgreSQL, MySQL, MariaDB, SQLite, ClickHouse; auto-explain skips above 10 statements.
- api-client: gRPC unary and server-streaming only; Postman export skips gRPC; timeline phases; incognito and history-masking wording.
- git: Skip offered for rebase, cherry-pick, revert; not merge.
- agents: `parked` branch kind; script stage has no steps; `runs_on` values; `stop` only for non-ok result; no-report string `no report: Claude ended without calling finish_step`; `on_failure` rules.
- automations: params are text, select, multi-select, each optionally secret.

Verified, no change: docker, workspace, phone, memory, settings, prompts, mcp-tools (memory, database, agent tools: names, args, limits), schedule semantics, budget rule.

Not code-verified (README-derived): git hazard list, review snapshot, AI comments; databases and database-mcp pages spot-read only.

Out of docs scope, reported: `README.md` still lists UUID/URL cell formats and "(PostgreSQL/MariaDB)" FK; `docs/ARCHITECTURE.md` calls the third branch kind "a placeholder with no branch yet"; Studio Settings footer shows `kira.sqlite`, real file `kira.db` (Known open items).

## 13. Risks and decided fallbacks

- `logo.src` outside the site root rejected by Starlight: override the `SiteTitle` component and
  import the SVG through `astro:assets`, as `Header.astro` does.
- `disable404Route` missing in the installed Starlight: stop and report; never delete P280's 404.
- Starlight's dark palette needs `data-theme="dark"` after all: `docs.css` sets the dark `--sl-*`
  tokens on `:root` unconditionally; the dark-only test is the guard.
- Pagefind index empty in `astro preview`: the search flow fails loudly; fix the build, never skip
  the test.
- Docs check false positive on a real phrase: rewrite the sentence; widen a rule only with the
  reason in a code comment and a spec case.

## 14. Out of scope

New screenshots; landing page copy; docs translations; versioned docs; edit-on-GitHub links (the
chapter branch is not `main`); docs search beyond Pagefind; any `apps/**`, `packages/**` or
`internal/**` change, including the section 10 bug.

## 15. Decisions log (one line each)

- Starlight: MIT, search, nav and a11y ready.
- 0.42.x pin under Astro 7.3.8: no Astro upgrade.
- `/docs/` prefix by folder: no route collision with the landing page.
- Docs accept Starlight JS: search needs it; landing stays zero JS.
- `disable404Route`: one 404 page.
- Empty theme overrides: dark only, like the apps.
- CSS split with `theme.css`: no preflight on docs, one token source.
- Favicon endpoint: exact name, no copied asset.
- Autogenerated sidebar: no page missing from nav.
- `.mdx` only for shots: plain Markdown elsewhere.
- P280 shots only: new captures would touch P279's paths.
- `sources:` frontmatter: traceable claims, findable by later phases.
- Check under `site/scripts`: deps resolve under the isolated linker.
- remark AST parser: exact code, link and table handling (library rule).
- UI terms reused: one term per concept across app and docs.
- Pending features omitted: no stale notes.
- No workflow change: `pages.yml` already builds `site/**`.
- One sequential implementer: one site, ordered steps.
