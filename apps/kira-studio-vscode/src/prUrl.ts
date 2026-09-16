/**
 * `isValidPrBrowserUrl` mirrors `bridge/github.go`'s `OpenPullRequestURL` validator (P74 §3.3,
 * P79 finding 3) — the desktop host re-validates `pr.browserUrl`'s Go-composed URL before ever
 * handing it to the OS browser; this extension host forwards the same request over the socket and
 * used to hand the answer straight to `vscode.Uri.parse`/`vscode.env.openExternal` with no
 * equivalent check. Not currently exploitable (the repo path segment is `url.PathEscape`d at the
 * source, Go-side), but the two hosts should agree — the process boundary is the thing being
 * defended, on both sides of it.
 *
 * Unlike the Go side, this extension has no live `gh`-authenticated-hosts list to check a GHES
 * hostname against (that Discovery cache lives only in the Go process, and `pr.browserUrl`'s wire
 * shape carries just the URL, no separate host). So this checks scheme + a plain hostname shape +
 * the `/owner/repo/pull/n` path shape — real guards against a URL that is not what this feature
 * ever composes, short of re-deriving the Go side's own host allowlist over the wire.
 */
const PULL_REQUEST_PATH = /^\/[\w.-]+\/[\w.-]+\/pull\/[0-9]+$/;
const HOSTNAME_SHAPE = /^[a-zA-Z0-9.-]+$/;

export function isValidPrBrowserUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    HOSTNAME_SHAPE.test(parsed.host) &&
    PULL_REQUEST_PATH.test(parsed.pathname)
  );
}
