import { buildPackedChunk, type PackedChunkRow } from '@kira/git-core/testing/packedChunk';
import type { Page } from '@playwright/test';
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
