# P211 notes

Measurements and deviations, recorded as they happen. Folded into `SPEC.md` in the last commit.

## Measurements (CLI 2.1.293, Sonnet, sandbox)

- Extract, 3 chunks of `docs/ARCHITECTURE.md` (2206, 3528, 2410 estimated tokens): 22, 29, 20 facts;
  17, 19, 16 s; 0.046, 0.051, 0.044 USD each. Dense technical prose: about 24 facts per 3000-token chunk.
- Smoke import (`testdata/smoke`, 2 files, 6 chunks at a 150-token test budget): 48 s wall, 8 Claude
  calls (6 extract, 2 finalize), 0.135 USD outer-agent cost, 24 facts extracted, 20 memories added,
  1 unresolved ("It restarts every night..." chunk without the service name), 0 dropped, 0 failed.
  Gate and reconcile calls inside `memory-mcp` are not in that cost.
- Estimate constants set from this: 20 facts per chunk, 18 s per extract call, finalize
  15 s + 25 s per 20 facts.
- Fact reasons came out as `Stated in <path>, <heading path>: "<evidence>"`; the gate challenged
  none of them (no reason-format change needed).

## Deviations from the plan

- Gitignore: `gitignore.ParsePattern` per directory instead of `ReadPatterns` over an `osfs`
  filesystem. Same matcher, no billy filesystem to wire, patterns stay scoped to each directory.
- `--allowedTools` is passed as one comma-joined argument instead of one argument per tool, so the
  variadic flag cannot swallow the next flag.
- The `memory-mcp` re-exec for the smoke test lives in the importer package's shared `TestMain`
  (`engine_test.go`), because a second `TestMain` in the tagged file would not compile.

## Step-2 isolation checks (real CLI, finalize flags)

- User-level canary: a temporary `~/.claude/CLAUDE.md` (the sandbox had none; removed after) told the
  agent to add a `CANARY-7731` item to every `store_memory` call. The finalize agent stored only the
  one input fact; the canary was not followed. `--setting-sources ""` keeps user memory out without
  `--safe-mode`. No Known open item.
- Denied tool: finalize flags with only `store_memory` allowed, agent told to call `search_memories`.
  Result: the call was denied under `--permission-prompts none` ("no way to approve permission
  prompts"), nothing ran, 3 turns.
