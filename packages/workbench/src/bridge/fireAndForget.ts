import { toCodedError } from './codedError';
import { logWarn } from './log';

/** Runs a call nobody waits on. A rejection logs and shows no UI, so it never goes unhandled. */
export function fireAndForget(promise: Promise<unknown>, scope: string): void {
  promise.catch((err: unknown) => {
    const e = toCodedError(err);
    logWarn(scope, `${e.code ?? 'E_INTERNAL'}: ${e.message}`);
  });
}
