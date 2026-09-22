// Kira Studio's own clipboard.ts, ported verbatim. Returns the underlying promise (most call
// sites still fire-and-forget it) so a caller that already surfaces action errors can await a
// real rejection instead of it vanishing as an unhandled rejection.
export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
