# P433 measurements

Probe: `tests/perf/heap-tabs.spec.ts` in each app, project `heap` (Chromium, CDP). Command in
`docs/DEV_ENVIRONMENT.md` "Perf probes". Heap = `Runtime.getHeapUsage` `usedSize` after two forced
GCs. Reads = control calls not matching write names, plus Studio `port:` data ops and Space `git:`
RPCs. Noise: about 0.3 MB between runs. Tab-switch round = activate every tab in strip order. Single
tab worlds switch away by mode round trip (Studio to API mode and back; Space local file to
Automations and back).

Q1 reads per round, Q2 reads after 6 min (fake clock `fastForward`, `idle6m` = reads fired by the
jump itself), Q4 delta per `open`, Q5 heap growth across `round1..3`, Q6 `closed` vs `baseline`
(first-load module code stays resident; `closed2` - `closed` is growth across a second open-all and
close-all cycle).

Base tree: `24b452bb9` plus the probe. Pre Stream B and C. Seed data is fixture-sized (Studio
pages are tens of rows, Space file is 40 000 lines, ~2 MB).

## Before

### Studio

**heap: postgres grid, definition, console**

| step | heap MB | note |
|---|---|---|
| baseline | 14.3 |  |
| open data-grid | 24.2 | delta=9.9 |
| open definition | 23.6 | delta=-0.6 |
| open console | 26.2 | delta=2.5 |
| round1 | 26.8 | reads=0 {} |
| round2 | 27.5 | reads=0 {} |
| round3 | 27.7 | reads=0 {} |
| idle6m | | reads=0 {} |
| after6m | 28.3 | reads=2 {"kira:maskRules:counts":1,"kira:maskRules:list":1} |
| closed | 27.1 | vsBaseline=12.8 |
| closed2 | 27.8 | vsClosed=0.7 |

**heap: mongo document**

| step | heap MB | note |
|---|---|---|
| baseline | 13.0 |  |
| open document | 23.1 | delta=10.1 |
| round1 | 23.7 | reads=1 {"kira:variables:listEnvironments":1} |
| round2 | 23.9 | reads=0 {} |
| round3 | 24.1 | reads=0 {} |
| idle6m | | reads=0 {} |
| after6m | 24.4 | reads=0 {} |
| closed | 22.1 | vsBaseline=9.0 |
| closed2 | 22.3 | vsClosed=0.2 |

**heap: redis browse and keyvalue**

| step | heap MB | note |
|---|---|---|
| baseline | 12.7 |  |
| open browse | 13.3 | delta=0.6 |
| open keyvalue | 21.6 | delta=8.3 |
| round1 | 21.9 | reads=3 {"kira:tree:keyTypes":1,"port:data:read":2} |
| round2 | 22.1 | reads=3 {"kira:tree:keyTypes":1,"port:data:read":2} |
| round3 | 22.5 | reads=3 {"kira:tree:keyTypes":1,"port:data:read":2} |
| idle6m | | reads=0 {} |
| after6m | 22.7 | reads=3 {"kira:tree:keyTypes":1,"port:data:read":2} |
| closed | 14.8 | vsBaseline=2.1 |
| closed2 | 15.0 | vsClosed=0.2 |

**heap: sqs stream**

| step | heap MB | note |
|---|---|---|
| baseline | 12.6 |  |
| open stream | 14.0 | delta=1.4 |
| round1 | 14.6 | reads=1 {"kira:variables:listEnvironments":1} |
| round2 | 14.8 | reads=0 {} |
| round3 | 14.9 | reads=0 {} |
| idle6m | | reads=0 {} |
| after6m | 15.2 | reads=0 {} |
| closed | 14.8 | vsBaseline=2.2 |
| closed2 | 15.1 | vsClosed=0.3 |

**heap: kibana discover**

| step | heap MB | note |
|---|---|---|
| baseline | 12.9 |  |
| open discover | 30.1 | delta=17.2 |
| round1 | 34.7 | reads=1 {"kira:variables:listEnvironments":1} |
| round2 | 38.6 | reads=0 {} |
| round3 | 42.3 | reads=0 {} |
| idle6m | | reads=3 {"kira:kibana:dataView":1,"kira:kibana:dataViews":1,"kira:kibana:histogram":1} |
| after6m | 50.4 | reads=0 {} |
| closed | 46.6 | vsBaseline=33.7 |
| closed2 | 49.9 | vsClosed=3.3 |

**heap: api grpc and http request**

| step | heap MB | note |
|---|---|---|
| baseline | 22.4 |  |
| open grpc-request | 22.4 | delta=0.0 |
| open http-request | 24.2 | delta=1.8 |
| round1 | 24.9 | reads=1 {"kira:grpcHistory:list":1} |
| round2 | 25.5 | reads=1 {"kira:grpcHistory:list":1} |
| round3 | 25.7 | reads=1 {"kira:grpcHistory:list":1} |
| idle6m | | reads=0 {} |
| after6m | 26.3 | reads=2 {"kira:grpcHistory:list":1,"kira:grpc:describe":1} |
| closed | 25.6 | vsBaseline=3.3 |
| closed2 | 26.0 | vsClosed=0.3 |

