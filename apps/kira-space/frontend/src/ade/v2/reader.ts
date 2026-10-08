import type { InjectionKey } from 'vue';
import { inject } from 'vue';
import type {
  BacklogResult,
  Board,
  LogPage,
  PrsResult,
  ReadLogArgs,
  Repo,
  SessionsResult,
  WorkflowsResult,
} from './wire';

/** Repo facts a read-only client needs: names only, never paths or scripts. */
export type RepoName = Pick<Repo, 'codeRepoId' | 'name' | 'nickname'>;

/** The ADE read surface, independent of transport: Wails bindings on the desktop, HTTP on the
 *  phone. Read hooks go through it; writes stay on the desktop `control`. */
export interface AdeReader {
  board(): Promise<Board>;
  prs(): Promise<PrsResult>;
  sessions(): Promise<SessionsResult>;
  workflows(): Promise<WorkflowsResult>;
  backlog(): Promise<BacklogResult>;
  repos(): Promise<{ repos: RepoName[] }>;
  readLog(args: ReadLogArgs): Promise<LogPage>;
}

export const adeReaderKey: InjectionKey<AdeReader> = Symbol('adeReader');

export function useAdeReader(): AdeReader {
  const reader = inject(adeReaderKey, null);
  if (!reader) throw new Error('AdeReader not provided: app.provide(adeReaderKey, ...) is missing');
  return reader;
}
