import type { InjectionKey } from 'vue';
import { inject } from 'vue';
import type {
  BacklogResult,
  Board,
  ChangeRequestsResult,
  HostProviders,
  LogPage,
  ReadLogArgs,
  Repo,
  SessionsResult,
  WorkflowsResult,
} from './wire';

/** Repo facts a read-only client needs: names only, never paths or scripts. */
type RepoName = Pick<Repo, 'codeRepoId' | 'name' | 'nickname'>;

/** The ADE read surface, independent of transport: Wails bindings on the desktop, HTTP on the
 *  phone. Read hooks go through it; writes stay on the desktop `control`. */
export interface AdeReader {
  board(): Promise<Board>;
  changeRequests(): Promise<ChangeRequestsResult>;
  sessions(): Promise<SessionsResult>;
  workflows(): Promise<WorkflowsResult>;
  backlog(): Promise<BacklogResult>;
  repos(): Promise<{ repos: RepoName[] }>;
  readLog(args: ReadLogArgs): Promise<LogPage>;
  hostProviders(): Promise<HostProviders>;
}

export const adeReaderKey: InjectionKey<AdeReader> = Symbol('adeReader');

export function useAdeReader(): AdeReader {
  const reader = inject(adeReaderKey, null);
  if (!reader)
    throw new Error('useAdeReader: reader not provided; app.provide(adeReaderKey, ...) is missing');
  return reader;
}
