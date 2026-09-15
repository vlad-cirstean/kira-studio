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

// §8.14: "for non-SQL engines the console takes that engine's native command form" — real Redis
// CLI syntax is flat whitespace-separated tokens with optional single/double quoting (backslash
// escapes inside quotes), not a JSON DSL like Mongo's shell (P9's D11, C12).
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
		quote := runes[i]
		if quote == '"' || quote == '\'' {
			i++
			var out strings.Builder
			for i < n && runes[i] != quote {
				if runes[i] == '\\' && i+1 < n {
					out.WriteRune(runes[i+1])
					i += 2
				} else {
					out.WriteRune(runes[i])
					i++
				}
			}
			if i >= n {
				return nil, adapters.New(adapters.CodeQuery, "unterminated quoted string", nil)
			}
			i++ // closing quote
			tokens = append(tokens, out.String())
		} else {
			var out strings.Builder
			for i < n && !unicode.IsSpace(runes[i]) {
				out.WriteRune(runes[i])
				i++
			}
			tokens = append(tokens, out.String())
		}
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

// execute is console.ts's execute — one op-log row for the whole batch (P5.5 D9's precedent).
// A read-only connection is gated per-command via Redis's own COMMAND table (isReadOnlyCommand),
// not a blanket refusal — SPEC.md's read-only contract disables "anything but a read", and a flat
// console-execution ban would take reads away too.
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

	var pages []page.Page
	for _, line := range lines {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return nil, err
		}
		tokens, err := tokenize(line)
		if err != nil {
			return nil, err
		}
		if len(tokens) == 0 {
			continue
		}
		command, args := tokens[0], tokens[1:]
		if readOnly && !set.isReadOnlyCommand(ctx, conn, command) {
			return nil, adapters.AssertWritable(true)
		}
		argv := make([]any, 0, len(args)+1)
		argv = append(argv, command)
		for _, a := range args {
			argv = append(argv, a)
		}
		reply, err := conn.Do(ctx, argv...).Result()
		if err != nil {
			return nil, mapError(err)
		}
		pages = append(pages, resultToPage(command, args, reply))
	}
	if len(pages) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}
	return pages, nil
}
