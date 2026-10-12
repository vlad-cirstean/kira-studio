/** Doubles capacity (from a 256-slot floor) until `minLength` fits, copying `current` into the
 *  new backing array. `EdgeBuffer`'s edge records and `StringInterner`'s offset table both grow
 *  their `Uint32Array` this way. */
export function growUint32(
  current: Uint32Array<ArrayBuffer>,
  minLength: number,
): Uint32Array<ArrayBuffer> {
  let capacity = current.length === 0 ? 256 : current.length;
  while (capacity < minLength) capacity *= 2;
  const grown = new Uint32Array(capacity);
  grown.set(current);
  return grown;
}
