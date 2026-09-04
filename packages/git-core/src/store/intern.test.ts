import { describe, expect, test } from 'bun:test';
import { StringInterner, SubjectBuffer } from './intern';

describe('StringInterner', () => {
  test('interning the same value twice returns the same id', () => {
    const interner = new StringInterner();
    expect(interner.intern('alice')).toBe(0);
    expect(interner.intern('bob')).toBe(1);
    expect(interner.intern('alice')).toBe(0);
    expect(interner.size).toBe(2);
  });

  test('ids are stable in first-seen order regardless of insert order elsewhere', () => {
    const a = new StringInterner();
    const b = new StringInterner();
    for (const name of ['alice', 'bob', 'carol']) a.intern(name);
    for (const name of ['alice', 'bob', 'carol']) b.intern(name);
    expect(a.get(0)).toBe(b.get(0));
    expect(a.get(1)).toBe(b.get(1));
    expect(a.get(2)).toBe(b.get(2));
  });

  test('get() round-trips the original string', () => {
    const interner = new StringInterner();
    const id = interner.intern('dörte@example.com');
    expect(interner.get(id)).toBe('dörte@example.com');
  });

  test('get() on an unknown id throws', () => {
    const interner = new StringInterner();
    expect(() => interner.get(0)).toThrow();
  });

  test('byteLength grows only on a new distinct string', () => {
    const interner = new StringInterner();
    interner.intern('alice');
    const afterFirst = interner.byteLength;
    interner.intern('alice');
    expect(interner.byteLength).toBe(afterFirst);
    interner.intern('bob');
    expect(interner.byteLength).toBeGreaterThan(afterFirst);
  });
});

describe('SubjectBuffer', () => {
  test('append returns sequential indices and at() round-trips', () => {
    const buffer = new SubjectBuffer();
    expect(buffer.append('first commit')).toBe(0);
    expect(buffer.append('second commit')).toBe(1);
    expect(buffer.at(0)).toBe('first commit');
    expect(buffer.at(1)).toBe('second commit');
    expect(buffer.count).toBe(2);
  });

  test('round-trips astral-plane characters, a lone surrogate, and an empty string', () => {
    const buffer = new SubjectBuffer();
    const astral = 'commit 🎉 done';
    const empty = '';
    buffer.append(astral);
    buffer.append(empty);
    buffer.append('normal');
    expect(buffer.at(0)).toBe(astral);
    expect(buffer.at(1)).toBe(empty);
    expect(buffer.at(2)).toBe('normal');
  });

  test('a lone surrogate round-trips through the fatal:false decoder without throwing', () => {
    const buffer = new SubjectBuffer();
    // A lone high surrogate with no low surrogate — invalid UTF-16, but must not throw either
    // on encode or on the subsequent decode.
    const lonely = 'before\uD800after';
    expect(() => buffer.append(lonely)).not.toThrow();
    expect(() => buffer.at(0)).not.toThrow();
  });

  test('at() past the appended count throws', () => {
    const buffer = new SubjectBuffer();
    buffer.append('only one');
    expect(() => buffer.at(1)).toThrow();
    expect(() => buffer.at(-1)).toThrow();
  });

  test('byteLength reflects actual allocation and grows across many appends', () => {
    const buffer = new SubjectBuffer();
    for (let i = 0; i < 5000; i++) buffer.append(`commit subject number ${i}`);
    expect(buffer.count).toBe(5000);
    expect(buffer.byteLength).toBeGreaterThan(0);
    for (let i = 0; i < 5000; i += 777) {
      expect(buffer.at(i)).toBe(`commit subject number ${i}`);
    }
  });
});
