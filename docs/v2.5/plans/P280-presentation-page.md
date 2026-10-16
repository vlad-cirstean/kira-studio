# P280 plan: Presentation page (Astro)

Ask (SPEC row P280): public presentation page for both apps, Astro plus Tailwind, hosted on GitHub
Pages at `https://vlad-cirstean.github.io/kira-studio/` (`base: '/kira-studio'`, no custom domain).
Deploy through a GitHub Action with `actions/configure-pages`, `actions/upload-pages-artifact`,
`actions/deploy-pages`, shipped under `docs/pending-workflows/`. Mobile-first, checked by Playwright
at phone and desktop widths. Real screenshots, generated once by a documented Playwright command from
the real frontends at a small window size, committed under `screenshots/`, shown on the page and in
root `README.md`. macOS traffic lights overlaid from a committed static asset, never captured. Page
text follows `CLAUDE.md` "Communication style". Structure stays ready for Starlight (P284).

Base: `v2.0` at `8c19cf097`. P278 (git graph blank) runs in parallel in the main checkout and owns
`packages/git-ui/**`, `packages/git-core/**`, `apps/kira-space/tests/ui/**`,
`apps/kira-space/tests/e2e-real/fixtures.ts`, `docs/ARCHITECTURE.md`. This phase never edits those
paths; section 8 orders the work around it.

Discovery ran through `codegraph_explore`: `createUiFixtures`, `startServer`/`serveStatic`
(`@workbench/testing/ui`), shared `installControlMocks`/`canonical`/`serveWailsRuntimeJs`, Studio
`tests/ui/fixtures.ts` and `support/mockRuntime.ts`, `adeV2Control`, `buildGraphStreamChunk`,
`PackedStreamState`, `internal/shell/window.go` `minWindowWidth`/`minWindowHeight`/`DefaultBounds`.
Targeted reads where the index had no hit (configs, test trees, docs): both `playwright.config.ts`,
Space `tests/ui/fixtures.ts`, `tests/visual/git-module.spec.ts`, Studio `tests/visual/workbench.spec.ts`
and `README.md`, `tests/visual/support/pin-fonts.css`, `adeV2.ts` exports, `tokens.css` title bar
tokens, `TitleBar.vue` class list, both `tsconfig.tests.json`, frontend `tsconfig.json` includes,
`knip.json`, `biome.json`, `.githooks/pre-commit`, scope of every `bun run lint` script,
`check-conventions.ts` `SPEC_ROOTS`, `scripts/prepare-worktree.sh`, `.github/workflows/pr.yml`,
`docs/DEV_ENVIRONMENT.md` workflow section, root and Space `README.md`, P278 plan ownership.

Facts that shape the design:

- UI fixtures already run the real production frontend bundle (`frontend/dist`) against a mocked
  Wails runtime: `createUiFixtures` serves `distDir` statically and `installControlMocks` answers
  every bound call from `ControlSnapshot` fixtures. No Go backend, no Keychain, no credentials.
- `createUiFixtures` opens each page with `browser.newPage({ timezoneId })` and a fixed
  `setViewportSize({ width: 1440, height: 960 })`. Project `use` options (scale, viewport) do not
  reach `browser.newPage`, so window size and pixel ratio need fixture options.
- Smallest real window: `minWindowWidth = 1024`, `minWindowHeight = 640` (`internal/shell/window.go`).
- Title bar: `--kira-titlebar-h` 34 px, `--kira-titlebar-inset-left` 78 px of empty space reserved
  for the macOS traffic lights (`TitleBar.vue` `pl-titlebar-inset`). Screenshots of the mocked page
  show that empty inset; the overlay fills it.
- Visual tier precedent: `visual` projects (WebKit, `animations: 'disabled'`, `pin-fonts.css`)
  build realistic fixtures inline in each spec; reusable builders live in `tests/ui/support/`
  (`adeV2Control`, `graphStreamFixture`, `postgresFixture`, `ipcChannels`).
- Pre-commit runs `bun run lint` and `bun run typecheck`. Every lint script but Biome scans fixed
  app and package directories only; Biome scans `**` (`.astro` covered by
  `html.experimentalFullSupportEnabled`). `knip` (`lint:dead`, CI) needs a workspace block per
  workspace.

## 1. Site location and tooling

