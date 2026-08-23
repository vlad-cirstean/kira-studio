#!/usr/bin/env bun
/**
 * W17: the wire path's own cost, isolated from git and from layout — `packSlice` →
 * `structuredClone` (with and without a transfer list) → `appendPacked`, over a 5,000-row page
 * and over all twenty pages of `largeBranchy(100_000)`. `historyPipeline.ts` (W15) already
 * measures git-spawn-through-layout; this measures the one hop it does not isolate: what
 * `packSlice`'s own cost is, what `structuredClone` costs with the transfer list §5.5 promises
 * ("transfers, not clones") versus without one, and what `appendPacked` costs on the receiving
 * side — the whole round trip a real host's `postMessage` performs every page.
 *
 * `cloneMsNoTransfer` is why this item exists at all rather than folding into W16 or
 * `historyPipeline.ts`: `Webview.postMessage` (VS Code, V1) exposes no transfer list in
 * `@types/vscode`, which implies a full structured clone of every `ArrayBuffer` on that
 * boundary. §5.1 gives the panel 300ms to first paint and 400ms to a first page; if that clone
 * cost is large, it belongs in that budget's accounting from P3 onward, not discovered by P4
 * while it is also standing up a renderer.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommitStore, packedTransferList } from "../../packages/core/src/store/commitStore.ts";
import { locateGit } from "../../packages/git/src/discovery.ts";
import { openLogSession } from "../../packages/git/src/logSession.ts";
import { NodeProcessRunner } from "../../packages/git/src/nodeProcessRunner.ts";
import { largeBranchy } from "../fixtures/generateRepo.ts";

const BASELINE_PATH = join(import.meta.dir, "streamRoundTrip.budget.json");
const REGRESSION_TOLERANCE = 0.2; // 20%, matching run.ts's and historyPipeline.ts's §5.1 convention
const COMMIT_COUNT = 100_000;
const PAGE_SIZE = 5000;

interface Measurement {
  readonly packMs: number;
  readonly cloneMs: number;
  readonly cloneMsNoTransfer: number;
  readonly appendMs: number;
  readonly wireBytesFirstPage: number;
  readonly wireBytes100k: number;
  readonly roundTripMs100k: number;
}

function transferListBytes(chunk: ReturnType<CommitStore["packSlice"]>): number {
  return packedTransferList(chunk).reduce((sum, buffer) => sum + buffer.byteLength, 0);
}

async function measure(): Promise<Measurement> {
  const { dir } = largeBranchy(COMMIT_COUNT); // commitGraph: true by default (W13), shared cache
  const runner = new NodeProcessRunner();
  const resolution = await locateGit({ runner });
  if (resolution.kind !== "ok") throw new Error("no usable system git found for this measurement");

  const store = new CommitStore();
  const session = openLogSession(resolution.git, runner, dir, {
    scope: "all",
    pageSize: PAGE_SIZE,
  });
  for (;;) {
    const outcome = await session.readPage((record) => store.append(record));
    if (outcome.kind === "stale") throw new Error("unexpected stale during a perf measurement");
    if (outcome.exhausted) break;
  }
  session.dispose();
  if (store.rowCount !== COMMIT_COUNT) {
    throw new Error(`expected ${COMMIT_COUNT} rows, loaded ${store.rowCount}`);
  }

  // First-page metrics, each against its own freshly packed chunk: `structuredClone` with a
  // transfer list detaches every buffer it's given, so reusing one chunk across two clone
  // measurements would make the second measure a clone of already-empty buffers.
  const packStart = performance.now();
  const chunkForPackMs = store.packSlice(0, PAGE_SIZE, 0);
  const packMs = performance.now() - packStart;
  const wireBytesFirstPage = transferListBytes(chunkForPackMs);

  const chunkForClone = store.packSlice(0, PAGE_SIZE, 0);
  const transferList = packedTransferList(chunkForClone);
  const cloneStart = performance.now();
  const clonedWithTransfer = structuredClone(chunkForClone, { transfer: transferList });
  const cloneMs = performance.now() - cloneStart;

  const chunkForCloneNoTransfer = store.packSlice(0, PAGE_SIZE, 0);
  const cloneNoTransferStart = performance.now();
  structuredClone(chunkForCloneNoTransfer); // full copy — the VS Code `postMessage` path (V1)
  const cloneMsNoTransfer = performance.now() - cloneNoTransferStart;

  const appendTarget = new CommitStore();
  const appendStart = performance.now();
  appendTarget.appendPacked(clonedWithTransfer);
  const appendMs = performance.now() - appendStart;

  // The full round trip: every one of the twenty pages through pack -> clone(with transfer) ->
  // append, sequentially, exactly the sequence a real stream produces one chunk at a time.
  const roundTripReceiver = new CommitStore();
  let dictionaryCursor = 0;
  let wireBytes100k = 0;
  const roundTripStart = performance.now();
  for (let from = 0; from < store.rowCount; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, store.rowCount);
    const chunk = store.packSlice(from, to, dictionaryCursor);
    dictionaryCursor += chunk.dictionary.length;
    wireBytes100k += transferListBytes(chunk);
    const cloned = structuredClone(chunk, { transfer: packedTransferList(chunk) });
    roundTripReceiver.appendPacked(cloned);
  }
  const roundTripMs100k = performance.now() - roundTripStart;
  if (roundTripReceiver.rowCount !== COMMIT_COUNT) {
    throw new Error(
      `round trip: expected ${COMMIT_COUNT} rows, received ${roundTripReceiver.rowCount}`,
    );
  }

  return {
    packMs,
    cloneMs,
    cloneMsNoTransfer,
    appendMs,
    wireBytesFirstPage,
    wireBytes100k,
    roundTripMs100k,
  };
}

function loadBaseline(): Measurement | undefined {
  if (!existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Measurement;
}

function saveBaseline(measurement: Measurement): void {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(measurement, null, 2)}\n`);
}

const GATED_METRICS = ["packMs", "cloneMs", "appendMs"] as const;
const RECORDED_ONLY_METRICS = [
  "cloneMsNoTransfer",
  "wireBytesFirstPage",
  "wireBytes100k",
  "roundTripMs100k",
] as const;

function report(actual: Measurement, baseline: Measurement): boolean {
  let regressed = false;
  const rows: string[] = [];

  for (const name of GATED_METRICS) {
    const base = baseline[name];
    const value = actual[name];
    const delta = base === 0 ? (value === 0 ? 0 : Number.POSITIVE_INFINITY) : (value - base) / base;
    const isRegression = delta > REGRESSION_TOLERANCE;
    if (isRegression) regressed = true;
    rows.push(
      `  ${isRegression ? "✗" : "✓"} ${name}: baseline=${base.toFixed(2)} actual=${value.toFixed(2)} delta=${(delta * 100).toFixed(1)}%`,
    );
  }
  for (const name of RECORDED_ONLY_METRICS) {
    rows.push(`  · ${name} (recorded, not gated): ${actual[name].toFixed(2)}`);
  }

  console.log(
    "test:perf (stream round trip) —",
    regressed ? "REGRESSION" : "within budget",
    `(tolerance ${REGRESSION_TOLERANCE * 100}%)`,
  );
  console.log(rows.join("\n"));
  return regressed;
}

async function main(): Promise<void> {
  const updateBaseline = process.argv.includes("--update-baseline");
  const measurement = await measure();

  if (updateBaseline || !existsSync(BASELINE_PATH)) {
    saveBaseline(measurement);
    console.log(`test:perf (stream round trip) — baseline written to ${BASELINE_PATH}`);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    throw new Error("unreachable: baseline existence checked above");
  }

  const regressed = report(measurement, baseline);
  if (regressed) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