### Space

**heap: repo graph, repo file, diff**

| step | heap MB | note |
|---|---|---|
| baseline | 13.5 |  |
| open repo-graph | 13.6 | delta=0.1 |
| open repo-file | 28.5 | delta=14.9 |
| open diff | 29.1 | delta=0.6 |
| round1 | 32.5 | reads=4 {"kira:codeWorkspace:readFile":1,"kira:codeWorkspace:readDiff":1,"git:blame.line":1,"git:branch.syncChangeRequests":1} |
| round2 | 36.2 | reads=4 {"kira:codeWorkspace:readFile":1,"kira:codeWorkspace:readDiff":1,"git:blame.line":1,"git:branch.syncChangeRequests":1} |
| round3 | 38.9 | reads=4 {"kira:codeWorkspace:readFile":1,"kira:codeWorkspace:readDiff":1,"git:blame.line":1,"git:branch.syncChangeRequests":1} |
| idle6m | | reads=0 {} |
| after6m | 41.7 | reads=4 {"kira:codeWorkspace:readFile":1,"kira:codeWorkspace:readDiff":1,"git:blame.line":1,"git:branch.syncChangeRequests":1} |
| closed | 40.6 | vsBaseline=27.1 |
| closed2 | 43.4 | vsClosed=2.8 |

**heap: local file**

| step | heap MB | note |
|---|---|---|
| baseline | 19.4 |  |
| open local-file | 19.4 | delta=0.0 |
| round1 | 20.7 | reads=3 {"kira:adetask:repos:call":1,"kira:openedFiles:read":1,"kira:codeWorkspace:repoWorktreeLinks":1} |
| round2 | 21.1 | reads=3 {"kira:adetask:repos:call":1,"kira:openedFiles:read":1,"kira:codeWorkspace:repoWorktreeLinks":1} |
| round3 | 21.4 | reads=3 {"kira:adetask:repos:call":1,"kira:openedFiles:read":1,"kira:codeWorkspace:repoWorktreeLinks":1} |
| idle6m | | reads=3 {"kira:adetask:repos:call":1,"kira:openedFiles:read":1,"kira:codeWorkspace:repoWorktreeLinks":1} |
| after6m | 22.0 | reads=3 {"kira:adetask:repos:call":1,"kira:openedFiles:read":1,"kira:codeWorkspace:repoWorktreeLinks":1} |
| closed | 22.2 | vsBaseline=2.8 |
| closed2 | 22.2 | vsClosed=0.0 |


### Reading the before numbers

- Q1: Studio redis keyvalue refetches on every switch (S1, 2 `data:read` plus `tree:keyTypes`). gRPC refetches
  `grpcHistory:list` per switch. Space refetches `readFile`, `readDiff` and `blame.line` per switch (P1, P2).
  Data grid, definition, console and stream tabs fire none. Single tab worlds fire one
  `variables:listEnvironments` on the first mode round trip only.
- Q2: gRPC `grpc:describe` reruns after 6 min (S2). Discover reruns `dataView`, `dataViews` and `histogram`
  (S3). Postgres refetches `maskRules:*` (S4-class app list). Space local file refetches `openedFiles:read`
  every switch and after 6 min (P3).
- Q5: Space grows ~3 MB per round (32.4, 36.2, 39.0) and Studio Discover ~4 MB per round (34.6, 38.6, 42.2).
  Not in the plan's findings; investigated in follow-up commits. Other worlds drift 0.2-0.7 MB per round.
- Q6: Discover (+33.7 MB) and Space repo (+27.1 MB) stay far above baseline after close-all and keep growing
  across the second cycle (+3.3, +2.8 MB). The rest end within 2-3 MB of baseline plus first-load module code.
- Q4: largest per-open deltas are first loads of heavy modules (grid 9.9, document 10.1, Discover 17.6, Space
  file 14.7 MB), not steady state.
- Stream D worlds not covered: Kafka stream (SQS stands in), Space commit diff, repo-graph per-commit data
  (graph is 300 fixture rows).

## After

Tree: `chapter/v0.2.24-stream-d` at the step 9 commit. Same probe, same fixtures, with two changes to the
fixtures: the Studio api world gained a `grpcHistoryList` snapshot after the before run, so the before
`grpcHistory:list` reads are partly a fixture artifact; the Space world gained `stat`/`oid` and gated
`unchanged` snapshots, because a mock that never answers `unchanged` cannot show the gate. Numbers are
single runs, noise about 0.3 MB.

