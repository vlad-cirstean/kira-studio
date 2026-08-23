/**
 * `BrowserWindow` creation (P3 W11, §2.2) — `contextIsolation`/`sandbox` on, `nodeIntegration`
 * off, and a preload built to CommonJS (W13): an ESM preload requires `sandbox: false` in
 * Electron, and trading the sandbox for a bundler flag is a bad trade. Bounds persist through
 * `Storage` and are clamped to a currently-visible display on restore, so a window last placed
 * on a monitor that is no longer connected does not open off-screen.
 */

import type { Storage } from "@kira-version/core";
import { BrowserWindow, screen } from "electron";

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const STORAGE_KEY = "windowBounds";
const DEFAULT_SIZE = { width: 1280, height: 800 };
const BOUNDS_SAVE_DEBOUNCE_MS = 500;

function isBounds(value: unknown): value is Bounds {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Bounds>;
  return (
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

/** A window whose stored bounds fall entirely outside every currently-connected display's work
 *  area is reset to that display's origin — the monitor it was last on may be gone. */
function clampToVisibleDisplay(bounds: Bounds): Bounds {
  const onSomeDisplay = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
  return onSomeDisplay ? bounds : { ...bounds, x: 0, y: 0 };
}

export interface CreateWindowOptions {
  readonly storage: Storage;
  readonly preloadPath: string;
}

export function createWindow(opts: CreateWindowOptions): BrowserWindow {
  const stored = opts.storage.get<Bounds>("global", STORAGE_KEY);
  const bounds = clampToVisibleDisplay(isBounds(stored) ? stored : { x: 0, y: 0, ...DEFAULT_SIZE });

  const window = new BrowserWindow({
    ...bounds,
    title: "Kira Version",
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persistBounds = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void opts.storage.set("global", STORAGE_KEY, window.getBounds());
    }, BOUNDS_SAVE_DEBOUNCE_MS);
  };
  window.on("resize", persistBounds);
  window.on("move", persistBounds);

  return window;
}
