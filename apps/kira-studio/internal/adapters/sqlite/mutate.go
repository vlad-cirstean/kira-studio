package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// endTransactionTimeout bounds mutate's own cleanup ROLLBACK (P2 R2), mirroring postgres/console.go
// and mysqlfamily/console.go's identically-named const: it must run even when the op's own ctx is
// already cancelled (Stop pressed mid-batch, or the op's deadline expired), since database/sql's
// ExecContext refuses outright on an already-done ctx without ever reaching the driver — skipping
// this would leave the op's *sql.Conn (returned to runOnConn's pool, not closed) sitting inside a
// stale, still-open BEGIN IMMEDIATE for whatever op the pool hands that conn to next.
const endTransactionTimeout = 5 * time.Second

// literalRenderer adapts sqlmutate.go's LiteralRenderer to the adapters.ValueRenderer shape
// RenderRowOp expects — preview() never touches params, so this closure just ignores it.
func literalRenderer(name string, value *string, _ *[]any) (string, error) {
	return adapters.LiteralRenderer(name, value)
}

// binaryColumnsOf builds the isBinary lookup NewParamRenderer needs from a read target's own
// resolved column types — a binary column's edited value is still spelled in the "0x<hex>" display
// convention and must be decoded to raw bytes before it reaches the driver (P2 R1).
func binaryColumnsOf(columns []model.ColumnMeta) func(name string) bool {
	binary := make(map[string]bool, len(columns))
	for _, c := range columns {
		if typeClassFor(c.DataType) == page.TypeClassBinary {
			binary[c.Name] = true
		}
	}
	return func(name string) bool { return binary[name] }
}

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
		stmt, err := adapters.RenderRowOp(relationSQL, op, literalRenderer, &params, quoteIdent)
		if err != nil {
			return nil, err
		}
		statements[i] = stmt
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

	paramRenderer := adapters.NewParamRenderer(questionPlaceholder, binaryColumnsOf(target.Columns))

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
		sqlText, err := adapters.RenderRowOp(relationSQL, rowOp, paramRenderer, &params, quoteIdent)
		if err != nil {
			return model.MutationResult{}, err
		}
		compiled[i] = compiledOp{sql: sqlText, params: params, kind: rowOp.Kind}
		var literalParams []any
		previewPart, err := adapters.RenderRowOp(relationSQL, rowOp, literalRenderer, &literalParams, quoteIdent)
		if err != nil {
			return model.MutationResult{}, err
		}
		previewParts[i] = previewPart
	}
	// One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5 D9's own
	// precedent).
	op.SetCommand(joinSemicolons(previewParts))

	if err := execLiteral(ctx, conn, "BEGIN IMMEDIATE"); err != nil {
		return model.MutationResult{}, err
	}
	// P2 R2: the ad-hoc `_ = execLiteral(ctx, conn, "ROLLBACK")` this replaced ran on the same ctx as
	// everything else — database/sql's ExecContext refuses outright on an already-cancelled ctx
	// without ever reaching the driver, so a cancellation mid-loop or racing COMMIT left neither
	// COMMIT nor ROLLBACK ever executed. conn is then returned to runOnConn's pool (not closed) still
	// inside that BEGIN IMMEDIATE, so the next op to get this conn back finds it already in a
	// transaction. A detached, timeout-bounded ctx (mirrors postgres/mysqlfamily console.go's own
	// cleanup) guarantees this always runs regardless of the caller's own ctx state.
	committed := false
	defer func() {
		if committed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), endTransactionTimeout)
		defer cancel()
		_ = execLiteral(cleanupCtx, conn, "ROLLBACK")
	}()
	var affectedRows int64
	for _, c := range compiled {
		n, err := runCommand(ctx, conn, c.sql, c.params, op, true)
		if err != nil {
			return model.MutationResult{}, err
		}
		if err := adapters.AssertAffectedExactlyOne(c.kind, n); err != nil {
			return model.MutationResult{}, err
		}
		affectedRows += n
	}
	if err := execLiteral(ctx, conn, "COMMIT"); err != nil {
		return model.MutationResult{}, err
	}
	committed = true
	return model.MutationResult{AffectedRows: int(affectedRows)}, nil
}
