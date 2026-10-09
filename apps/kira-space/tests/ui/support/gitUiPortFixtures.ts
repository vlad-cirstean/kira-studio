import { buildPackedChunk, type PackedChunkRow } from '@kira/git-core/testing/packedChunk';
import { expect, type Page } from '@playwright/test';
import type { KiraApp, RelaunchOptions } from '../fixtures';
import { installGitStreamMock } from './gitStreamMock';
import { buildGraphStreamChunk, type GraphStreamChunkFixture } from './graphStreamFixture';
import { IPC } from './ipcChannels';
import type { ControlSnapshot } from './types';

// Fixtures for the git-ui behaviours ported off the VS Code webview specs. The mock streams the
// same packed chunks the real daemon sends, so the grid under test is the shipped one.

export const PORT_REPO = {
  id: 'repo-port-1',
  name: 'port-repo',
  root: '/tmp/port-repo',
  repoId: '/tmp/port-repo',
  sortOrder: 1,
  color: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const PORT_CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [PORT_REPO] },
  {
    channel: IPC.codeWorkspaceListFiles,
    args: { id: PORT_REPO.id },
    response: { paths: ['a.ts'], status: {}, truncated: false },
  },
];

export const PORT_REPO_OPEN = {
  kind: 'ok',
  repo: {
    repoId: PORT_REPO.repoId,
    root: PORT_REPO.root,
    gitDir: `${PORT_REPO.root}/.git`,
    commonDir: `${PORT_REPO.root}/.git`,
    isBare: false,
    isLinkedWorktree: false,
    head: { kind: 'branch', name: 'main' },
  },
};

export const SHA_A = '22'.repeat(20);
export const SHA_B = '33'.repeat(20);

export function refRow(shortName: string, extra: Record<string, unknown> = {}) {
  return {
    refname: `refs/heads/${shortName}`,
    kind: 'branch',
    shortName,
    objectId: SHA_A,
    peeledObjectId: undefined,
    upstream: undefined,
    track: undefined,
    committerDate: 0,
    isHead: shortName === 'main',
    checkedOutIn: undefined,
    annotation: undefined,
    ...extra,
  };
}

export const MAIN_REFS = {
  branches: [refRow('main')],
  remoteBranches: [],
  tags: [],
  head: { kind: 'branch', name: 'main' },
};

export const BASE_RESULTS = {
  'repo.open': PORT_REPO_OPEN,
  'refs.list': MAIN_REFS,
  'graph.refresh': {},
  'graph.status': { loaded: 0, remaining: 0, exhausted: true },
};

const IDENTITIES = ['Fake Author', 'fake@example.com'];

/** One commit per chunk: the first declares the identities, the rest reuse them. */
export function singleRowChunks(rows: readonly PackedChunkRow[]): GraphStreamChunkFixture[] {
  return rows.map((row, i) =>
    buildGraphStreamChunk(
      PORT_REPO.repoId,
      i,
      buildPackedChunk(
        [row],
        i === 0
          ? { from: 0, dictionary: IDENTITIES }
          : { from: i, dictionary: [], dictionaryBase: IDENTITIES.length },
      ),
      { exhausted: i === rows.length - 1, remaining: rows.length - 1 - i },
    ),
  );
}

export const rootRow = (sha: string, subject: string, extra: Partial<PackedChunkRow> = {}) => ({
  sha,
  subject,
  ...extra,
});

export const manyRowShas = (n: number): string =>
  `aa${n.toString(16).padStart(8, '0')}`.padEnd(40, '0');

/** A linear history, newest first; pair with `refsAtTip(manyRowShas(0))` so it is all `main`. */
export const manyRows = (count: number): PackedChunkRow[] =>
  Array.from({ length: count }, (_, n) => ({
    sha: manyRowShas(n),
    subject: `Row ${n}`,
    parents: n < count - 1 ? [manyRowShas(n + 1)] : [],
  }));

export const refsAtTip = (sha: string) => ({
  ...MAIN_REFS,
  branches: [refRow('main', { objectId: sha })],
});

