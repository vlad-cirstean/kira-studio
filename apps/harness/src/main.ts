import { CommitStore, layoutAppend } from "@kira-version/core";
import {
  createLayoutClient,
  InMemoryViewStateStore,
  mount,
  type TokenMap,
  TokenReader,
} from "@kira-version/ui";
import { createMockBridge } from "./mockBridge.ts";
import { loadScenario } from "./scenarios/index.ts";
import { topology } from "./scenarios/topology.ts";
import { applyThemeKind, isThemeKind, type ThemeKind } from "./themeSwitcher.ts";

declare global {
  interface Window {
    __kiraHarness: {
      setTheme(kind: ThemeKind): void;
      readTokens(): TokenMap;
      checkLayoutWorker(): Promise<boolean>;
    };
  }
}

/**
 * P4 W4's own "Done when": an integration-style test drives the *real* module worker (not a
 * `WorkerLike` stub — `tests/unit/ui/layoutClient.test.ts` already covers the stub) through a
 * couple of pages and compares its output, row for row, against a synchronous `layoutAppend`
 * call fed the same input. This only needs to run in a real browser (a module worker is not
 * constructible under Bun), so it lives here as a harness hook a Playwright spec drives, rather
 * than as a `bun:test` unit test.
 *
 * The topology mixes a merge commit into an otherwise-linear chain so the two pages actually
 * exercise a patch (§5.2): the merge's second parent resolves in the first page, forcing the
 * worker to see `resolvedParentSlots` do real work, not just append straight edges.
 */
async function checkLayoutWorker(): Promise<boolean> {
  const spec = ["base", "side:base", "merge:base,side"];
  for (let i = 0; i < 20; i++) {
    spec.push(i === 0 ? `c0:merge` : `c${i}:c${i - 1}`);
  }
  const allRecords = topology(spec);

  const oracleStore = new CommitStore();
  oracleStore.appendPage(allRecords);
  const pageSize = 8;
  let oracleFrontier: ReturnType<typeof layoutAppend>["frontier"] | undefined;
  const oracleChunks: ReturnType<typeof layoutAppend>["chunk"][] = [];
  for (let from = 0; from < allRecords.length; from += pageSize) {
    const to = Math.min(from + pageSize, allRecords.length);
    const input = oracleStore.layoutInput(from, to);
    const result = layoutAppend(input, oracleFrontier);
    oracleFrontier = result.frontier;
    oracleChunks.push(result.chunk);
  }

  const workerStore = new CommitStore();
  workerStore.appendPage(allRecords);
  const client = createLayoutClient();
  try {
    const workerChunks = [];
    for (let from = 0; from < allRecords.length; from += pageSize) {
      const to = Math.min(from + pageSize, allRecords.length);
      const input = workerStore.layoutInput(from, to);
      workerChunks.push(await client.submit(input));
    }

    if (workerChunks.length !== oracleChunks.length) return false;
    for (let i = 0; i < oracleChunks.length; i++) {
      const oracle = oracleChunks[i];
      const worker = workerChunks[i];
      if (!oracle || !worker) return false;
      if (!arraysEqual(oracle.laneOf, worker.laneOf)) return false;
      if (!arraysEqual(oracle.colorOf, worker.colorOf)) return false;
      if (!arraysEqual(oracle.edges, worker.edges)) return false;
      if (!arraysEqual(oracle.edgeIndex, worker.edgeIndex)) return false;
      if (!arraysEqual(oracle.patches, worker.patches)) return false;
      if (oracle.laneCount !== worker.laneCount) return false;
      if (oracle.maxEdgeSpan !== worker.maxEdgeSpan) return false;
    }
    return true;
  } finally {
    client.dispose();
  }
}

function arraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const params = new URLSearchParams(location.search);
const scenarioName = params.get("scenario") ?? "clean";
const themeParam = params.get("theme") ?? "vscode-dark";

applyThemeKind(isThemeKind(themeParam) ? themeParam : "vscode-dark");

// Exercises the same getComputedStyle bridge the grid/graph row geometry reads --kv-row-height
// through (P4 W1 on) — re-read on every theme switch via the same MutationObserver path, not a
// fresh instance.
const tokenReader = new TokenReader();
tokenReader.watch();

window.__kiraHarness = {
  setTheme(kind: ThemeKind): void {
    applyThemeKind(kind);
  },
  readTokens(): TokenMap {
    return tokenReader.tokens;
  },
  checkLayoutWorker,
};

const container = document.getElementById("app");
if (!container) {
  throw new Error("harness: #app container missing from index.html");
}

const transport = createMockBridge(scenarioName);

// There is no repo-picker UI yet (P4+) — `App.vue`'s own `bootstrap()` only opens a repo
// automatically when `viewState.read()` returns a persisted, non-null `repoId`. Pre-seeding it
// here (via `setRaw`, the store's documented test-only injection hook) exploits that existing
// logic to get every scenario auto-loading on mount.
const viewState = new InMemoryViewStateStore();
let repoId: string | null = null;
try {
  const scenario = loadScenario(scenarioName);
  if (scenario.repoOpen.kind === "ok") repoId = scenario.repoOpen.repo.repoId;
} catch {
  // An unimplemented scenario stub (dirty/conflicted, see their own files) throws on any
  // property access by design — leave repoId null and let bootstrap() run without opening a
  // repo, rather than crash the page before the shell itself has a chance to render.
}
viewState.setRaw({ version: 1, repoId, loadedRows: 0, detailOpen: true });

mount(container, { transport, viewState, host: "harness" });
