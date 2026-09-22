package startupfail

import (
	"fmt"
	"strings"
)

// RenderAlert composes the alert's title and body from a Message (D5). The title (item 1 of argv,
// D3) is always the Headline, unmodified. The body is, in order: Advice, a blank line,
// "Details: <Detail>", a blank line, then a two-line footer naming this build's version and log
// folder — so a user staring at the alert with no other context knows both "what version am I
// running" and "where would a log record of this be, if one exists".
//
// Pure: no I/O beyond reading info.Version and info.LogsDir(), both plain, non-fallible reads
// (F11) — safe to call from any of the nine boot-failure sites, including the two that run before
// EnsureLayout has ever succeeded.
func RenderAlert(msg Message, info Info) (title, body string) {
	var b strings.Builder
	b.WriteString(msg.Advice)
	b.WriteString("\n\nDetails: ")
	b.WriteString(msg.Detail)
	b.WriteString("\n\n")
	b.WriteString(info.AppName)
	b.WriteString(" ")
	b.WriteString(info.Version)
	b.WriteString("\nLog folder: ")
	b.WriteString(info.logsDir())
	return msg.Headline, b.String()
}

// RenderClipboard is the *Copy Details* payload (D10) — a superset of what the alert itself could
// show, since the alert's Detail is capped and the clipboard's is not. It carries the step
// identifier, this build's version, the log folder, the database path, and the full, uncapped
// error text (fullErr, not msg.Detail) — everything a bug report would need that the alert had to
// abbreviate or omit entirely.
func RenderClipboard(msg Message, info Info, fullErr error) string {
	errText := ""
	if fullErr != nil {
		errText = fullErr.Error()
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s %s\n", info.AppName, info.Version)
	fmt.Fprintf(&b, "Step: %s\n", msg.Step)
	fmt.Fprintf(&b, "Log folder: %s\n", info.logsDir())
	fmt.Fprintf(&b, "Database: %s\n", info.dbPath())
	b.WriteString("\n")
	b.WriteString(msg.Headline)
	b.WriteString("\n")
	b.WriteString(msg.Advice)
	b.WriteString("\n\nFull error:\n")
	b.WriteString(errText)
	return b.String()
}
