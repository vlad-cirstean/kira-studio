package sqlite

import (
	"context"
	"database/sql"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

var paramRenderer = adapters.NewParamRenderer(questionPlaceholder)

// literalRenderer adapts sqlmutate.go's LiteralRenderer to the adapters.ValueRenderer shape
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

// mutate is mutate.ts's own — D25: BEGIN IMMEDIATE, not a deferred BEGIN, so a contended file fails
// before a single row has changed rather than mid-batch. Issued on the op's own dedicated
// *sql.Conn (the one runOnConn already obtained), which is what makes the transaction real.
func mutate(ctx context.Context, conn *sql.Conn, op *adapters.OpCtx, readOnly bool, plan model.MutationPlan) (model.MutationResult, error) {
	if err := adapters.AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}

	database, table, err := adapters.ResolveDatabaseTablePath(plan.Path)
	if err != nil {
		return model.MutationResult{}, err
	}
	relationSQL := quoteIdent(database) + "." + quoteIdent(table)

	// Fresh in this same op — never trusts a column name the renderer sent without re-checking it
	// against the catalog right now (same discipline resolveProjection uses on the read path).
	exec := execFor(ctx, conn, op)
	target, err := getReadTarget(exec, database, table)
	if err != nil {
		return model.MutationResult{}, err
	}

	qualifiedName := target.QualifiedName.Database + "." + target.QualifiedName.Table
	// D23: the table's own rowid, even when it exists and is used internally for keyset paging, is
	// never an acceptable key here — it is not a column the renderer ever shows.
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
		sqlText := adapters.RenderRowOp(relationSQL, rowOp, paramRenderer, &params, quoteIdent)
		compiled[i] = compiledOp{sql: sqlText, params: params, kind: rowOp.Kind}
		var literalParams []any
		previewParts[i] = adapters.RenderRowOp(relationSQL, rowOp, literalRenderer, &literalParams, quoteIdent)
	}
	// One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5 D9's own
	// precedent).
	op.SetCommand(joinSemicolons(previewParts))

	if err := execLiteral(ctx, conn, "BEGIN IMMEDIATE"); err != nil {
		return model.MutationResult{}, err
	}
	var affectedRows int64
	for _, c := range compiled {
		n, err := runCommand(ctx, conn, c.sql, c.params, op, true)
		if err != nil {
			_ = execLiteral(ctx, conn, "ROLLBACK") // best-effort, mirrors the other SQL adapters
			return model.MutationResult{}, err
		}
		if err := adapters.AssertAffectedExactlyOne(c.kind, n); err != nil {
			_ = execLiteral(ctx, conn, "ROLLBACK")
			return model.MutationResult{}, err
		}
		affectedRows += n
	}
	if err := execLiteral(ctx, conn, "COMMIT"); err != nil {
		_ = execLiteral(ctx, conn, "ROLLBACK")
		return model.MutationResult{}, err
	}
	return model.MutationResult{AffectedRows: int(affectedRows)}, nil
}
