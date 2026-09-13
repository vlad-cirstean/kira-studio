package clickhouse

import (
	"context"
	"regexp"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

// leadingCommentRE/rowReturningRE are console.ts's own — D19: the HTTP interface gives no cheap
// "will this return rows" check before executing (unlike SQLite's own zero-column QueryContext
// signal or MariaDB's OkPacket-vs-rows shape) — a leading-keyword heuristic decides a streamed
// query vs a command, skipping past leading comments first. This matters beyond cosmetics:
// appending FORMAT to a non-SELECT statement would be wrong for an INSERT, whose own FORMAT names
// the *input* data's format.
var (
	leadingCommentRE = regexp.MustCompile(`(?s)^\s*(?:--[^\n]*\n|/\*.*?\*/\s*)*`)
	rowReturningRE   = regexp.MustCompile(`(?i)^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN|EXISTS)\b`)
)

func isRowReturning(sql string) bool {
	stripped := leadingCommentRE.ReplaceAllString(sql, "")
	return rowReturningRE.MatchString(stripped)
}

func runRowReturning(ctx context.Context, h *Handle, queryID string, op *adapters.OpCtx, track TrackQuery, sql string) (page.TabularPage, error) {
	var columns []page.ColumnDescriptor
	var builder *page.TabularPageBuilder
	rowCount := 0
	err := StreamQuery(ctx, h, queryID, sql, op, track, func(names, types []string) {
		// §8.14's console never consults the catalog — nullability/PK-ness are unknowable here;
		// console results are always read-only regardless (mirrors mysql-family/console.go).
		columns = make([]page.ColumnDescriptor, len(names))
		for i, name := range names {
			t := "String"
			if i < len(types) {
				t = types[i]
			}
			columns[i] = page.ColumnDescriptor{Name: name, DataType: t, TypeClass: typeClassFor(t), Nullable: true}
		}
		builder = page.NewTabularPageBuilder(columns)
	}, func(values []*string) {
		if builder != nil {
			_ = builder.AppendRow(values)
			rowCount++
		}
	})
	if err != nil {
		return page.TabularPage{}, err
	}
	if builder == nil {
		builder = page.NewTabularPageBuilder(columns)
	}
	return builder.Finish(page.UnpagedPosition(rowCount)), nil
}

// execute is console.ts's own execute.
func execute(ctx context.Context, h *Handle, op *adapters.OpCtx, track TrackQuery, statements []string, nextQueryID func() string) ([]page.Page, error) {
	if len(statements) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}
	// One op-log row for the whole batch (P5 D9's precedent) — StreamQuery/RunCommand deliberately
	// never call op.SetCommand() themselves so this one call is authoritative.
	op.SetCommand(joinSemicolons(statements))

	pages := make([]page.Page, len(statements))
	for i, sql := range statements {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return nil, err
		}
		if isRowReturning(sql) {
			p, err := runRowReturning(ctx, h, nextQueryID(), op, track, sql)
			if err != nil {
				return nil, err
			}
			pages[i] = p
		} else {
			written, err := RunCommand(ctx, h, nextQueryID(), sql, op, track)
			if err != nil {
				return nil, err
			}
			pages[i] = adapters.SingleStatusPage(itoaPositive(int(written))+" row(s) written", "String")
		}
	}
	return pages, nil
}

func joinSemicolons(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ";\n"
		}
		out += p
	}
	return out
}
