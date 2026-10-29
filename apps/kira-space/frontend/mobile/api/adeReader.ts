import type { AdeReader } from '@ade/reader';
import type {
  ArchivedTask,
  BacklogResult,
  Board,
  ChangeRequestsResult,
  HostProviders,
  LogPage,
  SessionsResult,
  WorkflowsResult,
} from '@ade/wire';
import { getJson } from './http';

export const httpAdeReader: AdeReader = {
  board: () => getJson<Board>('/api/ade/board'),
  changeRequests: () => getJson<ChangeRequestsResult>('/api/ade/change-requests'),
  sessions: () => getJson<SessionsResult>('/api/ade/sessions'),
  workflows: () => getJson<WorkflowsResult>('/api/ade/workflows'),
  backlog: () => getJson<BacklogResult>('/api/ade/backlog'),
  repos: () => getJson('/api/ade/repos'),
  hostProviders: () => getJson<HostProviders>('/api/ade/hosts'),
  archivedTask: (args) => getJson<ArchivedTask>('/api/ade/archived-task', { taskId: args.taskId }),
  readLog: (args) =>
    getJson<LogPage>('/api/ade/log', { kind: args.kind, id: args.id, afterSeq: args.afterSeq }),
};
