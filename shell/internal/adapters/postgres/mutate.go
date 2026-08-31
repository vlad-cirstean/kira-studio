package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

var paramRenderer = adapters.NewParamRenderer(dollarPlaceholder)

// literalRenderer adapts sql-mutate.go's LiteralRenderer (a plain func(*string) string) to the
// adapters.ValueRenderer shape RenderRowOp expects — preview() never touches params, but the
// signature still takes one, so this closure just ignores it.
func literalRenderer(value *string, _ *[]any) string { return adapters.LiteralRenderer(value) }

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
		statements[i] = adapters.RenderRowOp(relationSQL, op, literalRenderer, &params, quoteIdent)
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
		return runCommand(ctx, conn, sql, params, op, track, CommandOptions{SuppressCommand: true})
	}

	if _, err := execCommand("BEGIN", nil); err != nil {
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