- `site/` at repo root, a Bun workspace member named `@kira/site` (root `package.json`
  `workspaces` gains `"site"`). Why not `apps/site`: `apps/*` holds Wails apps with Go and
  `frontend/`; a static site there misleads. Why a workspace, not a separate lockfile: one
  `bun install`, one `bun.lock`, hooks and knip see it like every other package.
- Dependencies, exact versions (repo convention), licence checked at the installed version:
  `astro` (MIT), `@astrojs/check` (MIT), `sharp` (Apache-2.0; prebuilt libvips LGPL-3.0, open
  source), `@fontsource-variable/inter` and `@fontsource/jetbrains-mono` (OFL-1.1 fonts, MIT
  package code). Tailwind reuses root `tailwindcss` and `@tailwindcss/vite` 4.3.3 (MIT). Pin the
  latest stable `astro` that the latest `@astrojs/starlight` lists in its `peerDependencies`, so
  P284 installs Starlight without an Astro upgrade. No other new dependency.
- Tailwind 4 through `@tailwindcss/vite` in `astro.config.mjs` `vite.plugins` (the
  `@astrojs/tailwind` integration is Tailwind 3 only). Types must line up without casts; if Astro's
  bundled Vite major differs from root `vite` 8.3.0, make `@tailwindcss/vite` resolve against
  Astro's Vite (site-local dependency entry) and record what worked.
- `astro.config.mjs`: `site: 'https://vlad-cirstean.github.io'`, `base: '/kira-studio'`,
  `trailingSlash: 'ignore'`, `output: 'static'`. Every internal link and asset goes through
  `import.meta.env.BASE_URL` or `astro:assets`; no hard-coded `/` paths.
- Root scripts: `site:dev` (`cd site && astro dev`), `site:build` (`cd site && astro check && astro
  build`), `site:check` (`bun run site:build && playwright test --config=site/playwright.config.ts`),
  `typecheck:site` (`cd site && astro check`) added to the `typecheck` aggregate with its own `wait`.
  Fallback, only if `astro check` cannot run under root TypeScript 6: `typecheck:site` becomes
  `cd site && astro sync && tsgo --noEmit -p tsconfig.json`; record the error in section 13.
- `site/tsconfig.json` extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, `src`,
  `tests`, `playwright.config.ts`.
- `knip.json`: workspace `site` with entry `src/pages/**/*.astro`, `playwright.config.ts`,
  `tests/**/*.spec.ts`; project `src/**/*.{ts,astro}`, `tests/**/*.ts`. Knip's Astro plugin
  enables itself from the dependency. Root workspace gains no entry (capture code lives in apps and
  `packages/workbench`, section 3).
- `.gitignore`: `site/.astro/` (generated types). `site/dist` is covered by `dist`.
- Biome: site files pass `biome check` with the repo config. If Biome cannot parse an Astro
  construct, restructure the file; an override only with the named Biome limitation in a comment.

## 2. Site structure (Starlight-ready)

```
site/
  astro.config.mjs
  package.json, tsconfig.json, playwright.config.ts
  public/            (empty unless a file must keep its exact name)
  src/
    data/nav.ts      header links; P284 appends Docs
    data/shots.ts    shot list: id, app, title, alt, caption, detail flag
    data/content.ts  page copy blocks (features per app, install lines)
    layouts/Base.astro    html shell, meta, Open Graph, favicon
    components/Header.astro, Hero.astro, AppSection.astro, Shot.astro, Install.astro, Footer.astro
    styles/global.css     @import "tailwindcss"; brand tokens
    pages/index.astro, pages/404.astro
  tests/site.spec.ts
```

- Starlight compatibility (final): no `src/content.config.ts` and no `src/pages/docs/**` now; P284
  adds the `docs` collection with Starlight's loader and serves docs under `/kira-studio/docs/`.
  `global.css` is the one Tailwind entry, so P284 adds Starlight's Tailwind layer there. Header
  links live in `data/nav.ts`, so P284 adds Docs without touching components. Screenshot imports go
  through one helper (`src/lib/shots.ts`), which P284 docs reuse.
- Brand colours: `global.css` imports `packages/theme/src/tokens.css` and maps a few `--kira-*`
  tokens into Tailwind `@theme` (`--color-bg`, `--color-fg`, `--color-muted`, `--color-accent`,
  `--color-border`). Why: one palette source; page and apps match. Dark only, like the apps.
