import type { AdeReader } from '../ade/v2/reader';
import { control } from './control';

export const controlAdeReader: AdeReader = {
  board: () => control.adeTaskBoard(),
  changeRequests: () => control.adeTaskChangeRequests(),
  sessions: () => control.adeTaskSessions(),
  workflows: () => control.adeTaskWorkflows(),
  backlog: () => control.adeTaskBacklog(),
  repos: () => control.adeTaskRepos(),
  readLog: (args) => control.adeTaskReadLog(args),
  hostProviders: () => control.gitHostProviders(),
  archivedTask: (args) => control.adeTaskArchivedTask(args),
};
