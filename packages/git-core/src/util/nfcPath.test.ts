import { describe, expect, test } from 'bun:test';
import { nfcPath } from './nfcPath.ts';

// Every non-ASCII input below is built from String.fromCharCode(<code point>) -- the TS analogue
// of the Go side's string([]byte{...}) literals (gitpath_test.go) -- rather than a literal
// multi-byte character typed into this source file, which an editor could silently re-encode on
// save (composing an "already fine" accent, say) and quietly turn a decomposed test case into a
// composed one without anyone noticing (G27 D12). No test here depends on the host filesystem's
// own normalization behaviour either. Every code point here is in the Basic Multilingual Plane, so
// a single fromCharCode call per code point is exact -- no surrogate-pair handling needed.

const COMBINING_ACUTE_ACCENT = 0x0301;
const LATIN_SMALL_LETTER_E_WITH_ACUTE = 0x00e9;
// choseong/jungseong/jongseong for the first syllable, then the second.
const HANGUL_CHOSEONG_HIEUH = 0x1112;
const HANGUL_JUNGSEONG_A = 0x1161;
const HANGUL_JONGSEONG_NIEUN = 0x11ab;
const HANGUL_CHOSEONG_KIYEOK = 0x1100;
const HANGUL_JUNGSEONG_EU = 0x1173;
const HANGUL_JONGSEONG_RIEUL = 0x11af;
const HANGUL_SYLLABLE_HAN = 0xd55c;
const HANGUL_SYLLABLE_GEUL = 0xae00;
const LATIN_SMALL_LIGATURE_FI = 0xfb01;

// String.fromCharCode takes any number of code points in one call, and template-literal
// interpolation (not "+" concatenation) joins the result onto its plain-ASCII neighbours.
const decomposedAccent = `cafe${String.fromCharCode(COMBINING_ACUTE_ACCENT)}.txt`;
const composedAccent = `caf${String.fromCharCode(LATIN_SMALL_LETTER_E_WITH_ACUTE)}.txt`;

const decomposedHangul = `${String.fromCharCode(
  HANGUL_CHOSEONG_HIEUH,
  HANGUL_JUNGSEONG_A,
  HANGUL_JONGSEONG_NIEUN,
  HANGUL_CHOSEONG_KIYEOK,
  HANGUL_JUNGSEONG_EU,
  HANGUL_JONGSEONG_RIEUL,
)}.md`;
const composedHangul = `${String.fromCharCode(HANGUL_SYLLABLE_HAN, HANGUL_SYLLABLE_GEUL)}.md`;

const ligature = `${String.fromCharCode(LATIN_SMALL_LIGATURE_FI)}le.txt`;

describe('nfcPath', () => {
  test('composes a decomposed Latin accent (the e-acute pair, probe P3)', () => {
    expect(nfcPath(decomposedAccent)).toBe(composedAccent);
  });

  test('is a no-op on an already-composed Latin accent', () => {
    expect(nfcPath(composedAccent)).toBe(composedAccent);
  });

  test('composes decomposed Hangul jamo into precomposed syllables (probe P4)', () => {
    expect(nfcPath(decomposedHangul)).toBe(composedHangul);
  });

  test('is a no-op on already-precomposed Hangul', () => {
    expect(nfcPath(composedHangul)).toBe(composedHangul);
  });

  test('leaves a pure-ASCII path unchanged', () => {
    const ascii = 'apps/kira-studio-vscode/src/extension.ts';
    expect(nfcPath(ascii)).toBe(ascii);
  });

  test('does NOT fold a compatibility ligature (the NFKC guard rail, probe P6)', () => {
    // Only NFKC would fold U+FB01 to "fi"; NFC must leave it exactly as it is.
    expect(nfcPath(ligature)).toBe(ligature);
  });

  test('is idempotent', () => {
    const once = nfcPath(decomposedAccent);
    expect(nfcPath(once)).toBe(once);
  });
});
