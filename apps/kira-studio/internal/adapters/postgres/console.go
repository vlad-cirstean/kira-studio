package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

// endTransactionTimeout bounds the BEGIN READ ONLY wrap's own cleanup COMMIT (P2 R2): it must run
// even when the op's own ctx is already cancelled (Stop pressed mid-batch), since skipping it
// would leave this connection's next op running inside a stale, likely-aborted transaction.
const endTransactionTimeout = 5 * time.Second

// rawField is console.ts's RawField.
type rawField struct {
	name        string
	dataTypeOID uint32
}

// rawResult is console.ts's RawResult.
type rawResult struct {
	rows    [][]*string
	fields  []rawField
	command string
}

// runRaw is console.ts's runRaw: §8.14's own low-level runner, deliberately separate from
// runArrayQuery/runCommand — the console needs full field metadata (name + type OID) those
// discard, and it must not call op.SetCommand() per statement — execute() below calls it once for
// the whole batch (P5 D9's precedent). Always text-mode (mirrors read.go's identity type parsing)
// so every cell arrives as the server's own text representation, with no per-type Go conversion to
// undo.
func runRaw(ctx context.Context, conn *pgx.Conn, sql string, params []any, op *adapters.OpCtx, track TrackQuery) (rawResult, error) {
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return rawResult{}, err
	}
	release := track(RunningQuery{BackendPID: conn.PgConn().PID()})

	return adapters.RunWithAbortRace(ctx, release, func(queryCtx context.Context) (rawResult, error) {
		rows, err := conn.Query(queryCtx, sql, queryArgs(true, params)...)
		if err != nil {
			return rawResult{}, mapError(err)
		}
		defer rows.Close()

		descs := rows.FieldDescriptions()
		fields := make([]rawField, len(descs))
		for i, d := range descs {
			fields[i] = rawField{name: d.Name, dataTypeOID: d.DataTypeOID}
		}

		var out [][]*string
		for rows.Next() {
			dest := make([]any, len(descs))
			cells := make([]*string, len(descs))
			for i := range cells {
				dest[i] = &cells[i]
			}
			if err := rows.Scan(dest...); err != nil {
				return rawResult{}, mapError(err)
			}
			out = append(out, cells)
		}
		if err := rows.Err(); err != nil {
			return rawResult{}, mapError(err)
		}

		// pgconn's own CommandTag string is the closest Go equivalent of Postgres's real
		// command-complete wire tag (e.g. "INSERT 0 3", "UPDATE 1") — used directly as the single
		// status cell's text for a statement with no output columns (buildPage, below), which is at
		// least as faithful as console.ts's own documented approximation (`${command} ${rowCount}`),
		// closer in fact since it is the server's own tag rather than a reconstruction of it.
		return rawResult{rows: out, fields: fields, command: rows.CommandTag().String()}, nil
	})
}

// buildPage is console.ts's buildPage.
func buildPage(result rawResult, typeNames map[uint32]string) page.TabularPage {
	if len(result.fields) == 0 {
		command := result.command
		if command == "" {
			command = "OK"
		}
		return adapters.SingleStatusPage(command, "text")
	}

	columns := make([]page.ColumnDescriptor, len(result.fields))
	for i, f := range result.fields {
		dataType := typeNames[f.dataTypeOID]
		if dataType == "" {
			dataType = "unknown"
		}
		columns[i] = page.ColumnDescriptor{
			Name: f.name, DataType: dataType, TypeClass: typeClassFor(dataType),
			// execute() never consults the catalog (no target relation to describe), so
			// nullability and PK-ness are unknowable here — console results are always
			// read-only regardless.
			Nullable: true, IsPrimaryKey: false, Generated: false,
		}
	}

	builder := page.NewTabularPageBuilder(columns)
	for _, row := range result.rows {
		values := make([]*string, len(row))
		for i, v := range row {
			// normalizeCellText only ever rewrites a TypeClassBinary cell — every other type class
			// returns its input string unchanged, so reusing the already-scanned *string directly
			// avoids a needless extra allocation + pointer per cell (P2 R1).
			if v == nil || columns[i].TypeClass != page.TypeClassBinary {
				values[i] = v
				continue
			}
			normalized := normalizeCellText(*v, columns[i].TypeClass)
			values[i] = &normalized
		}
		_ = builder.AppendRow(values)
	}
	return builder.Finish(page.UnpagedPosition(len(result.rows)))
}

