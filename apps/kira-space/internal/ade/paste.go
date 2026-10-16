package ade

import "strings"

// Bracketed paste (§4.5): a terminal in bracketed-paste mode treats everything between these two
// sequences as pasted text rather than typed keystrokes — the TUI's own line-editing never
// interprets a newline inside the message as "submit".
const (
	bracketedPasteStart = "\x1b[200~"
	bracketedPasteEnd   = "\x1b[201~"
)

// normalizeMessage prepares message text for either the initial CLI prompt or a forwarded paste:
// CRLF and bare CR become LF (a message typed on Windows or pasted from one source must not leave
// a stray \r inside the pty write), and any embedded end-of-paste sequence is stripped so pasted
// text can never terminate its own bracketed-paste block early.
func normalizeMessage(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.ReplaceAll(s, bracketedPasteEnd, "")
	return s
}

// pasteBytes renders message as a bracketed-paste write followed by the Enter that submits it —
// two separate byte slices (§4.5) so Tracker.Send can write them as two separate WriteTerminal
// calls: whether Claude Code's TUI needs a pause between paste-end and Enter is unverified (P129
// Part 1 §8), and keeping them apart lets a delay be added later without restructuring the call.
func pasteBytes(message string) (paste []byte, enter []byte) {
	normalized := normalizeMessage(message)
	paste = []byte(bracketedPasteStart + normalized + bracketedPasteEnd)
	enter = []byte("\r")
	return paste, enter
}
