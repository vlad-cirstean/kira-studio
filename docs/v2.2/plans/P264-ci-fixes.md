# P264 CI fixes

Runs: 38153009189 (head f1129b91e) and 37888912351 (head 605f63e).

## 1. macOS lint: U59 (run 38153009189)

Cause: `scripts/check-ui-primitives.sh` U59 used `'[—-]'`. `grep -P` outside UTF mode (C/POSIX locale,
Linux dev + sandbox) reads `—` as 3 bytes, so the class never matched a literal em dash. The macOS
runner uses a UTF-8 locale, matches chars, found 4 real literals. Linux pass was a false negative.
Reproduced: `LC_ALL=C` zero hits, `LC_ALL=C.UTF-8` four files.

Fix: pattern `'(?:—|-)'` (byte-sequence alternation, same result in both modes). Replaced literals with
`displayValue` in ResponseDiffDialog, OperationsPanel, CachePane, OpLogPanel. `bun run lint`
passes under `LC_ALL=C` and `LC_ALL=C.UTF-8`. Audit of U1-U63 and the other `check-*.sh`: U59 is the
only rule with non-ASCII in a regex. Remaining non-ASCII sits in comments and echo text.

Skipped steps run locally, all green: typecheck, build:studio, build:space, lint:go (0 issues),
lint:dead (knip exit 0), `go build ./...`, darwin `go vet` (CGO off) and `go test` of the five
darwin-relevant packages on Linux, verify:packaging (app/dmg checks skipped, no bundle).

## 2. Run 37888912351 (head 605f63e)

ui (Linux), Visual regression: 13 specs failed, each 0.6-1% pixel diff (connection-dialog, console,
data-grid, http-request-view, schema-dialog, 6 settings panes, quick-commands-dialog, workbench-shell).
Repo baselines were sandbox-recorded and drifted from CI render; README requires CI-environment
baselines. Since then baselines were re-recorded (3daf835e9 .. 4f14c59ea) and capture settling added
(5eb92288d). Not reproduced locally: sandbox shared with a concurrent Playwright run, and baselines
here were recorded in this sandbox, so a local pass says nothing about CI.

container-tests (Linux), `bun run test:go`:
- `TestFixture_SQS`: `create container: unauthorized: authentication required` pulling
  `localstack/localstack:4`. Image and manifests are anonymous-pullable (checked with a token),
  so likely a Docker Hub auth/rate-limit transient. No code fix.
- `internal/docker` TestEngine: stop took 10.08s (alpine PID 1 `sh` ignores SIGTERM, engine waits
  for SIGKILL) and the listing still read `running`; later subtests failed on the dead container.
  Fix (acc00ac82): test container traps TERM; state checks poll up to 15s. Needs Docker to confirm.

Other failed runs on v2.0: 8 and 10 apt cache plus wails-linux-cli (fixed b34eec58), 13 unit-test
leak (fixed, run 14 green at ba8419e), 4 and 6 older. Runs 1, 2, 3, 5, 7, 9, 11, 12, 15 cancelled.
PR #2 base is main.

## Unconfirmed (CI/Docker only)

- Visual job on tip: if still red, download playwright-report, re-record from CI env.
- SQS pull: re-run; persistent failure means Hub auth for localstack, switch to a mirror.
- TestEngine fix: needs a Docker run.
- Linux jobs never ran on f1129b91e (skipped after macOS lint failure).
