import type { Adapter } from './adapter';

// The live-adapter map, extracted out of control.ts (P1's ownership of the Map moves from
// "control.ts owns it" to "live.ts owns the map, control.ts owns its lifecycle") so data.ts can
// look adapters up directly instead of needing a second injection channel like the scheduler's.
const adapters = new Map<string, Adapter>();

export function setLiveAdapter(connectionId: string, adapter: Adapter): void {
  adapters.set(connectionId, adapter);
}

export function getLiveAdapter(connectionId: string): Adapter | undefined {
  return adapters.get(connectionId);
}

export function deleteLiveAdapter(connectionId: string): void {
  adapters.delete(connectionId);
}
