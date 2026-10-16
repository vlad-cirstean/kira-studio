# P249 result

Every e2e-real scenario that can split at the IPC boundary now runs as a Go flow test plus a
Playwright UI spec sharing `apps/<app>/tests/contract/<scenario>.json`. Real-claude tests moved to
nested Go modules `apps/<app>/tests/claude/` with `bun run test:claude*` scripts.

## Runtimes (measured, load average about 22)

- Space e2e-real: 32 tests (about 2.5 to 4 min plus build) to 3 tests, 1.1 min including build.
- Studio e2e-real: 27 tests (about 3 to 5 min plus build) to 8 tests, 1.8 min including build.
- Studio flows 1 min 26 s, Space flows 3 min 41 s (general suites).
- Changed UI specs: Space 166 tests in 4.6 min, Studio 107 tests in 2.1 min.

## Verification

- Pass: test:flows:studio, test:flows:space (one flake, below), Studio dbflow and dbmcpflow complete
  with Docker, changed UI specs both apps, e2e-real both apps, test:unit, lint, lint:go, lint:dead,
  lint:claude, go vet in both claude modules, real-claude smoke `TestRealClaudeSettingsUntouched`,
  `TestSmartScriptRun` (Space) and `TestSmartScriptRun` (Studio).
- Flake: `adeflow.TestScheduleADE` failed once in the full Space run and once under `-count=3`;
  passes alone (4 runs) and on the base commit. Test file untouched by P249; load-sensitive.
- Drift guard: renaming a key in `git-stash.json` fails both halves. Changing a value fails the flow
  half; UI halves that render the value from the fixture follow it.
- Skipped: Space complete variant (no contract in Complete-gated paths), visual and mobile suites.

## Deviations

- Space automations and ADE split landed in one commit.
- Contract ids are `<id:n>` per test; times `<time>` without numbering; `Omit` option added; `Mask`
  keeps types.
- Biome ignores contract directories.
- ADE UI halves use fixture ids with backend values; some UI tests assert argument key sets.
- Space smart has no failed variant.
- `restart-real` split uses the memory list after restart plus existing scripts contract, since
  `TestRestartKeepsUserData` covers scripts, memory and workflows, not repos and board.
- Claude module `go.mod` files gained `go-cmp` (flowtest dependency).
