import { afterAll, describe, expect, test } from 'bun:test';
import { resetCallFactory, setCallFactory } from './support/wailsRuntime';

const { control, unwrap } = await import('../../frontend/src/bridge/control');

afterAll(() => {
  resetCallFactory();
});

function callErrorLike(message: string, cause?: unknown): Promise<never> {
  const err = new Error(message) as Error & { cause?: unknown };
  if (cause !== undefined) err.cause = cause;
  return Promise.reject(err);
}

describe('apps/kira-studio/frontend/src/bridge/control.ts — unwrap (P57 D5)', () => {
  test('1. a structured cause is preferred over the message string', async () => {
    await expect(
      unwrap(
        callErrorLike(JSON.stringify({ code: 'E_DISCONNECTED', message: 'PG is not connected' }), {
          code: 'E_DISCONNECTED',
          message: 'PG is not connected',
        }),
      ),
    ).rejects.toMatchObject({ message: 'PG is not connected', code: 'E_DISCONNECTED' });
  });

  test('2. a JSON message is the fallback when cause is absent', async () => {
    await expect(
      unwrap(
        callErrorLike(JSON.stringify({ code: 'E_DISCONNECTED', message: 'PG is not connected' })),
      ),
    ).rejects.toMatchObject({ message: 'PG is not connected', code: 'E_DISCONNECTED' });
  });

  test('3. neither a structured cause nor a parseable message: E_INTERNAL, message preserved', async () => {
    await expect(unwrap(callErrorLike('boom', {}))).rejects.toMatchObject({
      message: 'boom',
      code: 'E_INTERNAL',
    });
    await expect(unwrap(callErrorLike('network gone'))).rejects.toMatchObject({
      message: 'network gone',
      code: 'E_INTERNAL',
    });
  });

  test('5. every promise-returning control method surfaces a code, not raw JSON', async () => {
    setCallFactory(() =>
      callErrorLike(JSON.stringify({ code: 'E_QUERY', message: 'relation does not exist' }), {
        code: 'E_QUERY',
        message: 'relation does not exist',
      }),
    );

    // Event subscriptions (on*) and appFlushed/windowFlushed (void, fire-and-forget — P8 C6 added
    // the second one, the close-handshake analogue of the quit one) call no bound method and
    // return no promise — everything else in `control` is a request/response call unwrap must
    // guard (§4.2 rule 1). Four placeholder arguments cover every method's arity; none of
    // control.ts's own wrapper bodies inspect argument shape before handing them to the binding.
    // Temporary diagnostic (remove once understood): this fails on CI's Linux runners on a method
    // that keeps changing round to round as each found offender gets fixed — three found and
    // fixed so far (opsRecent, tabsSave, variablesList, all leaked stubs from other spec files
    // overriding a control method without restoring it), each via a different TypeScript cast
    // style, and it still fails. Rather than keep spending one CI round-trip per offender, collect
    // every one that resolves instead of rejects in a single pass, so whatever is left surfaces
    // all at once.
    const checked: string[] = [];
    const offenders: { name: string; value: unknown }[] = [];
    for (const [name, member] of Object.entries(control)) {
      if (typeof member !== 'function') continue;
      if (name.startsWith('on') || name === 'appFlushed' || name === 'windowFlushed') continue;
      const result = (member as (...args: unknown[]) => unknown)('a', 'b', 'c', 'd');
      if (!result || typeof (result as Promise<unknown>).then !== 'function') continue;
      checked.push(name);
      const outcome = await (result as Promise<unknown>).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );
      if (outcome.ok) {
        offenders.push({ name, value: outcome.value });
      } else {
        try {
          expect(outcome.error).toMatchObject({ code: 'E_QUERY' });
        } catch {
          offenders.push({ name, value: outcome.error });
        }
      }
    }
    if (offenders.length > 0) {
      console.error('bridge-unwrap diagnostic round 3 — every remaining offender:', offenders);
    }
    expect(offenders).toEqual([]);
    // A regression that stops wrapping every method (or a Object.entries change that stops
    // reaching them) should fail loudly here rather than silently checking zero methods.
    expect(checked.length).toBeGreaterThan(30);
  });
});
