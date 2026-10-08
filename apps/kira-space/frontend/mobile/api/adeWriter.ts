import type { BacklogItem } from '@ade/wire';
import { postJson } from './http';

// The phone's write routes, one function each. Every call carries the caller's idempotency key.

export interface LaunchResult {
  sessionId: string;
}

export const adeWriter = {
  addBacklogItem: (text: string, key: string) =>
    postJson<BacklogItem>('/api/ade/backlog/items', { text }, { idempotencyKey: key }),
  moveBacklogItem: (id: string, toIndex: number, key: string) =>
    postJson<Record<string, never>>(
      '/api/ade/backlog/move',
      { id, toIndex },
      { idempotencyKey: key },
    ),
  setTaskStage: (taskId: string, fromStageId: string, stageId: string, key: string) =>
    postJson<{ taskId: string; stageId: string }>(
      '/api/ade/tasks/stage',
      { taskId, fromStageId, stageId },
      { idempotencyKey: key },
    ),
  startRun: (taskId: string, fromStageId: string, key: string) =>
    postJson<{ runIds: string[] }>(
      '/api/ade/tasks/run',
      { taskId, fromStageId },
      { idempotencyKey: key },
    ),
  launchStage: (taskId: string, fromStageId: string, key: string) =>
    postJson<LaunchResult>(
      '/api/ade/tasks/launch',
      { taskId, fromStageId },
      { idempotencyKey: key },
    ),
  sendReply: (sessionId: string, message: string, key: string) =>
    postJson<Record<string, never>>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/send`,
      { message },
      { idempotencyKey: key },
    ),
  takeOver: (sessionId: string, key: string) =>
    postJson<LaunchResult>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/take-over`,
      {},
      { idempotencyKey: key },
    ),
};
