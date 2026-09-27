# P134 — Flake in api-secret-reveal-isolation.spec.ts: plan

Plan for `docs/v2.0/SPEC.md`'s P134 row. Planned against `v1.9` at `a5d2e7ad`.

Symbols read via `codegraph_explore`: the spec file, `VariableRow.vue` (`onSecretChange`, the
`variable-secret` `Checkbox`), `VariableSetView.vue` (`onUpdateSecret`, `commitDraft`,
`allRealRows`, `draftFromRow`, `syncDrafts`), `state/variables.ts` (`revealVariable`,
`upsertVariable`), `reveal.ts` (`runReveal`), `state/draftMerge.ts` (`mergeDrafts`),
`state/apiQueries.ts` (`refreshApiQuery`, `useVariableRows`), theme `Checkbox.vue`.

---

## 1. Confirmed current state

- Failing call is `api-secret-reveal-isolation.spec.ts:123`, not `:63` (63 is where the test
  starts): `variableRow(page, 'var-apikey').locator('[data-testid="variable-secret"]').uncheck()`.
- `Checkbox.vue` forwards `model-value` to reka-ui `CheckboxRoot`. `VariableRow.vue:216` always
  passes `:model-value="row.isSecret"`, so the checkbox is fully controlled. A click only emits
  `update:modelValue`; `aria-checked` changes only when the parent's `row.isSecret` changes.
- `row.isSecret` is `drafts[id].isSecret` (`VariableSetView.vue:245-266`), not the query row.
- `onUpdateSecret(id, false)` (`VariableSetView.vue:380-398`): `await revealVariable(id)` (one
  IPC: `control.variablesReveal`), then sets `draft.isSecret = false` (checkbox flips here), then
  `await commitDraft(id)` (`variablesUpsert`, then `refreshApiQuery` refetches `variablesList`).
- In `tests/ui`, every control IPC is a `fetch` intercepted by `page.route` and answered from
  Node (`tests/ui/support/mockRuntime.ts:378`). So the reveal hop is a real cross-process round
  trip, not a microtask.
- Playwright's `uncheck()` clicks, then reads the checked state once, immediately. No retry.

SPEC's hypothesis holds with one correction: the flip needs **one** IPC hop (reveal), not two.
`draft.isSecret = false` lands before `commitDraft` starts. The upsert and refetch never change
`aria-checked` again: the static `variablesList` mock returns `isSecret: true`, but `mergeDrafts`
keeps the draft (dirty against its seed, still differs from incoming).

## 2. Live evidence

All runs: WebKit (`webkit-2359`, the `ui` project's browser), headless, after
`bun run build:test:studio`.

**Baseline, current tree.** `bunx playwright test --config=apps/kira-studio/playwright.config.ts
--project=ui api-secret-reveal-isolation --repeat-each=20`: 72 passed, 8 failed. All 8 failures
are test 1, each `Error: locator.uncheck: Clicking the checkbox did not change its state`. A second
run filtered to test 1 (`-g "Copy as curl"`, 20 repeats): 12 passed, 8 failed, same error. Test 1
fails ~40% of runs; tests 2-4 passed 20/20.

**Timeline probe.** A scratch copy of test 1 (outside the repo) replaced `uncheck()` with
`click()`, then recorded in-page timestamps: `aria-checked` mutations, `fetch` start/end, the
click event. 10/10 runs showed the same sequence:

```
 0ms  aria-checked=true
~60   click event
~61   fetch start   (variablesReveal)
~90   fetch done
~95   aria-checked=true    (reveal-mirror watch re-render, same value)
~99   fetch start   (variablesUpsert)
~100  aria-checked=false   (draft.isSecret = false)
~115  fetch done; then variablesList refetch start/done
      aria-checked stays false
```

Reveal round trip: 12-44ms. Checkbox reading right after `click()` returned: `false` in 9/10 runs,
`true` in 1/10. Settled state after 1.5s: `false` in 10/10. Final IPC counts, every run: 2 reveals,
1 upsert, 2 lists.

**Root cause, confirmed.** A test-shape race. `uncheck()` samples `aria-checked` once, right after
dispatching the click. The controlled checkbox flips only after the reveal round trip through
`page.route`. When that trip outlasts Playwright's post-click read, `uncheck()` throws. The app
always settles to unchecked, with a real second reveal call.

**Not an app bug.** The checkbox deliberately waits for re-auth before showing unchecked. Test 2
(line 185) pins why: a cancelled reveal must leave it checked and commit nothing. Optimistically
unchecking before the reveal resolves would briefly show a state the user never authorised, then
snap back on cancel. No app-side change.

## 3. Fix

Test-only, in `apps/kira-studio/tests/ui/api-secret-reveal-isolation.spec.ts` test 1. Replace
line 123:

```ts
  // Controlled ARIA toggle: it flips only once the re-auth reveal resolves, so `.uncheck()`'s
  // one-shot post-click read races that IPC round trip. Click, then wait for the flip.
  const secretBox = variableRow(page, 'var-apikey').locator('[data-testid="variable-secret"]');
  await secretBox.click();
  await expect(secretBox).not.toBeChecked();
```

Line 125's `expect(control.log()…variablesReveal).toHaveLength(2)` stays unchanged, directly after.

**Why not line 185's exact shape (bare `click()`, no wait).** Line 185's test asserts the checkbox
*stays* checked, so it has no postcondition to wait for. Test 1 does have one. A bare `click()`
would also make line 125 depend on the route handler logging the reveal before `click()` returns.
That held in 10/10 probe runs, but nothing guarantees it. `not.toBeChecked()` is a polling
web-first assertion. It passes only after `revealVariable` returned a value, so the reveal
response is already logged when line 125 runs. The same assertion already guards `variable-secret`
in `api-ui-consistency.spec.ts:1213`, so this is not a new pattern.

**Isolation guarantee preserved.** Test 1's guarantee: after Copy as curl populated the shared
`revealedValues` map, un-ticking secret in the Variables tab still makes its own `variablesReveal`
call. Line 125 (`toHaveLength(2)`) is the assertion that pins it. It is untouched. If the original
bug returned (stale map entry trusted, no reveal call), the checkbox would still uncheck, and line
125 would still fail with 1. The fix only adds a wait; it drops no assertion.

**Verified live during planning.** The scratch copy with exactly this edit: whole file 80/80
(4 tests × 20 repeats); test 1 alone 40/40 under `--repeat-each=40`.

Out of scope: line 186 has the same non-polling log read after a bare `click()`. It passed 20/20
and has no visible postcondition to wait on, so it stays as is.

## 4. Acceptance

1. `bun run build:test:studio`.
2. `bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui
   api-secret-reveal-isolation --repeat-each=20`: 80 passed, 0 failed, 0 flaky. That includes
   test 1 at 20/20.
3. Line 125's `toHaveLength(2)` reveal-count assertion is unchanged.
4. Pre-commit hook (lint, typecheck) passes without `--no-verify`.

## 5. Commits

1. `test(studio): wait out secret checkbox's re-auth reveal in isolation spec` — the §3 edit.
2. `docs(v2.0): P134 result` — append a result section here with step 2's pass/fail line.
