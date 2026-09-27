# P130 — Focused input flashes a white ring before turning blue: plan

Plan for `docs/v2.0/SPEC.md`'s P130 row. Planned against `v1.9` at `a5d2e7ad`.

Symbols and call sites read via `codegraph_explore` (`inputVariants`, `buttonVariants`,
`toggleVariants`, `inputGroupVariants`, `Textarea`, `Checkbox`, their consumers). CSS isn't in the
CodeGraph index, so `base.css`/`tokens.css` and repo-wide outline/transition usage came from `rg`.
Tailwind's transition lists were read from the installed `tailwindcss@4.3.3` dist.

---

## 0. What SPEC left open, and how each is resolved

| Open point | Resolution |
|---|---|
| Base-layer `outline-color` vs. dropping `outline-color` from component transition lists | Base layer, widened to the ring's full geometry (§2). |
| Complete list of affected components | §3. SPEC's list holds, with two corrections: `button`/`toggle` use `transition-all`, not `transition-colors`; `DialogScrollContent`'s close button is a seventh site. |
| Any component needing its own fix | One: `buttonVariants`' `destructive` variant (§3). |
| Test in both apps, or one? | Both (§4). |
| Overlap with P126 | None (§6). |

## 1. Confirmed current state

- `packages/theme/src/base.css:192-201`: `@utility focus-ring { outline: var(--kira-border-width) solid var(--kira-focus); outline-offset: calc(var(--kira-border-width) * -1); }`, applied by `@layer base { :focus-visible { @apply focus-ring; } }`. No rest-state outline rule exists anywhere in `packages/theme`.
- `packages/theme/src/tokens.css`: `--kira-fg: #cccccc` (line 7), `--kira-focus: #0078d4` (line 16), `--kira-border-width: 1px` (line 73). `base.css:217` sets `body { color: var(--kira-fg) }`, so an unfocused element's `outline-color` (initial `currentcolor`) resolves to `#cccccc`.
- Tailwind 4.3.3 (`dist/default-theme.js`): `transition-colors` = `color, background-color, border-color, outline-color, text-decoration-color, fill, stroke` (+ gradient vars); `transition` (bare) also includes `outline-color`; `transition-all` = `all`. Default duration 150ms.
- Only one theme exists (`tokens.css` is the only `--kira-fg`/`--kira-focus` definition outside built `dist/`). The fix is token-agnostic anyway.

