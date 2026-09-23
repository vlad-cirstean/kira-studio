package redis

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

// isHexDigit/hexDigitVal back tokenize's own \xHH escape (F12) — redis-cli's sdssplitargs accepts
// either case.
func isHexDigit(r rune) bool {
	return (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
}

func hexDigitVal(r rune) int {
	switch {
	case r >= '0' && r <= '9':
		return int(r - '0')
	case r >= 'a' && r <= 'f':
		return int(r-'a') + 10
	default:
		return int(r-'A') + 10
	}
}

// redisDoubleQuoteEscapes is redis-cli's own sdssplitargs table for a `\X` sequence inside a
// double-quoted console token (F12) — anything not listed here (including `\"` and `\\`) falls
// through to the escaped character itself, matching sdssplitargs's own `default: c = *p`.
var redisDoubleQuoteEscapes = map[rune]rune{
	'n': '\n',
	'r': '\r',
	't': '\t',
	'b': '\b',
	'a': '\a',
}

// scanQuotedToken consumes one quoted token starting at runes[i] (runes[i] is the opening quote),
// applying F12's own escaping rules, and returns the decoded token text plus the index just past
// the closing quote. Split out of tokenize to keep gocognit happy — the quoting rules themselves
// are exactly redis-cli's own sdssplitargs: double quotes recognize \n/\r/\t/\b/\a, \xHH, and any
// other `\X` as a literal X; single quotes recognize only `\'`, everything else literal (including a
// bare `\`); and a closing quote must be followed by whitespace or end of input, never trailing
// content glued onto the same token.
func scanQuotedToken(runes []rune, i int) (string, int, error) {
	n := len(runes)
	quote := runes[i]
	i++
	var out strings.Builder
	for i < n && runes[i] != quote {
		if quote == '"' && runes[i] == '\\' && i+1 < n {
			if runes[i+1] == 'x' && i+3 < n && isHexDigit(runes[i+2]) && isHexDigit(runes[i+3]) {
				out.WriteByte(byte(hexDigitVal(runes[i+2])*16 + hexDigitVal(runes[i+3])))
				i += 4
				continue
			}
			esc := runes[i+1]
			if r, ok := redisDoubleQuoteEscapes[esc]; ok {
				out.WriteRune(r)
			} else {
				out.WriteRune(esc)
			}
			i += 2
			continue
		}
		if quote == '\'' && runes[i] == '\\' && i+1 < n && runes[i+1] == '\'' {
			out.WriteRune('\'')
			i += 2
			continue
		}
		out.WriteRune(runes[i])
		i++
	}
	if i >= n {
		return "", i, adapters.New(adapters.CodeQuery, "unterminated quoted string", nil)
	}
	i++ // closing quote
	if i < n && !unicode.IsSpace(runes[i]) {
		return "", i, adapters.New(adapters.CodeQuery,
			"a closing quote must be followed by a space or the end of the line", nil)
	}
	return out.String(), i, nil
}

// scanBareToken consumes one unquoted, whitespace-delimited token starting at runes[i].
func scanBareToken(runes []rune, i int) (string, int) {
	n := len(runes)
	var out strings.Builder
	for i < n && !unicode.IsSpace(runes[i]) {
		out.WriteRune(runes[i])
		i++
	}
	return out.String(), i
}

// §8.14: "for non-SQL engines the console takes that engine's native command form" — real Redis
// CLI syntax is flat whitespace-separated tokens with optional single/double quoting, not a JSON
// DSL like Mongo's shell (P9's D11, C12).
func tokenize(line string) ([]string, error) {
	runes := []rune(line)
	n := len(runes)
	var tokens []string
	i := 0
	for i < n {
		for i < n && unicode.IsSpace(runes[i]) {
			i++
		}
		if i >= n {
			break
		}
		var (
			token string
			err   error
		)
		if runes[i] == '"' || runes[i] == '\'' {
			token, i, err = scanQuotedToken(runes, i)
			if err != nil {
				return nil, err
			}
		} else {
			token, i = scanBareToken(runes, i)
		}
		tokens = append(tokens, token)
	}
	return tokens, nil
}

func formatReplyItem(value any) string {
	if value == nil {
		return "(nil)"
	}
	switch v := value.(type) {
	case string:
		return v
	case int64:
		return strconv.FormatInt(v, 10)
	case float64:
		return strconv.FormatFloat(v, 'g', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(b)
	}
}

// hashReadCommands is resultToPage's own limited command-aware set (finding #3, M7): these three
// reads carry a genuine per-value field name — HGET/HMGET's from the command's own arguments (the
// caller-supplied field names), HGETALL's from the reply itself (server-returned field/value
// pairs) — so their page is built with FieldsAreColumns=true and a real Field, letting a mask rule
// on that hash's field name actually match. Every other command keeps the generic formatting below
// with FieldsAreColumns=false: an array index or a bare command name is never a genuine field
// identifier a rule could legitimately match, so dbmcp's renderKeyValuePage refuses to mask such a
// page rather than silently pass a real value through under a Field nothing could ever match.
var hashReadCommands = map[string]bool{"HGET": true, "HMGET": true, "HGETALL": true}

// resultToPage is console.ts's own: any RESP reply is formatted generically (P9's D11) — no
// per-command result shape, unlike Mongo's console — except for hashReadCommands above. A scalar's
// field name is the upper-cased command; an array's are the indices.
func resultToPage(command string, args []string, reply any) page.KeyValuePage {
	upper := strings.ToUpper(command)
	if hashReadCommands[upper] {
		if pg, ok := hashReadPage(upper, args, reply); ok {
			return pg
		}
		// Reply didn't match the shape this command is supposed to return (a protocol surprise, or
		// a mock in a test) — fall through to the generic, columnless rendering below rather than
		// guess at a Field that might be wrong.
	}
	builder := page.NewKeyValuePageBuilder("string", nil, nil, false)
	builder.SetFieldsAreColumns(false)
	pageSize := 1
	if arr, ok := reply.([]any); ok {
		for i, item := range arr {
			builder.Push(strconv.Itoa(i), formatReplyItem(item))
		}
		pageSize = len(arr)
	} else {
		builder.Push(strings.ToUpper(command), formatReplyItem(reply))
	}
	return builder.Finish(page.UnpagedPosition(pageSize))
}

// hashReadPage builds hashReadCommands' own real-field-name page, ok=false when reply isn't the
// shape that command is documented to return.
func hashReadPage(upper string, args []string, reply any) (page.KeyValuePage, bool) {
	switch upper {
	case "HGET":
		if len(args) == 0 {
			return page.KeyValuePage{}, false
		}
		builder := page.NewKeyValuePageBuilder("hash", nil, nil, true)
		builder.Push(args[0], formatReplyItem(reply))
		return builder.Finish(page.UnpagedPosition(1)), true
	case "HMGET":
		arr, ok := reply.([]any)
		if !ok {
			return page.KeyValuePage{}, false
		}
		builder := page.NewKeyValuePageBuilder("hash", nil, nil, false)
		for i, item := range arr {
			field := strconv.Itoa(i)
			if i < len(args) {
				field = args[i]
			}
			builder.Push(field, formatReplyItem(item))
		}
		return builder.Finish(page.UnpagedPosition(len(arr))), true
	case "HGETALL":
		builder := page.NewKeyValuePageBuilder("hash", nil, nil, false)
		switch v := reply.(type) {
		case []any: // RESP2: a flat field, value, field, value, ... array
			if len(v)%2 != 0 {
				return page.KeyValuePage{}, false
			}
			for i := 0; i+1 < len(v); i += 2 {
				builder.Push(formatReplyItem(v[i]), formatReplyItem(v[i+1]))
			}
			return builder.Finish(page.UnpagedPosition(len(v) / 2)), true
		case map[string]any: // RESP3: a real map reply
			keys := make([]string, 0, len(v))
			for k := range v {
				keys = append(keys, k)
			}
			sort.Strings(keys) // deterministic order — the wire map has none
			for _, k := range keys {
				builder.Push(k, formatReplyItem(v[k]))
			}
			return builder.Finish(page.UnpagedPosition(len(v))), true
		default:
			return page.KeyValuePage{}, false
		}
	default:
		return page.KeyValuePage{}, false
	}
}

// ClassifyStatement satisfies adapters.StatementClassifier (M2) over this package's own
// tokenize/isReadOnlyCommand — Redis has no DDL, and one run_query call is one command (tokenize
// treats a newline as ordinary whitespace, so extra lines become arguments, never a second
// command). The COMMAND table is server-wide, so the db index does not matter for classification.
func (a *Adapter) ClassifyStatement(ctx context.Context, statement string) (adapters.OpClass, error) {
	set, err := a.requireSet()
	if err != nil {
		return adapters.ClassUnknown, err
	}
	tokens, err := tokenize(statement)
	if err != nil {
		return adapters.ClassUnknown, err
	}
	if len(tokens) == 0 {
		return adapters.ClassUnknown, nil
	}
	conn, err := set.get(ctx, a.defaultDbIndex)
	if err != nil {
		return adapters.ClassUnknown, err
	}
	if set.isReadOnlyCommand(ctx, conn, tokens[0]) {
		return adapters.ClassRead, nil
	}
	return adapters.ClassWrite, nil
}

// deniedConsoleCommands is F1's denylist: every command go-redis's pooled *redis.Client cannot
// safely run through a raw conn.Do — go-redis does not track connection/session state a raw command
// changes, so any of these, issued on the shared per-db-index pooled connection, would silently
// corrupt every later grid/tree/mutate/console call sharing it. SELECT repoints the connection at a
// different db index; MULTI/EXEC/DISCARD/WATCH/UNWATCH leave a transaction half-open or make later
// commands reply QUEUED; SUBSCRIBE and its siblings leave the connection stuck in push mode;
// MONITOR never stops streaming; HELLO/AUTH/RESET change the negotiated protocol or effective user;
// QUIT closes the connection out from under the pool.
var deniedConsoleCommands = map[string]bool{
	"SELECT":       true,
	"MULTI":        true,
	"EXEC":         true,
	"DISCARD":      true,
	"WATCH":        true,
	"UNWATCH":      true,
	"SUBSCRIBE":    true,
	"PSUBSCRIBE":   true,
	"SSUBSCRIBE":   true,
	"UNSUBSCRIBE":  true,
	"PUNSUBSCRIBE": true,
	"SUNSUBSCRIBE": true,
	"MONITOR":      true,
	"HELLO":        true,
	"AUTH":         true,
	"RESET":        true,
	"QUIT":         true,
}

// rejectConnectionStateCommand is F1's guard, checked before every console command reaches
// conn.Do. CLIENT REPLY OFF/SKIP desyncs the reply stream for every later command on this same
// pooled connection the exact same way the commands in deniedConsoleCommands do — matched as the
// two-token command CLIENT REPLY specifically, so an ordinary CLIENT subcommand (GETNAME, INFO,
// LIST, and friends) stays usable.
func rejectConnectionStateCommand(command string, args []string) error {
	upper := strings.ToUpper(command)
	if upper == "CLIENT" && len(args) > 0 && strings.EqualFold(args[0], "REPLY") {
		return adapters.New(adapters.CodeUnsupported,
			"CLIENT REPLY changes this connection's reply mode for every later command sharing it; not supported in the console", nil)
	}
	if !deniedConsoleCommands[upper] {
		return nil
	}
	if upper == "SELECT" {
		return adapters.New(adapters.CodeUnsupported,
			"SELECT is not supported in the console; use the app's own database selector instead", nil)
	}
	return adapters.New(adapters.CodeUnsupported,
		upper+" changes state shared by every later command on this connection; not supported in the console", nil)
}

// consoleCommand is one already-parsed, already-validated console line (F11): execute below parses
// and validates every statement in the batch before running any of them.
type consoleCommand struct {
	line    string
	command string
	args    []string
}

// execute is console.ts's execute — one op-log row for the whole batch (P5.5 D9's precedent).
// A read-only connection is gated per-command via Redis's own COMMAND table (isReadOnlyCommand),
// not a blanket refusal — SPEC.md's read-only contract disables "anything but a read", and a flat
// console-execution ban would take reads away too.
//
// F11: every statement is tokenized, denylist-checked, and read-only-checked up front — before any
// of them runs against the connection. The previous shape parsed statement N only after 1..N-1 had
// already executed, so a typo further down a batch discarded the already-committed earlier writes
// with no rollback path; re-running after fixing the typo then double-applied them.
func execute(ctx context.Context, set *dbConnectionSet, dbIndex int, readOnly bool, op *adapters.OpCtx, statements []string) ([]page.Page, error) {
	var lines []string
	for _, s := range statements {
		if trimmed := strings.TrimSpace(s); trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	if len(lines) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}
	op.SetCommand(strings.Join(lines, "\n"))

	conn, err := set.get(ctx, dbIndex)
	if err != nil {
		return nil, err
	}

	commands := make([]consoleCommand, 0, len(lines))
	for _, line := range lines {
		tokens, err := tokenize(line)
		if err != nil {
			return nil, err
		}
		if len(tokens) == 0 {
			continue
		}
		command, args := tokens[0], tokens[1:]
		if err := rejectConnectionStateCommand(command, args); err != nil {
			return nil, err
		}
		if readOnly && !set.isReadOnlyCommand(ctx, conn, command) {
			return nil, adapters.AssertWritable(true)
		}
		commands = append(commands, consoleCommand{line: line, command: command, args: args})
	}
	if len(commands) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}

	pages := make([]page.Page, 0, len(commands))
	for _, c := range commands {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return nil, err
		}
		argv := make([]any, 0, len(c.args)+1)
		argv = append(argv, c.command)
		for _, a := range c.args {
			argv = append(argv, a)
		}
		reply, err := conn.Do(ctx, argv...).Result()
		if err != nil {
			return nil, mapError(err)
		}
		pages = append(pages, resultToPage(c.command, c.args, reply))
	}
	return pages, nil
}
