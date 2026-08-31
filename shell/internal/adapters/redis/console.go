package redis

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"unicode"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
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

// resultToPage is console.ts's own: any RESP reply is formatted generically (P9's D11) — no
// per-command result shape, unlike Mongo's console. A scalar's field name is the upper-cased
// command; an array's are the indices.
func resultToPage(command string, reply any) page.KeyValuePage {
	builder := page.NewKeyValuePageBuilder("string", nil, nil, false)
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

// execute is console.ts's execute — one op-log row for the whole batch (P5.5 D9's precedent).
func execute(ctx context.Context, set *dbConnectionSet, dbIndex int, op *adapters.OpCtx, statements []string) ([]page.Page, error) {
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
		argv := make([]any, 0, len(args)+1)
		argv = append(argv, command)
		for _, a := range args {
			argv = append(argv, a)
		}
		reply, err := conn.Do(ctx, argv...).Result()
		if err != nil {
			return nil, mapError(err)
		}
		pages = append(pages, resultToPage(command, reply))
	}
	if len(pages) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}
	return pages, nil
}
