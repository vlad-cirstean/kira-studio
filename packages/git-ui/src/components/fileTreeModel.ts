/**
 * `docs/plans/P5.md` W8: the pure half of `FileTree.vue` — folding a flat `readonly FileChange[]`
 * into a directory tree, aggregating counts, collapsing single-child directory chains, producing
 * the flat list, and applying the filter. No DOM, no Vue — everything here is exercised directly
 * by `tests/unit/ui/fileTreeModel.test.ts`, matching this repo's own precedent for splitting a
 * pure model from its DOM-touching renderer (`refBadges.ts`).
 */
import type { FileChange, FileChangeKind } from '@kira/git-ipc';

/** §6.4's per-file status letter — the letter is always shown (§6.1: no colour-only meaning). */
export const STATUS_LETTERS: Readonly<Record<FileChangeKind, string>> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T',
  unmerged: 'U',
};

/** The `--kv-diff-*-fg` colour class per kind (§6.1: "the same colour as in the Explorer"),
 *  applied by `FileTree.vue`'s CSS — never a colour value computed or read here. */
export const STATUS_COLOR_CLASS: Readonly<Record<FileChangeKind, string>> = {
  added: 'kv-status-added',
  modified: 'kv-status-modified',
  deleted: 'kv-status-deleted',
  renamed: 'kv-status-renamed',
  copied: 'kv-status-copied',
  typeChanged: 'kv-status-typechanged',
  unmerged: 'kv-status-unmerged',
};

export interface FileTreeFileNode {
  readonly kind: 'file';
  readonly name: string;
  readonly path: string;
  readonly change: FileChange;
  /** Index into the *original*, unfiltered `files` array `commit.detail` returned — what
   *  `DetailState.selectFile` takes, so a node found after filtering still opens the right diff. */
  readonly fileIndex: number;
}

export interface FileTreeDirNode {
  readonly kind: 'directory';
  /** The directory's own display name — a collapsed chain reads `src/main/java`, not `src`. */
  readonly name: string;
  /** The full path from the tree's root, `/`-joined — collapsed chains included. Used as the
   *  identity key for expand/collapse state (`isExpanded(path)`) since two directories can never
   *  share one. */
  readonly path: string;
  readonly children: readonly FileTreeNode[];
  readonly additions: number;
  readonly deletions: number;
  readonly fileCount: number;
}

export type FileTreeNode = FileTreeFileNode | FileTreeDirNode;

interface IndexedFileChange {
  readonly change: FileChange;
  readonly fileIndex: number;
}

/** §7.8: "case-insensitive substring, not fuzzy, not regex" over the *full path*. An empty
 *  (or all-whitespace) filter matches everything, preserving each change's original index. */
export function filterFiles(files: readonly FileChange[], filter: string): IndexedFileChange[] {
  const needle = filter.trim().toLowerCase();
  const indexed = files.map((change, fileIndex) => ({ change, fileIndex }));
  if (needle === '') return indexed;
  return indexed.filter(({ change }) => change.path.toLowerCase().includes(needle));
}

/** Flat-mode's own ordering: alphabetical by full path — the same order a fully-expanded,
 *  uncollapsed tree would visit its leaves in, so toggling tree/flat never surprises with a
 *  reshuffle. */
