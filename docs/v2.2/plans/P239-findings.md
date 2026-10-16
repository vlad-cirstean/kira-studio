# P239 findings (files outside Stream C)

- `apps/kira-space/internal/flowharness/harness_test.go:22` (Stream A): `TestHarnessBootsWithDefaultSettings`
  asserts 20 bound services. Real count is 22 after P238 and P239. Set to 22.
- `claudeflow.TestClaudeSettingsUntouched` passes with the new per-launch settings file.
- Stream B (P237): `ComposeLaunch` now takes `(terminalID, cwd, command)` and, with `usageEnabled` on
  (default), `--settings` points at `settings-<12 hex>.json` instead of `hooks.json`. Re-run
  `TestHookPayloadContract` and `TestRealClaudeSettingsUntouched` after the rebase.
- `repoflow.TestCodeSearch/cancel_stops_events` failed once under concurrent load (cancelled git ls-files
  surfaced as `E_INTERNAL`), passed three reruns. Untouched by this stream; `codeworkspace` cancel race.
