# P290 plan: Presentation page redesign

Source: `docs/v2.5/SPEC.md` row P290. Depends on P280 and P284 (both landed). Base `7eec31df7`.

Ask, condensed: (a) split the landing page into two subtabs, Studio and Space. (b) Keep theme
(colours, fonts); redesign hero, cards, sections, feature lists and screenshot frames. (c) Icons where
they help. (d) Studio screenshots use English names. (e) Drop the Develop docs section entirely: nav,
pages, links, lint rules and `sources:` referencing it; list every removal. (f) Docs follow `CLAUDE.md`
Communication style. `bun run lint` and `bun run site:check` stay green.

Discovery: `codegraph_explore` over the screenshot flow and i18n catalog (`packages/theme/src/i18n`).
`site/` is mostly unindexed Astro and Markdown, so it was read with targeted Bash.

## 0. How things work today

- Presentation page: `site/src/pages/index.astro` at `/kira-studio/`. Plain Astro on
  `site/src/layouts/Base.astro`, not Starlight. Zero client JavaScript.
  Order: `Header`, `Hero` (h1 `SITE.title`, tagline, Install and GitHub buttons, `studio-data-grid`
  shot), one `AppSection` per app (h2, summary, feature strings in bordered `li` boxes, remaining
  shots stacked), `Install` (both commands), `Footer`.
- Copy: `site/src/data/content.ts` (`SITE`, `APPS`, `INSTALL`). Facts come only from `README.md` and
  `apps/kira-space/README.md`. Nav: `site/src/data/nav.ts` (`#studio`, `#space`, `#install`, Docs,
  GitHub). Shots: `site/src/data/shots.ts` (six ids), resolved by `site/src/lib/shots.ts`.
- `Shot.astro` is shared by the landing page and Starlight docs (`DocShot.astro`). It serves the
  framed PNG/WebP at 768 px and wider, and the 440 x 330 detail crop below that.
- Theme: `site/src/styles/theme.css` maps `packages/theme/src/tokens.css` into Tailwind `@theme`
  (`bg`, `elevated`, `chrome`, `fg`, `muted`, `accent`, `accent-fg`, `border`). Fonts are Inter
  Variable and JetBrains Mono (Fontsource). Docs map the same tokens in `docs.css`.
- Docs: Starlight 0.42.6, 21 pages under `site/src/content/docs/docs/`. Sidebar in
  `site/astro.config.mjs`. Develop has three pages.
- Screenshots: `bun run screenshots` builds both test bundles, then runs the `screenshots` Playwright
  project of each app (`apps/*/tests/screenshots/*.shot.ts`) against the mocked Wails runtime.
  `packages/workbench/src/testing/screenshots/capture.ts` pins `locale: 'en-US'`, UTC, clock, fonts,
  WebKit, scale 2. Output: `screenshots/<id>.png`, `<id>-detail.png`, `framed/<id>.png`.
- Studio UI language is already English: the only catalog is `packages/theme/src/i18n/en.json`
  (`locale: 'en'`). The non-English part is the fixture data: Romanian person names in
  `apps/kira-studio/tests/screenshots/support/acme.ts` (`CUSTOMERS`: Ana Pop, Mihai Ionescu, Elena
  Radu, Andrei Dumitru, Ioana Stan, Radu Marin, Maria Toma, Paul Vasile) and in
  `apps/kira-studio/tests/screenshots/studio.shot.ts` (`RESULT_PAGE` rows, API body `customer`,
  three `toContainText('Ana Pop')` asserts). Connection, database, table and column names are English.
- Tests: `site/tests/site.spec.ts` (landing, one URL), `site/tests/docs.spec.ts` (every docs page;
  `PAGES.length >= 21`). Docs lint: `site/scripts/check-docs.ts` with rules D1-D9 in `docsRules.ts`;
  runs in root `lint` and in `site:build`. No site visual baseline exists.
- Icons in the repo: `@vscode/codicons` 0.0.46-24 (root dependency, the glyphs both apps draw;
  `src/icons/*.svg`, `fill="currentColor"`, 24 x 24), `@lucide/vue` 1.47.0 (Vue only; the site has no
  Vue integration), Starlight's built-in `Icon` set (no terminal, globe, table or robot glyph).

