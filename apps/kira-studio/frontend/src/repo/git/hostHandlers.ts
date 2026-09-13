/**
 * C10 §5 (S11) — the native counterpart to `apps/kira-studio-vscode/src/proxyHandlers.ts`'s local
 * arm: the handful of methods this host answers itself rather than forwarding over the git
 * stream. `transport.ts` (S12) is the thing that actually decides "local or forward" per request;
 * this file only supplies the local side, keyed by method name and total over nothing — an absent
 * key here means "forward", which is `transport.ts`'s own correct default (a method a later
 * contract version adds is forwarded, never silently dropped).
 *
 * §5.1's identity trap, read literally: `CodeRepo.ID` (`code_repos.id`, what every native tab/
 * workspace call speaks) and `gitclient.RepoSummary.RepoID` (what `git-ui`/every `gitrpc` method
 * speaks) are never equal and never interchangeable. `gitRepoIdFor`/`codeRepoIdFor` are the only
 * mapping this app has — both over `codeReposState.records`, both returning `undefined` on a
 * miss rather than guessing, exact rather than heuristic because `RepoSummary.repoId` is already
 * stored from the same `gitclient.Identify` call `repo.open` itself runs (C5's import).
 */
import type {
  FileChange,
  GitStatus,
  ParamsOf,
  RequestKey,
  ResultOf,
  Transport,
} from '@kira/git-ipc';
import { codeRepoRecord, codeReposState } from '../../state/coderepos';
import { openRepoCommitDiffTab, openRepoDiffTab } from '../../state/repoTabs';

/** git's own well-known empty-tree object id — `<sha>:<path>` against it always resolves to
 *  `file.read`'s existing `{kind: 'missing'}` classification (the path never existed in an empty
 *  tree), which is exactly the rendering a root commit's added file needs on its left side. Used
 *  instead of a `null` "left" revision so `repoDiffTabStateSchema`'s own `left === null` sentinel
 *  stays reserved for C6's HEAD-vs-worktree comparison alone — a commit diff, root commit
 *  included, always supplies a real (if synthetic) left revision. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** `code_repos.id` -> the git `repoId` git-ui and every `gitrpc` method actually speak, or
 *  `undefined` if this app has no record of that repository (never guessed). */
export function gitRepoIdFor(codeRepoId: string): string | undefined {
  return codeRepoRecord(codeRepoId)?.repoId;
}

/** The reverse of `gitRepoIdFor` — a git `repoId` (from an inbound `editor.*` request's own
 *  params) back to the `code_repos.id` every native tab/workspace call needs, or `undefined`. */
export function codeRepoIdFor(gitRepoId: string): string | undefined {
  return codeReposState.records.find((r) => r.repoId === gitRepoId)?.id;
}

// D11's own shape, ported: the Go server's real app.init result is only these three fields
// (handlers.go's handleAppInit) — host/settings/capabilities are composed entirely host-side
// (S3's own doc comment: neither crosses the Go wire). Contract['app.init']['result'] describes
// the *client-visible* shape after that composition, which is why this is its own narrower local
// type rather than trusting ResultOf<'app.init'> for what the raw stream actually returns — the
// exact same move proxyHandlers.ts's own ServerAppInitResult makes for the identical reason.
interface ServerAppInitResult {
  readonly contractVersion: number;
  readonly serverVersion: string;
  readonly git: GitStatus;
}

async function findChangeInDetail(
  remoteRequest: Transport['request'],
  gitRepoId: string,
  sha: string,
  path: string,
  parentIndex: number | undefined,
  signal: AbortSignal | undefined,
): Promise<{ readonly change: FileChange; readonly baseSha: string | null } | undefined> {
  const detail = await remoteRequest(
    'commit.detail',
    { repoId: gitRepoId, sha, parentIndex },
    signal,
  );
  const change = detail.files.find((f) => f.path === path);
  if (!change) return undefined;
  return { change, baseSha: detail.parents[detail.parentIndex] ?? null };
}

