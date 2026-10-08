import type { AdeReader } from '@ade/reader';
import type {
  BacklogResult,
  Board,
  LogPage,
  PrsResult,
  SessionsResult,
  WorkflowsResult,
} from '@ade/wire';
import { getJson } from './http';

export const httpAdeReader: AdeReader = {
  board: () => getJson<Board>('/api/ade/board'),
  prs: () => getJson<PrsResult>('/api/ade/prs'),
  sessions: () => getJson<SessionsResult>('/api/ade/sessions'),
  workflows: () => getJson<WorkflowsResult>('/api/ade/workflows'),
  backlog: () => getJson<BacklogResult>('/api/ade/backlog'),
  repos: () => getJson('/api/ade/repos'),
  readLog: (args) =>
    getJson<LogPage>('/api/ade/log', { kind: args.kind, id: args.id, afterSeq: args.afterSeq }),
};