## 1. Decisions (final)

1. Subtabs are two static routes, not client-side tabs. `/kira-studio/` is the Studio tab;
   `/kira-studio/space/` is the Space tab. Why: deep links work with no JavaScript, each tab gets its
   own title, description and `og:image`, and the page keeps its "zero client JavaScript" property.
2. Tab bar semantics: links that change page are navigation, not an ARIA `tablist` (WAI-ARIA APG).
   Markup: `<nav aria-label="Apps">` with a `<ul>` of two links; the current one has
   `aria-current="page"`. Native Tab and Enter; visible `focus-visible` ring.
3. No `/studio/` route: it would duplicate `/`. Old `/#studio`, `/#space` links land on the Studio
   tab with the tab bar in view. No redirect script.
4. Icons: Codicons SVGs from `@vscode/codicons` (CC-BY-4.0 for icons, MIT for code; checked at
   package level and for the SVG files used). Why: same glyphs as both apps, every needed name exists,
   already a repo dependency. Attribution goes in the footer. Declined: Starlight `Icon` (no
   terminal, globe, table or robot glyph); Lucide (needs a new `lucide-static` or `@lucide/astro`
   package, and its glyphs differ from the apps).
5. Theme stays: only existing `--kira-*` colours, Inter and JetBrains Mono. Depth comes from
   `color-mix` tints of existing tokens, gradients, borders and shadows, not new hues.
6. Per-tab tint: Studio uses `--kira-info` (#3794ff); Space uses `--kira-ok` (#23d18b). Both are
   existing palette entries. Primary buttons stay `--kira-accent`.
7. Hero shots: Studio `studio-data-grid`; Space `space-agents-board`. Other shots become highlight
   sections.
8. Header nav drops Studio and Space (the tab bar owns them). New `NAV`: Install (`#install`), Docs,
   GitHub.
9. Studio English names (fictional, at most 14 characters so column widths and crops hold): Alice
   Morgan, Ben Carter, Chloe Hughes, Daniel Brooks, Emma Wright, Oliver Grant, Grace Turner, Henry
   Walsh. Space shots are not in the ask and stay unchanged.
10. Develop section is removed, not moved. Developer docs live in `README.md` and `docs/`.
11. Visual baseline: a new `site/tests/visual.spec.ts` with full-page `toHaveScreenshot` per tab per
    project. Linux-recorded in the sandbox; skipped on other platforms.

## 2. Routes and layout

New `site/src/layouts/Landing.astro` (props `app: AppId`). Renders inside `Base`:

1. `Header` (sticky, unchanged structure, new `NAV`).
2. Intro band: eyebrow line `SITE.tagline` plus `SITE.availability`, small, muted, with the app icon.
3. `AppTabs` (new): segmented control, full width on phone (two 50% segments, min height 44 px),
   inline on desktop. Each segment: app icon (codicon `database` / `git-branch`), app name, and a
   one-line hint at `sm` and up. Active segment: `bg-elevated`, tint ring, `aria-current="page"`.
   Not sticky.
4. `AppHero` (new; replaces `Hero.astro`): h1 app name, summary, CTAs (Install anchor, Docs for that
   app: `docs/studio/databases/` or `docs/space/git/`, GitHub), hero `Shot` with glow.
5. `FeatureGrid` (new; replaces the feature `ul` in `AppSection.astro`): cards, 1 column on phone,
   2 at `sm`, 3 at `lg`.
6. `Highlight` (new), one per remaining shot: eyebrow (icon plus label), h2 title, caption, 2-3
   bullet points with `check` icons, `Shot`. Alternates text left and right at `md` and up; stacks on
   phone, text first.
7. `Install` (props `app`): that app's command only, in a numbered two-step card (1 run the command,
   2 first launch Keychain prompt), beta note as a warning callout, build-from-source link.
8. `Footer`: adds "Icons: Codicons by Microsoft, CC BY 4.0" with links to the codicons repository and
   the licence.

