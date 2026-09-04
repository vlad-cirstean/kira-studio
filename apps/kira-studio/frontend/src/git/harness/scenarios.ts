import type { GitStatus, RepoCandidate, RepoOpenResult, SettingsSnapshot } from '@kira/git-ipc';

/**
 * D5's harness: named, hand-written scenarios (never captured fixtures — there is no backend to
 * capture from) — each one is exactly the app.init/repo.open shape a real Go host could produce,
 * so tests/ui/git/harness.spec.ts proves git-ui renders D4's blocking states and the no-repository
 * state correctly with *no Wails present at all*, which is the whole point of the package split
 * (docs/v1.3/SPEC.md).
 */
export interface Scenario {
  readonly init: {
    readonly host: 'harness';
    readonly contractVersion: number;
    readonly settings: SettingsSnapshot;
    readonly git: GitStatus;
  };
  /** repo.open's answer once a candidate is opened — absent means "not a repository" for any path. */
  readonly repoOpen?: RepoOpenResult;
  /** repo.list's own candidates — empty unless a scenario needs NoRepositoryPanel's candidate
   *  list rendered (F14: clicking one is repo.open, exercised the same way "Open Folder…" is). */
  readonly candidates?: readonly RepoCandidate[];
}

const SETTINGS: SettingsSnapshot = {
  'git.path': '',
  'git.graph.pageSize': 5000,
  'git.graph.scope': 'all',
  'git.log.level': 'info',
};

const GIT_OK: GitStatus = { kind: 'ok', path: '/opt/homebrew/bin/git', version: '2.42.0' };

function initWith(git: GitStatus): Scenario['init'] {
  return { host: 'harness', contractVersion: 3, settings: SETTINGS, git };
}

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  'git-not-found': {
    init: initWith({
      kind: 'notFound',
      probed: ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'],
    }),
  },
  'git-too-old': {
    init: initWith({
      kind: 'tooOld',
      path: '/usr/bin/git',
      detected: '2.10.1',
      required: '2.38.0',
      settingId: 'git.path',
    }),
  },
  'git-unusable': {
    init: initWith({ kind: 'unusable', path: '/usr/bin/git', reason: 'permission denied' }),
  },
  'no-repository': {
    init: initWith(GIT_OK),
  },
  'repo-open-unborn': {
    init: initWith(GIT_OK),
    candidates: [{ path: '/tmp/harness-repo', label: 'harness-repo' }],
    repoOpen: {
      kind: 'ok',
      repo: {
        repoId: 'harness-repo-1',
        root: '/tmp/harness-repo',
        gitDir: '/tmp/harness-repo/.git',
        commonDir: '/tmp/harness-repo/.git',
        isBare: false,
        isLinkedWorktree: false,
        head: { kind: 'unborn', name: 'main' },
      },
    },
  },
  'repo-open-branch': {
    init: initWith(GIT_OK),
    candidates: [{ path: '/tmp/harness-repo-2', label: 'harness-repo-2' }],
    repoOpen: {
      kind: 'ok',
      repo: {
        repoId: 'harness-repo-2',
        root: '/tmp/harness-repo-2',
        gitDir: '/tmp/harness-repo-2/.git',
        commonDir: '/tmp/harness-repo-2/.git',
        isBare: false,
        isLinkedWorktree: false,
        head: { kind: 'branch', name: 'main' },
      },
    },
  },
};

export const DEFAULT_SCENARIO = 'no-repository';
