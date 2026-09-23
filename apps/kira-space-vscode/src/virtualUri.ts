/**
 * The virtual-document URI shape `ports/editorIntegration.ts`'s own `toUri` mints:
 * `kira-space:/<encoded-key>/<label>` (G12 D11's base64url encoding, `virtualKey.ts`'s key
 * format). `diffToolbar.ts`, `reviewComments.ts` and `reviewMarking.ts` each carried their own
 * copy of this resolution — `reviewMarking.ts`'s own comment even named the other two by name as
 * the reason it kept its own ("this file, like those, stays a single self-contained
 * `vscode`-facing unit") — shared here instead (T1-26/T2-24).
 */
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { SCHEME } from './ports/editorIntegration.ts';
import { decodeKey, encodeKey, parseVirtualKey, virtualKey } from './virtualKey.ts';

/** Resolves either side of a diff to `{repoId, rev, path}` — `undefined` for the `.empty` side
 *  (an added/deleted file's other half) or any URI this scheme did not mint. */
export function resolveVirtualUri(
  uri: vscode.Uri,
): { repoId: string; rev: string; path: string } | undefined {
  if (uri.scheme !== SCHEME) return undefined;
  const [first] = uri.path.split('/').filter((segment) => segment.length > 0);
  if (first === undefined) return undefined;
  const parsed = parseVirtualKey(decodeKey(first));
  if (!parsed) return undefined;
  return { repoId: parsed.repoId, rev: parsed.rev, path: parsed.path };
}

/** Everything `review.comment.*` needs about one document, resolved statelessly from its own URI
 *  (D8a/D9/D20) — no registry, no `Map`, survives a window reload. */
export interface ReviewAnchor {
  readonly repoId: string;
  readonly branch: string;
  readonly path: string;
  readonly at: string;
}

/** Is `uri` the branch-tip side of a review diff, and of which `(repoId, branch, path)` at which
 *  revision? Pure and stateless (D9/D20) — the answer lives entirely in the URI's own fourth
 *  virtual-key field (D8a), which only the branch-tip side of `editor.openRangeDiff` ever sets. */
export function reviewAnchorFor(uri: vscode.Uri): ReviewAnchor | undefined {
  if (uri.scheme !== SCHEME) return undefined;
  const [first] = uri.path.split('/').filter((segment) => segment.length > 0);
  if (first === undefined) return undefined;
  const parsed = parseVirtualKey(decodeKey(first));
  if (!parsed || parsed.reviewBranch === undefined) return undefined;
  return { repoId: parsed.repoId, branch: parsed.reviewBranch, path: parsed.path, at: parsed.rev };
}

/** Reconstructed from plain data (not read off an already-open editor) so `proxyHandlers.ts`
 *  (which never imports `vscode`, by design) can ask for a re-render after opening a diff without
 *  holding a `vscode.Uri` itself. */
export function reviewDocumentUri(
  repoId: string,
  branchTip: string,
  path: string,
  branch: string,
): vscode.Uri {
  const key = virtualKey(repoId, branchTip, path, branch);
  return vscode.Uri.parse(`${SCHEME}:/${encodeKey(key)}/${encodeURIComponent(basename(path))}`);
}
