# P244 findings

## Stream A handoff

`apps/kira-studio/tests/e2e-real/docker-real.spec.ts` (~line 87-88): terminal no longer auto-opens.
Add between the `docker-tab-terminal` click and the `.xterm-rows` expectation:

```ts
await page.locator('[data-testid="docker-exec-new"]').click();
```

Stream A owns the file; P244 did not edit it.