export interface HostHandlersDeps {
  /** The underlying git-stream transport's own `request` — the one seam this file needs to reach
   *  the Go server for `app.init`'s base fields and `editor.openDiff`'s `commit.detail` lookup.
   *  Never the split `Transport` `transport.ts` builds around this file (that would be circular);
   *  `transport.ts` constructs the remote client first and passes its `request` in here. */
  readonly remoteRequest: Transport['request'];
  /** This transport's own repo workspace — `code_repos.id`, never the git repoId — so
   *  `repo.list`'s `activeRepoId` can report which repository this particular mounted graph is
   *  for (one transport per repo workspace, §8). */
  readonly codeRepoId: string;
}

type HostHandler<K extends RequestKey> = (
  params: ParamsOf<K>,
  signal?: AbortSignal,
) => Promise<ResultOf<K>>;

/** Partial, not total (unlike `ServerHandlers`) — an absent key here means "forward", the correct
 *  default for a method this file has simply never heard of, never a silently dropped one. */
export type HostHandlers = Partial<{ [K in RequestKey]: HostHandler<K> }>;

function readOnlyRefusal<K extends RequestKey>(method: K, reason: string): HostHandler<K> {
  return async () => {
    throw new Error(`hostHandlers: ${method} ${reason}`);
  };
}

