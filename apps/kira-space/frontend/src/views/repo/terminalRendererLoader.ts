// P99 §9.3: split out of RepoTerminalView.vue's own module-scope <script> block — mirrors
// repo/git/gitUiModule.ts's own loadGitUi (and views/repo/monaco.ts's loadMonaco) memoized-import
// shape exactly, so terminalRenderer.ts's chunk is paid for once per session, not once per mount,
// and one transient import failure doesn't permanently break every terminal opened afterward.
let terminalRendererPromise: Promise<typeof import('./terminalRenderer')> | null = null;

export function loadTerminalRenderer(): Promise<typeof import('./terminalRenderer')> {
  if (!terminalRendererPromise) {
    terminalRendererPromise = import('./terminalRenderer').catch((err) => {
      terminalRendererPromise = null;
      throw err;
    });
  }
  return terminalRendererPromise;
}
