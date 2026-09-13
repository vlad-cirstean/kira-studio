package startupfail

import (
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
)

// RenderAlert composes the alert's title and body from a Message (D5). The title (item 1 of argv,
// D3) is always the Headline, unmodified. The body is, in order: Advice, a blank line,
// "Details: <Detail>", a blank line, then a two-line footer naming this build's version and log
// folder — so a user staring at the alert with no other context knows both "what version am I
// running" and "where would a log record of this be, if one exists".
//
// Pure: no I/O beyond reading buildinfo.Version and config.LogsDir(), both of which are plain,
// non-fallible reads (F11) — safe to call from any of the nine boot-failure sites, including the
// two that run before config.EnsureLayout has ever succeeded.
func RenderAlert(msg Message) (title, body string) {
	var b strings.Builder
	b.WriteString(msg.Advice)
	b.WriteString("\n\nDetails: ")
	b.WriteString(msg.Detail)
	b.WriteString("\n\nKira Studio ")
	b.WriteString(buildinfo.Version)
	b.WriteString("\nLog folder: ")
	b.WriteString(config.LogsDir())
	return msg.Headline, b.String()
}

// RenderClipboard is the *Copy Details* payload (D10) — a superset of what the alert itself could
// show, since the alert's Detail is capped and the clipboard's is not. It carries the step
// identifier, this build's version, the log folder, the database path, and the full, uncapped
// error text (fullErr, not msg.Detail) — everything a bug report would need that the alert had to
// abbreviate or omit entirely.
func RenderClipboard(msg Message, fullErr error) string {
	errText := ""
	if fullErr != nil {
		errText = fullErr.Error()
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Kira Studio %s\n", buildinfo.Version)
	fmt.Fprintf(&b, "Step: %s\n", msg.Step)
	fmt.Fprintf(&b, "Log folder: %s\n", config.LogsDir())
	fmt.Fprintf(&b, "Database: %s\n", config.DbPath())
	b.WriteString("\n")
	b.WriteString(msg.Headline)
	b.WriteString("\n")
	b.WriteString(msg.Advice)
	b.WriteString("\n\nFull error:\n")
	b.WriteString(errText)
	return b.String()
}
