import { InMemoryViewStateStore, mount, type TokenMap, TokenReader } from "@kira-version/ui";
import { createMockBridge } from "./mockBridge.ts";
import { loadScenario } from "./scenarios/index.ts";
import { applyThemeKind, isThemeKind, type ThemeKind } from "./themeSwitcher.ts";

declare global {
  interface Window {
    __kiraHarness: {
      setTheme(kind: ThemeKind): void;
      readTokens(): TokenMap;
    };
  }
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
