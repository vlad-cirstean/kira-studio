# P238 findings (files outside Stream C)

- `apps/kira-space/internal/flowharness/harness_test.go:22` (Stream A): `TestHarnessBootsWithDefaultSettings`
  asserts `len(app.W.Bound()) == 20`. P238 makes it 21; P239 will make it 22. Fails `bun run test:flows:space`
  until updated. Set to 22 after both phases land.
- `apps/kira-space/internal/flowharness/**` is untouched: the flow tests inject the recording sink through
  `Wired.AgentNotify.SetSink` and mark the window known via `app.WindowMgr.Known`.
