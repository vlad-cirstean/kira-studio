/** Per-id ordered writes. Concurrent bound calls arrive in any order, so only one write per id is in
 *  flight; chunks typed meanwhile coalesce into the next write. No timers: an idle id sends at once. */
export function createOrderedWriter(
  send: (id: string, bytes: Uint8Array) => Promise<unknown>,
  onError: (id: string, err: unknown) => void,
) {
  interface Lane {
    pending: Uint8Array[];
  }
  const lanes = new Map<string, Lane>();

  async function flush(id: string, lane: Lane, first: Uint8Array): Promise<void> {
    let chunk: Uint8Array | null = first;
    while (chunk) {
      try {
        await send(id, chunk);
      } catch (err) {
        onError(id, err);
      }
      if (lanes.get(id) !== lane) return;
      chunk = lane.pending.length > 0 ? concat(lane.pending.splice(0)) : null;
    }
    lanes.delete(id);
  }

  return {
    write(id: string, bytes: Uint8Array): void {
      const lane = lanes.get(id);
      if (lane) {
        lane.pending.push(bytes);
        return;
      }
      const fresh: Lane = { pending: [] };
      lanes.set(id, fresh);
      void flush(id, fresh, bytes);
    },
    /** Forget id: queued chunks are discarded, an in-flight write finishes unobserved. */
    drop(id: string): void {
      lanes.delete(id);
    },
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
