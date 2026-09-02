// Ambient `Window` augmentation for tests/ui/*.spec.ts, typechecked under tsconfig.node.json as
// its own TS program (separate from apps/kira-studio/frontend/src's own tsconfig.web.json) — so the identically
// named hooks apps/kira-studio/frontend/src/main.ts assigns at runtime (D5/D6) need re-declaring here too, for the
// specs that read them straight off `window` inside a `page.evaluate()` callback rather than
// through a local cast.
declare global {
  interface Window {
    /** Playwright-only hook (apps/kira-studio/frontend/src/main.ts) — the exact §2.2 retained-bytes figure. */
    __kiraGridRetainedBytes?: () => number;
    /** Playwright-only hook (apps/kira-studio/frontend/src/main.ts, D5) — the sum across all five page stores. */
    __kiraRetainedBytes?: () => number;
    /** Playwright-only hook (apps/kira-studio/frontend/src/main.ts, D6) — the tree's live connection ids. */
    __kiraTreeConnectionIds?: () => string[];
    /** Playwright-only hook (apps/kira-studio/frontend/src/main.ts, P5 C1) — the renderer-retention
     *  probe. Left untyped (`unknown`) here — this file is a separate TS program from
     *  frontend/src's own, and leaks.spec.ts only ever compares it whole with `toEqual`. */
    __kiraRetention?: () => unknown;
    /** P22 iter2 D2 — a real-fling scroll trace (apps/kira-studio/frontend/src/views/grid/scrollTrace.ts).
     *  Not a Playwright hook in intent (a human on real hardware is meant to drive it), but
     *  scroll-trace.spec.ts exercises its start()/stop() plumbing sandboxed — see that file's own
     *  header comment for what it can and cannot prove from here. Shape redeclared, not imported,
     *  matching this file's own convention (a separate TS program from frontend/src's own). */
    __kiraScrollTrace?: {
      start: () => void;
      stop: () => {
        frames: {
          t: number;
          scrollEvents: number;
          scrollTopAtEvent: { offset: number; t: number; afterRaf: boolean }[];
          pxPerFrame: number;
          notified: boolean;
          mountedTop: number;
          mountedBottom: number;
          liveScrollTop: number;
          clientHeight: number;
          uncoveredPx: number;
          renderMs: number;
          rows: number;
        }[];
        summary: {
          pxPerFrame: { p50: number; p95: number; max: number };
          uncoveredPx: { p50: number; p95: number; max: number };
          renderMs: { p50: number; p95: number; max: number };
          scrollEventsHistogram: Record<number, number>;
        };
      } | null;
    };
  }
}

export {};
