/**
 * The virtual-document key format shared between proxyHandlers.ts (which mints one per
 * editor.openDiff/editor.goToFile call, G4 D11/D12) and extension.ts's own VirtualDocumentSource
 * (which resolves one back into a file.read request, D14). Opaque to VS Code — `\0` is a safe
 * separator because none of repoId/rev/path can ever contain it (repoId is a filesystem path, rev
 * is a sha or ref name, path is a repository-relative path).
 */

export function virtualKey(repoId: string, rev: string, path: string): string {
  return `${repoId}\0${rev}\0${path}`;
}

export interface ParsedVirtualKey {
  readonly repoId: string;
  readonly rev: string;
  readonly path: string;
}

export function parseVirtualKey(key: string): ParsedVirtualKey | undefined {
  const parts = key.split('\0');
  if (parts.length !== 3) return undefined;
  const [repoId, rev, path] = parts;
  if (!repoId || !rev || !path) return undefined;
  return { repoId, rev, path };
}

/**
 * G12 D11: `ports/editorIntegration.ts`'s `toUri` used to percent-encode `virtualKey()`'s own
 * string into the URI's first path segment. `RepoID` is an absolute worktree root (G3 D7), so the
 * key always starts with `/`, and `vscode-uri`'s `Uri.parse` percent-*decodes* the path before
 * validating it — `%2F` becomes `//`, which it rejects outright ("path cannot begin with two
 * slash characters"), throwing on every real repository. base64url's alphabet (`A-Za-z0-9_-`)
 * survives that decode untouched and can never itself contain a `/`, so the encoded segment can
 * never collide with the URI's own path separators.
 *
 * Defined here rather than in the port so `virtualKey.test.ts` needs no `vscode` import — the
 * same reason `commands.ts` holds the palette table (its own doc comment).
 */
export function encodeKey(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

export function decodeKey(segment: string): string {
  return Buffer.from(segment, 'base64url').toString('utf8');
}
