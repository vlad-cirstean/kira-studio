/** Moves fromId to toId's pre-splice index — createTabsStore.moveTab's own rule, so a drop onto a
 *  later item lands after it and onto an earlier one lands before it. */
export function moveId(ids: readonly string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
