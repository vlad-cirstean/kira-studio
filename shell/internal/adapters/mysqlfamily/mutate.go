package mysqlfamily

import (
	"context"
	"database/sql"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

var paramRenderer = adapters.NewParamRenderer(questionPlaceholder)

// literalRenderer adapts sql-mutate.go's LiteralRenderer to the adapters.ValueRenderer shape
// RenderRowOp expects — preview() never touches params, so this closure just ignores it.
func literalRenderer(value *string, _ *[]any) string { return adapters.LiteralRenderer(value) }

// preview is mutate.ts's preview — synchronous (D6): no catalog lookup, no network.
func preview(plan model.MutationPlan) ([]string, error) {
	database, table, err := adapters.ResolveDatabaseTablePath(plan.Path)
	if err != nil {
		return nil, err
	}
	relationSQL := quoteIdent(database) + "." + quoteIdent(table)
	ordered := adapters.OrderedOps(plan.Ops)
	statements := make([]string, len(ordered))
	for i, op := range ordered {
		var params []any
		statements[i] = adapters.RenderRowOp(relationSQL, op, literalRenderer, &params, quoteIdent)
	}
	return statements, nil
}

// mutate is mutate.ts's mutate.
func mutate(ctx context.Context, conn *sql.Conn, threadID uint32, op *adapters.OpCtx, track TrackQuery, readOnly bool, plan model.MutationPlan) (model.MutationResult, error) {
	if err := adapters.AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}

	database, table, err := adapters.ResolveDatabaseTablePath(plan.Path)
	if err != nil {
		return model.MutationResult{}, err
	}
	relationSQL := quoteIdent(database) + "." + quoteIdent(table)

	exec := execFor(conn, threadID, op, track)
	target, err := getReadTarget(ctx, exec, database, table)
	if err != nil {
		return model.MutationResult{}, err
	}

	qualifiedName := target.QualifiedName.Database + "." + target.QualifiedName.Table
	for _, rowOp := range plan.Ops {
		switch rowOp.Kind {
		case "update":
			if err := adapters.AssertColumnsKnown(target.Columns, append(rowOp.Key.Names(), rowOp.Changes.Names()...)); err != nil {
				return model.MutationResult{}, err
			}
			if err := adapters.AssertKeyIsPrimaryKey(target.PrimaryKey, rowOp.Key, qualifiedName); err != nil {
				return model.MutationResult{}, err
			}
		case "delete":
			if err := adapters.AssertColumnsKnown(target.Columns, rowOp.Key.Names()); err != nil {
				return model.MutationResult{}, err
			}
			if err := adapters.AssertKeyIsPrimaryKey(target.PrimaryKey, rowOp.Key, qualifiedName); err != nil {
				return model.MutationResult{}, err
			}
		default: // "insert"
			if err := adapters.AssertColumnsKnown(target.Columns, rowOp.Values.Names()); err != nil {
				return model.MutationResult{}, err
			}
		}
	}

	ordered := adapters.OrderedOps(plan.Ops)
	type compiledOp struct {
		sql    string
		params []any
		kind   string
	}
	compiled := make([]compiledOp, len(ordered))
	previewParts := make([]string, len(ordered))
	for i, rowOp := range ordered {
		var params []any
		sql := adapters.RenderRowOp(relationSQL, rowOp, paramRenderer, &params, quoteIdent)
		compiled[i] = compiledOp{sql: sql, params: params, kind: rowOp.Kind}
		var literalParams []any
		previewParts[i] = adapters.RenderRowOp(relationSQL, rowOp, literalRenderer, &literalParams, quoteIdent)
	}
	// One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5 D9).
	op.SetCommand(joinSemicolons(previewParts))

	execCommand := func(sql string, params []any) (int64, error) {
		return runCommand(ctx, conn, threadID, sql, params, op, track, CommandOptions{SuppressCommand: true})
	}

	if _, err := execCommand("START TRANSACTION", nil); err != nil {
		return model.MutationResult{}, err
	}
	var affectedRows int64
	for _, c := range compiled {
		rowCount, err := execCommand(c.sql, c.params)
		if err != nil {
			_, _ = execCommand("ROLLBACK", nil)
			return model.MutationResult{}, err
		}
		if err := adapters.AssertAffectedExactlyOne(c.kind, rowCount); err != nil {
			_, _ = execCommand("ROLLBACK", nil)
			return model.MutationResult{}, err
		}
		affectedRows += rowCount
	}
	if _, err := execCommand("COMMIT", nil); err != nil {
		_, _ = execCommand("ROLLBACK", nil)
		return model.MutationResult{}, err
	}
	return model.MutationResult{AffectedRows: int(affectedRows)}, nil
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
