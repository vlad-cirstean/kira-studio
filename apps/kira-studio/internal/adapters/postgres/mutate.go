package postgres

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
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
	return adapters.BinaryColumnsOf(columns, typeClassFor)
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
	return adapters.PreviewSQLMutation(plan, relationSQL, literalRenderer, quoteIdent)
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
	if err := adapters.ValidateMutationOps(plan.Ops, target.Columns, target.PrimaryKey, qualifiedName); err != nil {
		return model.MutationResult{}, err
	}

	paramRenderer := adapters.NewParamRenderer(dollarPlaceholder, binaryColumnsOf(target.Columns))
	ordered := adapters.OrderedOps(plan.Ops)
	compiled, previewParts, err := adapters.CompileMutationOps(relationSQL, ordered, paramRenderer, literalRenderer, quoteIdent)
	if err != nil {
		return model.MutationResult{}, err
	}
	// One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5 D9).
	op.SetCommand(strings.Join(previewParts, ";\n"))

	execCommand := func(sql string, params []any) (int64, error) {
		return runCommand(ctx, conn, sql, params, op, track, CommandOptions{SuppressCommand: true})
	}

	// P2 R2: rollback runs on its own detached, timeout-bounded ctx (RunSQLMutation's own rule) so it
	// always reaches the server even when the caller's own ctx is already cancelled — the ad-hoc
	// `_, _ = execCommand("ROLLBACK", nil)` this replaced ran through runCommand's CheckNotStarted,
	// which refuses outright on an already-cancelled ctx, leaving conn (pinned for this adapter's
	// lifetime) stuck inside a stale, still-open transaction for whatever op runs on it next.
	rollback := func(ctx context.Context) {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), endTransactionTimeout)
		defer cancel()
		_, _ = conn.Exec(cleanupCtx, "ROLLBACK")
	}
	return adapters.RunSQLMutation(ctx, "BEGIN", execCommand, rollback, compiled)
}
