// A dev tool for porting the remaining tests/e2e/*.spec.ts files into tests/ui/ (P57 M5): captures
// real tree.children/describe/data.read responses from a real Postgres container through the same
// in-process engine harness tests/ipc/*/*.backend.spec.ts already use (tests/ipc/support/harness.ts),
// so a tests/ui/ fixture is built from real captured shapes rather than hand-guessed JSON — the same
// discipline P50 D5 established for tests/ipc/**/*.fixture.ts (a hand-written tree node once used the
// wrong `path` shape and was silently rendered rather than rejected; capturing for real is how this
// repo avoids that class of bug). Not part of the automated suite — a manual capture aid, run with
// `bun run scripts/capture-postgres-tree.ts '<recipe JSON>'`.
//
// Recipe: an array of steps, run in order against one connected Postgres fixture:
//   {"kind":"children","path":"..."}                                   -> TreeChildrenResult
//   {"kind":"describe","path":"...","tabId":null}                      -> TreeDescribeResult
//   {"kind":"definition","path":"...","tabId":null}                    -> TreeDefinitionResult
//   {"kind":"read","path":"...","pageSize":100,"filter":null,"sort":null,"projection":null,"cursor":{"mode":"offset","offset":0}} -> LogicalPage or {error}
//     `cursor` may also be the string "after:<i>"/"before:<i>", resolved against step i's own
//     captured `page.position.nextToken`/`prevToken` — the only way to capture a real keyset
//     round trip, since the token is an opaque value the adapter itself mints and cannot be
//     guessed or reused across a fresh container.
//     `cancelAfterMs` (read only) fires the read, waits that long, then calls `adapter:cancel`
//     (ENGINE_OP.cancel) with the read's own opId and awaits the (now-racing) read — the real way
//     to capture a genuine mid-flight cancellation (57014/"canceling statement due to user
//     request"), not an invented E_CANCELLED message. Needs a `filter` slow enough to still be
//     running `cancelAfterMs` after it starts (a `pg_sleep` in the WHERE clause, e.g.).
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
// indefinitely in this sandbox on `forListeningPorts()` specifically (confirmed — the identical
// container, wait strategy and image complete in ~2s under
// `node --experimental-strip-types --experimental-transform-types`, and hang for minutes with no
// further log output under `bun run`; AGENTS.md's Docker section already names this class of
// issue generically for other adapters, this confirms it for Postgres too). `harness.close()`
// does not hang, but `container.stop()`'s own port-wait does the same way `.start()`'s did in an
// earlier attempt that used Bun — clean up with `docker rm -f` after instead of waiting on it.

import { DATA_OP } from '../src/shared/protocol/data-ops';
import { ENGINE_OP } from '../src/shared/protocol/engine-ops';
import { startPostgres } from '../tests/db/support/postgres';
import { decodePage } from '../tests/ipc/support/decode';
import { openHarness } from '../tests/ipc/support/harness';

interface Step {
  kind:
    | 'children'
    | 'describe'
    | 'definition'
    | 'read'
    | 'count'
    | 'preview'
    | 'mutate'
    | 'execute';
  path: string;
  tabId?: string | null;
  pageSize?: number;
  filter?: string | null;
  sort?: unknown;
  projection?: unknown;
  cursor?: unknown;
  ops?: unknown[];
  refresh?: boolean;
  statements?: string[];
  cancelAfterMs?: number;
}

// Resolves a `cursor` of the form "after:<i>"/"before:<i>" against an earlier `read` step's own
// captured position — see the recipe doc comment above. Anything else (a plain cursor object, or
// absent) passes through unchanged, exactly as before this existed.
function resolveCursor(cursor: unknown, results: unknown[]): unknown {
  if (typeof cursor === 'string') {
    const m = /^(after|before):(\d+)$/.exec(cursor);
    if (m) {
      const [, mode, idxStr] = m;
      const prior = results[Number(idxStr)] as { page: { position: Record<string, unknown> } };
      const token = prior.page.position[mode === 'after' ? 'nextToken' : 'prevToken'];
      return { mode, token };
    }
  }
  return cursor ?? { mode: 'offset', offset: 0 };
}

async function main(): Promise<void> {
  const recipe = JSON.parse(process.argv[2] ?? '[]') as Step[];
  const pg = await startPostgres();
  const harness = await openHarness();
  try {
    const connectResult = await harness.connect(pg.config);
    console.log(`# connect: ${JSON.stringify(connectResult)}`);

    const results: unknown[] = [];
    for (const [i, step] of recipe.entries()) {
      let result: unknown;
      switch (step.kind) {
        case 'children':
          result = await harness.children(pg.config.id, step.path);
          break;
        case 'describe':
          result = await harness.describe(pg.config.id, step.path, false, step.tabId ?? null);
          break;
        case 'definition':
          result = await harness.definition(pg.config.id, step.path, false, step.tabId ?? null);
          break;
        case 'read': {
          const payload = {
            opId: `capture-read-${i}`,
            tabId: step.tabId ?? null,
            connectionId: pg.config.id,
            path: step.path,
            projection: step.projection ?? null,
            filter: step.filter ?? null,
            sort: step.sort ?? null,
            pageSize: step.pageSize ?? 100,
            cursor: resolveCursor(step.cursor, results),
          };
          if (step.cancelAfterMs !== undefined) {
            const pending = harness.dataOp<{ page: unknown; source: string }>(
              DATA_OP.read,
              payload,
            );
            await new Promise((r) => setTimeout(r, step.cancelAfterMs));
            const cancelResult = await harness.engineOp(ENGINE_OP.cancel, { opId: payload.opId });
            try {
              const raw = await pending;
              result = {
                payload,
                cancelResult,
                page: decodePage(raw.page as Parameters<typeof decodePage>[0]),
              };
            } catch (err) {
              result = {
                payload,
                cancelResult,
                error: { message: (err as Error).message, code: (err as { code?: string }).code },
              };
            }
            break;
          }
          try {
            const raw = await harness.dataOp<{ page: unknown; source: string }>(
              DATA_OP.read,
              payload,
            );
            result = { payload, page: decodePage(raw.page as Parameters<typeof decodePage>[0]) };
          } catch (err) {
            // A real invalid-filter capture (a genuine Postgres syntax error) needs this the same
            // way 'execute'/'mutate' already do — a bad WHERE fragment throws, it does not resolve.
            result = {
              payload,
              error: { message: (err as Error).message, code: (err as { code?: string }).code },
            };
          }
          break;
        }
        case 'count': {
          const payload = {
            opId: `capture-count-${i}`,
            tabId: step.tabId ?? null,
            connectionId: pg.config.id,
            path: step.path,
            filter: step.filter ?? null,
            refresh: step.refresh ?? false,
          };
          result = { payload, ...(await harness.dataOp(DATA_OP.count, payload)) };
          break;
        }
        case 'preview': {
          const payload = { connectionId: pg.config.id, path: step.path, ops: step.ops ?? [] };
          result = { payload, ...(await harness.dataOp(DATA_OP.preview, payload)) };
          break;
        }
        case 'execute': {
          const payload = {
            opId: `capture-execute-${i}`,
            tabId: step.tabId ?? null,
            connectionId: pg.config.id,
            path: step.path,
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
            connectionId: pg.config.id,
            path: step.path,
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
      results.push(result);
      console.log(`## step ${i} (${step.kind} ${step.path})`);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await harness.close();
    // pg.stop() not called: not needed for a one-off manual capture, and `container.stop()`
    // internally reuses the same wait-strategy machinery this file's header comment named as a
    // Bun-specific hang risk — `docker rm -f` the container manually after this script exits.
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