| world | Q1 reads per round before -> after | Q2 reads after 6 min before -> after | Q5 heap round1 -> round3 before -> after | Q6 closed vs baseline before -> after |
|---|---|---|---|---|
| postgres grid, definition, console | 0 -> 0 | maskRules list+counts -> 0 | 26.8 -> 27.7 -> 27.0 -> 27.9 | 12.8 -> 13.0 |
| mongo document | 0 -> 0 | 0 -> 0 | 23.7 -> 24.1 -> 23.7 -> 24.1 | 9.0 -> 9.0 |
| redis browse + keyvalue | `keyTypes` + 2 `data:read` -> `keyTypes` only | 3 reads -> `keyTypes` only | 21.9 -> 22.5 -> 21.8 -> 22.4 | 2.1 -> 2.0 |
| sqs stream | 0 -> 0 | 0 -> 0 | 14.6 -> 14.9 -> 14.6 -> 14.9 | 2.2 -> 2.2 |
| kibana discover | 0 -> 0 | dataView + dataViews + histogram -> dataViews only | 34.7 -> 42.3 -> 34.4 -> 41.9 | 33.7 -> 33.4 |
| api grpc + http | `grpcHistory:list` -> 0 | `grpcHistory:list` + `grpc:describe` -> 0 | 24.9 -> 25.7 -> 24.9 -> 25.7 | 3.3 -> 3.2 |
| space repo graph, file, diff | 4 calls -> 4 calls, `readFile`/`readDiff` payload now empty | 4 -> 4 | 32.5 -> 38.9 -> 30.4 -> 32.8 | 27.1 -> 18.7 |
| space local file | 3 -> 3 | 3 -> 3 | 20.7 -> 21.4 -> 20.7 -> 21.5 | 2.8 -> 2.9 |

What the numbers say:

- Fixed: redis keyvalue no longer re-reads the key (S1); gRPC schema and history survive six minutes (S2);
  Discover keeps its data view and histogram (S3; the picker list `dataViews` stays on its 60 s
  `staleTime` as a named external-data exception); mask rules and counts survive (S4).
- Space file and diff: the calls remain (a stat check is still a call) but carry no content when nothing
  changed. Heap growth across three rounds drops from 6.4 MB to 2.4 MB and heap after close-all from
  27.1 to 18.7 MB over baseline. `git:blame.line` and `branch.syncChangeRequests` still fire per switch;
  neither is in this phase's findings.
- Not fixed: Space local file (P3). No watcher event exists for a Finder-opened file, so the read cannot be
  made safe to skip, and retaining the text with `staleTime: 0` would only add memory. Studio Discover
  still grows about 4 MB per round and ends 33 MB over baseline, and Space still grows about 0.7 MB per
  round and 2.8 MB per open/close cycle. The cause is not query-cache retention (the query fixes did not
  move it). Recorded in `docs/ARCHITECTURE.md` Known open items.


## Iter2

Tree: `chapter/v0.2.24`, before = `dce7bdbe9` (probe at 5 rounds, no fixes), after = `955b336a6`. Same probe and
fixtures. Noise about 0.3 MB. Discover and Space file after numbers repeat across 2-3 runs.

| world | metric | before | after |
|---|---|---|---|
| kibana discover | rounds 1-5 (MB) | 34.5, 38.4, 42.1, 46.2, 49.5 | 31.4, 32.3, 32.8, 33.9, 34.1 |
| kibana discover | growth per round after round 2 | about 3.7 | about 0.6 |
| kibana discover | closed vs baseline (MB) | 40.0 | 18.5 |
| kibana discover | `closed2` - `closed` (MB) | 5.0 | 1.9 |
| space repo graph, file, diff | rounds 1-5 (MB) | 30.7, 32.4, 33.1, 33.8, 34.2 | 30.5, 31.8, 32.3, 32.7, 32.9 |
| space repo graph, file, diff | growth per round after round 2 | about 0.6 | about 0.35 |
| space repo graph, file, diff | closed vs baseline (MB) | 19.4 | 15.5 |
| space repo graph, file, diff | `closed2` - `closed` (MB) | 2.8 | 0.3 |

Other worlds, one run each after the fixes, compared to the P433 after table: unchanged within noise.

| world | round1 -> round3 (MB) | closed vs baseline (MB) | closed2 - closed (MB) |
|---|---|---|---|
| postgres grid, definition, console | 26.8 -> 27.8 | 12.8 | 0.4 |
| mongo document | 23.7 -> 24.1 | 9.0 | 0.2 |
| redis browse + keyvalue | 21.9 -> 22.4 | 2.0 | 0.2 |
| sqs stream | 14.6 -> 14.9 | 2.2 | 0.3 |
| api grpc + http | 24.9 -> 25.8 | 3.2 | 0.3 |
| space local file | 20.7 -> 21.5 | 2.8 | 0.0 |

Targets:

- Space `closed2` - `closed` under 0.5 MB: met (0.3).
- Discover growth under 0.5 MB per round after round 2: missed (about 0.6, repeatable over 3 runs).
  The `ARCHITECTURE.md` Known open items entry stays, reworded with these numbers.