**Mechanism confirmed live during planning.** A standalone WebKit repro (Playwright's `webkit-2359` from `/opt/pw-browsers`; hand-written CSS mirroring base.css's layer order and Tailwind's two transition lists, not the app build) sampled `getComputedStyle` and `el.getAnimations()` synchronously after `el.focus()`:

| Element | Rest rule | `outlineColor` at t=0 | outline transitions running |
|---|---|---|---|
| input, `transition-colors` | none (today) | `rgb(204, 204, 204)` | `outline-color` |
| button, `transition-all` | none (today) | `rgb(204, 204, 204)`, width `3px`, offset `0px` | `outline-color`, `outline-offset`, `outline-width` |
| input | colour only | `rgb(0, 120, 212)` | none |
| button | colour only | `rgb(0, 120, 212)`, width `3px` | `outline-offset`, `outline-width` |
| button, `focus-visible:outline-error` | colour only | `rgb(0, 120, 212)` | `outline-color` (blue to red: new flash) |
| input / button | colour + width + offset | `rgb(0, 120, 212)`, `1px`, `-1px` | none |
| button, `outline-error` at rest | colour + width + offset | `rgb(241, 76, 76)` | none |

So SPEC's diagnosis holds: the input's white-to-blue fade is exactly `outline-color` interpolating from `currentcolor`. Two findings SPEC didn't have:

1. `transition-all` elements (Button, Toggle) also animate `outline-width` from `medium` (3px) to 1px and `outline-offset` from 0 to -1px. On keyboard focus, a thick ring shrinks over 150ms. A colour-only fix leaves this.
2. `buttonVariants`' `destructive` variant sets `focus-visible:outline-error` next to `text-error`. Today its `currentcolor` is already red, so no flash. A blue rest colour would *introduce* a blue-to-red flash there.

The implementation still reruns this check against the real app build first (§4, step 1). That run is the acceptance evidence; this repro only chose the approach.

## 2. Fix approach: hold the ring's colour, width and offset at rest

Add a base-layer rule on `*` that sets `outline-color`, `outline-width` and `outline-offset` to `focus-ring`'s own values. Focus then changes only `outline-style` (`none` to `solid`). That property is discrete, so `transition-colors`/`transition-all` have nothing to interpolate, and the ring appears in its final state on the first frame.

Why this over dropping `outline-color` from components' transition lists:

- **CSS can't subtract from a transition list.** `button` and `toggle` use `transition-all`. Excluding outline properties there means replacing `all` with a hand-kept explicit list in each cva string, and repeating that in every future component. Getting it wrong fails silently.
- **Per-component edits are the opposite of SPEC's "fix once, at the ring".** Six-plus edit sites versus one rule next to `focus-ring`.
- **Colour alone isn't enough (§1 finding 1).** Dropping `outline-color` still leaves `transition-all`'s width/offset animation. The rest-state rule covers all three properties at once.

Why `*` is safe:

- Rest values only render when `outline-style` isn't `none`. The only rule that sets it is `:focus-visible` (plus explicit outline utilities), and `:focus-visible` sets these same three values.
- Specificity 0, `base` layer. Every utility (`outline-fg`, `kv:focus-visible:outline-kui-focus-border`, `-outline-offset-2`, …) and every unlayered rule (git-ui `app-shell.css:82`, `CommitGrid.vue:1404`, `slickTheme.css:289`, Monaco's CSS) still wins. An unlayered `outline:` shorthand also resets colour/width/offset itself.
- Repo-wide `rg` of every outline utility and raw `outline` declaration (§3) found none that draws an outline without also setting its own colour.
- Cost: one more universal selector next to preflight's own `*` rule. Negligible.

Residual risk: third-party CSS that sets only `outline-style`/`outline-width` longhands with no colour or offset would now draw blue and inset instead of `currentcolor` and flush. None is known. §5's before/after visual comparison is the check.

### Diff

`packages/theme/src/base.css`, the `@layer base` block at lines 197-201:

```css
@layer base {
  /* P130: focus-ring's colour, width and offset, held at rest, so focus flips only the discrete
     outline-style — transition-colors/-all never animate the ring from currentcolor/medium. */
  * {
    outline-color: var(--kira-focus);
    outline-width: var(--kira-border-width);
    outline-offset: calc(var(--kira-border-width) * -1);
  }

  :focus-visible {
    @apply focus-ring;
  }
}
```

The `@utility focus-ring` block (lines 190-195) stays unchanged. It still serves `input-group`'s `has-[…]:focus-ring`/`focus-within:focus-ring`, whose fieldsets get the same rest values from `*`. The rest rule repeats `focus-ring`'s two expressions. They're token references, not literals, and §4's test fails on drift: a mismatched width or offset shows up as an `outline-width`/`outline-offset` transition on the Button assertion.

`packages/theme/src/components/ui/button/index.ts:19`, `destructive` variant: `focus-visible:outline-error` becomes `outline-error`. At rest it's invisible, because `outline-style` is `none`. On focus it's the same red as today, and there's nothing to interpolate. No `Button` in either app uses `variant="destructive"` today (every `variant="destructive"` hit is `Alert`/`DropdownMenuItem`). The change keeps the registry variant correct for its next consumer, not a live bug. `scripts/check-theme-classes.sh`'s `check_focus_width` patterns only match `focus*:`-prefixed `outline-[2-9]`, so `outline-error` passes lint.

## 3. Components that inherit the fix

`rg` for every Tailwind transition utility that includes outline properties (`transition`, `transition-colors`, `transition-all`, including `kv:`-prefixed forms) across `packages/{theme,kira-ui,workbench,git-ui,shared}/src` and both apps' `frontend/src`. The only class-string hits are all in `packages/theme/src/components/ui`. Every other hit is prose in a comment. No scoped `<style>` rule sets `transition: all` or lists an outline property.

| Component (file) | Transition | Ring source | Focus that shows it | Inherits fix |
|---|---|---|---|---|
| `Input` (`input/index.ts:12`) | `transition-colors` | base `:focus-visible` | mouse + keyboard | yes |
| `Textarea` (`textarea/Textarea.vue:24`) | `transition-colors` | base `:focus-visible` | mouse + keyboard | yes |
| `InputGroup`, `default` variant (`input-group/index.ts:49`) | `transition-colors` on the fieldset | `has-[…:focus-visible]:focus-ring` | mouse + keyboard | yes (fieldset gets the `*` rest values; `InputGroupInput`/`InputGroupTextarea` carry `outline-none`) |
| `Button` (`button/index.ts:7`), and `InputGroupButton`/`TooltipIconButton`, which render it | `transition-all` | base `:focus-visible` | keyboard | yes: colour, width and offset |
| `Button`, `destructive` variant | `transition-all` | `focus-visible:outline-error` | keyboard | yes, after §2's one-token change |
| `Toggle` (`toggle/index.ts:7`), and `ToggleGroupItem`, which uses `toggleVariants` | `transition-all` | base `:focus-visible` | keyboard | yes: colour, width and offset |
| `Checkbox` (`checkbox/Checkbox.vue:22`) | `transition-colors` | base `:focus-visible` | keyboard | yes |
| `DialogScrollContent` close button (`dialog/DialogScrollContent.vue:51`) | `transition-colors` | base `:focus-visible` | keyboard | yes (exported, no app consumer today) |

Checked and not affected (no transition on the element, so its ring already appears at once; rest values change nothing visible):

- `InputGroup` `kira` variant (`focus-within:focus-ring`).
- `SwatchRadio.vue:32`'s `peer-focus-visible:outline-fg`, P122's named exception.
- `packages/kira-ui` `KuiButton`/`KuiTextInput`/`KuiSelect`/`KuiSearchInput` (`kv:focus-visible:outline-kui-focus-border` etc.) and `rowVariants`.
- `packages/git-ui` `UncommittedChangesStrip`, `ReviewCommitRow`, `FileTree`, the `CommitGrid`/`App.vue` resize handles (`outline-none`).
- git-ui `app-shell.css:82`, Studio `slickTheme.css:289`.

## 4. Steps

1. **Live check first, in the real build.** Write §4.1's two specs before touching CSS. Run each one alone on the unfixed tree:
   - `bun run test:ui:studio focus-ring.spec.ts`
   - `bun run test:ui:space focus-ring.spec.ts`

   Expect red. The Input should show `outlineColor` ≈ `rgb(204, 204, 204)` (or an interpolated value) with an `outline-color` transition. The Button should show `outline-color`/`outline-offset`/`outline-width` transitions. Quote the one decisive failure line per app in the result section. Missing WebKit system libraries: see `docs/DEV_ENVIRONMENT.md` §"Playwright UI tier". If the input is green before the fix, stop and report: the mechanism would be wrong and §2 must not land.
2. Apply §2's diff. Rerun both specs: green. Run `bun run lint`, typecheck and build. Commit 1.
3. Commit 2: the two specs.
4. Update `docs/ARCHITECTURE.md`'s Styling-row `focus-ring` sentence. Record that every element holds the ring's colour, width and offset at rest, so `:focus-visible` flips only `outline-style` and no transition animates the ring (P130). Commit 3.
5. Run §5's verification. Write the result section in `docs/v2.0/SPEC.md` (the P128 precedent), with step 1's before lines, the after results, and §5's visual outcome. Commit 4.

### 4.1 Test guard

One new spec per app, the same assertion in each:

- `apps/kira-studio/tests/ui/focus-ring.spec.ts`: `relaunch({ control: [{ channel: IPC.connectionsList, response: [] }] })`. Then `add-connection` and `connection-kind-postgres`, the same opening as `connection-dialog-tabs.spec.ts`'s `openNewPostgresDialog`. Targets: `[data-testid="connection-name"]` (theme `Input`), then `[data-testid="connection-save"]` (theme `Button`).
- `apps/kira-space/tests/ui/focus-ring.spec.ts`: the `kira` fixture. Then `open-settings` and `settings-section-Git`, the same opening as `tests/visual/settings.spec.ts`. Targets: `[data-testid="settings-git-path"]` (theme `Input`, `GitPane.vue:160`), then `[data-testid="settings-save"]` (theme `Button`).

Per target, in this order:

1. Move focus off the target: `document.activeElement.blur()` via `evaluate`. The dialog may auto-focus its first field, and a no-op `focus()` would start no transition and false-pass the pre-fix run.
2. `expect.poll` until the target's `getAnimations()` is empty, so any blur transition has settled.
3. One `evaluate` that does all of this synchronously:
   1. Resolves `--kira-focus` through a temporary `<span style="color: var(--kira-focus)">`'s computed `color`, then removes the span.
   2. Calls `el.focus()`.
   3. Returns `el.matches(':focus-visible')`, `getComputedStyle(el).outlineColor`, and the `transitionProperty` of each `CSSTransition` in `el.getAnimations()` whose property starts with `outline`.

Assert: `focusVisible` is true, `outlineColor` equals the resolved `--kira-focus`, and the outline-transition list is empty. Focus the Input first, then the Button. The Button's programmatic focus matches `:focus-visible` because focus arrives from an element that already matched it (confirmed in §1's repro).

Duplicating the assertion in both apps is deliberate. SPEC's acceptance says "in both apps' suites". Each app also compiles its own stylesheet from its own entry (`main.ts` imports `@workbench/workbench.css`) and loads its own extra CSS: Space mounts git-ui's `kv-mount-root` CSS, Studio has `slickTheme.css`. A shared source doesn't prove each compiled result, and the cost is two small specs. The `evaluate` body is under 15 lines, so each spec inlines it rather than adding a cross-app support module for one caller each.

A focus-state regression guard for a user-visible bug meets `CLAUDE.md`'s test bar: the failure mode is invisible to lint, typecheck and pixel baselines (`animations: 'disabled'` fast-forwards transitions, §5).

## 5. Verification

- Step 1's red run, then step 2's green run, both apps.
- `bun run lint` (includes `check-theme-classes.sh` and `check-class-conflicts.ts`), typecheck, build.
- Full `bun run test:ui:studio` and `bun run test:ui:space`, once, at phase end.
- `test:visual:studio` and `test:visual:space` on the parent commit, then again after commit 1, **in the same sandbox**. Compare the two runs with each other, not with the CI baselines. `docs/DEV_ENVIRONMENT.md` records sandbox font mismatches against the CI-Linux baselines, and those aren't this phase's diff. Both configs set `animations: 'disabled'`, so a focused element already snapshots at the transition's end state (blue, 1px, -1px). Expect the same failures, or the same passes, before and after. A new diff is an element with an at-rest outline the `*` rule changed (§2's residual risk). Investigate it; never re-record past it. Re-record baselines (P125 precedent) only if a new diff is traced and confirmed correct, and then only on the CI image.

