import type { CellFormat } from './formats';

// P42 D29: four values a developer routinely needs to type into a column by hand — pure and
// Vue-free so P43's sparse-unit-test phase can pin the shape cheaply. Never format-gated (that
// was the actual bug in the button this panel replaces, F26): a generator writes text into the
// buffer, and the buffer does not care what format the value is being read as. "Now" is the one
// entry that is format-aware, because the right *text* for "the current moment" genuinely differs
// between an ISO timestamp and an epoch count.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Reads 5-bit groups out of a byte array, MSB-first — correct only for a bit length that is an
// exact multiple of 5 (P43 iter2 D31: the 80-bit random half below, 16 groups exactly). Used to
// carry a trailing-pad branch for a partial final group, which made it look reusable for the
// 48-bit timestamp half too — it is not: ULID's timestamp field is 50 bits (10 Crockford chars),
// left-padded with 2 zero bits at the *top*, read MSB-first; padding the *last* group instead (as
// this function's own trailing branch did) shifts every bit up by 2, decoding to a timestamp four
// times too large (F22). encodeUlidTime below is the correct, separate encoder for that half.
function toCrockford(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

// ULID's timestamp field: the 48-bit millisecond value written into a 50-bit, 10-character
// Crockford field, MSB-first — i.e. left-padded with two zero bits, not right-padded. Repeated
// division by 32, prepending each digit, produces exactly that: 10 base-32 digits (50 bits of
// room) can only ever need the top two digits for padding when the value fits in 48 bits, and
// division naturally leaves them as leading zeros rather than appending anything at the tail.
function encodeUlidTime(ms: number): string {
  let n = ms;
  let out = '';
  for (let i = 0; i < 10; i++) {
    const mod = n % 32;
    out = CROCKFORD[mod] + out;
    n = (n - mod) / 32;
  }
  return out;
}

// 48-bit timestamp (10 Crockford chars) + 80 random bits (16 chars) = 26 chars, sortable by
// creation time unlike a v4 UUID — the second most-requested "give me an id" shape after UUID.
function generateUlid(): string {
  const time = encodeUlidTime(Date.now());
  const random = toCrockford(crypto.getRandomValues(new Uint8Array(10)));
  return time + random;
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateNow(format: CellFormat): string {
  const now = Date.now();
  if (format === 'epochSeconds') return String(Math.floor(now / 1000));
  if (format === 'epochMillis') return String(now);
  return new Date(now).toISOString();
}

export interface Generator {
  id: string;
  label: string;
  hint: string;
  run(format: CellFormat): string;
}

export const GENERATORS: readonly Generator[] = [
  {
    id: 'uuid',
    label: 'UUID (v4)',
    hint: 'A random 36-character dashed UUID.',
    run: () => crypto.randomUUID(),
  },
  {
    id: 'ulid',
    label: 'ULID',
    hint: 'A 26-character id that sorts by creation time.',
    run: generateUlid,
  },
  {
    id: 'token',
    label: 'Random token',
    hint: '32 random hex characters (128 bits).',
    run: generateToken,
  },
  {
    id: 'now',
    label: 'Now',
    hint: 'The current moment, spelled for the effective format.',
    run: generateNow,
  },
];