func lookupTypeNames(ctx context.Context, conn *pgx.Conn, op *adapters.OpCtx, track TrackQuery, oids []uint32) (map[uint32]string, error) {
	result, err := runRaw(ctx, conn, "SELECT oid, typname FROM pg_type WHERE oid = ANY($1::oid[])", []any{oids}, op, track)
	if err != nil {
		return nil, err
	}
	out := make(map[uint32]string, len(result.rows))
	for _, row := range result.rows {
		if len(row) < 2 || row[0] == nil || row[1] == nil {
			continue
		}
		oid, err := parseUint32(*row[0])
		if err != nil {
			continue
		}
		out[oid] = *row[1]
	}
	return out, nil
}

func parseUint32(s string) (uint32, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, adapters.New(adapters.CodeQuery, "not a number: "+s, nil)
		}
		n = n*10 + int(c-'0')
	}
	return uint32(n), nil
}

// execute is console.ts's execute. readOnly closes the gap client.go's own
// SET default_transaction_read_only=on leaves open (P2 R2): that session default only governs
// transactions *not yet started*, so a statement in this very batch could otherwise flip the
// session's default (or, on Postgres specifically, the current transaction's own read-write mode
// via SET TRANSACTION READ WRITE) and have every following statement in the batch run writable.
// Wrapping the whole batch in an explicit BEGIN READ ONLY transaction closes every angle actually
// tried against a real server except that one specific statement, which
// AssertNoTransactionEscalation rejects outright before anything runs.
func execute(ctx context.Context, conn *pgx.Conn, op *adapters.OpCtx, track TrackQuery, readOnly bool, statements []string) ([]page.Page, error) {
	if len(statements) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}
	if readOnly {
		if err := adapters.AssertNoTransactionEscalation(statements); err != nil {
			return nil, err
		}
	}
	op.SetCommand(joinSemicolons(statements))

	if readOnly {
		if _, err := conn.Exec(ctx, "BEGIN READ ONLY"); err != nil {
			return nil, mapError(err)
		}
		defer func() {
			// Detached from ctx: an op cancelled mid-batch must still end this transaction, or the
			// pinned connection is left inside it (aborted or not) for whatever op runs next. Safe to
			// call unconditionally regardless of the loop's own outcome — issuing COMMIT against an
			// already-aborted transaction is itself how Postgres ends one (confirmed empirically: the
			// server reports back a ROLLBACK command tag, not an error).
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), endTransactionTimeout)
			defer cancel()
			_, _ = conn.Exec(cleanupCtx, "COMMIT")
		}()
	}

	results := make([]rawResult, 0, len(statements))
	for _, sql := range statements {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return nil, err
		}
		result, err := runRaw(ctx, conn, sql, nil, op, track)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}

	oidSet := map[uint32]struct{}{}
	for _, r := range results {
		for _, f := range r.fields {
			oidSet[f.dataTypeOID] = struct{}{}
		}
	}
	typeNames := map[uint32]string{}
	if len(oidSet) > 0 {
		oids := make([]uint32, 0, len(oidSet))
		for o := range oidSet {
			oids = append(oids, o)
		}
		names, err := lookupTypeNames(ctx, conn, op, track, oids)
		if err != nil {
			return nil, err
		}
		typeNames = names
	}

	pages := make([]page.Page, len(results))
	for i, r := range results {
		pages[i] = buildPage(r, typeNames)
	}
	return pages, nil
}
