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
  }
}

export {};
