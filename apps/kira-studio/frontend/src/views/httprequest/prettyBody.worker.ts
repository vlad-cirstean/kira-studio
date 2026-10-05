import { formatBody, type PrettyRequest, type PrettyResult } from './prettyBodyCore';

// The frontend tsconfig has no `WebWorker` lib; type only the two members used.
const ctx = self as unknown as {
  postMessage: (m: PrettyResult & { id: number }) => void;
  addEventListener: (type: 'message', cb: (e: MessageEvent<PrettyRequest>) => void) => void;
};

ctx.addEventListener('message', (e) => {
  const { id, body, wantText } = e.data;
  ctx.postMessage({ id, ...formatBody(body, wantText) });
});
