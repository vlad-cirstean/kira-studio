import { describe, expect, test } from 'bun:test';
import { ContractShapeError, createContractShapeAsserter } from './shape';

const assertShape = createContractShapeAsserter({
  requests: new Set(['thing.open']),
  events: new Set(['thing.changed']),
  streams: new Set(['thing.stream']),
});

describe('ipc shape', () => {
  test('accepts a known request with an object payload', () => {
    expect(() => assertShape('request', 'thing.open', { path: '/x' })).not.toThrow();
  });

  test('rejects an unknown method', () => {
    expect(() => assertShape('request', 'thing.nonsense', {})).toThrow(ContractShapeError);
  });

  test('rejects a non-object payload', () => {
    expect(() => assertShape('event', 'thing.changed', 'nope')).toThrow(ContractShapeError);
  });

  test("rejects a non-string 'kind' discriminant", () => {
    expect(() => assertShape('request', 'thing.open', { kind: 1 })).toThrow(ContractShapeError);
  });

  test('accepts a valid stream method', () => {
    expect(() => assertShape('stream', 'thing.stream', { id: 'r1' })).not.toThrow();
  });
});
