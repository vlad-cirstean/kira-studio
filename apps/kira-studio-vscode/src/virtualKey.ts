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
