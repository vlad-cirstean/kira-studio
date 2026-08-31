package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
)

// RunningQuery is query.ts's RunningQuery.
type RunningQuery struct {
	BackendPID uint32
}

// TrackQuery is query.ts's TrackQuery: registers a running query and returns its own release,
// called once the statement settles. P13 D3's identity-checked release lives in the caller
// (adapter.go's trackerFor), same as the TypeScript.
type TrackQuery func(RunningQuery) (release func())

// QueryOptions is query.ts's QueryOptions, minus RowMode: runArrayQuery/runCommand below are the
// Go analogues of runQuery's two rowMode branches, so there is no shared function that needs to
// distinguish them at runtime.
type QueryOptions struct {
	// TextMode requests pgx.QueryExecModeSimpleProtocol — the read/console path's identity type
	// parsing (D3), never catalog queries.
	TextMode bool
	// LogParams appends the bound parameter values to the logged command (§5b step 6), read path only.
	LogParams bool
}

func setCommand(op *adapters.OpCtx, sql string, params []any, logParams bool) {
	if logParams && len(params) > 0 {
		if b, err := json.Marshal(params); err == nil {
			op.SetCommand(sql + " -- params: " + string(b))
			return
		}
	}
	op.SetCommand(sql)
}

func queryArgs(textMode bool, params []any) []any {
	if textMode {
		return append([]any{pgx.QueryExecModeSimpleProtocol}, params...)
	}
	return params
}

// runWithAbortRace is abort.ts's withAbortRace: issue runs the real driver call on a context
// detached from ctx's own cancellation, on its own goroutine, while this function returns to the
// caller as soon as either the query settles or ctx is done — whichever first. A local
// cancellation (host.CancelOp's own ctx.cancel(), the first of its two steps) must unblock the
// caller immediately without itself touching the still-running server-side query (query.ts:77-80's
// "do not fix it by trying to make the query itself abort"): unlike Node's pg, pgx honours ctx
// natively and would otherwise race its own cancel-request against — and typically win before —
// adapter.go's Cancel/pg_cancel_backend call, the one place the real kill is meant to happen.
// release is called exactly once, whenever the query actually settles — not merely when ctx fires
// — so Cancel still finds the tracked backend pid if it is called shortly after a local abort.
func runWithAbortRace[T any](ctx context.Context, release func(), issue func(context.Context) (T, error)) (T, error) {
	type result struct {
		value T
		err   error
	}
	done := make(chan result, 1)
	go func() {
		v, err := issue(context.WithoutCancel(ctx))
		done <- result{value: v, err: err}
		release()
	}()

	select {
	case r := <-done:
		return r.value, r.err
	case <-ctx.Done():
		var zero T
		return zero, adapters.CheckCancelled(ctx)
	}
}

// runArrayQuery is read.ts's and console.ts's own runQuery({rowMode:'array', ...}) call shape:
// every row scanned as []*string in column order, nil for SQL NULL. The server-side kill is
// entirely adapter.go's Cancel (pg_cancel_backend over a side connection) — this function does not
// and must not try to make the query itself abort (see runWithAbortRace).
func runArrayQuery(ctx context.Context, conn *pgx.Conn, sql string, params []any, op *adapters.OpCtx, track TrackQuery, opts QueryOptions) ([][]*string, error) {
	setCommand(op, sql, params, opts.LogParams)
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return nil, err
	}

	release := track(RunningQuery{BackendPID: conn.PgConn().PID()})

	return runWithAbortRace(ctx, release, func(queryCtx context.Context) ([][]*string, error) {
		rows, err := conn.Query(queryCtx, sql, queryArgs(opts.TextMode, params)...)
		if err != nil {
			return nil, mapError(err)
		}
		defer rows.Close()

		width := len(rows.FieldDescriptions())
		var out [][]*string
		for rows.Next() {
			dest := make([]any, width)
			cells := make([]*string, width)
			for i := range cells {
				dest[i] = &cells[i]
			}
			if err := rows.Scan(dest...); err != nil {
				return nil, mapError(err)
			}
			out = append(out, cells)
		}
		if err := rows.Err(); err != nil {
			return nil, mapError(err)
		}
		return out, nil
	})
}

// CommandOptions is query.ts's CommandOptions.
type CommandOptions struct {
	// SuppressCommand: setCommand() was already called once for the whole batch (P5 D9) — do not
	// call it again.
	SuppressCommand bool
}

// runCommand is query.ts's runCommand: an UPDATE/DELETE/INSERT/BEGIN/COMMIT/ROLLBACK has no rows
// worth returning, only the number of rows it affected.
func runCommand(ctx context.Context, conn *pgx.Conn, sql string, params []any, op *adapters.OpCtx, track TrackQuery, opts CommandOptions) (int64, error) {
	if !opts.SuppressCommand {
		op.SetCommand(sql)
	}
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return 0, err
	}

	release := track(RunningQuery{BackendPID: conn.PgConn().PID()})

	return runWithAbortRace(ctx, release, func(queryCtx context.Context) (int64, error) {
		tag, err := conn.Exec(queryCtx, sql, params...)
		if err != nil {
			return 0, mapError(err)
		}
		return tag.RowsAffected(), nil
	})
}
