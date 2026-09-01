package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// literalRenderer adapts sql-mutate.go's LiteralRenderer to the adapters.ValueRenderer shape
// RenderRowOp expects — preview() never touches params, but the signature still takes one, so
// this closure just ignores it.
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

// resolveTablePath is mutate.ts's own resolveTablePath — postgres's three-segment
// database/schema/table form, distinct from sql-mutate.go's ResolveDatabaseTablePath (the
// two-segment form clickhouse/mysql-family/sqlite share).
func resolveTablePath(path model.NodePath) (schema, table string, err error) {
	segs := path.Segments
	if len(segs) != 3 || segs[1].Kind != "schema" || segs[2].Kind != "table" {
		return "", "", adapters.New(adapters.CodeNotFound,
			"mutate requires a database/schema/table path, got: "+model.EncodePath(segs), nil)
	}
	return segs[1].Name, segs[2].Name, nil
}

// preview is mutate.ts's preview — synchronous (D6): no catalog lookup, no network, trusts the
// plan's column names as given.
func preview(plan model.MutationPlan) ([]string, error) {
	schema, table, err := resolveTablePath(plan.Path)
	if err != nil {
		return nil, err
	}
	relationSQL := quoteIdent(schema) + "." + quoteIdent(table)
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

// mutate is mutate.ts's mutate.
func mutate(ctx context.Context, conn *pgx.Conn, op *adapters.OpCtx, track TrackQuery, readOnly bool, plan model.MutationPlan) (model.MutationResult, error) {
	// §8.12's standard: enforced here, not only greyed out in the UI (P5 D11).
	if err := adapters.AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}

	schema, table, err := resolveTablePath(plan.Path)
	if err != nil {
		return model.MutationResult{}, err
	}
	relationSQL := quoteIdent(schema) + "." + quoteIdent(table)

	// Fresh in this same op (D7, mirrors resolveProjection's P2 D10 discipline) — never trusts a
	// column name the renderer sent without re-checking it against the catalog right now.
	exec := execFor(conn, op, track)
	target, err := getReadTarget(ctx, exec, schema, table)
	if err != nil {
		return model.MutationResult{}, err
	}

	qualifiedName := target.QualifiedName.Schema + "." + target.QualifiedName.Relation
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

	paramRenderer := adapters.NewParamRenderer(dollarPlaceholder, binaryColumnsOf(target.Columns))

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
		sql, err := adapters.RenderRowOp(relationSQL, rowOp, paramRenderer, &params, quoteIdent)
		if err != nil {
			return model.MutationResult{}, err
		}
		compiled[i] = compiledOp{sql: sql, params: params, kind: rowOp.Kind}
		var literalParams []any
		previewPart, err := adapters.RenderRowOp(relationSQL, rowOp, literalRenderer, &literalParams, quoteIdent)
		if err != nil {
			return model.MutationResult{}, err
		}
		previewParts[i] = previewPart
	}
	// One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5 D9).
	op.SetCommand(joinSemicolons(previewParts))

	execCommand := func(sql string, params []any) (int64, error) {
		return runCommand(ctx, conn, sql, params, op, track, CommandOptions{SuppressCommand: true})
	}

	if _, err := execCommand("BEGIN", nil); err != nil {
		return model.MutationResult{}, err
	}
	// P2 R2: the ad-hoc `_, _ = execCommand("ROLLBACK", nil)` this replaced ran ROLLBACK through
	// execCommand/runCommand, which refuses on an already-cancelled ctx the same way COMMIT does
	// (CheckNotStarted) — a cancellation mid-loop or racing the COMMIT call left neither COMMIT nor
	// ROLLBACK ever reaching the server, and conn is pinned for this adapter's lifetime, so the next
	// op on it ran inside that same stale, still-open transaction. Mirrors console.go's execute()
	// cleanup: a detached, timeout-bounded ctx so this always reaches the server regardless of the
	// caller's own ctx state.
	committed := false
	defer func() {
		if committed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), endTransactionTimeout)
		defer cancel()
		_, _ = conn.Exec(cleanupCtx, "ROLLBACK")
	}()
	var affectedRows int64
	for _, c := range compiled {
		rowCount, err := execCommand(c.sql, c.params)
		if err != nil {
			return model.MutationResult{}, err
		}
		if err := adapters.AssertAffectedExactlyOne(c.kind, rowCount); err != nil {
			return model.MutationResult{}, err
		}
		affectedRows += rowCount
	}
	if _, err := execCommand("COMMIT", nil); err != nil {
		return model.MutationResult{}, err
	}
	committed = true
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