## 6. Overlap with parallel work

- **P126** (`docs/v2.0/plans/P126-space-data-font-size.md`): its landing commit touches only the workbench status bar. Its SPEC row names `tokens.css`'s `--kira-font-size`/`--kira-t-*` (lines 107-136). This phase edits `base.css:197-201`, `button/index.ts:19` and no line of `tokens.css`. Font size and focus ring are disjoint rules. Whichever lands second rebases.
- **P129 Part 1** (`apps/kira-space`, `internal/`, `packages/workbench/src/state`) and **P134** (Studio `tests/ui` flake, `frontend/src/views/api`): no shared file. The new Studio spec is a new file. The one shared file is `docs/ARCHITECTURE.md`. Step 4 edits only the Styling row's `focus-ring` sentence, and a line-level conflict there is a trivial rebase.
- **P131** migrates git-ui controls onto theme primitives afterwards and inherits the at-rest ring with no extra work, as SPEC intends.

## 7. Commits

1. `fix(theme): hold focus ring colour and geometry at rest so focus never animates it`: `base.css` rest rule, `button/index.ts` destructive `outline-error`.
2. `test(ui): guard focus ring against animating on focus`: both apps' `focus-ring.spec.ts`.
3. `docs: ARCHITECTURE records the at-rest focus ring (P130)`.
4. `docs(v2.0): P130 result`.

One pass, no split.

## 8. Acceptance (SPEC row's own wording)

- The live check confirms the mechanism first. Before the fix, `getComputedStyle(input).outlineColor`, sampled right after `focus()`, reads interpolated or white. After the fix, it reads `--kira-focus`. Both apps, quoted in the result section.
- The ring's colour never animates from `currentcolor`. It's fixed once, at the ring (`base.css`), not per component. Only `destructive`'s own colour override changes, and it's a variant-level colour, not a per-component transition fix.
- Both apps inherit the fix through `packages/theme`.
- A `test:ui` assertion on that sample guards it in both apps' suites (`focus-ring.spec.ts` ×2). It also asserts no `outline-*` transition runs on Input or Button.
- Lint, typecheck, build and the full `test:ui:studio`/`test:ui:space` pass. `test:visual:*` shows no diff introduced by commit 1 (same-sandbox before/after).
