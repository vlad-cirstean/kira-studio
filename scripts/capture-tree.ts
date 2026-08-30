// A dev tool for porting the remaining tests/e2e/*.spec.ts files into tests/ui/ (P57 M5),
// generalized from the Postgres-only scripts/capture-postgres-tree.ts to any adapter with a
// tests/db/support/<adapter>.ts start<X>() fixture: captures real tree.children/describe/
// data.read/... responses from a real container through the same in-process engine harness
// tests/ipc/*/*.backend.spec.ts already use (tests/ipc/support/harness.ts), so a tests/ui/
// fixture is built from real captured shapes rather than hand-guessed JSON — the same discipline
// P50 D5 established for tests/ipc/**/*.fixture.ts. Not part of the automated suite — a manual
// capture aid, run with `bun run scripts/capture-tree.ts <adapter> '<recipe JSON>'` or
// `... <adapter> --recipe-file <path>` (a file sidesteps shell-quoting a large JSON array).
//
// <adapter>: one of "postgres" | "mariadb" | "mongo" | "redis" — selects which tests/db/support/
// start<X>() fixture to boot and which ResolvedConnectionConfig the recipe's steps run against.
// scripts/capture-postgres-tree.ts is left in place unmodified (existing ports already document
// its own exact invocation history); this file is the one to reach for on every other adapter,
// including postgres captures going forward.
//
// Recipe: an array of steps, run in order against one connected fixture (same shape regardless
// of adapter — the engine's control/data protocol is adapter-agnostic):
//   {"kind":"connect"}                                                  -> {serverVersion, caps}
//   {"kind":"children","path":"..."}                                   -> TreeChildrenResult
//   {"kind":"describe","path":"...","tabId":null}                      -> TreeDescribeResult
//   {"kind":"definition","path":"...","tabId":null}                    -> TreeDefinitionResult
//   {"kind":"read","path":"...","pageSize":100,"filter":null,"sort":null,"projection":null,"cursor":{"mode":"offset","offset":0}} -> LogicalPage
//   {"kind":"count","path":"...","filter":null}                        -> {value, exact}
//   {"kind":"preview","path":"...","ops":[MutationRowOp, ...]}          -> {statements}
//   {"kind":"mutate","path":"...","ops":[MutationRowOp, ...]}           -> {affectedRows} or {error}
//     MutationRowOp: {"kind":"update","key":{...},"changes":{...}} | {"kind":"insert","values":{...}}
//                  | {"kind":"delete","key":{...}}
//   {"kind":"execute","path":"...","statements":["SELECT ...", ...]}   -> {pages} or {error}
// `mutate` steps run in recipe order against the *same* container — a delete/update/insert
// genuinely changes the data, so a recipe capturing a mutation sequence must list steps in the
// same order the ported spec will replay them, exactly like a real session would issue them.
// Each step's result is printed as one JSON object on its own line, prefixed by its index, so a
// long recipe's output can be split apart without re-running the container.
//
// Must run under plain Node, not Bun: `bun run`'s own `testcontainers` integration hangs
// indefinitely in this sandbox on `forListeningPorts()`/equivalent wait strategies for at least
// Postgres (confirmed, see scripts/capture-postgres-tree.ts's own header and AGENTS.md's Docker
// section) — bundle with esbuild and run under a real Node binary (the vendored
// shell/runtime/node/bin/node if present, otherwise this sandbox's own system `node`, itself a
// genuine Node binary and not Bun) the same way `scripts/run-ipc-backend.sh` already does for the
// tests/ipc backend tier. `harness.close()` does not hang, but a container's own `.stop()` port-wait
// can hang the same way `.start()`'s did — clean up with `docker rm -f` after instead of waiting.

import { DATA_OP } from '../src/shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '../src/shared/protocol/engine-ops';
import { startMariadb } from '../tests/db/support/mariadb';
import { startMongo } from '../tests/db/support/mongo';
import { startPostgres } from '../tests/db/support/postgres';
import { startRedis } from '../tests/db/support/redis';
import { decodePage } from '../tests/ipc/support/decode';
import { openHarness } from '../tests/ipc/support/harness';

type Adapter = 'postgres' | 'mariadb' | 'mongo' | 'redis';

interface Step {
  kind:
    | 'connect'
    | 'children'
    | 'describe'
    | 'definition'
    | 'read'
    | 'count'
    | 'preview'
    | 'mutate'
    | 'execute';
  path?: string;
  tabId?: string | null;
  pageSize?: number;
  filter?: string | null;
  sort?: unknown;
  projection?: unknown;
  cursor?: unknown;
  ops?: unknown[];
  refresh?: boolean;
  statements?: string[];
}

