import { describe, expect, test } from 'bun:test';
import { StringInterner, SubjectBuffer } from './intern.ts';

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

  // G31 round-2 performance review, finding #2: rangeBytes(0, count) used to rebase every
  // offset — `this.#offsets[i] - this.#offsets[0]` — into a freshly allocated Uint32Array even
  // though `this.#offsets[0]` is always 0, making the whole rebase loop an identity copy. Proven
  // here by capacity: growOffsets's own doubling (1, 2, 4, 8, ...) leaves slack between
  // `#offsets`' own allocated length and `count + 1` once count stops landing exactly on a power
  // of two — a genuine copy would be exactly `(count + 1) * 4` bytes; a view into the padded
  // backing buffer is larger.
  describe('rangeBytes', () => {
    test('a from=0 range is a view into the live offsets buffer, not a copy', () => {
      const buffer = new SubjectBuffer();
      for (const s of ['a', 'bb', 'ccc', 'dddd', 'eeeee']) buffer.append(s);
      const { offsets } = buffer.rangeBytes(0, buffer.count);
      expect(offsets.length).toBe(buffer.count + 1);
      expect(Array.from(offsets)).toEqual([0, 1, 3, 6, 10, 15]);
      // A fresh, tightly-sized copy would be exactly (count + 1) * 4 = 24 bytes for these 5
      // appends; growOffsets' own doubling leaves the live buffer at 8 entries (32 bytes) by
      // then, so a view's reported byteLength is strictly larger.
      expect(offsets.buffer.byteLength).toBeGreaterThan(
        (buffer.count + 1) * Uint32Array.BYTES_PER_ELEMENT,
      );
    });

    test('a from>0 range is still correctly rebased to start at 0', () => {
      const buffer = new SubjectBuffer();
      buffer.append('a'); // 1 byte
      buffer.append('bb'); // 2 bytes
      buffer.append('ccc'); // 3 bytes
      buffer.append('dddd'); // 4 bytes
      // Full offsets: [0, 1, 3, 6, 10]. Slicing rows [1, 3) ("bb", "ccc") must rebase to [0, 3].
      const { bytes, offsets } = buffer.rangeBytes(1, 3);
      expect(Array.from(offsets)).toEqual([0, 2, 5]);
      expect(new TextDecoder().decode(bytes)).toBe('bbccc');
    });

    test('a from>0 range starting right after zero-length subjects is still correctly rebased', () => {
      const buffer = new SubjectBuffer();
      buffer.append(''); // 0 bytes — offsets[1] === 0, the same value start=0 would have.
      buffer.append(''); // 0 bytes — offsets[2] === 0.
      buffer.append('xyz'); // 3 bytes.
      const { offsets } = buffer.rangeBytes(2, 3);
      expect(Array.from(offsets)).toEqual([0, 3]);
    });
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
