import { describe, expect, test } from 'bun:test';
import {
  assertContractShape,
  CONTRACT_VERSION,
  ContractShapeError,
  unwrapVersioned,
  validateVersion,
  wrapVersioned,
} from './validate.ts';

describe('ipc validate', () => {
  test('accepts a matching version', () => {
    expect(() => validateVersion(CONTRACT_VERSION)).not.toThrow();
  });

  test('throws loudly on a version mismatch', () => {
    expect(() => validateVersion(CONTRACT_VERSION + 1)).toThrow(/contract version mismatch/);
  });

  test('wrap/unwrap round-trips a body and validates its version', () => {
    const envelope = wrapVersioned({ hello: 'world' });
    expect(unwrapVersioned(envelope)).toEqual({ hello: 'world' });
    expect(() => unwrapVersioned({ version: CONTRACT_VERSION + 1, body: {} })).toThrow();
  });

  test('assertContractShape accepts a known request with an object payload', () => {
    expect(() => assertContractShape('request', 'repo.open', { path: '/x' })).not.toThrow();
  });

  test('assertContractShape rejects an unknown method', () => {
    expect(() => assertContractShape('request', 'repo.nonsense', {})).toThrow(ContractShapeError);
  });

  test('assertContractShape rejects a non-object payload', () => {
    expect(() => assertContractShape('event', 'repo.changed', 'nope')).toThrow(ContractShapeError);
  });

  test("assertContractShape rejects a non-string 'kind' discriminant", () => {
    expect(() => assertContractShape('request', 'repo.open', { kind: 1 })).toThrow(
      ContractShapeError,
    );
  });

  test('assertContractShape accepts a valid stream method', () => {
    expect(() => assertContractShape('stream', 'graph.stream', { repoId: 'r1' })).not.toThrow();
  });
});
