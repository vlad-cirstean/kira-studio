package startupfail

import (
	"strings"
	"testing"
)

// TestAlertArgvGolden asserts D3's exact argv, byte for byte.
func TestAlertArgvGolden(t *testing.T) {
	got := alertArgv("My Title", "My Body")
	want := []string{
		"-e", "on run argv",
		"-e", "activate",
		"-e", `set r to display alert (item 1 of argv) message (item 2 of argv) as critical buttons {"Copy Details", "OK"} default button "OK"`,
		"-e", "return button returned of r",
		"-e", "end run",
		"--",
		"My Title",
		"My Body",
	}
	if len(got) != len(want) {
		t.Fatalf("alertArgv length = %d, want %d\ngot:  %#v\nwant: %#v", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("alertArgv[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestAlertArgvDashPosition confirms "--" is present and immediately precedes title, body — the
// two final elements — so a body starting with "-" can never be read as an osascript flag (D4).
func TestAlertArgvDashPosition(t *testing.T) {
	got := alertArgv("t", "b")
	idx := -1
	for i, a := range got {
		if a == "--" {
			idx = i
			break
		}
	}
	if idx == -1 {
		t.Fatalf("alertArgv contains no \"--\" separator: %#v", got)
	}
	if idx != len(got)-3 {
		t.Fatalf("\"--\" at index %d, want it exactly 2 before the end (title, body follow): %#v", idx, got)
	}
	if got[idx+1] != "t" || got[idx+2] != "b" {
		t.Fatalf("title/body do not immediately follow \"--\": %#v", got)
	}
}

// TestAlertArgvHostileBody is D4's security-critical assertion: a title/body containing a double
// quote, a backslash, an embedded newline, and a leading "-" (all four in one string) appears ONLY
// as the final two argv elements — never fragmented into, or appended onto, any of the five "-e"
// statements.
func TestAlertArgvHostileBody(t *testing.T) {
	hostileTitle := "-leading-dash \"quoted\" \\backslash\nnewline"
	hostileBody := "-leading-dash \"quoted\" \\backslash\nnewline\r\nmore \"\"\"\\\\ stuff"

	got := alertArgv(hostileTitle, hostileBody)

	if len(got) == 0 || got[len(got)-1] != hostileBody {
		t.Fatalf("hostile body is not the final argv element: %#v", got)
	}
	if got[len(got)-2] != hostileTitle {
		t.Fatalf("hostile title is not the second-to-last argv element: %#v", got)
	}

	// Every element up to "--" must be one of the five fixed -e statements or the literal
	// "-e"/"--" flags — none of them may contain any fragment of the hostile strings.
	fixedPrefix := got[:len(got)-2]
	needles := []string{"leading-dash", "quoted", "backslash", "newline"}
	for i, a := range fixedPrefix {
		for _, needle := range needles {
			if strings.Contains(a, needle) {
				t.Fatalf("hostile text leaked into the fixed -e statement at index %d: %q", i, a)
			}
		}
	}

	// The hostile body/title must never appear anywhere except as the final two elements — proves
	// no "-e" statement was built by concatenating it in.
	for i := 0; i < len(got)-2; i++ {
		if got[i] == hostileBody || got[i] == hostileTitle {
			t.Fatalf("hostile text appeared at non-final index %d: %q", i, got[i])
		}
	}
}

// TestAlertArgvNoInterpolation proves the five "-e" statements are byte-identical regardless of
// what title/body are — the structural sibling of the plan's exit-criterion grep over this file
// for Sprintf/fmt.Errorf/strings.Join/string concatenation reaching an "-e" statement.
func TestAlertArgvNoInterpolation(t *testing.T) {
	a := alertArgv("AAAA", "BBBB")
	b := alertArgv("ZZZZZZZZZZZZZZZZZZZZ", "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY")
	for i := 0; i < len(a)-2; i++ {
		if a[i] != b[i] {
			t.Fatalf("statement at index %d changed with title/body length: %q vs %q", i, a[i], b[i])
		}
	}
}