- Fonts: Inter (UI) and JetBrains Mono (code) via Fontsource imports in `Base.astro`; same fonts as
  the screenshots (section 3.3).
- Favicon and touch icon from `apps/kira-studio/build/appicon.icon/Assets/kira_icon_vector.svg` and
  `apps/kira-studio/build/appicon.png` through `astro:assets` (`getImage` for a 180 px PNG). No
  copies.
- Zero client JavaScript: no islands, no `<script>`. Install command is a selectable code block.
- `404.astro`: one line plus a link home.

### 2.1 Page content

Copy follows `CLAUDE.md` "Communication style" (terse, one idea per sentence, about 20 words max,
imperative instructions, no filler). Facts come only from root `README.md` and
`apps/kira-space/README.md`; nothing invented.

1. Header: app icon, "Kira Studio", links Studio, Space, Install, GitHub.
2. Hero: h1 "Kira Studio and Kira Space". Line: "Two native macOS apps. Databases and APIs. Git and
   coding agents." Line: "Free and open source. macOS 14+ on Apple Silicon." Buttons: Install
   (anchor), GitHub. Hero image: `studio-data-grid` framed.
3. Kira Studio section: one-sentence summary; features: ten engines (list from README "Supported
   engines"), data grid editing, SQL console, Api mode (HTTP and gRPC), Automations, Docker,
   Database MCP server. Shots 1-3.
4. Kira Space section: summary; features: git graph and review, code workspace, coding agents
   board, memory store with MCP server, terminal, phone view. Shots 4-6.
5. Install: the README `curl` line for each app (`--app=studio`, `--app=space`), build-from-source
   pointer to GitHub. Beta and ad-hoc signing note in normal prose (security note, `CLAUDE.md`
   allows).
6. Footer: MIT licence, GitHub, source of the page.

### 2.2 Mobile-first layout

- Base styles target 375 px; `md:` and `lg:` add width. Content column `max-w-5xl`, side padding
  16 px on phones.
- `Shot.astro` renders `<picture>`: below `md` (768 px) the detail crop, from `md` up the framed
  full window. Sources via `getImage` (WebP plus PNG fallback `<img>`), explicit `width`/`height`,
  `loading="lazy"` except the hero, `decoding="async"`. Each shot links to the full framed PNG so a
  phone user can open and zoom it.
- Code blocks wrap (`whitespace-pre-wrap break-all`) instead of scrolling: no element wider than the
  viewport. Never `overflow-x: hidden` on `html` or `body` to hide overflow (the check in section 6
  rejects it).
- Body text 16 px minimum on phones, tap targets 44 px minimum.

## 3. Screenshots

### 3.1 Capture design (final)

- Source: the real production frontend bundles (`bun run build:test:studio`,
  `bun run build:test:space`), the same code the Wails apps embed, driven by the existing mocked
  runtime and fixture snapshots. Why: deterministic, no backend, no credentials; the e2e-real tier
  needs Docker, a real `claude` and live repos.
- Window: 1024 x 640 CSS px (the apps' minimum window, `minWindowWidth`/`minWindowHeight`), device
  scale factor 2. Why: the smallest real window keeps text largest relative to the image; scale 2
  keeps it sharp when a phone zooms.
- Browser: WebKit (the engine both apps embed), `timezoneId: 'UTC'`, `locale: 'en-US'`, clock
  installed at `FIXED_NOW` from `apps/kira-space/tests/ui/support/adeV2.ts` for both apps, so
  relative dates never drift.
- Fixture options: `packages/workbench/src/testing/ui/fixtures.ts` `UiFixturesOptions` gains
  optional `viewport`, `deviceScaleFactor`, `locale`, passed to `browser.newPage`; `viewport`
  replaces the fixed 1440 x 960 only when set. Additive; every existing spec keeps today's values.
- Playwright project `screenshots` in each app's `playwright.config.ts`: `testDir:
  './tests/screenshots'`, `testMatch: '**/*.shot.ts'`, WebKit, `workers: 1`, `fullyParallel: false`,
  `retries: 0`. `.shot.ts` keeps these files out of `ui` and `visual` runs and out of the
  `check-conventions` spec rules. Both `tsconfig.tests.json` include `tests/screenshots/**/*.ts`.
- Shot files: `apps/kira-studio/tests/screenshots/studio.shot.ts`,
  `apps/kira-space/tests/screenshots/space.shot.ts`. They import fixtures and builders from each
  app's `tests/ui/` (read only, never edited) and build their own realistic data inline, the
  `tests/visual` pattern. Data is fictional but plausible (repo `acme-web`, people such as
  "Ana Pop", "Mihai Ionescu"); no real people, no secrets, no "Fake" or "test" labels on screen.
- Shared helper `packages/workbench/src/testing/screenshots/capture.ts`:
  `captureShot(page, { id, detail })`:
  1. Move the mouse to a neutral point; wait for `document.fonts.ready`; assert
     `document.fonts.check('13px Inter')`; assert no console errors (the `consoleErrors` fixture).
  2. Full viewport PNG (`animations: 'disabled'`, `caret: 'hide'`, `scale: 'device'`) to
     `screenshots/<id>.png`.
  3. Detail crop (`clip`, 440 x 330 CSS px, per-shot origin over the feature) to
     `screenshots/<id>-detail.png`. Why 440 px: shows at about 0.78 scale in a 343 px phone column,
     so 13 px app text stays near 10 px.
  4. Framed copy to `screenshots/framed/<id>.png` (section 3.2).
- Output root resolved from the helper's own location, never from `process.cwd()`.

### 3.2 Traffic lights (final: composited in the capture step)

- Asset: `screenshots/assets/traffic-lights.svg`, hand-written, 52 x 12 viewBox, three 12 px circles
  at x 0, 20, 40: `#FF5F57`, `#FEBC2E`, `#28C840`, each with a 0.5 px darker stroke.
- Compositor: the helper opens a second page in the same context, `setContent` with a fixed HTML
  frame: 1024 x 640 box, 10 px radius, `overflow: hidden`, 1 px `rgb(255 255 255 / 0.1)` inner
  border, the raw PNG as a data URL, the SVG absolutely placed with circle centres at x 20, 40,
  60 px and y 17 px (centre of the 34 px title bar, inside the 78 px inset). Element screenshot
  with `omitBackground: true`, so corners stay transparent on light and dark GitHub themes.
- Why compositing, not a CSS overlay on the page: GitHub Markdown cannot overlay images, so
  `README.md` needs composited files anyway; one compositor gives the page and README the same look.
  Raw `screenshots/<id>.png` stays free of window buttons; framed files are derived.
- Why HTML in Playwright, not an image library: Playwright is already the capture tool; no new
  dependency.

### 3.3 Fonts

- Capture pins `--kira-font-ui` to Inter and `--kira-font-family` to JetBrains Mono, through an init
  script that registers both faces as `FontFace` objects from the Fontsource `woff2` files (read
  from `node_modules`) before any app script runs, then sets the two variables on `:root`. Why: the
  apps use `-apple-system` and Menlo, which do not exist on Linux; Inter and JetBrains Mono are open
  fonts close to SF Pro and Menlo, and the page uses the same pair.
- Canvas views (commit graph, data grid) measure text at mount. If a determinism rerun or a visual
  review shows fallback glyphs on a canvas, the shot resizes the viewport by 1 px and back after
  `document.fonts.ready`, which runs the view's own resize repaint. No fixed waits.

### 3.4 Shot list

| Id | App | View | Fixture source to reuse |
|---|---|---|---|
| `studio-data-grid` | Studio | Postgres table in the data grid, a row selected | `tests/visual/data-view.spec.ts` setup, `tests/ui/support/postgresFixture.ts` |
| `studio-sql-console` | Studio | SQL console, a join query, result grid | `tests/visual/console.spec.ts` |
| `studio-api` | Studio | Api mode HTTP request with JSON response | `tests/visual/http-request-view.spec.ts` |
| `space-git-graph` | Space | Commit graph, branches and tags, detail pane open | `tests/visual/git-module.spec.ts` (graph detail), `support/graphStreamFixture.ts` |
| `space-agents-board` | Space | ADE board, tasks across stages, one run live | `tests/ui/support/adeV2.ts` `adeV2Control`, `emitRuns` |
| `space-memory` | Space | Memory module list with origin and scope | `tests/ui/memory-module.spec.ts`, `memory-provenance.spec.ts` snapshots |

Every shot asserts its key content visible before capture (rows rendered with non-empty subject,
grid cells, board cards), so a broken view never ships as a screenshot.

### 3.5 Command and determinism

- Root script `screenshots`: `bun run build:test:studio && bun run build:test:space && playwright
  test --config=apps/kira-studio/playwright.config.ts --project=screenshots && playwright test
  --config=apps/kira-space/playwright.config.ts --project=screenshots`. Never wired into hooks, CI or
  the Pages Action; rerun by hand when the UI changes.
- It rebuilds both `frontend/dist`: never run it while a UI suite runs in the same checkout.
- Determinism (final rule: byte-identical): after committing the PNGs, run `bun run screenshots`
  again; `git diff --exit-code -- screenshots/` must pass. A changed file means a nondeterministic
  input (clock, hover, animation, font race, async load); fix the cause, never add tolerance.
- Size budget: each PNG at most 700 KB, all of `screenshots/` at most 8 MB. Over budget: shrink the
  detail crops first, then report; never drop the scale factor silently.

## 4. Deploy workflow

`docs/pending-workflows/pages.yml` (complete, ready to copy):

- `on`: `push` to `main` with `paths` `site/**`, `screenshots/**`, `packages/theme/src/tokens.css`,
  `apps/kira-studio/build/appicon*/**`, `apps/kira-studio/build/appicon.png`, `package.json`,
  `bun.lock`, `.github/workflows/pages.yml`; plus `workflow_dispatch`.
- `permissions`: `contents: read`, `pages: write`, `id-token: write`. `concurrency`: group `pages`,
  `cancel-in-progress: false`.
- Job `build` (`ubuntu-latest`): `actions/checkout`, `oven-sh/setup-bun` (same pinned SHAs and
  `bun-version` as `pr.yml`), bun cache keyed on `bun.lock` (same as `pr.yml`),
  `bun install --frozen-lockfile`, `actions/configure-pages`, `bun run site:build`,
  `actions/upload-pages-artifact` with `path: site/dist`.
- Job `deploy` (`needs: build`): `environment: { name: github-pages, url: ${{
  steps.deployment.outputs.page_url }} }`, `actions/deploy-pages` (`id: deployment`).
- Every action pinned to a full commit SHA with a version comment (`pr.yml` convention). Resolve
  the current major tags with `gh api repos/actions/<name>/git/ref/tags/<tag>` (dereference
  annotated tags).
- No screenshot capture and no Playwright in the Action.

User steps (also in the final report and `docs/DEV_ENVIRONMENT.md`):

1. On a Mac session (its push credential has the `workflow` scope), move
   `docs/pending-workflows/pages.yml` to `.github/workflows/pages.yml` in one commit, and push.
2. In the GitHub repository, open Settings > Pages > Build and deployment, and set Source to
   GitHub Actions.
3. Merge the chapter branch to `main`, or run the "Pages" workflow by hand on `main`. The
   `github-pages` environment only accepts deployments from `main` by default; a manual run from
   another branch is rejected unless that branch is added under Settings > Environments >
   github-pages.
4. Open `https://vlad-cirstean.github.io/kira-studio/`.

## 5. README

Root `README.md` stays normal prose:

- Under the intro: a link to the presentation page, then a "Screenshots" section with the six
  framed images, grouped under Kira Studio and Kira Space, each with alt text and a short caption.
  Plain Markdown image syntax, relative paths `screenshots/framed/<id>.png`.
- "Development": add `bun run screenshots` (when and how to regenerate, the determinism rerun) and
  `bun run site:dev`, `bun run site:check`.
- "Documentation": point at `docs/v2.5/`, not `docs/v2.2/` (stale line, fix in passing).

`apps/kira-space/README.md` gains a link to the page and to the root Screenshots section; no image
copies.

## 6. Tests

No unit tests (`CLAUDE.md` bar: nothing here is complex logic).

- Site check, `site/playwright.config.ts` plus `site/tests/site.spec.ts`. Web server: `astro
  preview` on a fixed port, `url` with the `/kira-studio/` base. Projects: `phone` (WebKit, 375 x 812,
  `isMobile`, scale 2) and `desktop` (WebKit, 1280 x 800). Assertions, both projects:
  1. No horizontal page scroll: `document.documentElement.scrollWidth <= window.innerWidth`, and
     computed `overflow-x` of `html` and `body` is not `hidden` or `clip`.
  2. Every `<img>`: scrolled into view, `complete`, `naturalWidth > 0`, bounding box inside the
     viewport width.
  3. Every same-origin `href` and `src` under `/kira-studio/` answers 200.
  4. No console errors.
  5. Phone: each shot's `currentSrc` is the `-detail` image; paragraph and list text at least 16 px.
     Desktop: each shot's `currentSrc` is the framed image.
- Screenshot determinism: section 3.5 rerun.
- README render: `gh api -X POST /markdown -f mode=gfm -f context=vlad-cirstean/kira-studio -F
  text=@README.md` lists six `<img>` tags whose `src` paths exist in the tree.

Machine is shared: run only `astro check`, `astro build`, `bun run screenshots`, `bun run site:check`,
plus the hook's `lint` and `typecheck` and one `bun run lint:dead`. No `test:ui`, flow, Go or visual
suites in this phase (orchestrator rule for this run). The fixture change in section 3.1 is
additive and typechecked; the next serial test pass (P281 onward) runs the UI suites.

## 7. Docs (close-out, after landing)

- `docs/ARCHITECTURE.md`: new "Presentation site" section: `site/` workspace, Astro plus Tailwind,
  GitHub Pages via Actions, `base` path rule, screenshot pipeline (mocked frontends, 1024 x 640 at
  scale 2, composited traffic lights, byte-identical rerun), Starlight path for P284. Declined, for
  the `CLAUDE.md` library rule: Jekyll (Ruby toolchain beside Bun and Go; no component model);
  VitePress (docs-centric default theme fights a landing page; Vue SFC docs model not needed for
  one page). Written after P278's close-out, which edits the same file.
- `docs/DEV_ENVIRONMENT.md`: "Nothing pending now" becomes the `pages.yml` entry with the section 4
  user steps; new short section on `bun run screenshots` (WebKit, rebuilds `dist`, never beside a UI
  suite) and `bun run site:check`.
- `docs/v2.5/SPEC.md`: P280 status Done with a one-line result.
- This plan: section 13 Result.

## 8. Execution

### 8.1 Isolation and order

One Sonnet implementer, sequential (one site, one shot helper, order-dependent; no stream split).
P278 runs in the main checkout at the same time, so:

- Work in a worktree off current `v2.0` (record the commit in section 13):
  `git worktree add .claude/worktrees/p280 -b p280 v2.0`, then
  `sh scripts/prepare-worktree.sh` inside it. Its own `node_modules` and `frontend/dist` keep
  `bun install` and frontend builds away from P278's test runs.
- Never edit P278's paths (header). Imports from `apps/kira-space/tests/ui/support/*` are read only.
- No push.

### 8.2 Steps and commits (each passes the pre-commit hook)

1. Site workspace: `site/` skeleton, `astro.config.mjs`, `tsconfig.json`, `global.css`, root
   `workspaces` and scripts, `typecheck:site` in the aggregate, `knip.json` block, `.gitignore`.
   `bun install`; `bun run site:build` on a placeholder page. Commit `chore(site): Astro and Tailwind workspace`.
2. Capture harness, no PNGs: fixture options, `capture.ts`, traffic-light SVG, both `screenshots`
   projects, both `tsconfig.tests.json` includes, both `.shot.ts` files, root `screenshots` script.
   Develop shots by running the command inside the worktree; output stays uncommitted. Commit
   `test(screenshots): capture harness for both apps`.
3. Page: `data/*`, `lib/shots.ts`, layout, components, `index.astro`, `404.astro`. Shots load via
   `import.meta.glob` over `screenshots/framed/*.png` and `screenshots/*-detail.png`; `lib/shots.ts`
   throws at build time when a listed shot has no file, so a missing PNG fails the build loudly.
   Commit `feat(site): presentation page`.
4. Site check: `site/playwright.config.ts`, `site/tests/site.spec.ts`, `site:check` script. Commit
   `test(site): phone and desktop layout check`.
5. Deploy workflow and READMEs: `docs/pending-workflows/pages.yml`, root and Space `README.md`.
   Commit `docs: pages workflow and README screenshots`.
6. LAST implementation step, screenshots. Start only when P278 is landed: SPEC row P278 reads Done
   and its close-out commit is on `v2.0`. Otherwise stop and report; the orchestrator resumes this
   step later. Then: `git rebase v2.0` in the worktree (a conflict means an ownership breach: stop
   and report), rerun `sh scripts/prepare-worktree.sh`, `bun run screenshots`, open every PNG with
   the Read tool and check content, font, overlay position, no blank rows, no error toast. Commit
   `docs: P280 screenshots`. Rerun `bun run screenshots`; `git diff --exit-code -- screenshots/`.

Commits 3 to 5 build only with local uncommitted PNGs; commit 6 completes the tree. Accepted: the
phase lands as one rebased series and nothing is pushed in between.

### 8.3 Serial test-and-fix (same implementer, after step 6)

`bun run site:build`, `bun run site:check`, README render check, `bun run lint:dead`. Fix at cause;
commit per group (`fix(site): ...`). A UI fix that changes a shot reruns `bun run screenshots` and
the determinism rerun.

### 8.4 Landing and close-out

1. In the main checkout, only with a clean tree and no other agent committing:
   `git merge --ff-only p280`; then `git worktree remove .claude/worktrees/p280`;
   `git branch -d p280`.
2. Close-out edits (section 7). Commit `docs: P280 close-out`.

### 8.5 File ownership

| Owner | Paths |
|---|---|
| P280 | `site/**`; `screenshots/**`; `apps/kira-studio/tests/screenshots/**`, `apps/kira-space/tests/screenshots/**`; `apps/kira-studio/playwright.config.ts`, `apps/kira-space/playwright.config.ts` (new `screenshots` project only); both `apps/*/tsconfig.tests.json` (one include line); `packages/workbench/src/testing/ui/fixtures.ts` (additive options); `packages/workbench/src/testing/screenshots/**`; root `package.json`, `bun.lock`, `knip.json`, `.gitignore`; `README.md`, `apps/kira-space/README.md`; `docs/pending-workflows/pages.yml` |
| P280 close-out only | `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/v2.5/SPEC.md`, this plan |
| Never (P278) | `packages/git-ui/**`, `packages/git-core/**`, `apps/kira-space/tests/ui/**`, `apps/kira-space/tests/e2e-real/**` |

## 9. Verification (orchestrator, real checks)

1. `git log 8c19cf097..v2.0 --format=%s` shows the section 8.2 commits in order; the screenshots
   commit is the last implementation commit, after P278's close-out.
2. `git diff 8c19cf097 --stat -- packages/git-ui packages/git-core apps/kira-space/tests/ui
   apps/kira-space/tests/e2e-real` lists only P278 commits (`git log` per file shows no P280 commit).
3. `rg -n "base: '/kira-studio'" site/astro.config.mjs` one hit; `rg -n '"site"' package.json` in
   `workspaces`; `rg -n "typecheck:site" package.json` inside the `typecheck` aggregate.
4. `rg -n "tailwindcss" site/astro.config.mjs` and a Tailwind utility class in
   `site/src/components/*.astro`: Tailwind is really used. `rg -n "<style" site/src` none.
5. `ls screenshots/*.png screenshots/framed/*.png screenshots/*-detail.png` lists 6 raw, 6 detail,
   6 framed; `screenshots/assets/traffic-lights.svg` exists; `rg -n "traffic-lights.svg"
   packages/workbench/src/testing/screenshots` one hit; `du -sh screenshots` at most 8 MB.
6. Determinism: rerun `bun run screenshots`, then `git status --porcelain screenshots/` is empty.
7. `bun run site:check` passes both projects; the log shows the 375 px phone project ran.
8. `rg -n "screenshots/framed/" README.md` six hits; each path exists.
9. `docs/pending-workflows/pages.yml` uses `actions/configure-pages`, `actions/upload-pages-artifact`,
   `actions/deploy-pages`, each pinned to a 40-hex SHA; `git diff 8c19cf097 --stat --
   .github/workflows` is empty.
10. `rg -n "playwright|screenshots" docs/pending-workflows/pages.yml` shows no capture step.
11. Licence check: `jq -r .license` over each new dependency's installed `package.json` reads MIT,
    Apache-2.0 or OFL-1.1.
12. Copy check: page text and `src/data/content.ts` follow "Communication style" (no filler words,
    no arrows, no emoji, sentences about 20 words or fewer); every feature claim matches a README line.
13. Planner and implementer tool logs show `codegraph_explore` calls for discovery (implementer:
    when locating fixture builders and views beyond this plan).

## 10. Risks and decided fallbacks

- `@astrojs/check` peer range may exclude TypeScript 6: fallback in section 1, recorded.
- Astro's bundled Vite against root Vite 8: resolve `@tailwindcss/vite` to Astro's Vite; no casts.
- Font race on canvas views: resize repaint in section 3.3; the determinism rerun is the guard.
- Bun in CI is `pr.yml`'s pinned version; if `bun install --frozen-lockfile` fails there with this
  lockfile, bump both workflows together in the pending file and note it for the user.

## 11. Out of scope

Docs pages and the docs lint script (P284); custom domain; analytics; any client JavaScript; light
theme; capturing screenshots in CI; Space phone app screenshots.

## 12. Decisions log (final)

- Astro plus Tailwind: SPEC decision; static output, zero JavaScript by default, first-party image pipeline.
- Jekyll declined: Ruby toolchain beside Bun and Go; no component model.
- VitePress declined: docs-centric default theme fights a landing page.
- `site/` workspace member: one lockfile and install; hooks and knip cover it; `apps/*` means Wails apps.
- Pin the Astro version current Starlight supports: P284 installs Starlight without an upgrade.
- No content collection or `/docs` route now: Starlight owns both in P284.
- Tailwind 4 via `@tailwindcss/vite`: `@astrojs/tailwind` is Tailwind 3 only; root already ships 4.3.3.
- Palette from `packages/theme/src/tokens.css`: one colour source for apps and page.
- Zero client JavaScript: fastest mobile load; nothing on the page needs it.
- Screenshots from production bundles plus mocked runtime: real UI code, deterministic, no credentials.
- 1024 x 640 at scale 2: the apps' minimum window; largest text per image width; sharp on zoom.
- Detail crops 440 x 330 for phones: readable without zoom; full window one tap away.
- Traffic lights composited in the capture step: README cannot overlay; one look on page and README.
- Compositing with Playwright HTML: no new image dependency.
- Inter and JetBrains Mono in captures and page: open fonts close to the apps' macOS fonts.
- Byte-identical rerun as the determinism rule: a rerun must not churn the repo.
- `.shot.ts` in per-app `screenshots` projects: mirrors `visual`; stays out of `ui` runs and spec lint rules.
- Additive fixture options: window size and scale cannot reach `browser.newPage` otherwise.
- Worktree implementer: isolates installs and `dist` builds from P278's runs.
- Screenshots last, after P278 lands: the graph shot must show the fixed graph.
- No Playwright or capture in the Pages Action: screenshots are committed, the Action only builds.
- Actions pinned by SHA: `pr.yml` convention.
- Docs edits at close-out: P278 edits `docs/ARCHITECTURE.md` in parallel.

## 13. Result

Done. Base `v2.0` after P278 close-out `18c1af43b`.

- Site: `site/` workspace, Astro 7.3.8, Tailwind 4 via `@tailwindcss/vite`, zero client JavaScript.
  `bun run site:check`: 12 tests pass (phone 375 px, desktop 1280 px).
- Screenshots: six shots, `bun run screenshots`, byte-identical across three reruns. 2.8 MB total,
  each PNG under 260 KB. Fixes found while capturing:
  - `captureShot` framing opened its page on the shot's context; `browser.newPage` pages own their
    context, so framing now uses a fresh context at scale 2.
  - Space shots needed fixtures for `adeTaskRepos`, `codeWorkspaceRepoHeads`, `memoryImportJobs`,
    `memorySemanticStatus`, `memoryHistory`, `memoryContext` (each unmocked call is an HTTP 422 console error).
  - `studio-api` varied between runs: Monaco tokenizes JSON asynchronously (shot waits for
    coloured tokens) and fades scrollbars on a JS timer (capture hides them).
  - Detail crop origins retuned; memory shot selects a fact; hash-like fake SHAs.
- Page fixes from visual review: hero shot no longer repeats in the Studio section; header brand text
  hidden below 640 px.
- Licences: astro, `@astrojs/check`, `@tailwindcss/vite` MIT; sharp Apache-2.0 (prebuilt libvips
  LGPL-3.0, open source); both Fontsource packages OFL-1.1.
- Serial suites in this worktree: lint, typecheck, test:unit, test:ui:space, test:ui:studio,
  test:visual:space, test:visual:studio. Results in the final report.
- README images: all six `screenshots/framed/*.png` paths exist (2048 x 1280, transparent corners).
  Remote GitHub render check is the user's (`gh api` blocked here).
- Left for the user: `pages.yml` go-live (DEV_ENVIRONMENT.md).
