import type { AdeReader } from '../ade/v2/reader';
import { control } from './control';

export const controlAdeReader: AdeReader = {
  board: () => control.adeTaskBoard(),
  prs: () => control.adeTaskPrs(),
  sessions: () => control.adeTaskSessions(),
  workflows: () => control.adeTaskWorkflows(),
  backlog: () => control.adeTaskBacklog(),
  repos: () => control.adeTaskRepos(),
  readLog: (args) => control.adeTaskReadLog(args),
};
