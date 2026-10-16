# P126 — Kira Space "Data font size" renders smaller than set: plan

Planning only. One Opus pass, at `bef995d5`. Implementer: one sequential Sonnet subagent, but only
after §4's macOS measurement exists — see §5.

**Outcome: live probe finds no defect off macOS.** Real Go backend, real git, real Settings UI,
WebKit and Chromium: every text node computes exactly the configured size (§2). The one layer not
exercised is the macOS host itself — WKWebView, macOS fonts, the user's own `~/.kira-space` state
(§3). SPEC forbids fixing an assumed cause, so this plan proposes no pipeline change. §4 is the one
measurement that unblocks the fix; §5 maps each possible result to its fix site.

## §0 Goal, acceptance

SPEC row: Data font size 12 renders "visibly much smaller than 12px". Start with a live runtime
check, read `getComputedStyle` on the small node, walk its cascade, fix the cause found there.

Acceptance (SPEC):

1. Root cause plus before/after computed-style evidence in the result section.
2. The same node computes to the configured size after the fix.
3. A `test:ui:space` assertion on that node's computed font size, shaped like Kira Studio's
   `apps/kira-studio/tests/ui/control-sizing.spec.ts`. `test:ui:space` is a real root script
   (`build:test:space` then Playwright `--project=ui`, WebKit).

## §1 What ran

Linux container, no display. Setup: `bun install`, `bun run setup` (bindings), `bun run
build:test:space`, `npx playwright install webkit` plus `npx playwright install-deps webkit`
(WebKit 2359). Viewport 1440x960, DPR 1 throughout.

- **Tier A — `test:ui:space` harness.** Throwaway spec (not committed) on
  `apps/kira-space/tests/ui/fixtures.ts`: static `dist`, mocked control calls, `installGitStreamMock`
  with the multi-branch graph fixture plus a `commit.detail` answer. Opened the repo graph,
  selected a commit, opened `a.ts` in Monaco, opened a terminal tab, opened Settings. At each step:
  a `TreeWalker` over every visible text node, `getComputedStyle(parent).fontSize` bucketed, plus
  root custom properties.
- **Tier B — real Go backend.** `go build -tags server` of `apps/kira-space` (DEV_ENVIRONMENT's
  sandbox substitute for a GUI boot), temp `KIRA_SPACE_HOME`, `WAILS_SERVER_HOST=127.0.0.1`. Two
  sandbox-only hurdles, both worked around outside the tree:
  - Boot fails `unknown window: main` (`internal/appstorage/tabs.go:117`): a server build has no
    shell creating the `windows` row. Seeded `windows('main')` and one `code_repos` row via SQLite,
    then navigated to `/?window=main`.
  - Git discovery is darwin-only (`apps/kira-space/internal/gitclient/discovery.go:124-137`,
    `unsupportedLocator`). A throwaway binary patched `Locate` to return `/usr/bin/git`; source
    reverted right after the build.

  Scratch repo: 5 commits, 5 files. Drove WebKit and Chromium. Captured the real `settingsGetAll`
  wire payload. Then changed Data font size through the real Settings UI (fill, Save, close):
  20, 12, 9, 12.
- **Tier C — build parity.** Packaged `vite build` vs `build:test` CSS: all 4 chunks
  byte-identical. The harness and the shipped app run the same stylesheet.
- **Tier D — dev mode, not reached.** Server binary with `FRONTEND_DEVSERVER_URL` pointed at a
  plain `vite` dev server: Vite's import analysis rejects `/wails/runtime.js` and the page never
  boots. This approximation is not what `wails3 dev` does, so it says nothing about the real dev
  path. Tier C already covers the packaged app's CSS.

## §2 Evidence

Root, every run, both engines, before and after git-ui's lazy CSS chunk loads:

