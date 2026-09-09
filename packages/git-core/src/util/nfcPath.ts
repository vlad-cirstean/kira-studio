/**
 * G27 D7 — NFC-canonicalise an absolute path taken from the filesystem (a VS Code `Uri.fsPath`, a
 * folder picker's result) before it is compared with, or sent as, a path the Go server produced.
 *
 * Never applied to a repository-relative path: those go back to git as pathspecs, where the byte
 * form must be git's own (plan probe P7 — an NFC spelling of an NFD tree entry resolves to
 * `fatal: path ... does not exist`). Applied at exactly four sites, all filesystem boundaries:
 * `ports/workspaceRoots.ts`, `ports/dialogs.ts`'s folder picker, and three direct
 * `workspaceFolders?.[0]?.uri.fsPath` reads in `extension.ts` (D7). `packages/git-ui` never calls
 * this — every path it compares is already wire-sourced on both sides (F12/F13).
 *
 * Unguarded, matching internal/gitpath.NFC's own doc comment: `String.prototype.normalize('NFC')`
 * is idempotent and a no-op on an already-composed string, so a pre-check buys nothing.
 */
export const nfcPath = (p: string): string => p.normalize('NFC');
