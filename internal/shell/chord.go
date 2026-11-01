package shell

import (
	"fmt"
	"strings"
)

const chordPunctuation = ",./;'[]-=`"

// ParseChord parses a Wails accelerator string into its canonical Chord. Wails' own
// parseAccelerator is unexported, so settings validation needs this; Wails re-parses at register.
// A chord needs CmdOrCtrl, Ctrl or Alt: Shift alone would grab plain typing.
func ParseChord(s string) (Chord, error) {
	parts := strings.Split(strings.TrimSpace(s), "+")
	var c Chord
	for _, p := range parts[:len(parts)-1] {
		switch strings.ToLower(strings.TrimSpace(p)) {
		case "cmdorctrl":
			c.CmdOrCtrl = true
		case "ctrl":
			c.Ctrl = true
		case "alt":
			c.Alt = true
		case "shift":
			c.Shift = true
		default:
			return Chord{}, fmt.Errorf("invalid modifier %q", p)
		}
	}
	key, ok := canonicalKey(strings.TrimSpace(parts[len(parts)-1]))
	if !ok {
		return Chord{}, fmt.Errorf("invalid key %q", parts[len(parts)-1])
	}
	c.Key = key
	if !c.CmdOrCtrl && !c.Ctrl && !c.Alt {
		return Chord{}, fmt.Errorf("chord needs CmdOrCtrl, Ctrl or Alt")
	}
	return c, nil
}

func canonicalKey(k string) (string, bool) {
	switch {
	case strings.EqualFold(k, "space"):
		return "Space", true
	case len(k) == 1 && (k[0] >= 'a' && k[0] <= 'z' || k[0] >= 'A' && k[0] <= 'Z'):
		return strings.ToUpper(k), true
	case len(k) == 1 && (k[0] >= '0' && k[0] <= '9' || strings.ContainsRune(chordPunctuation, rune(k[0]))):
		return k, true
	case (len(k) == 2 || len(k) == 3) && (k[0] == 'F' || k[0] == 'f'):
		var n int
		if _, err := fmt.Sscanf(k[1:], "%d", &n); err == nil && n >= 1 && n <= 12 && fmt.Sprint(n) == k[1:] {
			return fmt.Sprintf("F%d", n), true
		}
	}
	return "", false
}

// ConflictsWithMenu reports whether c equals any app menu accelerator in Shortcuts.
func (c Chord) ConflictsWithMenu() bool {
	for _, m := range Shortcuts {
		if m == c {
			return true
		}
	}
	return false
}
