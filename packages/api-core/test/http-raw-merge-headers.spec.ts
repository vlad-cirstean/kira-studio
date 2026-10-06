// P175 D6: matching with duplicate name+value pairs interacts with disabled-row anchoring.

import { describe, expect, test } from 'bun:test';
import type { HttpHeaderState } from '@kira/shared/domain/http';
import { isRawEmittedHeader } from '../src/http/raw/generate';
import { mergeRawHeaders } from '../src/http/raw/mergeHeaders';

const h = (name: string, value: string, enabled = true, description = ''): HttpHeaderState => ({
  name,
  value,
  enabled,
  description,
});
const parse = (rows: HttpHeaderState[]) =>
  rows.filter(isRawEmittedHeader).map((r) => h(r.name, r.value));
const names = (rows: HttpHeaderState[]) => rows.map((r) => `${r.name}${r.enabled ? '' : '!'}`);

describe('mergeRawHeaders', () => {
  test('a no-edit Apply is the identity', () => {
    const original = [
      h('X-Off', '1', false, 'first'),
      h('A', 'x', true, 'da'),
      h('', '', true, 'blank'),
      h('A', 'x', true, 'db'),
      h('B', 'y', false),
      h('A', 'x', true, 'dc'),
      h('C', 'z', false, 'tail'),
    ];
    expect(mergeRawHeaders(original, parse(original))).toEqual(original);
  });

  test('an edited value drops that description but keeps neighbouring disabled rows in place', () => {
    const original = [h('A', '1', true, 'da'), h('Off', 'x', false), h('B', '2', true, 'db')];
    const parsed = [h('A', '1'), h('B', 'changed')];
    const merged = mergeRawHeaders(original, parsed);
    expect(names(merged)).toEqual(['A', 'Off!', 'B']);
    expect(merged[0].description).toBe('da');
    expect(merged[2].description).toBe('');
  });

  test('a deleted enabled row leaves its trailing disabled row after the previous survivor', () => {
    const original = [h('A', '1'), h('B', '2'), h('Off', 'x', false), h('C', '3')];
    const merged = mergeRawHeaders(original, [h('A', '1'), h('C', '3')]);
    expect(names(merged)).toEqual(['A', 'Off!', 'C']);
  });

  test('a new parsed row keeps its position', () => {
    const original = [h('Off', 'x', false), h('A', '1', true, 'da')];
    const merged = mergeRawHeaders(original, [h('New', 'n'), h('A', '1')]);
    expect(names(merged)).toEqual(['Off!', 'New', 'A']);
    expect(merged[2].description).toBe('da');
  });
});
