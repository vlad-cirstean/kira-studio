import type { Shelf, Task } from '@ade/wire';
import { postJson } from './http';

// The phone's write routes, one function each. Every call carries the caller's idempotency key.

export interface LaunchResult {
  sessionId: string;
}

export const adeWriter = {
  captureTask: (title: string, key: string) =>
    postJson<Task>('/api/ade/later/items', { title }, { idempotencyKey: key }),
  shelveTask: (taskId: string, shelf: Shelf, beforeId: string, key: string) =>
    postJson<Record<string, never>>(
      '/api/ade/shelf/move',
      { taskId, shelf, beforeId },
      { idempotencyKey: key },
    ),
  setTaskStep: (taskId: string, fromStepId: string, stepId: string, key: string) =>
    postJson<{ taskId: string; stepId: string }>(
      '/api/ade/tasks/step',
      { taskId, fromStepId, stepId },
      { idempotencyKey: key },
    ),
  startRun: (taskId: string, fromStepId: string, key: string) =>
    postJson<{ runIds: string[] }>(
      '/api/ade/tasks/run',
      { taskId, fromStepId },
      { idempotencyKey: key },
    ),
  launchStep: (taskId: string, fromStepId: string, key: string) =>
    postJson<LaunchResult>(
      '/api/ade/tasks/launch',
      { taskId, fromStepId },
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
