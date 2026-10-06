/** Subscribes before awaiting the snapshot, so a broadcast landing mid-await is not lost. Every
 *  event these channels carry is the whole state, so the latest pushed value applies over the
 *  snapshot, and later ones apply as they arrive. A failed snapshot unsubscribes and rethrows. */
export async function hydrateThenSubscribe<T>(opts: {
  snapshot(): Promise<T>;
  subscribe(cb: (value: T) => void): () => void;
  apply(value: T): void;
}): Promise<() => void> {
  let live = false;
  let pushed: { value: T } | null = null;
  const unsubscribe = opts.subscribe((value) => {
    if (live) opts.apply(value);
    else pushed = { value };
  });
  try {
    opts.apply(await opts.snapshot());
  } catch (err) {
    unsubscribe();
    throw err;
  }
  live = true;
  const latest = pushed as { value: T } | null;
  if (latest) opts.apply(latest.value);
  return unsubscribe;
}
