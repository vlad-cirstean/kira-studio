// P44 F45: views/shared/page/scan.ts's runChunkedScan is a two-phase, frame-driven scheduler
// (P42 D37's priority window, then an ascending main pass) whose every interesting behaviour is
// defined *by animation-frame boundary* — three separate P43 findings (F30, F36, F36a, F40) reason
// about exactly this scheduling and none of them got a deterministic assertion, because a
// Playwright test cannot pause between two frames: it can only wait for a settled end state, by
// which point the priority tick, the chunk boundary and the cancel point have all already happened.
// P43 iteration 3's own plan said as much twice about the same surface (its commit 6/commit 4 rows:
// the SQLite seed "completes in one frame, so there is no in-flight scan to navigate"; the stale-
// failure half "has no DOM assertion the suite can make deterministically"). A fake
// requestAnimationFrame that hands frames out one at a time turns every one of these into an
// ordinary assertion. scan.ts imports nothing, so — unlike every other spec here — no window stub
// is needed, only the global requestAnimationFrame it calls by name.
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  eachMatch,
  runChunkedScan,
  type SearchQuery,
} from '../../src/renderer/views/shared/page/scan';

interface RowMatch {
  row: number;
}

const frames: (() => void)[] = [];
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
  cb: (t: number) => void,
) => {
  frames.push(() => cb(0));
  return frames.length;
};

beforeEach(() => {
  frames.length = 0;
});

function runFrame(): boolean {
  const cb = frames.shift();
  if (!cb) return false;
  cb();
  return true;
}

// Bounded, not a while(true): a queued .then() from a resolved `done` needs one microtask tick to
// run and (for the priority path) schedule its own next requestAnimationFrame call — awaiting a
// resolved Promise between frames lets that happen before the next runFrame() check.
async function drain(maxFrames = 20): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (!runFrame()) return;
    await Promise.resolve();
  }
}

// Ignores `pattern` entirely and records every row visited — the row-range facts this file checks
// (chunk boundaries, priority-window clamping) don't depend on what a real per-row scan body does,
// only on which rows runChunkedScan itself decided to visit and in what order.
function scanRow(row: number, _pattern: RegExp, out: RowMatch[]): void {
  out.push({ row });
}

const QUERY: SearchQuery = { text: 'x', matchCase: false, wholeWord: false, regex: false };

describe('runChunkedScan — frame semantics (P44 F45)', () => {
  test('1. nothing is published before the first frame', () => {
    const onProgress = () => {
      throw new Error('onProgress must not fire before a frame runs');
    };
    runChunkedScan<RowMatch>(100, scanRow, QUERY, onProgress);
    expect(frames.length).toBeGreaterThan(0);
  });

  test('2. a 5000-row page publishes rowsScanned exactly [2000, 4000, 5000] and resolves ascending', async () => {
    const rowsScannedTicks: number[] = [];
    const handle = runChunkedScan<RowMatch>(5000, scanRow, QUERY, (_found, rowsScanned) => {
      rowsScannedTicks.push(rowsScanned);
    });
    await drain();
    const matches = await handle.done;
    expect(rowsScannedTicks).toEqual([2000, 4000, 5000]);
    expect(matches).toHaveLength(5000);
    expect(matches.map((m) => m.row)).toEqual(Array.from({ length: 5000 }, (_, i) => i));
  });

  test('3. a priority window runs in its own first frame, publishing rowsScanned === 0 and only its own matches', async () => {
    const ticks: { rowsScanned: number; soFar: readonly RowMatch[] }[] = [];
    runChunkedScan<RowMatch>(
      5000,
      scanRow,
      QUERY,
      (_found, rowsScanned, _totalRows, soFar) => {
        ticks.push({ rowsScanned, soFar: [...soFar] });
      },
      { priority: { from: 4000, to: 4500 } },
    );
    runFrame(); // the priority frame only
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.rowsScanned).toBe(0);
    expect(ticks[0]?.soFar.map((m) => m.row)).toEqual(
      Array.from({ length: 500 }, (_, i) => 4000 + i),
    );
  });

  test('4. the final array is still strictly ascending from row 0 after a priority pass', async () => {
    const handle = runChunkedScan<RowMatch>(5000, scanRow, QUERY, () => {}, {
      priority: { from: 4000, to: 4500 },
    });
    await drain();
    const matches = await handle.done;
    expect(matches.map((m) => m.row)).toEqual(Array.from({ length: 5000 }, (_, i) => i));
  });

  test('5. a priority window is clamped at both ends', () => {
    const soFarSnapshots: number[][] = [];
    runChunkedScan<RowMatch>(
      100,
      scanRow,
      QUERY,
      (_found, _rowsScanned, _totalRows, soFar) => {
        soFarSnapshots.push(soFar.map((m) => m.row));
      },
      { priority: { from: -50, to: 150 } },
    );
    runFrame();
    expect(soFarSnapshots).toHaveLength(1);
    expect(soFarSnapshots[0]).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  test('6. an empty or inverted window falls through to the plain path with no priority tick', () => {
    const rowsScannedTicks: number[] = [];
    runChunkedScan<RowMatch>(
      100,
      scanRow,
      QUERY,
      (_found, rowsScanned) => rowsScannedTicks.push(rowsScanned),
      {
        priority: { from: 50, to: 50 },
      },
    );
    runFrame();
    expect(rowsScannedTicks).toEqual([100]); // a main-pass tick, never rowsScanned === 0

    frames.length = 0;
    const invertedTicks: number[] = [];
    runChunkedScan<RowMatch>(
      100,
      scanRow,
      QUERY,
      (_found, rowsScanned) => invertedTicks.push(rowsScanned),
      {
        priority: { from: 80, to: 20 },
      },
    );
    runFrame();
    expect(invertedTicks).toEqual([100]);
  });

  test('7. cancel before the first frame resolves with nothing found', async () => {
    const handle = runChunkedScan<RowMatch>(100, scanRow, QUERY, () => {});
    handle.cancel();
    await drain();
    expect(await handle.done).toEqual([]);
  });

  test('8. cancel mid-scan resolves with what was found so far', async () => {
    const handle = runChunkedScan<RowMatch>(5000, scanRow, QUERY, () => {});
    runFrame(); // one chunk: rows 0..1999
    handle.cancel();
    await drain();
    const matches = await handle.done;
    expect(matches).toHaveLength(2000);
  });

  test('9. an invalid regex throws synchronously, before any frame is scheduled', () => {
    const badQuery: SearchQuery = { text: '(', matchCase: false, wholeWord: false, regex: true };
    expect(() => runChunkedScan<RowMatch>(10, scanRow, badQuery, () => {})).toThrow();
    expect(frames).toHaveLength(0);
  });
});

describe('eachMatch (P44 F45)', () => {
  test('10. a zero-width pattern terminates instead of looping forever, and resets lastIndex', () => {
    const pattern = /x*/g;
    pattern.lastIndex = 5; // stale state from a previous scan — eachMatch must reset it
    const hits: [number, number][] = [];
    eachMatch(pattern, 'abc', (start, end) => hits.push([start, end]));
    expect(hits).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});
