import type { CellFormat } from './formats';

// P42 D29: four values a developer routinely needs to type into a column by hand — pure and
// Vue-free so P43's sparse-unit-test phase can pin the shape cheaply. Never format-gated (that
// was the actual bug in the button this panel replaces, F26): a generator writes text into the
// buffer, and the buffer does not care what format the value is being read as. "Now" is the one
// entry that is format-aware, because the right *text* for "the current moment" genuinely differs
// between an ISO timestamp and an epoch count.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Reads 5-bit groups out of a byte array, MSB-first, zero-padding the final partial group — the
// same rule every Crockford base32 encoder (ULID's own reference included) uses.
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
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

function timestampBytes(ms: number): Uint8Array {
  const bytes = new Uint8Array(6); // 48 bits, ULID's own timestamp width
  let n = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return bytes;
}

// 48-bit timestamp (10 Crockford chars) + 80 random bits (16 chars) = 26 chars, sortable by
// creation time unlike a v4 UUID — the second most-requested "give me an id" shape after UUID.
function generateUlid(): string {
  const time = toCrockford(timestampBytes(Date.now()));
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
