package postgres

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// literalRenderer adapts sql-mutate.go's LiteralRenderer to the adapters.ValueRenderer shape
// RenderRowOp expects — preview() never touches params, but the signature still takes one, so
// this closure just ignores it.
func literalRenderer(name string, value *string, _ *[]any) (string, error) {
	return adapters.LiteralRenderer(name, value)
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
func mutate(ctx context.Context, conn *trackedConn, op *adapters.OpCtx, track TrackQuery, readOnly bool, plan model.MutationPlan) (model.MutationResult, error) {
	resolve := func() (relationSQL, qualifiedName string, columns []model.ColumnMeta, primaryKey []string, err error) {
		schema, table, err := resolveTablePath(plan.Path)
		if err != nil {
			return "", "", nil, nil, err
		}
		// Fresh in this same op (D7, mirrors resolveProjection's P2 D10 discipline) — never trusts a
		// column name the renderer sent without re-checking it against the catalog right now.
		exec := execFor(conn, op, track)
		target, err := getReadTarget(ctx, exec, schema, table)
		if err != nil {
			return "", "", nil, nil, err
		}
		relationSQL = quoteIdent(schema) + "." + quoteIdent(table)
		qualifiedName = target.QualifiedName.Schema + "." + target.QualifiedName.Relation
		return relationSQL, qualifiedName, target.Columns, target.PrimaryKey, nil
	}

	execCommand := func(sql string, params []any) (int64, error) {
		return runCommand(ctx, conn, sql, params, op, track, CommandOptions{SuppressCommand: true})
	}

	// P2 R2: rollback runs on its own detached, timeout-bounded ctx (RunSQLMutation's own rule) so it
	// always reaches the server even when the caller's own ctx is already cancelled — the ad-hoc
	// `_, _ = execCommand("ROLLBACK", nil)` this replaced ran through runCommand's CheckNotStarted,
	// which refuses outright on an already-cancelled ctx, leaving conn (pinned for this adapter's
	// lifetime) stuck inside a stale, still-open transaction for whatever op runs on it next.
	rollback := func(ctx context.Context) {
		// F2: wait for every RunWithAbortRace goroutine this mutate's own statements spawned to
		// actually finish touching conn before issuing ROLLBACK on it — otherwise an aborted
		// statement's own background goroutine (still running conn.Exec) races this cleanup on the
		// same non-concurrency-safe *pgx.Conn.
		conn.waitInFlight()
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), endTransactionTimeout)
		defer cancel()
		_, _ = conn.Exec(cleanupCtx, "ROLLBACK")
	}

	// §8.12's standard: enforced by RunRelationalMutate's own AssertWritable, not only greyed out in
	// the UI (P5 D11).
	return adapters.RunRelationalMutate(ctx, op, readOnly, plan, adapters.RelationalMutateDeps{
		Resolve: resolve, Quote: quoteIdent, Placeholder: dollarPlaceholder,
		TypeClassFor: typeClassFor, LiteralRenderer: literalRenderer,
		BeginSQL: "BEGIN", Exec: execCommand, Rollback: rollback,
	})
}
