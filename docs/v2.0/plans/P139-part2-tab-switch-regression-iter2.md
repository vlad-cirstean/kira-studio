# P139 Part 2 — cached tab switch regression, iteration 2 (no tab caching): plan

Iteration 2 of `docs/v2.0/SPEC.md`'s **P139 Part 2** row. Iteration 1:
`P139-part2-tab-switch-regression.md` (§1 measurements, §2 root cause). Its fix (per-tab
`KeepAlive`) is **rejected by the user: no tab caching, no keep-alive.** This pass investigates the
WebKit side (option E): can a real remount get under 50 ms p95?

Probed against chapter commit `035bbbeb` in a scratch worktree. Line numbers are at that commit.

**Status: in progress. Findings below are measured; design sections not yet written.**

## 1. Measured findings (WebKit, `ui` project engine)

Method: probe spec seeded from `budgets.spec.ts` setup (big_rows open, cell editor open, wide_table
in 2nd tab). In-page microbenchmarks, median of 8-10, each op followed by `document.body.offsetWidth`.
Tab switch: iteration 1 method (`click()` to header cell in DOM, `MutationObserver`), 20 switches,
plus click to 2nd rAF. Probe code never committed.

### 1.1 Environment

- UA `Version/26.6 Safari/605.1.15` (Playwright WebKit, libWPEWebKit). JS JIT on (5e7-iteration
  loop 251 ms).
- 683 elements: `main-view` 432, `data-grid` 252, `cell-editor-panel` 78, tree 155.
- 5 sheets: app CSS `index-*.css` (1 710 style rules, 68 `@property`, 48 `@supports`, 48 `:has()`),
  `monacoEntry-*.css` (1 222), `style.monaco-colors` (937), 2 small `<style>`.

### 1.2 Stylesheet op cost (baseline)

| Op | WebKit ms |
|---|---|
| layout read only | 0 |
| append `<style>` with text (one class rule) | 2-3 |
| remove a `<style>` | 53-61 |
| set `CSSStyleRule.style.left` | 49-64 |
| custom property on `:root` | 69-97 |
| custom property on `data-grid` (252 els) | 10-18 |
| append `<style>` inside a shadow root (100 els) | 1 |
| set rule `style.left` inside a shadow root | 0 |

Correction to iteration 1 §1.7: appending a `<style>` that already holds its text is **cheap** (2-3
ms). WebKit takes the additive path: it invalidates only elements the new selectors match. Removing a
sheet or mutating a rule forces a full-document rebuild. SlickGrid does both on every mount: its old
grid's `<style>` removal, then `createCssRules` appends an empty `<style>` and `insertRule`s into it
(mutation), then `applyColumnWidths` sets `rule.style.left/right` (mutation).

Shadow-root sheets are scoped on WebKit: mutation cost 0-1 ms.

### 1.3 What makes a full recalc cost ~55 ms: per-sheet bisect

Rule mutation cost with one sheet disabled at a time:

| Disabled | ruleMutate ms |
|---|---|
| none | 55-63 |
| app `index-*.css` | 16 |
| `monacoEntry-*.css` | 54 |
| `monaco-colors` | 53 |
| either small `<style>` | 55-56 |
| all 5 | 5 |

Hiding regions (`display: none`, rule mutation ms): `main-view` 29, `data-grid` 44, cell editor 45,
tree 60. Cost scales with styled elements times per-element cost; the app sheet sets the
per-element cost.

### 1.4 Inside the app sheet: which rules (fresh page per row)

Rules deleted from every sheet, then ruleMutate / gridVar / tab switch:

| Deleted | ruleMutate ms | `data-grid` var ms | switch p50 / p95 ms |
|---|---|---|---|
| nothing (per-run baseline) | 49-64 | 10-13 | 279-323 / 324-414 |
| 1 `@supports` block: Tailwind's `@property` fallback | **31** | 4 | **190 / 264** |
| all 47 `@supports` blocks | 29 | 5 | 202 / 262 |
| 45 `color-mix` `@supports` blocks | 57 | 10 | 294 / 448 |
| 68 `@property` rules | 46 | 10 | 265 / 318 |
| 48 `:has()` rules | 53 | 12 | 291 / 408 |
| 154 rules with a universal rightmost compound | **19** | 2 | **148 / 177** |

**Root finding.** Tailwind v4 emits `@layer properties { @supports (((-webkit-hyphens:none)) and (not
(margin-trim:inline))) or (…) { *, ::before, ::after, ::backdrop { --tw-*: … } } }`: a fallback for
engines without `@property`, detected as "WebKit without `margin-trim`". This Playwright WebKit build
reports `CSS.supports('margin-trim: inline') === false`, so the fallback is live. Every element and
pseudo-element then carries ~68 `--tw-*` custom properties. That doubles per-element style cost here
(ruleMutate 55 to 31 ms without it). A second copy sits in one Vue scoped style
(`[data-v-f7649ec7], …::backdrop`, inner rules 2).

Safari has shipped `margin-trim` since 16.4, so real macOS WKWebView should not match this fallback.
Not verifiable here (§6).