| Property | Value |
|---|---|
| `<html style>` (from `applyAppearance`) | `--kira-font-family: Menlo, monospace; --kira-font-size: 12px; --kira-row-height: 28px;` |
| `--kira-t-md` / `--text-kira-md` | `12px` |
| `--kira-t-sm` | `calc(12px - 1px)` |
| `--vscode-font-size` | `12px` |
| `--kv-font-size` | `12px` (empty until git-ui's chunk loads; no text reads it before then) |
| `html` / `body` font-size | `16px` / `12px` |

Real wire payload: `"appearance":{"fontFamily":"Menlo, monospace","fontSize":12,...}`,
`"git":{...,"graphFontSize":0}`.

Per surface, fontSize 12, WebKit (Chromium identical):

| Surface | Node | Computed |
|---|---|---|
| Graph commit subject | `.kv-message-subject` | 12px |
| File tree row | `span.overflow-hidden.text-ellipsis` | 12px |
| Commit details title | `h2.kv-meta-subject` (`kv:text-lg`) | 13px |
| Commit details date, sha, `+1`/`-0`, status letter | `kv:text-sm` spans | 11px (P123 secondary) |
| Monaco | `.view-line` | 12px, line-height 18px; inline `font-size: 12px` |
| xterm.js | `.xterm-rows` | 12px |
| Settings labels / descriptions / title | | 12 / 11 / 13px |
| Status bar "no selection" | `span.font-data.xs` | 11px (inherits `text-kira-sm`) |

Histogram, real backend, commit selected: 11px x10, 12px x23, 13px x1. Nothing below 11px on any
surface, in any tier.

Live change through Settings (real backend):

| Set to | Data nodes | Secondary nodes |
|---|---|---|
| 20 | 20px (31) | 19px (1) |
| 12 | 12px (31) | 11px (1) |
| 9 | 9px (31) | 8px (4) |
| 12 | 12px (31) | 11px (4) |

Applies live, no restart, no stale value, Monaco and git-ui included. Screenshots match: the graph,
file tree and commit panel read as ordinary 12px text (DejaVu Sans, the container's fallback for
`-apple-system`).

Conclusion: every link in the pipeline measures correct in WebKit and Chromium. The defect does not
reproduce here.

## §3 Unexercised layers, read statically

Only macOS-only layers remain. None shows a defect in source.

1. **WKWebView host** (Wails `v3.0.0-beta.21`, `pkg/application/webview_window_darwin.go`).
   - Initial `setZoom(options.Zoom)` is commented out (`:1665`).
   - `setZoom` clamps anything below 1.0 up to 1.0 (`:1214-1218`).
   - `zoomOut` never goes below 1.05 (`:446-448`).
   - `MinimumFontSize`/`AllowsMagnification` apply only when set. `internal/shell/security.go:24-26`
     sets only `JavaScriptCanOpenWindowsAutomatically`.
   - `internal/shell/menu.go:127-137` has only the window `Zoom` role (maximise), no view zoom.

   App code cannot scale the page below 1.0.
2. **macOS fonts.** Graph subjects, file tree and commit details render in the UI face
   (`--kira-font-ui`/`--kv-font-ui`, `-apple-system`), not the data face (`--kira-font-data`,
   Menlo), which the label "Data font size" suggests. Same px, different face. Not measurable here:
   this container has no SF Pro.
3. **User's persisted state** (`~/.kira-space/kira.db`, table `settings`, one row per non-default
   leaf, e.g. `appearance.fontSize|12`). A nonzero `git.graphFontSize` (Settings, Git, "Font
   size") overrides Data font size on every git-ui surface — graph, commit details, review
   (`apps/kira-space/frontend/src/state/settings.ts:22-30`,
   `packages/theme/src/vscode-bridge.css:98`). That is by design. The user would see "Data font
   size does nothing" there.

Bundle CSS has no platform-dependent sizing: no system-font keywords, no `-webkit-*-control`.
Tailwind preflight `font: inherit` on form controls is present. The only relative sizes are
`.md-reading` headings (em, larger) and preflight `small`/`sub`/`sup`.

## §4 macOS measurement (blocking; this sandbox can't run it)

Needs the user, or a session on a Mac (`uname -s` = `Darwin`). Run all of it on one machine.

1. Ask the user first: which surface looks small (graph, file tree, commit panel, editor,
   terminal, chrome), and what they compared it against (Kira Studio at 12, VS Code, memory).
   This is the cheapest disambiguator.
2. Launch an inspectable build. `bun run dev:space` builds without the `production` tag, so
   `webview_window_darwin_dev.go` sets `webView.inspectable = YES`. A packaged-shape alternative
   is a `darwin:build` with `EXTRA_TAGS=devtools`. Both read the real `~/.kira-space`, so the
   user's own state is in play.
3. Open Safari, Develop, the Mac, Kira Space. Open the surface named in step 1, then run in the
   console:

   ```js
   (() => {
     const r = getComputedStyle(document.documentElement);
     const vars = ['--kira-font-size', '--kira-t-md', '--kira-graph-font-size',
       '--vscode-font-size', '--kv-font-size'].map((v) => [v, r.getPropertyValue(v).trim()]);
     const b = {};
     const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
     for (let t = w.nextNode(); t; t = w.nextNode()) {
       const el = t.parentElement;
       if (!el || !t.textContent.trim() || !el.getClientRects().length) continue;
       const cs = getComputedStyle(el);
       const k = `${cs.fontSize} ${cs.fontFamily.split(',')[0]}`;
       (b[k] ??= []).push(t.textContent.trim().slice(0, 24));
     }
     return { vars, inline: document.documentElement.getAttribute('style'),
       dpr: devicePixelRatio, vv: visualViewport?.scale, inner: innerWidth,
       buckets: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [v.length, v.slice(0, 5)]])) };
   })();
   ```

4. Inspect the node that looks small. Record Computed `font-size`, the winning rule, and the
   Fonts panel's used face.
5. `sqlite3 ~/.kira-space/kira.db "SELECT key, value FROM settings"`.

Record the raw output in the result section as "before" evidence.

## §5 Outcome to fix

Pick the first row that matches §4's output. Only row A is a pipeline defect.

| # | §4 shows | Cause | Fix | Guard |
|---|---|---|---|---|
| A | Node computes below the configured px | A macOS-only cascade path | The winning rule from §4.4, at its file:line | `test:ui:space` assertion on that node, below. If the rule is gated to macOS WebKit, the harness can't reach it; record that and assert the platform-independent part |
| B | Node computes the configured px; `git.graphFontSize` row present | User state, by design (§3.3) | No pipeline change. The Git pane's "Font size" label is ambiguous. Renaming it "Graph font size" with a "0 follows Data font size" hint is a UX call for the user | None — a label change |
| C | Node computes the configured px; `vv` < 1, or `innerWidth` exceeds the window's width in points | Webview magnification. Unlikely: §3.1 found no path below 1.0 | Reset magnification on window create, `internal/shell/window.go` `Options`/attach | None possible on Linux; `darwin && cgo` path, per DEV_ENVIRONMENT's Wails section |
| D | Node computes the configured px, face SF Pro, nothing else off | Perceptual: Data font size drives text in the UI face; P123's secondary role is −1px | Design decision for the user, not a defect: (i) render git-ui data text (commit subject, file tree path) in `--kira-font-data`; (ii) decouple the chrome scale (P123 §8 Q1); (iii) leave as is. Don't pick for them | Per chosen option |

Row A guard shape: new `apps/kira-space/tests/ui/data-font-size.spec.ts`. `relaunch` with a
`settingsGetAll` override (`mergeBootSnapshots` replaces by channel) at a non-default size, e.g.
16. Open the surface. Assert the node's `getComputedStyle(...).fontSize` is `'16px'`, then change
it through Settings and assert again. The non-default value is what lets it catch a "setting
ignored" cause. It lands with the fix, never before: a spec that passes pre-fix is vacuous (P124
precedent).

## §6 Lands now, independent of §4

1. **Dead class.** `packages/workbench/src/components/StatusBar.vue:21` carries `xs`, a P110 B14
   (`db7cccf6`, `.mono` to `font-data`) leftover. No built chunk has a `.xs` rule. The node
   computes 11px from its parent's `text-kira-sm` either way. Delete the token, no visual change.
   Commit: `refactor(workbench): drop dead xs class from status bar`.
2. **Sandbox recipe.** Add a short "Kira Space real backend in a sandbox" subsection to
   `docs/DEV_ENVIRONMENT.md` (an environment fact, per `CLAUDE.md`): `go build -tags server`,
   seed `windows('main')` before navigating to `/?window=main`, and git discovery is darwin-only,
   so the graph needs a local-only locator patch that never gets committed. Commit:
   `docs: Kira Space server-tag recipe`.

Then stop. Report P126 as blocked on §4, not done. Don't write the §5 fix or guard until §4's
output exists.

## §7 Not committed

Throwaway probe spec, the patched discovery binary, the scratch repo and temp `KIRA_SPACE_HOME`
dirs: all outside the tree or removed. `git status` after the pass shows only this file.
