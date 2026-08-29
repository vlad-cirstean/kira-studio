package preconnect

import (
	"strings"
	"testing"
)

func TestTailTracker(t *testing.T) {
	tests := []struct {
		name   string
		chunks []string
		want   string
	}{
		{"single line", []string{"boom\n"}, "boom"},
		{"line split across chunks", []string{"bo", "om\n"}, "boom"},
		{"several lines in one chunk", []string{"first\nsecond\nthird\n"}, "third"},
		{"trailing newline then new content is not reused as a stale prefix", []string{"first\n", "second"}, "second"},
		{"blank lines ignored", []string{"real\n\n\n"}, "real"},
		{"unterminated remainder counts as the tail", []string{"partial line, no newline yet"}, "partial line, no newline yet"},
		{"carriage return newline", []string{"one\r\ntwo\r\n"}, "two"},
		{"truncated over 200 chars", []string{strings.Repeat("x", 250) + "\n"}, strings.Repeat("x", 200)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var tr tailTracker
			for _, c := range tt.chunks {
				tr.push(c)
			}
			if got := tr.value(); got != tt.want {
				t.Errorf("value() = %q, want %q", got, tt.want)
			}
		})
	}
}
