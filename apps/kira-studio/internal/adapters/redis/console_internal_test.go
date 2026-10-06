package redis

import (
	"testing"
	"time"
)

func TestConsoleReadTimeoutFor(t *testing.T) {
	cases := []struct {
		command string
		args    []string
		want    time.Duration
		wantErr bool
	}{
		{"GET", []string{"k"}, consoleReadTimeout, false},
		{"BLPOP", []string{"a", "b", "10"}, 10*time.Second + blockMargin, false},
		{"BLPOP", []string{"q", "0"}, 0, true},
		{"BRPOP", []string{"q", "0.5"}, 500*time.Millisecond + blockMargin, false},
		{"BLMPOP", []string{"3", "1", "q", "LEFT"}, 3*time.Second + blockMargin, false},
		{"XREAD", []string{"COUNT", "2", "BLOCK", "2000", "STREAMS", "s", "$"}, 2*time.Second + blockMargin, false},
		{"xreadgroup", []string{"GROUP", "g", "c", "BLOCK", "0", "STREAMS", "s", ">"}, 0, true},
		{"XREAD", []string{"STREAMS", "s", "0"}, consoleReadTimeout, false},
		{"WAIT", []string{"1", "10000"}, 10*time.Second + blockMargin, false},
		{"WAIT", []string{"1", "0"}, 0, true},
		{"WAITAOF", []string{"0", "1", "500"}, 500*time.Millisecond + blockMargin, false},
		{"BLPOP", []string{"q", "999999"}, 0, true},
		{"BLPOP", []string{"q", "soon"}, consoleReadTimeout, false},
	}
	for _, c := range cases {
		got, err := consoleReadTimeoutFor(c.command, c.args)
		if (err != nil) != c.wantErr || (err == nil && got != c.want) {
			t.Errorf("%s %v: got (%v, %v), want (%v, err=%v)", c.command, c.args, got, err, c.want, c.wantErr)
		}
	}
}
