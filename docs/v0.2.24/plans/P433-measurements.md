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