export function buildFlatList(files: readonly IndexedFileChange[]): FileTreeFileNode[] {
  return [...files]
    .sort((a, b) => a.change.path.localeCompare(b.change.path))
    .map(({ change, fileIndex }) => ({
      kind: 'file',
      name: baseName(change.path),
      path: change.path,
      change,
      fileIndex,
    }));
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** A directory node under construction — mutable only while folding, never exposed. */
interface DirBuilder {
  name: string;
  children: Map<string, DirBuilder>;
  files: FileTreeFileNode[];
}

function newDir(name: string): DirBuilder {
  return { name, children: new Map(), files: [] };
}

function insertFile(root: DirBuilder, file: FileTreeFileNode): void {
  const segments = file.path.split('/');
  const dirSegments = segments.slice(0, -1);
  let cursor = root;
  for (const segment of dirSegments) {
    let next = cursor.children.get(segment);
    if (!next) {
      next = newDir(segment);
      cursor.children.set(segment, next);
    }
    cursor = next;
  }
  cursor.files.push(file);
}

/** Folds one `DirBuilder` into its final, immutable form: children first (so a chain collapses
 *  bottom-up), then this directory itself collapses into its one child *iff* it has exactly one
 *  child overall (no files of its own) and that child is a directory — `src/main/java/` renders
 *  as one row, matching VS Code's own Explorer. `pathPrefix` is this directory's own full path,
 *  passed down so a collapsed name still gets the right full `path` identity. */
function finalize(builder: DirBuilder, pathPrefix: string): FileTreeNode[] {
  const childDirs = [...builder.children.values()]
    .map((child) => finalizeOne(child, joinPath(pathPrefix, child.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [...builder.files].sort((a, b) => a.name.localeCompare(b.name));
  return [...childDirs, ...files];
}

function joinPath(prefix: string, name: string): string {
  return prefix === '' ? name : `${prefix}/${name}`;
}

function finalizeOne(builder: DirBuilder, path: string): FileTreeDirNode {
  const children = finalize(builder, path);
  // Collapse: this directory has no files of its own and exactly one child, which is itself a
  // directory — fold that child's name/path/children straight into this row instead of nesting.
  if (builder.files.length === 0 && children.length === 1) {
    const only = children[0];
    if (only && only.kind === 'directory') {
      return {
        kind: 'directory',
        name: `${builder.name}/${only.name}`,
        path: only.path,
        children: only.children,
        additions: only.additions,
        deletions: only.deletions,
        fileCount: only.fileCount,
      };
    }
  }
  let additions = 0;
  let deletions = 0;
  let fileCount = 0;
  for (const child of children) {
    if (child.kind === 'file') {
      additions += child.change.additions ?? 0;
      deletions += child.change.deletions ?? 0;
      fileCount += 1;
    } else {
      additions += child.additions;
      deletions += child.deletions;
      fileCount += child.fileCount;
    }
  }
  return { kind: 'directory', name: builder.name, path, children, additions, deletions, fileCount };
}

/** Folds a flat, already-filtered file list into the hierarchical tree §6.4 describes:
 *  directories aggregate their descendants' `+adds/−dels` and file counts, and a chain of
 *  directories with nothing but one child directory at each level collapses into a single row. */
export function buildFileTree(files: readonly IndexedFileChange[]): FileTreeNode[] {
  const root = newDir('');
  for (const { change, fileIndex } of files) {
    insertFile(root, {
      kind: 'file',
      name: baseName(change.path),
      path: change.path,
      change,
      fileIndex,
    });
  }
  return finalize(root, '');
}

export type FileTreeRow =
  | {
      readonly kind: 'directory';
      readonly node: FileTreeDirNode;
      readonly depth: number;
      readonly expanded: boolean;
    }
  | { readonly kind: 'file'; readonly node: FileTreeFileNode; readonly depth: number };

/** Walks the tree respecting `isExpanded`, producing the flat row list both the renderer paints
 *  top-to-bottom and `↑`/`↓` file-cursor navigation moves through — a collapsed directory's
 *  descendants are simply absent from this list, which is what makes "directory rows are skipped
 *  by arrow nav" true for free in flat mode (no directory rows exist there at all) and correct in
 *  tree mode (collapsing one hides its whole subtree from navigation, not just from view). */
export function flattenTreeRows(
  nodes: readonly FileTreeNode[],
  isExpanded: (path: string) => boolean,
  depth = 0,
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      rows.push({ kind: 'file', node, depth });
    } else {
      const expanded = isExpanded(node.path);
      rows.push({ kind: 'directory', node, depth, expanded });
      if (expanded) rows.push(...flattenTreeRows(node.children, isExpanded, depth + 1));
    }
  }
  return rows;
}

/** §8's explicit render cap — 500 rows, then a "Show all N files" row, never a second
 *  virtualizer (`AGENTS.md`'s prefer-a-library rule; see the plan's own escalation ladder). */
export const FILE_TREE_ROW_CAP = 500;

export interface CappedRows {
  readonly visible: readonly FileTreeRow[];
  readonly hiddenCount: number;
}

export function capRows(rows: readonly FileTreeRow[], cap: number = FILE_TREE_ROW_CAP): CappedRows {
  if (rows.length <= cap) return { visible: rows, hiddenCount: 0 };
  return { visible: rows.slice(0, cap), hiddenCount: rows.length - cap };
}

/**
 * G21 D9: a real per-extension/per-filename table, mapped to the most specific codicon that
 * genuinely exists — replacing G19 D14's own six-category map, which collapsed every `.ts`/
 * `.go`/`.py`/`.rs`/`.java`/`.c`/`.vue` file onto the identical `codicon-file-code` glyph (F9's
 * own objection, taken literally). **The ceiling is real, not an oversight**: F9's own measured
 * survey of `@vscode/codicons/dist/codicon.css` found no per-language file-icon vocabulary in it
 * at all — that is what a Seti/Material file-icon *theme* is for, and this webview has no API to
 * read the host's active one. This table goes exactly as far as the named icon set (codicons)
 * actually goes and says so here rather than leaving it implicit (D9's own non-goal).
 *
 * Checked in order: an exact filename match (`package.json` → `codicon-package`, not the `json`
 * extension's own `codicon-json` — precedence, not a coincidence), a path-shape rule (a
 * `.github/workflows/` file, a `*.test.*`/`*.spec.*` file), then the extension table; a path
 * matching none of those falls back to the fully-generic `codicon-file` glyph, same as before.
 */
const EXACT_FILENAME_ICONS: Readonly<Record<string, string>> = {
  'package.json': 'codicon-package',
  'bun.lock': 'codicon-package',
  'bun.lockb': 'codicon-package',
  'package-lock.json': 'codicon-package',
  'yarn.lock': 'codicon-package',
  'pnpm-lock.yaml': 'codicon-package',
  'go.sum': 'codicon-package',
  'Cargo.lock': 'codicon-package',
  LICENSE: 'codicon-law',
  LICENCE: 'codicon-law',
  COPYING: 'codicon-law',
  Dockerfile: 'codicon-vm',
  'docker-compose.yml': 'codicon-vm',
  'docker-compose.yaml': 'codicon-vm',
  Makefile: 'codicon-tools',
  'CMakeLists.txt': 'codicon-tools',
  '.gitignore': 'codicon-source-control',
  '.gitattributes': 'codicon-source-control',
  '.gitmodules': 'codicon-source-control',
  '.editorconfig': 'codicon-gear',
  '.npmrc': 'codicon-gear',
  // A bare `.env` has no extension by `extensionOf`'s own leading-dot rule (the same reason
  // `.gitignore` needs its own entry above) — the `env` bucket in the extension table below
  // only ever catches a *named* file ending `.env` (e.g. `settings.env`).
  '.env': 'codicon-gear',
  'tsconfig.json': 'codicon-gear',
  'biome.json': 'codicon-gear',
};

const JSON_EXTENSIONS = new Set(['json', 'jsonc']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);
const RUBY_EXTENSIONS = new Set(['rb', 'erb', 'gemspec']);
const DATABASE_EXTENSIONS = new Set(['sql', 'db', 'sqlite']);
/** VS Code's own Explorer groups every one of these under a settings/config-shaped glyph — this
 *  table reuses `codicon-gear`, the same one `EXACT_FILENAME_ICONS` above already gives
 *  `.editorconfig`/`.npmrc`/`tsconfig.json`/`biome.json`, rather than inventing a second config
 *  glyph the icon set has no equally-apt candidate for. */
const CONFIG_EXTENSIONS = new Set(['yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env']);
const BASH_EXTENSIONS = new Set(['sh', 'bash', 'zsh']);
const CMD_EXTENSIONS = new Set(['bat', 'cmd']);
const KEY_EXTENSIONS = new Set(['pem', 'key', 'crt']);
const TEXT_EXTENSIONS = new Set(['txt', 'rst', 'adoc']);
const MEDIA_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'ico',
  'avif',
  'mp4',
  'mov',
  'avi',
  'webm',
  'mp3',
  'wav',
  'ogg',
  'flac',
]);
const ZIP_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz']);
const BINARY_EXTENSIONS = new Set([
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'class',
  'o',
  'a',
  'wasm',
  'jar',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
]);
/** Every genuine source extension this table knows about — none of these has a more specific
 *  codicon glyph than "this is code" (F9's own ceiling), so they all land on the one shared
 *  `codicon-file-code` icon; the table above them is what actually gives the *common* file types
 *  a distinct glyph. */
