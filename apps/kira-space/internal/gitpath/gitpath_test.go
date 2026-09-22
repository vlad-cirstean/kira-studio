package gitpath

import "testing"

// Every input below is an explicit string([]byte{...}) literal (G27 D12): this container's
// filesystem is byte-transparent (probe P1) and CI runs on Linux, so a test that asked the OS or
// even the source file's own encoding to produce an NFD string would prove nothing about macOS
// and could be silently re-encoded by an editor. Byte literals are the honest alternative.
func TestNFC(t *testing.T) {
	var (
		// "cafe" + U+0301 COMBINING ACUTE ACCENT + ".txt" — decomposed Latin (P3).
		latinDecomposed = string([]byte{0x63, 0x61, 0x66, 0x65, 0xcc, 0x81, 0x2e, 0x74, 0x78, 0x74})
		// "café.txt" with U+00E9 — composed Latin.
		latinComposed = string([]byte{0x63, 0x61, 0x66, 0xc3, 0xa9, 0x2e, 0x74, 0x78, 0x74})

		// "한글.md" spelled with conjoining Hangul jamo (choseong/jungseong/jongseong per
		// syllable) — decomposed (P4).
		hangulDecomposed = string([]byte{
			0xe1, 0x84, 0x92, 0xe1, 0x85, 0xa1, 0xe1, 0x86, 0xab, // 한 as ᄒ ᅡ ᆫ
			0xe1, 0x84, 0x80, 0xe1, 0x85, 0xb3, 0xe1, 0x86, 0xaf, // 글 as ᄀ ᅳ ᆯ
			0x2e, 0x6d, 0x64,
		})
		// "한글.md" with the precomposed Hangul syllables U+D55C U+AE00.
		hangulComposed = string([]byte{0xed, 0x95, 0x9c, 0xea, 0xb8, 0x80, 0x2e, 0x6d, 0x64})

		// U+2126 OHM SIGN — a singleton canonical equivalence to U+03A9 GREEK CAPITAL OMEGA (P5).
		ohmSign = string([]byte{0xe2, 0x84, 0xa6})
		omega   = string([]byte{0xce, 0xa9})
		// U+FB01 LATIN SMALL LIGATURE FI — a *compatibility* equivalence to "fi". NFC must leave
		// it alone (P6) — this is the concrete reason D1 rejects NFKC.
		ligatureFi = string([]byte{0xef, 0xac, 0x81})

		// "a" + U+0327 COMBINING CEDILLA (ccc 202) + U+0301 COMBINING ACUTE ACCENT (ccc 230), and
		// the same two combining marks in the opposite order — canonical reordering plus
		// composition must produce the same result either way (P5).
		reorderCedillaFirst = string([]byte{0x61, 0xcc, 0xa7, 0xcc, 0x81})
		reorderAcuteFirst   = string([]byte{0x61, 0xcc, 0x81, 0xcc, 0xa7})
		reorderExpected     = string([]byte{0xc3, 0xa1, 0xcc, 0xa7}) // U+00E1 (á) + combining cedilla

		asciiPath = "internal/gitclient/porcelain/status.go"

		// Invalid UTF-8 (P9): a lone continuation-less 0xff, a truncated multi-byte lead byte, a
		// lead byte followed by a bad continuation byte, and a CESU-8-encoded surrogate. None of
		// these are valid UTF-8, and norm.NFC.String must pass every one through byte-for-byte.
		invalidLoneFF          = string([]byte{0x61, 0xff, 0x62})
		invalidTruncated       = string([]byte{0x61, 0xc3})
		invalidBadContinuation = string([]byte{0xc3, 0x28})
		invalidCESU8Surrogate  = string([]byte{0x61, 0xed, 0xa0, 0x80, 0x62})

		// "a" + acute (decomposed) + "/" + "b" + "/" + "c" — NFC must neither create nor destroy a
		// separator (P10).
		slashSafety = string([]byte{0x61, 0xcc, 0x81, 0x2f, 0x62, 0x2f, 0x63})
		// "a" + acute (decomposed) + NUL + "b" — NFC must not touch a NUL byte (P10).
		nulSafety = string([]byte{0x61, 0xcc, 0x81, 0x00, 0x62})
	)

	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"latin decomposed composes", latinDecomposed, latinComposed},
		{"latin already composed is unchanged", latinComposed, latinComposed},
		{"hangul decomposed jamo composes", hangulDecomposed, hangulComposed},
		{"hangul already precomposed is unchanged", hangulComposed, hangulComposed},
		{"pure ASCII is unchanged", asciiPath, asciiPath},
		{"singleton: OHM SIGN normalizes to GREEK CAPITAL OMEGA", ohmSign, omega},
		{"compatibility ligature FI is left alone (NFKC guard rail)", ligatureFi, ligatureFi},
		{"combining marks reorder: cedilla before acute", reorderCedillaFirst, reorderExpected},
		{"combining marks reorder: acute before cedilla", reorderAcuteFirst, reorderExpected},
		{"invalid UTF-8: lone 0xff is unchanged", invalidLoneFF, invalidLoneFF},
		{"invalid UTF-8: truncated sequence is unchanged", invalidTruncated, invalidTruncated},
		{"invalid UTF-8: bad continuation byte is unchanged", invalidBadContinuation, invalidBadContinuation},
		{"invalid UTF-8: CESU-8 surrogate is unchanged", invalidCESU8Surrogate, invalidCESU8Surrogate},
		{"slash count is preserved", slashSafety, string([]byte{0xc3, 0xa1, 0x2f, 0x62, 0x2f, 0x63})},
		{"NUL byte is preserved", nulSafety, string([]byte{0xc3, 0xa1, 0x00, 0x62})},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NFC(tc.input)
			if got != tc.want {
				t.Fatalf("NFC(%q) = %q, want %q", tc.input, got, tc.want)
			}
			// Idempotence: every row must be a fixed point of a second application (P9's
			// invalid-UTF-8 rows exercise this as strongly as the valid ones).
			if again := NFC(got); again != got {
				t.Fatalf("NFC(NFC(%q)) = %q, want %q (idempotence)", tc.input, again, got)
			}
		})
	}

	t.Run("reordered inputs converge to the same NFC form", func(t *testing.T) {
		if NFC(reorderCedillaFirst) != NFC(reorderAcuteFirst) {
			t.Fatalf("NFC(%q) = %q, NFC(%q) = %q — expected equal",
				reorderCedillaFirst, NFC(reorderCedillaFirst), reorderAcuteFirst, NFC(reorderAcuteFirst))
		}
	})
}

func TestCleanNFC(t *testing.T) {
	// "/a/./b/../café/" with a decomposed é, and a trailing slash plus a "./" and a "b/.." that
	// filepath.Clean must remove before NFC composes the accent.
	decomposedE := string([]byte{0x65, 0xcc, 0x81}) // "e" + combining acute
	input := "/a/./b/../caf" + decomposedE + "/"
	want := "/a/caf" + string([]byte{0xc3, 0xa9}) // "/a/café" composed

	got := CleanNFC(input)
	if got != want {
		t.Fatalf("CleanNFC(%q) = %q, want %q", input, got, want)
	}
}
