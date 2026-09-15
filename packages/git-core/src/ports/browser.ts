/**
 * P74 §3.3: the one browser-open action any host needs — `pr.openExternal`'s handler requests
 * `pr.browserUrl` for the URL, then hands it here. A dedicated, single-method port (matching
 * `Windows`' own "narrow, single-purpose port" shape) rather than folded into `EditorIntegration`
 * — opening a URL in the OS browser is not an editor action.
 */
export interface Browser {
  openExternal(url: string): Promise<void>;
}