const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'vue',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'cs',
  'php',
  'scala',
  'hs',
  'ex',
  'exs',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'xml',
  'graphql',
  'gql',
  'proto',
  'swift',
  'm',
  'mm',
  'lua',
  'r',
  'pl',
  'dart',
  'clj',
  'cljs',
  'elm',
  'erl',
  'fs',
  'fsx',
  'nim',
  'zig',
  'jl',
]);

function extensionOf(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** A workflow file lives under a `.github/workflows/` directory at the repo root — a commit's own
 *  `path` is already repo-root-relative, so this anchors at the start of the string rather than
 *  searching for the segment anywhere in it. */
const GITHUB_WORKFLOW_PATH = /^\.github\/workflows\//;
const TEST_FILE_PATTERN = /\.(test|spec)\.[a-z0-9]+$/i;

export function fileIconFor(path: string): string {
  const base = baseName(path);
  const exact = EXACT_FILENAME_ICONS[base];
  if (exact !== undefined) return exact;

  if (GITHUB_WORKFLOW_PATH.test(path)) return 'codicon-github-action';
  if (TEST_FILE_PATTERN.test(base)) return 'codicon-beaker';

  const ext = extensionOf(path);
  if (JSON_EXTENSIONS.has(ext)) return 'codicon-json';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'codicon-markdown';
  if (RUBY_EXTENSIONS.has(ext)) return 'codicon-ruby';
  if (DATABASE_EXTENSIONS.has(ext)) return 'codicon-database';
  if (CONFIG_EXTENSIONS.has(ext)) return 'codicon-gear';
  if (BASH_EXTENSIONS.has(ext)) return 'codicon-terminal-bash';
  if (ext === 'ps1') return 'codicon-terminal-powershell';
  if (CMD_EXTENSIONS.has(ext)) return 'codicon-terminal-cmd';
  if (ext === 'ipynb') return 'codicon-notebook';
  if (KEY_EXTENSIONS.has(ext)) return 'codicon-key';
  if (TEXT_EXTENSIONS.has(ext)) return 'codicon-file-text';
  if (ext === 'pdf') return 'codicon-file-pdf';
  if (MEDIA_EXTENSIONS.has(ext)) return 'codicon-file-media';
  if (ZIP_EXTENSIONS.has(ext)) return 'codicon-file-zip';
  if (BINARY_EXTENSIONS.has(ext)) return 'codicon-file-binary';
  if (CODE_EXTENSIONS.has(ext)) return 'codicon-file-code';
  return 'codicon-file';
}

/** `originalPath → path` with the common leading *directory* path truncated (§6.4: "a file
 *  moved within a directory shows `old.ts → new.ts`, not two full paths") — compares directory
 *  segments only, so the filenames themselves are never folded away even when they happen to
 *  match. `undefined` for anything that is not a rename/copy. */
export function renameDisplay(change: FileChange): { from: string; to: string } | undefined {
  if (change.originalPath === undefined) return undefined;
  const fromSegments = change.originalPath.split('/');
  const toSegments = change.path.split('/');
  let shared = 0;
  while (
    shared < fromSegments.length - 1 &&
    shared < toSegments.length - 1 &&
    fromSegments[shared] === toSegments[shared]
  ) {
    shared++;
  }
  return {
    from: fromSegments.slice(shared).join('/'),
    to: toSegments.slice(shared).join('/'),
  };
}
