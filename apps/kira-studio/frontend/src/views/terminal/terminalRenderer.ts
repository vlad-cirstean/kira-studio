// P83 §6.2: the sole contact point with `@xterm/xterm`, reached only through a dynamic `import()`
// (RepoTerminalView.vue's own mount) — never a static import at the top of a module Vite includes
// in the boot bundle. Static re-exports here would be pointless (nothing outside this module
// needs the xterm types), but the shape mirrors monacoEntry.ts's own recorded reasoning: everyone
// this codebase's Terminal instance actually touches lives in this one file.
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useSettingsStore } from '../../state/settings';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { useTerminalsStore } from '../../state/terminals';

interface Attached {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  off: () => void;
}

// Module-level, not held by the Vue component (§5.2/§6.2): a tab switch unmounts
// RepoTerminalView.vue (MainView.vue keeps only RepoGraphView alive), and the whole point of this
// map is that the live Terminal survives that — the sink stays attached, output keeps landing,
// and remounting re-inserts the same DOM node rather than recreating it.
const byTabId = new Map<string, Attached>();

// §4/§7.4's own close path never reaches this module (state/tabKinds.ts's dropResources only
// calls closeTerminalSession, which never imports this file — importing it there would pull
// @xterm/xterm into the boot bundle, the exact cost this file's own lazy boundary exists to
// avoid). registerTabRuntimeCleanup is the seam built for exactly this: registered once this
// module is actually loaded (i.e. once a terminal was actually opened), called for every tab that
// closes for real, a no-op for a tabId with no entry here — tabRuntime.ts's own documented shape
// ("a view kind whose module was never loaded has nothing registered here").
registerTabRuntimeCleanup((tabId) => {
  const attached = byTabId.get(tabId);
  if (!attached) return;
  byTabId.delete(tabId);
  attached.off();
  attached.term.dispose();
});

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// §6.4: the four colours that have a token get one; the sixteen ANSI colours keep xterm's own
// defaults (the VS Code Dark+ palette this app's own tokens are already derived from) —
// deliberate, not an oversight (§6.4's own stated reasoning).
function terminalTheme(): import('@xterm/xterm').ITheme {
  return {
    background: cssVar('--kira-bg'),
    foreground: cssVar('--kira-fg'),
    cursor: cssVar('--kira-fg'),
    selectionBackground: cssVar('--kira-select'),
  };
}

const encoder = new TextEncoder();

/** Returns tabId's own attached Terminal, creating and wiring it on first call. `host` is a
 *  detached `<div>` — RepoTerminalView.vue appends it to its container on mount and never calls
 *  `term.open()` a second time (§6.2: the one mechanically safe way to reattach an xterm across
 *  unmounts, since whether `open()` itself is re-entrant is never relied on). */
export function getOrCreateTerminal(tabId: string): Attached {
  const existing = byTabId.get(tabId);
  if (existing) return existing;

  const host = document.createElement('div');
  host.style.height = '100%';
  host.style.width = '100%';

  const settingsStore = useSettingsStore();
  const terminalsStore = useTerminalsStore();
  const term = new Terminal({
    scrollback: 5000,
    cursorBlink: true,
    allowProposedApi: false,
    fontFamily: settingsStore.appearance.fontFamily,
    fontSize: settingsStore.appearance.fontSize,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(host);

  const off = terminalsStore.onTerminalOutput(tabId, (bytes) => term.write(bytes));
  // onData is real text (typed characters, paste, escape sequences) — UTF-8 encoded before it
  // crosses the wire. onBinary is xterm's own byte-per-char convention (mouse reports, Alt-meta) —
  // each JS char code already IS the intended byte value, so it is never UTF-8 encoded, only
  // reinterpreted 1:1 into a Uint8Array. Getting these two swapped would corrupt typed non-ASCII
  // text (mis-encoding it) or corrupt binary escape sequences (double-UTF-8-encoding raw bytes).
  term.onData((d) => terminalsStore.writeTerminal(tabId, encoder.encode(d)));
  term.onBinary((d) => {
    const bytes = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i++) bytes[i] = d.charCodeAt(i) & 0xff;
    terminalsStore.writeTerminal(tabId, bytes);
  });

  const attached: Attached = { term, fit, host, off };
  byTabId.set(tabId, attached);
  return attached;
}

/** Re-measures tabId's own terminal against its current container size and applies it — the
 *  caller (RepoTerminalView.vue's ResizeObserver) turns the result into a resizeTerminal call. A
 *  no-op, not an error, for an id with no attached terminal (the container observed before
 *  getOrCreateTerminal ever ran, or after this tab's own close). */
export function fitTerminal(tabId: string): { cols: number; rows: number } | null {
  const attached = byTabId.get(tabId);
  if (!attached) return null;
  attached.fit.fit();
  return { cols: attached.term.cols, rows: attached.term.rows };
}

/** §6.3: re-applies the live "Data font" setting to an already-open terminal and re-fits it —
 *  the settings watch's own target (RepoTerminalView.vue). A no-op for an id with no attached
 *  terminal. */
export function applyTerminalAppearance(tabId: string): { cols: number; rows: number } | null {
  const attached = byTabId.get(tabId);
  if (!attached) return null;
  const settingsStore = useSettingsStore();
  attached.term.options.fontFamily = settingsStore.appearance.fontFamily;
  attached.term.options.fontSize = settingsStore.appearance.fontSize;
  return fitTerminal(tabId);
}