async function startAdapter(
  adapter: Adapter,
): Promise<{ config: ResolvedConnectionConfig; stop(): Promise<void> }> {
  switch (adapter) {
    case 'postgres': {
      const fx = await startPostgres();
      return { config: fx.config, stop: fx.stop };
    }
    case 'mariadb': {
      // seedBigTable:false — the 1M-row big_rows seed (and its ANALYZE TABLE) is P2 paging-only
      // and buys nothing for a manual tree/data capture; skipping it is minutes off every run.
      const fx = await startMariadb({ seedBigTable: false });
      return { config: fx.config, stop: fx.stop };
    }
    case 'mongo': {
      const fx = await startMongo();
      return { config: fx.config, stop: fx.stop };
    }
    case 'redis': {
      const fx = await startRedis();
      return { config: fx.config, stop: fx.stop };
    }
  }
}

async function main(): Promise<void> {
  const adapter = process.argv[2] as Adapter | undefined;
  if (!adapter || !['postgres', 'mariadb', 'mongo', 'redis'].includes(adapter)) {
    console.error("usage: capture-tree.ts <postgres|mariadb|mongo|redis> '<recipe JSON>'");
    process.exit(1);
  }
  let recipeArg = process.argv[3] ?? '[]';
  if (recipeArg === '--recipe-file') {
    const fs = await import('node:fs');
    recipeArg = fs.readFileSync(process.argv[4] as string, 'utf8');
  }
  const recipe = JSON.parse(recipeArg) as Step[];
  const fx = await startAdapter(adapter);
  const harness = await openHarness();
  try {
    const connectResult = await harness.connect(fx.config);
    console.log(`# connect: ${JSON.stringify(connectResult)}`);

    for (const [i, step] of recipe.entries()) {
      let result: unknown;
      const path = step.path ?? '';
      switch (step.kind) {
        case 'connect':
          result = connectResult;
          break;
        case 'children':
          result = await harness.children(fx.config.id, path);
          break;
        case 'describe':
          result = await harness.describe(fx.config.id, path, false, step.tabId ?? null);
          break;
        case 'definition':
          result = await harness.definition(fx.config.id, path, false, step.tabId ?? null);
          break;
        case 'read': {
          const payload = {
            opId: `capture-read-${i}`,
            tabId: step.tabId ?? null,
            connectionId: fx.config.id,
            path,
            projection: step.projection ?? null,
            filter: step.filter ?? null,
            sort: step.sort ?? null,
            pageSize: step.pageSize ?? 100,
            cursor: step.cursor ?? { mode: 'offset', offset: 0 },
          };
          const raw = await harness.dataOp<{ page: unknown; source: string }>(
            DATA_OP.read,
            payload,
          );
          result = { payload, page: decodePage(raw.page as Parameters<typeof decodePage>[0]) };
          break;
        }
        case 'count': {
          const payload = {
            opId: `capture-count-${i}`,
            tabId: step.tabId ?? null,
            connectionId: fx.config.id,
            path,
            filter: step.filter ?? null,
            refresh: step.refresh ?? false,
          };
          result = { payload, ...(await harness.dataOp(DATA_OP.count, payload)) };
          break;
        }
        case 'preview': {
          const payload = { connectionId: fx.config.id, path, ops: step.ops ?? [] };
          result = { payload, ...(await harness.dataOp(DATA_OP.preview, payload)) };
          break;
        }
        case 'execute': {
          const payload = {
            opId: `capture-execute-${i}`,
            tabId: step.tabId ?? null,
            connectionId: fx.config.id,
            path,
            statements: step.statements ?? [],
          };
          try {
            const raw = await harness.dataOp<{ pages: unknown[] }>(DATA_OP.execute, payload);
            result = {
              payload,
              pages: raw.pages.map((p) => decodePage(p as Parameters<typeof decodePage>[0])),
            };
          } catch (err) {
            result = {
              payload,
              error: { message: (err as Error).message, code: (err as { code?: string }).code },
            };
          }
          break;
        }
        case 'mutate': {
          const payload = {
            opId: `capture-mutate-${i}`,
            tabId: step.tabId ?? null,
            connectionId: fx.config.id,
            path,
            ops: step.ops ?? [],
          };
          try {
            result = { payload, ok: await harness.dataOp(DATA_OP.mutate, payload) };
          } catch (err) {
            result = {
              payload,
              error: { message: (err as Error).message, code: (err as { code?: string }).code },
            };
          }
          break;
        }
      }
      console.log(`## step ${i} (${step.kind} ${path})`);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await harness.close();
    // fx.stop() not called: not needed for a one-off manual capture, and every adapter's own
    // container.stop() internally reuses the same wait-strategy machinery the header comment
    // named as a Bun-specific hang risk — `docker rm -f` the container manually after this script
    // exits instead.
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
