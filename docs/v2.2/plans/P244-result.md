# P244 result

Done: terminal opt-in (empty state + New session), dropdown `min-h-control`, CPU/RAM gone from side list only.
Detail-header and overview CPU/RAM kept. Stats subscription stays in `DockerPanel`.
`docker-real.spec.ts` untouched; needed line in `P244-findings.md`.

Checks (real output):
- `bun run lint`, typecheck set: passed in pre-commit hook on both commits (no `--no-verify`).
- `bun run lint:dead`: `$ knip`, no findings.
- `bun run build:studio`: `✓ built in 8.08s`.
- `playwright --project=ui docker-module`: `11 passed (16.8s)`.
- Dropdown test with `h-control` restored: `1 failed`; restored `min-h-control`, rebuilt.
- `grep openSession ExecView.vue`: function def (22) and two `@click` (50, 72) only.
- `grep "<style"` on the three components: empty. ContainerList stat grep: empty.
- `useStatsSubscription(` hit: `DockerPanel.vue:43`. `useDockerStatsStore` users: ContainerDetail, ContainerTable, StatsView, EngineOverview.

Not run: `test:e2e-real:studio` (needs dockerd; Stream A owns spec line).
