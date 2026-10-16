import { bound as boundCall } from '@workbench/testing/e2eReal';

const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge';

/** Calls a bound Kira Space service method on the real server. */
export function bound<T>(
  baseURL: string,
  service: string,
  method: string,
  args?: unknown,
): Promise<T> {
  return boundCall<T>(baseURL, BRIDGE_PKG, service, method, args);
}