export function createHostHandlers(deps: HostHandlersDeps): HostHandlers {
  return {
    'app.init': async (_params, signal) => {
      const server = (await deps.remoteRequest(
        'app.init',
        {},
        signal,
      )) as unknown as ServerAppInitResult;
      return {
        host: 'kira',
        contractVersion: server.contractVersion,
        // G14 D6's own VS Code "workbench.tree.indent" mirror has no native equivalent — 8 is
        // VS Code's own default (the same literal codec.test.ts's own fixture uses), which is all
        // git-ui's file tree actually needs: a plausible indent, not a live-synced setting.
        settings: { 'workbench.tree.indent': 8 },
        git: server.git,
        capabilities: {
          openInEditor: true,
          // detailActions.ts D12/G21 D12: goToFile has no native caller left; a throwing entry
          // below is honest about that, so this stays false rather than advertising a capability
          // this host cannot actually serve.
          goToFile: false,
          clipboard: true,
          // Native reports its own conflicts through its own Source Control surface, not git-ui's
          // "Resolve in VS Code" banner action — the existing capabilities.resolveConflict gate
          // (App.vue) already covers this; layer 2 (editor.resolveConflict throwing, below) covers
          // it regardless.
          resolveConflict: false,
          // "Open in New Window" (vscode.openFolder) has no native meaning — worktree.openWindow
          // throws below regardless (§4.2 layer 2).
          openWorktreeWindow: false,
          // No workspace-trust concept here, and the affordance this gates is hidden anyway
          // (write: false) — a real value would be advertising a capability layer 1 always refuses.
          runPrepareScript: false,
          // C10's whole reason for existing (§4.2/§4.3): this is the one flag the UI actually
          // branches on to hide every write affordance uniformly.
          write: false,
        },
      };
    },

    'repo.list': async () => {
      const candidates = codeReposState.records.map((r) => ({ path: r.root, label: r.name }));
      return { candidates, activeRepoId: gitRepoIdFor(deps.codeRepoId) ?? null };
    },

    // §6.1: extends repo-diff (S8's revision pair) rather than forking it. `editor.openAllChanges`
    // below shares this same composition per file.
    'editor.openDiff': async (params, signal) => {
      const { repoId: gitRepoId, sha, path, parentIndex, pinned, fallbackSha } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        throw new Error(`hostHandlers: editor.openDiff: unknown git repoId ${gitRepoId}`);
      }
      let found = await findChangeInDetail(
        deps.remoteRequest,
        gitRepoId,
        sha,
        path,
        parentIndex,
        signal,
      );
      let effectiveSha = sha;
      if (!found && fallbackSha !== undefined) {
        found = await findChangeInDetail(
          deps.remoteRequest,
          gitRepoId,
          fallbackSha,
          path,
          parentIndex,
          signal,
        );
        effectiveSha = fallbackSha;
      }
      if (!found) {
        throw new Error(
          `hostHandlers: editor.openDiff: ${path} is not one of commit ${sha}'s changed files`,
        );
      }
      const leftRev = found.baseSha ?? EMPTY_TREE_SHA;
      const leftLabel = found.baseSha ? found.baseSha.slice(0, 7) : 'empty tree';
      const rightLabel = effectiveSha.slice(0, 7);
      // C5's preview/permanent split (§6.1): pinned:false is C5's own default preview slot;
      // only an explicit true pins.
      openRepoCommitDiffTab(
        codeRepoId,
        path,
        leftRev,
        effectiveSha,
        { left: leftLabel, right: rightLabel },
        pinned === true,
      );
      return {};
    },

    // §6.1: "N tabs instead" of a single multi-diff editor (§13) — the native workspace has none.
    // Always mode: 'tabs', matching detailActions.ts's own existing result shape (`:54`).
    'editor.openAllChanges': async (params, signal) => {
      const { repoId: gitRepoId, sha, parentIndex } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        return { opened: 0, failed: 0, mode: 'tabs' };
      }
      const detail = await deps.remoteRequest(
        'commit.detail',
        { repoId: gitRepoId, sha, parentIndex },
        signal,
      );
      const baseSha = detail.parents[detail.parentIndex] ?? null;
      const leftRev = baseSha ?? EMPTY_TREE_SHA;
      const leftLabel = baseSha ? baseSha.slice(0, 7) : 'empty tree';
      const rightLabel = sha.slice(0, 7);
      for (const change of detail.files) {
        openRepoCommitDiffTab(
          codeRepoId,
          change.path,
          leftRev,
          sha,
          { left: leftLabel, right: rightLabel },
          true, // "Always pinned/multi-diff in both branches" (contract.ts's own doc comment)
        );
      }
      return { opened: detail.files.length, failed: 0, mode: 'tabs' };
    },

    // §6.3: exactly C6's own comparison — no revision fields, no new code path.
    'editor.openWorkingDiff': async (params) => {
      const { repoId: gitRepoId, path } = params;
      const codeRepoId = codeRepoIdFor(gitRepoId);
      if (codeRepoId === undefined) {
        throw new Error(`hostHandlers: editor.openWorkingDiff: unknown git repoId ${gitRepoId}`);
      }
      openRepoDiffTab(codeRepoId, path);
      return {};
    },

    'clipboard.write': async ({ text }) => {
      await navigator.clipboard.writeText(text);
      return {};
    },

    // Out of scope for this phase (§13) — C11 restores these.
    'editor.openRangeDiff': readOnlyRefusal('editor.openRangeDiff', 'is C11 scope (review layer)'),
    'review.open': readOnlyRefusal('review.open', 'is C11 scope (review layer)'),
    'review.session.save': readOnlyRefusal('review.session.save', 'is C11 scope (review layer)'),
    'review.session.load': readOnlyRefusal('review.session.load', 'is C11 scope (review layer)'),
    // detailActions.ts D12/G21 D12: no caller remains for editor.goToFile at all — a throw is
    // honest and costs nothing (§5's own table).
    'editor.goToFile': readOnlyRefusal('editor.goToFile', 'has no native caller'),

    // §4.2 layer 2 — never reach Go at all under VS Code either; a local throw names the real
    // reason instead of layer 1's more generic E_READ_ONLY.
    'credential.provide': readOnlyRefusal(
      'credential.provide',
      'is unreachable here — there is no socket connection, and therefore no credential prompt, for the native graph to answer',
    ),
    'editor.resolveConflict': readOnlyRefusal(
      'editor.resolveConflict',
      'is a write — the native graph is read-only (§4.2)',
    ),
    'settings.setGitPath': readOnlyRefusal(
      'settings.setGitPath',
      "writes the global git path, which this app's own Settings dialog already owns",
    ),
    'worktree.openWindow': readOnlyRefusal(
      'worktree.openWindow',
      'is a write — the native graph is read-only (§4.2)',
    ),
  };
}
