package bridge

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSanitizeAttachmentName(t *testing.T) {
	long := strings.Repeat("é", 150) + ".png"
	cases := []struct {
		name, in, want string
		ok             bool
	}{
		{"plain", "shot.png", "shot.png", true},
		{"parent path", "../x.png", "x.png", true},
		{"backslash path", `C:\a\b.png`, "b.png", true},
		{"control chars", "a\x00b\n.png", "ab.png", true},
		{"reserved chars", `a:b*c?"d<e>f|g.txt`, "abcdefg.txt", true},
		{"unicode kept", "résumé 日本.pdf", "résumé 日本.pdf", true},
		{"trailing dots and spaces", "x.png. .", "x.png", true},
		{"hidden", ".env.txt", "", false},
		{"no extension", "README", "", false},
		{"dots only", "..", "", false},
		{"empty after strip", "***", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := SanitizeAttachmentName(tc.in)
			if got != tc.want || ok != tc.ok {
				t.Errorf("got %q,%v want %q,%v", got, ok, tc.want, tc.ok)
			}
		})
	}
	t.Run("long name keeps extension on a rune boundary", func(t *testing.T) {
		got, ok := SanitizeAttachmentName(long)
		if !ok || len(got) > maxAttachmentName || !strings.HasSuffix(got, ".png") || !utf8.ValidString(got) {
			t.Errorf("got %q (%d bytes), %v", got, len(got), ok)
		}
	})
}
