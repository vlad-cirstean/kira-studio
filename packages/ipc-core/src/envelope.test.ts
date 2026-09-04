import { describe, expect, test } from 'bun:test';
import { unwrapVersioned, validateVersion, wrapVersioned } from './envelope';

const CONTRACT_VERSION = 3;

describe('ipc envelope', () => {
  test('accepts a matching version', () => {
    expect(() => validateVersion(CONTRACT_VERSION, CONTRACT_VERSION)).not.toThrow();
  });

  test('throws loudly on a version mismatch', () => {
    expect(() => validateVersion(CONTRACT_VERSION, CONTRACT_VERSION + 1)).toThrow(
      /contract version mismatch/,
    );
  });

  test('wrap/unwrap round-trips a body and validates its version', () => {
    const envelope = wrapVersioned(CONTRACT_VERSION, { hello: 'world' });
    expect(unwrapVersioned(CONTRACT_VERSION, envelope)).toEqual({ hello: 'world' });
    expect(() =>
      unwrapVersioned(CONTRACT_VERSION, { version: CONTRACT_VERSION + 1, body: {} }),
    ).toThrow();
  });
});