Pages: `site/src/pages/index.astro` = `<Landing app="studio" />`; new `site/src/pages/space.astro` =
`<Landing app="space" />`. Each sets title, description and `og:image` (framed hero PNG) from
`APPS`. Delete `Hero.astro` and `AppSection.astro` once unused. `404.astro` keeps `Base` and gets the
new button style.

Links go through `import.meta.env.BASE_URL` (ARCHITECTURE rule). Add a helper `href(path)` in
`site/src/data/nav.ts` so `Header`, `AppTabs`, `AppHero` and `404` share it.

## 3. Visual system (tokens within the theme)

Add to `site/src/styles/theme.css` `@theme inline` (existing tokens only):

- Colours: `--color-subtle: var(--kira-fg-subtle)`, `--color-border-strong:
  var(--kira-border-strong)`, `--color-input: var(--kira-bg-input)`, `--color-info: var(--kira-info)`,
  `--color-ok: var(--kira-ok)`, `--color-warn: var(--kira-warn)`.
- Tint per tab: `Landing` sets `data-app` on `<main>`; `global.css` defines
  `[data-app=studio] { --tint: var(--kira-info) }`, `[data-app=space] { --tint: var(--kira-ok) }`, and
  `--color-tint: var(--tint)` in `@theme inline`, so `text-tint`, `border-tint/40`, `bg-tint/10` work.
- Radius: cards `rounded-xl`, shots `rounded-xl`, buttons and segments `rounded-lg`.
- Shadows: `--shadow-card: 0 1px 0 rgb(255 255 255 / 0.04) inset, 0 8px 24px -12px rgb(0 0 0 / 0.5)`;
  `--shadow-shot: 0 32px 80px -24px rgb(0 0 0 / 0.7)`.
- Type scale: h1 `text-4xl sm:text-6xl font-semibold tracking-tight`; h2 `text-2xl sm:text-4xl
  font-semibold tracking-tight`; eyebrow `text-sm font-medium uppercase tracking-wider text-tint`
  (phone body text stays at least 16 px; eyebrows are `span`, not `p`, so the 16 px test still holds
  for prose). Body `text-base sm:text-lg text-muted`.
- Backgrounds: hero gets an `aria-hidden` absolutely positioned radial gradient
  (`color-mix(in srgb, var(--tint) 18%, transparent)` to transparent), clipped by a wrapper with
  `overflow-hidden` (not `html`/`body`, which the test forbids). Sections separated by spacing plus a
  1 px gradient hairline (`from-transparent via-border-strong to-transparent`), no hard `border-t`.
- Feature card: `rounded-xl border border-border bg-elevated shadow-card p-5`; icon tile `size-10
  rounded-lg bg-tint/10 text-tint ring-1 ring-tint/20`; title `font-medium text-fg`; body
  `text-muted`. Hover: `border-tint/40` with `motion-safe:transition-colors`. No transforms.
- Shot frame (`Shot.astro`, shared with docs): `rounded-xl ring-1 ring-border-strong shadow-shot
  bg-chrome overflow-hidden`; `figcaption` with the shot title in `text-fg font-medium` and caption
  in `text-muted`. Prop `glow` (hero only) adds the tint glow behind the figure.
- Buttons: primary `bg-accent text-accent-fg rounded-lg min-h-11 px-5` with icon; secondary
  `border border-border-strong bg-elevated/60 hover:bg-elevated`.
- Install code: `pre` in `bg-chrome border border-border-strong rounded-lg`, a terminal-style header
  row with the `terminal` icon and the app name. No copy button (would need JavaScript).

Copy changes: `content.ts` features become `{ icon, title, body }` split from today's strings at the
colon (same facts). Add per-app `title` (page title), `description`, `hero` (shot id), `docs` (path),
`hint`, and `highlights: { shot, points }[]`. `shots.ts` gains `icon` and `label` (eyebrow). Every
new point comes from `README.md` ("Studio (database client)", "Api (HTTP/gRPC client)") or
`apps/kira-space/README.md`; one idea per point, at most 20 words, no claim beyond those files.

## 4. Icons