export type Relaunch = (options?: RelaunchOptions) => Promise<KiraApp>;

export interface OpenGraphOptions {
  readonly results?: Record<string, unknown>;
  readonly chunks: readonly GraphStreamChunkFixture[];
  readonly holdAfter?: number;
  readonly control?: ControlSnapshot[];
}

/** Boots Space with one repo, installs the git mock and opens the graph tab. */
export async function openPortGraph(relaunch: Relaunch, options: OpenGraphOptions): Promise<Page> {
  const { window: page } = await relaunch({ control: options.control ?? PORT_CONTROL });
  await installGitStreamMock(
    page,
    PORT_REPO.repoId,
    { ...BASE_RESULTS, ...options.results },
    options.chunks,
    undefined,
    options.holdAfter,
  );
  await page.locator(`[data-testid="repo-row"][data-repo-id="${PORT_REPO.id}"]`).click();
  return page;
}

/** A current-shape persisted graph view state; a version or field mismatch discards it whole. */
export function persistedViewState(scrollRow: number): Record<string, unknown> {
  return {
    version: 8,
    repoId: PORT_REPO.repoId,
    loadedRows: 0,
    detailOpen: false,
    scrollRow,
    selectedSha: null,
    columnWidths: { author: 140, date: 152, graph: 95 },
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
    searchOpen: false,
    collapseBranches: false,
  };
}

/** Restores an active graph tab carrying `viewState`, with the git mock installed at boot. */
export async function restorePortGraph(
  relaunch: Relaunch,
  viewState: Record<string, unknown>,
  chunks: readonly GraphStreamChunkFixture[],
  results: Record<string, unknown> = {},
): Promise<Page> {
  const { window: page } = await relaunch({
    control: [
      ...PORT_CONTROL,
      {
        channel: IPC.tabsList,
        response: [
          {
            id: 'restored-repo-graph',
            kind: 'repo-graph',
            connectionId: null,
            path: '',
            order: 0,
            active: true,
            workspaceId: PORT_REPO.id,
            state: { viewState, reviewSession: null },
          },
        ],
      },
    ],
    gitStream: {
      repoId: PORT_REPO.repoId,
      extraResults: { ...BASE_RESULTS, ...results },
      graphStreamChunks: chunks,
    },
  });
  return page;
}

const PARAGRAPH =
  'This paragraph exists only to overflow a two-line clamp reliably regardless of viewport ' +
  'width or font metrics, so no test has to guess how many words make two lines.';

const file = (kind: string, path: string, additions: number, deletions: number) => ({
  kind,
  path,
  originalPath: undefined,
  similarity: undefined,
  additions,
  deletions,
  isBinary: false,
});

/** `commit.detail` for SHA_A: a ten-paragraph body, trailers, distinct author and committer, a
 *  branch decoration and two files with different extensions. */
export const COMMIT_DETAIL = {
  sha: SHA_A,
  parents: [SHA_B],
  author: { name: 'Fake Author', email: 'fake@example.com', timestamp: 1_700_000_000 },
  committer: { name: 'Fake Committer', email: 'committer@example.com', timestamp: 1_700_000_500 },
  subject: 'A commit with a long message body',
  body: Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}. ${PARAGRAPH}`).join('\n\n'),
  trailers: [
    { token: 'Co-authored-by', value: 'Jane Coauthor <jane@example.com>' },
    { token: 'Signed-off-by', value: 'Fake Author <fake@example.com>' },
  ],
  signature: { status: 'N', signer: '' },
  decoration: [{ kind: 'branch', name: 'main', isHead: true }],
  parentIndex: 0,
  files: [file('modified', 'src/example.ts', 3, 1), file('added', 'README.md', 5, 0)],
};

/** Opens the graph with one commit and selects it, so the detail pane shows `COMMIT_DETAIL`. */
export async function openCommitDetail(relaunch: Relaunch): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, COMMIT_DETAIL.subject)]),
    results: { 'commit.detail': COMMIT_DETAIL },
  });
  const row = page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('.kv-meta-subject')).toBeVisible();
  return page;
}
