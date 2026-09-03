# Pending workflows

Files here are complete, ready-to-use GitHub Actions workflows that could not be committed to
`.github/workflows/` directly: writing to that path requires a `workflow` OAuth scope neither this
session's git push access nor its GitHub MCP write tools have, and the local permission classifier
also blocks a direct attempt to create a file there. This is a deliberate GitHub/agent-tooling
boundary (a workflow file can make CI execute arbitrary code), not a bug to work around.

To activate one: copy it into `.github/workflows/` yourself (you have the necessary scope) and
delete it from here.

- `test-matrix.yml` — P25's on-demand + nightly auth/config permutation matrix
  (`docs/v1.1/plans/P25-connection-auth-test-matrix.md` §2.10). Runs
  `KIRA_TEST_MATRIX=1 sh scripts/test-matrix.sh` (already committed and working) against real
  containers for all nine adapters; `sh scripts/test-matrix.sh` itself works today without this
  workflow — this file is only what's needed to also run it in CI (on demand, and nightly).