- Add `"@vscode/codicons": "0.0.46-24"` to `site/package.json` (same pin as root); run `bun install`.
- New `site/src/data/icons.ts`: static `?raw` imports of only the SVGs used, exported as
  `ICONS = { database, ... } as const` and `type IconName = keyof typeof ICONS`. A typo fails
  `astro check`.
- New `site/src/components/Icon.astro`: props `name: IconName`, `class?`, `label?`. Renders
  `<span class="inline-flex shrink-0 [&>svg]:size-full" set:html={ICONS[name]} />` with
  `aria-hidden="true"`, or `role="img"` plus `aria-label` when `label` is set.
- Starting set (each verified present in `src/icons/`): `database`, `table`, `code`, `globe`,
  `play-circle`, `sparkle`, `vm`, `plug`, `lock`, `git-branch`, `git-commit`, `files`, `robot`,
  `lightbulb`, `terminal`, `device-mobile`, `check`, `cloud-download`, `github`, `book`,
  `arrow-right`, `warning`. Feature map: Studio engines `database`, data grid `table`, SQL console
  `code`, Api mode `globe`, Automations `sparkle`, Docker `vm`, Database MCP `plug`, Keychain `lock`;
  Space git graph `git-branch`, workspace `files`, agents `robot`, memory `lightbulb`, terminal
  `terminal`, phone `device-mobile`.

## 5. Studio screenshots with English names

1. `apps/kira-studio/tests/screenshots/support/acme.ts`: replace `CUSTOMERS` with decision 9's names.
2. `apps/kira-studio/tests/screenshots/studio.shot.ts`: `RESULT_PAGE` rows use the first six names in
   the same order; API body `customer: 'Alice Morgan'`; the three asserts expect `'Alice Morgan'`.
3. Regenerate Studio only: `bun run build:test:studio && bunx playwright test
   --config=apps/kira-studio/playwright.config.ts --project=screenshots`. Do not run beside another UI
   suite in the same checkout (DEV_ENVIRONMENT). Rerun once and confirm
   `git status --porcelain screenshots/` shows no change after the second run.
4. Open the three framed PNGs and three detail PNGs; the detail crops must still frame the grid, the
   query plus result, and the response. Adjust `detail` coordinates only if a crop misses its feature.
5. Commit the nine changed PNGs. `README.md` "Screenshots" embeds the same files, so it updates
   without an edit. Space PNGs must show no diff.

## 6. Develop section removal inventory

Removed:

