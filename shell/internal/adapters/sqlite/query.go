package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
)

// The three patterns assertSingleStatement strips from the remainder after the first top-level
// ';' — query.ts's own "whitespace, one trailing ';', and SQL comments are the only things
// tolerated there" (F9/D9), ported verbatim as regexes since the remainder, by construction, opens
// outside any string literal.
var (
	commentLine           = regexp.MustCompile(`--[^\n]*`)
	commentBlock          = regexp.MustCompile(`(?s)/\*.*?\*/`)
	whitespaceOrSemicolon = regexp.MustCompile(`[\s;]`)
)

// firstTopLevelSemicolon scans sqlText once, tracking comment/string-literal state, and returns
// the byte index of the first ';' that appears outside a comment or a quoted literal — or -1 if
// there is none. This is Go's answer to query.ts's own guard, which instead compared the full text
// against `StatementSync.sourceSQL` (the exact substring node:sqlite's own prepare() actually
// compiled) — database/sql exposes no such "how much did the driver consume" signal for any
// driver, modernc.org/sqlite included (verified against its own stmt.go: a multi-statement string
// is detected internally via SQLite's own pzTail, but that fact never crosses the driver.Stmt
// interface), so the boundary is found by parsing the SQL text directly instead.
func firstTopLevelSemicolon(s string) int {
	const (
		normal = iota
		lineComment
		blockComment
		single
		double
		backtick
	)
	state := normal
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch state {
		case normal:
			switch {
			case c == '-' && i+1 < len(s) && s[i+1] == '-':
				state = lineComment
				i++
			case c == '/' && i+1 < len(s) && s[i+1] == '*':
				state = blockComment
				i++
			case c == '\'':
				state = single
			case c == '"':
				state = double
			case c == '`':
				state = backtick
			case c == ';':
				return i
			}
		case lineComment:
			if c == '\n' {
				state = normal
			}
		case blockComment:
			if c == '*' && i+1 < len(s) && s[i+1] == '/' {
				state = normal
				i++
			}
		case single:
			if c == '\'' {
				if i+1 < len(s) && s[i+1] == '\'' {
					i++
				} else {
					state = normal
				}
			}
		case double:
			if c == '"' {
				if i+1 < len(s) && s[i+1] == '"' {
					i++
				} else {
					state = normal
				}
			}
		case backtick:
			if c == '`' {
				if i+1 < len(s) && s[i+1] == '`' {
					i++
				} else {
					state = normal
				}
			}
		}
	}
	return -1
}

// assertSingleStatement is query.ts's own guard (F9/D9, re-derived per B9/SQ-1): whitespace, one
// trailing ';', and SQL comments after the first top-level ';' are the only things tolerated;
// anything else means a smuggled second statement — the console's own contract (§8.14) is one page
// per statement, and modernc.org/sqlite executes a multi-statement string in full (SQ-1) rather
// than silently dropping the tail the way node:sqlite's prepare() did, so the enforcement has to
// happen here, before the driver ever sees the text.
func assertSingleStatement(sqlText string) error {
	idx := firstTopLevelSemicolon(sqlText)
	if idx < 0 {
		return nil
	}
	remainder := commentLine.ReplaceAllString(sqlText[idx+1:], "")
	remainder = commentBlock.ReplaceAllString(remainder, "")
	remainder = whitespaceOrSemicolon.ReplaceAllString(remainder, "")
	if remainder != "" {
		return adapters.New(adapters.CodeQuery, "multiple statements are not supported in a single statement", nil)
	}
	return nil
}

func setCommand(op *adapters.OpCtx, sqlText string, params []any, logParams bool) {
	if logParams && len(params) > 0 {
		if b, err := json.Marshal(params); err == nil {
			op.SetCommand(sqlText + " -- params: " + string(b))
			return
		}
	}
	op.SetCommand(sqlText)
}

// runRows is query.ts's runQuery generalized with a per-row scan callback, the same shape
// mysqlfamily/catalog.go's queryExec uses — catalog.go's typed pragma reads and read.go's own
// positional row reads both go through this. ctx is always the adapter-owned driverCtx
// (adapter.go's runOnConn), never the op's own context — B8's whole point.
func runRows(ctx context.Context, conn *sql.Conn, sqlText string, params []any, op *adapters.OpCtx, logParams bool, scan func(*sql.Rows) error) error {
	setCommand(op, sqlText, params, logParams)
	if err := assertSingleStatement(sqlText); err != nil {
		return err
	}
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return err
	}

	rows, err := conn.QueryContext(ctx, sqlText, params...)
	if err != nil {
		return mapError(err)
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return mapError(err)
		}
	}
	if err := rows.Err(); err != nil {
		return mapError(err)
	}
	return nil
}

// runArrayQuery is read.ts's runQuery({rowsAsArray: true}) — every row scanned positionally into
// []any, the driver's own native Go value for each cell (nil/int64/float64/string/[]byte, plus the
// one coercion the driver performs itself for a DATE/DATETIME/TIMESTAMP-declared column — see
// read.go's selectExpr and toCellText). D3's setReadBigInts has no Go analogue to opt into: an
// int64 is already exact, so there is no equivalent to node:sqlite's ERR_OUT_OF_RANGE to avoid.
func runArrayQuery(ctx context.Context, conn *sql.Conn, sqlText string, params []any, op *adapters.OpCtx, logParams bool) ([][]any, error) {
	var out [][]any
	err := runRows(ctx, conn, sqlText, params, op, logParams, func(rows *sql.Rows) error {
		cols, err := rows.Columns()
		if err != nil {
			return err
		}
		vals := make([]any, len(cols))
		dest := make([]any, len(cols))
		for i := range vals {
			dest[i] = &vals[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return err
		}
		out = append(out, vals)
		return nil
	})
	return out, err
}

// runCommand is mutate.ts's runQuery-for-writes counterpart — INSERT/UPDATE/DELETE, never SELECT.
// suppressCommand mirrors mutate.ts's own "setCommand() was already called once for the whole
// batch" rule (P5 D9's precedent).
func runCommand(ctx context.Context, conn *sql.Conn, sqlText string, params []any, op *adapters.OpCtx, suppressCommand bool) (int64, error) {
	if !suppressCommand {
		op.SetCommand(sqlText)
	}
	if err := assertSingleStatement(sqlText); err != nil {
		return 0, err
	}
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return 0, err
	}

	result, err := conn.ExecContext(ctx, sqlText, params...)
	if err != nil {
		return 0, mapError(err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return 0, mapError(err)
	}
	return n, nil
}

// execLiteral is mutate.ts's execLiteral — BEGIN IMMEDIATE/COMMIT/ROLLBACK, fixed adapter-internal
// literals never seen by a user, so they bypass assertSingleStatement (nothing to guard against
// here) and go straight through ExecContext.
func execLiteral(ctx context.Context, conn *sql.Conn, sqlText string) error {
	if _, err := conn.ExecContext(ctx, sqlText); err != nil {
		return mapError(err)
	}
	return nil
}
