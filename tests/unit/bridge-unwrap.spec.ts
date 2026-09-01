import { afterAll, describe, expect, test } from 'bun:test';
import { resetCallFactory, setCallFactory } from './support/wailsRuntime';

const { control, unwrap } = await import('../../apps/kira-studio/frontend/src/bridge/control');

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

    // Event subscriptions (on*) and appFlushed (void, fire-and-forget) call no bound method and
    // return no promise — everything else in `control` is a request/response call unwrap must
    // guard (§4.2 rule 1). Four placeholder arguments cover every method's arity; none of
    // control.ts's own wrapper bodies inspect argument shape before handing them to the binding.
    const checked: string[] = [];
    for (const [name, member] of Object.entries(control)) {
      if (typeof member !== 'function') continue;
      if (name.startsWith('on') || name === 'appFlushed') continue;
      const result = (member as (...args: unknown[]) => unknown)('a', 'b', 'c', 'd');
      if (!result || typeof (result as Promise<unknown>).then !== 'function') continue;
      checked.push(name);
      await expect(result as Promise<unknown>).rejects.toMatchObject({ code: 'E_QUERY' });
    }
    // A regression that stops wrapping every method (or a Object.entries change that stops
    // reaching them) should fail loudly here rather than silently checking zero methods.
    expect(checked.length).toBeGreaterThan(30);
  });
});
