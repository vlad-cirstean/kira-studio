/** Next warm-tab list. Order stays stable (insertion order): reordering would move a kept-alive
 *  subtree in the DOM, which is itself a detach/attach. */
export function nextWarmIds(
  prev: readonly string[],
  activeId: string | null,
  liveIds: ReadonlySet<string>,
  lastUsed: Map<string, number>,
  stamp: number,
  max: number,
): string[] {
  const next = prev.filter((id) => liveIds.has(id));
  for (const id of lastUsed.keys()) {
    if (!liveIds.has(id)) lastUsed.delete(id);
  }
  if (activeId) {
    lastUsed.set(activeId, stamp);
    if (!next.includes(activeId)) next.push(activeId);
  }
  while (next.length > max) {
    let oldest = -1;
    for (let i = 0; i < next.length; i++) {
      if (next[i] === activeId) continue;
      if (oldest < 0 || (lastUsed.get(next[i]) ?? 0) < (lastUsed.get(next[oldest]) ?? 0))
        oldest = i;
    }
    if (oldest < 0) break;
    lastUsed.delete(next[oldest]);
    next.splice(oldest, 1);
  }
  const unchanged = next.length === prev.length && next.every((id, i) => id === prev[i]);
  return unchanged ? (prev as string[]) : next;
}
