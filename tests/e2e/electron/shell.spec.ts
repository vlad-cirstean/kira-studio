import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { linear } from "../support/generateRepo.ts";

/**
 * P3 W15 — the real Electron host, launched as a real window rather than the harness's
 * in-memory mock. `KIRA_REPO` (`packages/host-electron/src/main/index.ts`) is a dev/e2e-only
 * hook: with no repo-picker UI yet (P4+), this is the only way to get a repo open without a
 * human clicking through a native file dialog.
 *
 * **Environment reality.** Narrower than the P0/P1/P2 precedent this file's own history assumed:
 * the `electron` npm package's binary download is *not* blocked here (`bun install` fetches it
 * from npm's own registry, unlike the VS Code build `panel.spec.ts` needs, which really is
 * blocked — see there). What this sandbox lacks is a display and a desktop session: Electron
 * needs an X server (`Missing X server or $DISPLAY` without one) and `--no-sandbox` (this
 * container has no working setuid sandbox helper). With both:
 *
 *   bun run build && KIRA_PLAYWRIGHT_CHROMIUM_PATH=<path> xvfb-run -a bunx playwright test --project=electron
 *
 * this file's first test passes for real, in this sandbox, against a real Electron window and a
 * real generated git repo — confirmed by an actual run. The second test hits a narrower, third
 * environment gap of its own (documented at its own definition, below) that the first test does
 * not: this container has no D-Bus session bus, which is what `nativeTheme` needs to learn about
 * an OS theme change at all. On a real desktop (macOS, Windows, or Linux with a desktop D-Bus
 * session) plain `bunx playwright test --project=electron` is enough; xvfb-run and the chromium
 * path override are this headless sandbox's own concessions, not something a normal run needs.
 *
 * `MAIN_JS` resolves off `process.cwd()`, not `import.meta.dirname`: the pinned
 * `@playwright/test@1.62.1`'s own test-file transform cannot load a spec that references
 * `import.meta` at all — confirmed with a one-line repro file — independent of anything above.
 * `playwright.config.ts`'s `testDir` is already root-relative, so Playwright always runs from
 * the repo root.
 */
const MAIN_JS = resolve(process.cwd(), "dist", "electron", "main.js");

/** A fresh `--user-data-dir` per launch: `app.requestSingleInstanceLock()` (`main/index.ts`)
 *  keys off the default userData path, which is the same for every launch of this same binary
 *  — with `fullyParallel: true` running this file's tests concurrently, two launches sharing
 *  that default would make the second's lock request fail and its process quit immediately,
 *  never producing a window (confirmed: without this, the second launch exits cleanly with a
 *  "socket hang up" from Playwright's side, and the first launch mysteriously has no repo-open
 *  test failures because it *is* the surviving instance). */
function launchArgs(): string[] {
  const userDataDir = mkdtempSync(join(tmpdir(), "kira-e2e-electron-userdata-"));
  return [MAIN_JS, "--no-sandbox", `--user-data-dir=${userDataDir}`];
}

test.describe("electron shell", () => {
  test("opens a window and shows the generated repository's live values", async () => {
    const repo = linear(10);
    const app = await electron.launch({
      args: launchArgs(),
      env: { ...process.env, KIRA_REPO: repo.dir },
    });

    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-testid="connection-state"]');

      await expect(page.getByTestId("connection-state")).toHaveText("connected");
      await expect(page.getByTestId("repo-root")).toHaveText(repo.dir);
      await expect(page.getByTestId("commit-count")).toHaveText(String(repo.commits.length));
      // The very first stream for a freshly opened repo has nothing cached yet — every row it
      // emits comes from `RepoService.streamGraph`'s one fresh page read (§5.4), never a replay.
      await expect(page.getByTestId("chunk-source")).toHaveText("git");
    } finally {
      await app.close();
    }
  });

  test("switching the OS colour scheme swaps the palette live, with no reload", async () => {
    // `kiraVersion.theme.kind` defaults to "system" and there is no settings UI yet to change
    // the *setting* itself in this host (`main/index.ts`'s own comment: "the settings UI has no
    // phase yet and is not invented here") — that half of §3.4's theme story is what
    // `tests/e2e/vscode/panel.spec.ts` exercises instead, since VS Code's setting is real today.
    // What Electron *can* genuinely do without any UI is react to the OS-level signal
    // `renderer/index.ts`'s `watchThemeKind` already listens for — `nativeTheme.themeSource`
    // (`ports/theme.ts`'s `ElectronTheme`), the same signal `main/index.ts` reads for its own
    // `theme.current()` log line. `page.emulateMedia` looked like the obvious tool for this, but
    // Electron's own `nativeTheme` resolves `prefers-color-scheme` for every renderer at the
    // Chromium-embedder level, underneath where Playwright's CDP-based media emulation attaches
    // — confirmed by a real run in this sandbox where `emulateMedia` never changed the computed
    // token at all — so the only faithful way to drive this from outside the app is
    // `app.evaluate`, which runs in the real main process and can flip the real signal.
    //
    // **Environment reality, narrower than the rest of this file.** Unlike the first test (which
    // passes for real here), this one is currently environment-blocked in this specific sandbox
    // for a third, distinct reason from the two documented at the top of this file: confirmed by
    // direct probe (`nativeTheme.themeSource` set, then `window.matchMedia("(prefers-color-
    // scheme: dark)").matches` polled and never flips) that `nativeTheme`'s own OS-theme
    // propagation into Chromium's renderer never fires here — this container has no D-Bus/desktop
    // theme portal for Electron to synchronize through (`[ERROR:dbus/bus.cc] Failed to connect
    // to the bus: ... No such file or directory` in this same launch's stderr). A real desktop
    // (macOS, Windows, or a Linux desktop session with a running D-Bus session bus) does not have
    // this gap.
    const repo = linear(3);
    const app = await electron.launch({
      args: launchArgs(),
      env: { ...process.env, KIRA_REPO: repo.dir },
    });

    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-testid="connection-state"]');
      // `gen-theme-palettes.ts`'s generated rules are scoped `:root:has(body.vscode-dark)` etc
      // (§3.4, W12) — every `--kv-*` consumer in `vscode-tokens.css` reads its `--vscode-*`
      // source through a `var()` written on `:root`, and a custom property's `var()` resolves
      // using the value visible at the *declaring* element, not the element's descendants; a
      // `--vscode-editor-background` set only on `body` would be invisible to a `var()` written
      // on `:root` (confirmed the hard way: this test read the same fallback colour under both a
      // real light and a real dark body class until that selector changed) — so this reads off
      // `body`, matching where `renderer/index.ts`'s `applyThemeClass` puts the class, but the
      // colour itself resolves through `:root`.
      const readAppBg = () =>
        page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--kv-app-bg").trim());
      const setThemeSource = (source: "light" | "dark") =>
        app.evaluate(({ nativeTheme }, value) => {
          nativeTheme.themeSource = value;
        }, source);

      await setThemeSource("light");
      const light = await readAppBg();

      await setThemeSource("dark");
      await expect.poll(readAppBg).not.toBe(light);
      const dark = await readAppBg();
      expect(dark).not.toBe(light);
    } finally {
      await app.close();
    }
  });
});
