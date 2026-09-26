package agenthooks

import (
	"encoding/json"
	"fmt"
	"strings"
)

// hookEvents is every event name §2.4 wires to the same shim, no matcher on any of them (match
// everything) — hook_event_name inside the payload is what tells the listener which event fired,
// so one identical command entry per event is enough. Read from the installed CLI's own schema,
// not assumed.
var hookEvents = []string{
	"SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "Notification", "Stop",
}

// hookCommandTimeoutSeconds is the "timeout" field's own unit (seconds, not milliseconds) in the
// settings schema the installed CLI reads — §2.4's own five-second figure, generous for a shim
// that itself carries a two-second curl --max-time.
const hookCommandTimeoutSeconds = 5

// hookCommand mirrors the installed CLI's own {type: "command", command: string, timeout?:
// number} shape (§2.4) — this repo's own .claude/settings.json already carries this exact shape
// for its PostCompact hook.
type hookCommand struct {
	Type    string `json:"type"`
	Command string `json:"command"`
	Timeout int    `json:"timeout"`
}

// hookMatcherEntry mirrors the installed CLI's own {matcher?: string, hooks: [...]} shape — no
// matcher field at all here, since every entry below matches everything (§2.4).
type hookMatcherEntry struct {
	Hooks []hookCommand `json:"hooks"`
}

// hooksDocument is hooks.json's own top-level shape — the settings hook map is
// partialRecord(enum(events), array(hookMatcherEntry)), read from the installed CLI's own schema.
type hooksDocument struct {
	Hooks map[string][]hookMatcherEntry `json:"hooks"`
}

// buildHooksDocument renders hooks.json (§2.4): one identical command hook — quotedShimCommand,
// already wrapped in single quotes by ShellSingleQuote — for every event in hookEvents. Generated
// with encoding/json over a Go struct, never hand-assembled JSON text.
func buildHooksDocument(quotedShimCommand string) ([]byte, error) {
	doc := hooksDocument{Hooks: make(map[string][]hookMatcherEntry, len(hookEvents))}
	for _, event := range hookEvents {
		doc.Hooks[event] = []hookMatcherEntry{{
			Hooks: []hookCommand{{Type: "command", Command: quotedShimCommand, Timeout: hookCommandTimeoutSeconds}},
		}}
	}
	encoded, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("agenthooks: encode hooks.json: %w", err)
	}
	return encoded, nil
}

// ShellSingleQuote wraps s in single quotes for a POSIX shell argument — the command value
// hooks.json stores (Claude Code runs it through a shell) and the `--settings` flag's own value
// (internal/bridge/terminal.go's `$SHELL -l -i -c` composition). Refuses — a hard error, not a
// best-effort escape — a string containing a single quote or a newline: an unquotable argv
// element. A mkdtemp-derived path never contains either; the check exists so a future change here
// cannot silently produce a broken command.
func ShellSingleQuote(s string) (string, error) {
	if strings.ContainsAny(s, "'\n") {
		return "", fmt.Errorf("agenthooks: path cannot be safely single-quoted: %q", s)
	}
	return "'" + s + "'", nil
}
