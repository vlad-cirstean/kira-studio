/**
 * P4 W4: the module worker side of layout — receives one `LayoutRequest`, calls the pure
 * `layoutAppend` (P2), and posts back a `LayoutResponse` with the new chunk's buffers
 * transferred (§5.5). Deliberately thin: `layoutAppend` already does the real work, and the
 * frontier this worker receives on each request and returns in each response is threaded
 * through, never held here — `layoutClient.ts` owns its lifecycle (`reset()` on a repo switch
 * or a refresh), matching `core/graph/types.ts`'s own note that a frontier is "returned rather
 * than kept in module state so two repositories' layouts never see each other". Keeping this
 * file pure per message means `reset()` needs no message to this worker at all.
 *
 * Typed against a narrow local `WorkerScope` rather than lib "webworker"'s ambient
 * `DedicatedWorkerGlobalScope`: `packages/ui/tsconfig.json`'s `lib` is `DOM`, and TypeScript
 * cannot have both `DOM` and `webworker` active in one program (they declare incompatible
 * globals) — `MessageEvent`/`Transferable`, the only two worker-specific types this file needs,
 * are already part of `DOM`, so a whole-project `lib` change is not needed for two lines.
 */
import { layoutAppend, layoutTransferList } from "@kira-version/core";
import type { LayoutRequest, LayoutResponse } from "@kira-version/core";

interface WorkerScope {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutResponse, transfer: readonly Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { sequence, input, frontier } = event.data;
  const { chunk, frontier: nextFrontier } = layoutAppend(input, frontier);
  const response: LayoutResponse = { sequence, chunk, frontier: nextFrontier };
  scope.postMessage(response, layoutTransferList(chunk));
};