- `site/src/content/docs/docs/develop/architecture.md`
- `site/src/content/docs/docs/develop/build-and-test.md`
- `site/src/content/docs/docs/develop/contributing.md` (with its `sources:` entries `CLAUDE.md`,
  `docs/HUMAN_CODE_REVIEW.md`, `site/scripts/docsRules.ts`,
  `docs/v2.5/plans/P284-astro-documentation.md`; the other two pages' `sources:` go with them)
- Sidebar entry `{ label: 'Develop', ... directory: 'docs/develop' }` in `site/astro.config.mjs`.
- `site/src/content/docs/docs/index.md` line "Develop: architecture, build and test, contributing".
- `site/src/content/docs/docs/start/install.md` "Build from source" link to
  `../../develop/build-and-test/`. Replace with: "See [Building from source](https://github.com/vlad-cirstean/kira-studio#building-from-source)
  in the README."
- `README.md` "Documentation" bullet text "and developer docs". New text: "user guides for both
  apps and reference pages."

Checked, nothing to remove: `site/scripts/docsRules.ts`, `docsRules.spec.ts` and `check-docs.ts`
hold no Develop-specific rule; no other page's `sources:` lists a `develop/` path; `nav.ts`,
`content.ts`, `Footer.astro` have no Develop link; `CLAUDE.md` and `docs/DEV_ENVIRONMENT.md` have
none. Historical plans (`P284-astro-documentation.md`) stay as shipped.

Tests: `docs.spec.ts` minimum becomes `PAGES.length >= 18`. Add a test that `docs/develop/` answers
404 and that no docs page links to a `/docs/develop/` path.

## 7. Tests

`site/tests/site.spec.ts`:

- `ROUTES = [{ path: '', app: 'studio', shots: [3 studio ids] }, { path: 'space/', app: 'space',
  shots: [3 space ids] }]`. Each existing test runs per route (no horizontal scroll, images load and
  fit, links answer 200, no console errors, crop on phone and framed on desktop, 16 px text, 44 px tap
  targets).
- Tabs: `nav[aria-label="Apps"]` has exactly two links; the route's own link has
  `aria-current="page"`, the other has none. Clicking Space on `/` loads `space/` with h1
  `Kira Space`; clicking Studio returns with h1 `Kira Studio`.
- Deep link: `goto('space/')` directly shows the Space tab current.
- Keyboard: focus the Space tab link with Tab presses from the page top; its computed `outline-style`
  or `box-shadow` is not `none` under `:focus-visible`.
- Icons: every `svg` inside `main` and `footer` has an ancestor or self with `aria-hidden="true"`, or
  an `aria-label`.
- Head: each route's `og:image` contains its hero id; titles differ.
- Footer: Codicons attribution link present.

New `site/tests/visual.spec.ts`: for each route, wait `document.fonts.ready`, scroll to load every
lazy image, back to top, then `toHaveScreenshot('<app>.png', { fullPage: true, animations:
'disabled', caret: 'hide' })`. `test.skip(process.platform !== 'linux', 'Linux-recorded baseline')`.
Record with `--update-snapshots` once, run `site:check` twice more, both green. Baselines:
`site/tests/visual.spec.ts-snapshots/{studio,space}-{phone,desktop}-linux.png`.

`docs.spec.ts`: as in section 6. `docsRules.spec.ts`: unchanged. `check-docs` passes over 18 files.

No backend half: the site has no IPC boundary, so the split-test rule does not apply.

## 8. Docs updates

- `docs/ARCHITECTURE.md` "Presentation site (P280)" section only: routes (`/` Studio tab, `/space/`
  Space tab, `nav aria-label="Apps"` with `aria-current`), still zero client JavaScript, tint tokens,
  Codicons icons (CC-BY-4.0, footer attribution), `visual.spec.ts` baseline, docs page count 18, and
  the check list. Add one line: P290 removed the Develop docs; developer docs are `README.md` and
  `docs/`.
- `README.md`: "Documentation" bullet (section 6). Line 15 also names the Space tab:
  "See both apps on the presentation page" stays; add the Space URL. Normal prose (README exemption).
- `docs/DEV_ENVIRONMENT.md` "Presentation screenshots and site check (P280)" only: Studio-only capture
  command; site visual baselines are Linux-recorded in this sandbox, skipped elsewhere, refreshed with
  `bunx playwright test --config=site/playwright.config.ts visual --update-snapshots` only for an
  intended change.
- Pages workflow stays in `docs/pending-workflows/pages.yml`; its `site/**` path filter and
  `bun run site:build` already cover the new route. No change; do not create `.github/workflows/`.

## 9. Execution

One sequential Sonnet implementer. Each step is one commit that passes the pre-commit hook. On resume,
compare `git log --oneline 7eec31df7..HEAD` with the subjects below and continue at the first missing
one.

1. `feat(site): codicons icon component and theme tokens`: section 4 plus section 3 tokens and
   footer attribution. `bun install` updates `bun.lock`.
2. `fix(screenshots): English names in Studio shots`: section 5 (fixtures plus nine PNGs).
3. `feat(site): Studio and Space tabs as routes`: `Landing.astro`, `AppTabs.astro`, `space.astro`,
   `index.astro`, `nav.ts` (`href`, new `NAV`), `content.ts` per-app fields, `Install` per app. Old
   components may still render inside the new layout.
4. `feat(site): redesign landing hero, cards, highlights and frames`: `AppHero`, `FeatureGrid`,
   `Highlight`, `Shot` frame, buttons, `404`; delete `Hero.astro` and `AppSection.astro`.
5. `docs(site): remove Develop section`: section 6 removals, `install.md` and `index.md` edits,
   `docs.spec.ts` count and 404 test, README bullet.
6. `test(site): tab routes, accessibility and visual baselines`: section 7 plus baseline PNGs.
7. `docs: P290 presentation site notes`: section 8.
8. Test-and-fix: `bun run lint`, `bun run typecheck` (root, if defined), `bun run test:unit`,
   `bun run site:check` twice. Fix every failure, pre-existing or not, as `fix(site): ...` commits.
   Never `--no-verify` as a finish.
9. Close-out `docs: P290 close-out`: append "## 14. Result" to this plan (what shipped, any deviation
   and why), mark the SPEC row Done.

Check copy against Communication style while writing (`content.ts`, docs edits): no filler, no
invented abbreviations, no arrows, at most 20 words per sentence.

## 10. File ownership

P290 touches only:

- `site/**` except `site/src/content/docs/docs/{studio,space,shared,reference}/**`. Docs content
  edits are limited to `docs/index.md`, `docs/start/install.md` and deleting `docs/develop/**`.
- `apps/kira-studio/tests/screenshots/**`, `screenshots/studio-*.png`,
  `screenshots/framed/studio-*.png`.
- `bun.lock`; `README.md` (line 15 and "Documentation" bullet); `docs/ARCHITECTURE.md` "Presentation
  site" section; `docs/DEV_ENVIRONMENT.md` "Presentation screenshots and site check" section;
  `docs/v2.5/SPEC.md` row P290; this plan.

Overlap with P289 (prompt registry, `internal/llmprompts/**`, MCP texts, eval harness): no code
overlap. P289 may edit `site/src/content/docs/docs/reference/{prompts,mcp-tools}.md` under the page
ownership rule; P290 does not touch them. Shared files are `docs/ARCHITECTURE.md`, `README.md`,
`docs/DEV_ENVIRONMENT.md` and `SPEC.md`, at different sections; P289 lands first by table order, so
P290 rebases on it. Overlap with P286 (workflow review step): none; P290 never touches
`site/src/content/docs/docs/space/**` or Space code.

## 11. Verification (orchestrator, real checks)

- `ls site/src/content/docs/docs/develop` fails; `grep -rn "develop/" site/src README.md
  docs/ARCHITECTURE.md` finds no docs link; `grep -n Develop site/astro.config.mjs` is empty.
- `grep -rn "Ana Pop\|Ionescu" apps/kira-studio/tests/screenshots` is empty; open
  `screenshots/framed/studio-*.png` and see English names.
- `grep -rn "<Icon " site/src/components` finds real callers; `site/package.json` lists
  `@vscode/codicons`; footer shows the attribution.
- `site/src/pages/space.astro` exists; `grep -n aria-current site/src/components/AppTabs.astro`.
- `ls site/tests/visual.spec.ts-snapshots/` shows four PNGs; open them and judge the design against
  ask (b): hero, cards, highlights, frames all restyled.
- `bun run lint` and `bun run site:check` green; a second `bun run screenshots` Studio run leaves
  `git status --porcelain screenshots/` clean.

## 12. Risks and fallbacks

- `?raw` SVG imports fail `astro check` types: add `/// <reference types="vite/client" />` to
  `site/src/env.d.ts` (create it if absent).
- Codicons `set:html` sizing: SVGs carry `width="24" height="24"`; the `[&>svg]:size-full` rule
  overrides them. If Biome or Tailwind rejects the arbitrary variant, strip the attributes in
  `icons.ts` with a string replace at import.
- Full-page visual baselines flake on lazy images: the scroll pass plus `img.decode()` on all images
  before capture. If still flaky, set `maxDiffPixelRatio: 0.001` and record why in the spec.
- Detail crop misses a feature after the name change: adjust `detail` coordinates in
  `studio.shot.ts`, nothing else.

## 13. Out of scope

- Space screenshot fixtures (Ana Pop git identity in `space.shot.ts`): not in the ask.
- Docs page restyling beyond the shared `Shot` frame; Starlight layout and sidebar stay.
- Moving `.github/workflows/pages.yml` live.
- A client-side tab script, copy buttons, light theme.
