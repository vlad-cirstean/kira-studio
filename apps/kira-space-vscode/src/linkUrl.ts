/**
 * `isValidExternalLinkUrl` mirrors `bridge/link.go`'s `LinkService.OpenExternal` validator (P79
 * finding 4) — a commit message body's own URL (`linkify.ts`, `git-ui`) is untrusted
 * renderer-visible content already, unlike `pr.openExternal`'s server-composed URL (`prUrl.ts`),
 * so the only check either side can make is the URL's own shape: a well-formed http(s) URL with a
 * non-empty host, never a `javascript:`/`file:`/other locally-dangerous scheme.
 */
export function isValidExternalLinkUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host !== '';
}
