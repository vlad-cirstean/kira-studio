// Package clickhouse_test is the Go analogue of tests/db/clickhouse.spec.ts. Not every one of the
// spec's 47 scenarios has a Go twin — the ones ported are the load-bearing behaviours P58 D12's own
// "adapter-first-test-first" rule exists to protect, plus the three §5.5 names as carrying the most
// weight for judging B11 (wide types, big integers, NULL-vs-"null"-vs-NaN).
package clickhouse_test

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/clickhouse"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testsupport.StopClickHouse()
	os.Exit(code)
}

var deps = adapters.Deps{Log: func(level, message string) {}}

var (
	seg          = testsupport.Seg
	childNames   = testsupport.ChildNames
	containsName = testsupport.ContainsName
	cellAt       = testsupport.CellAt
	strp         = testsupport.Strp
)

func nodePath(connectionID string, segments ...model.PathSegment) model.NodePath {
	return testsupport.NodePath(connectionID, segments...)
}

func newAdapter(t *testing.T) adapters.Adapter {
	t.Helper()
	a, err := adapters.CreateAdapter("clickhouse", deps)
	if err != nil {
		t.Fatalf("CreateAdapter(clickhouse): %v", err)
	}
	return a
}

var connectCounter atomic.Int64

func connectedAdapter(t *testing.T, cfg model.ResolvedConnectionConfig) adapters.Adapter {
	t.Helper()
	a := newAdapter(t)
	// The op's own OpID feeds adapter.go's own nextQueryID ("kira-<opID>-<seq>", D8) — it must be
	// unique per Connect() call, not a shared literal: a fixed "connect" here produced a genuine
	// QUERY_WITH_SAME_ID_IS_ALREADY_RUNNING collision against the real server when two connects'
	// probes landed close enough in wall-clock time that ClickHouse had not yet cleared the
	// previous one's query_id from its own registry (found running the whole shell module's test
	// suite, not this package alone — a real per-connection uniqueness requirement this test
	// file's own convenience helper was violating, not a production adapter bug: a real op.OpID is
	// always unique per operation). t.Name() alone is not enough either: a subtest connecting twice
	// (the cancel test's own `a` and `side`) shares one t.Name() for both calls.
	opID := "connect-" + t.Name() + "-" + strconv.FormatInt(connectCounter.Add(1), 10)
	if _, err := a.Connect(context.Background(), cfg, adapters.NewOpCtx(opID)); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = a.Disconnect(context.Background()) })
	return a
}

var versionRE = regexp.MustCompile(`^ClickHouse \d+\.`)

func derefStr(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func TestClickHouse(t *testing.T) {
	fixture := testsupport.StartClickHouse(t)
	cfg := fixture.Config

	t.Run("connect/disconnect, real server version", func(t *testing.T) {
		a := newAdapter(t)
		info, err := a.Connect(context.Background(), cfg, adapters.NewOpCtx("op-1"))
		if err != nil {
			t.Fatalf("Connect: %v", err)
		}
		if !versionRE.MatchString(info.ServerVersion) {
			t.Errorf("ServerVersion = %q, want to match %s", info.ServerVersion, versionRE)
		}
		if err := a.Disconnect(context.Background()); err != nil {
			t.Fatalf("Disconnect: %v", err)
		}
	})

	t.Run("auth failure", func(t *testing.T) {
		a := newAdapter(t)
		bad := cfg
		wrong := "definitely-wrong"
		bad.Password = &wrong
		_, err := a.Connect(context.Background(), bad, adapters.NewOpCtx("op-2"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeAuth {
			t.Fatalf("got %v, want an E_AUTH *adapters.Error", err)
		}
	})

	t.Run("tree enumeration", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		ctx := context.Background()

		dbs, err := a.Children(ctx, nodePath(cfg.ID), adapters.NewOpCtx("op-3a"))
		if err != nil {
			t.Fatalf("Children(root): %v", err)
		}
		dbNames := childNames(t, dbs)
		// D15: system is genuinely browsable and kept, unlike mysql-family's own SYSTEM_SCHEMAS hiding.
		if !containsName(dbNames, "kira_test") || !containsName(dbNames, "default") || !containsName(dbNames, "system") {
			t.Errorf("databases = %v, want kira_test, default and system all present", dbNames)
		}

		objects, err := a.Children(ctx, nodePath(cfg.ID, seg("database", "kira_test")), adapters.NewOpCtx("op-3b"))
		if err != nil {
			t.Fatalf("Children(database): %v", err)
		}
		kindOf := make(map[string]string)
		for _, n := range objects.Nodes {
			kindOf[n.Name] = n.Kind
		}
		if kindOf["orders"] != "table" || kindOf["order_summary"] != "view" || kindOf["order_summary_mv"] != "matview" {
			t.Errorf("object kinds = %+v, want orders=table order_summary=view order_summary_mv=matview", kindOf)
		}
		for _, n := range objects.Nodes {
			if n.HasChildren {
				t.Errorf("object %q HasChildren = true, want false (P19 D5: every relation is a leaf)", n.Name)
			}
		}
	})

	t.Run("describe: no primary key, a sparse primary index, no foreign keys", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		meta, err := a.Describe(context.Background(), nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "order_items")), adapters.NewOpCtx("op-5"))
		if err != nil {
			t.Fatalf("Describe: %v", err)
		}
		// D18: a MergeTree PRIMARY KEY is a sparse index, not a uniqueness constraint — never
		// claimed as ObjectMeta.PrimaryKey.
		if meta.PrimaryKey != nil {
			t.Errorf("PrimaryKey = %v, want nil (D18)", meta.PrimaryKey)
		}
		if len(meta.ForeignKeys) != 0 {
			t.Errorf("ForeignKeys = %v, want none (F17: ClickHouse has no such concept)", meta.ForeignKeys)
		}
		foundPrimary := false
		for _, idx := range meta.Indexes {
			if idx.Primary {
				foundPrimary = true
			}
		}
		if !foundPrimary {
			t.Error("expected a synthesized primary sparse-index entry")
		}
	})

	t.Run("row estimate on big_rows", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		objects, err := a.Children(context.Background(), nodePath(cfg.ID, seg("database", "kira_test")), adapters.NewOpCtx("op-6"))
		if err != nil {
			t.Fatalf("Children: %v", err)
		}
		bigRowsDetail := regexp.MustCompile(`^~[\d.]+[A-Za-z]* rows$`)
		for _, n := range objects.Nodes {
			if n.Name == "big_rows" && (n.Detail == nil || !bigRowsDetail.MatchString(*n.Detail)) {
				t.Errorf("big_rows detail = %v, want a \"~N rows\" estimate", n.Detail)
			}
		}
	})

	t.Run("definition renders create_table_query verbatim, plus Table properties", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		def, err := a.Definition(context.Background(), nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")), adapters.NewOpCtx("op-7"))
		if err != nil {
			t.Fatalf("Definition: %v", err)
		}
		if len(def.Statements) != 1 || def.Statements[0] == "" {
			t.Fatalf("Statements = %v, want exactly one non-empty CREATE TABLE", def.Statements)
		}
		if len(def.Sections) != 1 || def.Sections[0].Title != "Table properties" {
			t.Fatalf("Sections = %+v, want a single \"Table properties\" section", def.Sections)
		}
	})

	t.Run("quoting: a doubled-backtick table name and a space in an identifier", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		ctx := context.Background()

		p1, err := a.Read(ctx, adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "weird`name")),
			PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-8a"))
		if err != nil {
			t.Fatalf("Read(weird`name): %v", err)
		}
		if tp := p1.(page.TabularPage); tp.RowCount != 1 {
			t.Errorf("weird`name RowCount = %d, want 1", tp.RowCount)
		}

		p2, err := a.Read(ctx, adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "Order Items")),
			PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-8b"))
		if err != nil {
			t.Fatalf("Read(Order Items): %v", err)
		}
		if tp := p2.(page.TabularPage); tp.RowCount != 1 {
			t.Errorf("Order Items RowCount = %d, want 1", tp.RowCount)
		}
	})

	// P2 R1: unlike MySQL/MariaDB, ClickHouse's identifier lexer processes backslash escapes the
	// same as a string literal — quoteIdent must double a raw backslash, not just a backtick, or
	// the generated query never actually reaches this table (a trailing "\`" is read as an escaped
	// literal backtick, not the identifier's closing quote).
	t.Run("quoting: a table name containing a raw backslash", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		p, err := a.Read(context.Background(), adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", `trail\`)),
			PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-8c"))
		if err != nil {
			t.Fatalf(`Read(trail\): %v`, err)
		}
		if tp := p.(page.TabularPage); tp.RowCount != 1 {
			t.Errorf(`trail\ RowCount = %d, want 1`, tp.RowCount)
		}
	})

	t.Run("read: first page", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		p, err := a.Read(context.Background(), adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-9"))
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		if tp := p.(page.TabularPage); tp.RowCount != 2 || tp.Position.Strategy != "offset" {
			t.Errorf("RowCount/Strategy = %d/%s, want 2/offset", tp.RowCount, tp.Position.Strategy)
		}
	})

	t.Run("a keyset cursor is refused with E_UNSUPPORTED, not silently downgraded", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		_, err := a.Read(context.Background(), adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			PageSize: 10, Cursor: model.PageCursor{Mode: "after", Token: "whatever"},
		}, adapters.NewOpCtx("op-10"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
			t.Fatalf("got %v, want E_UNSUPPORTED (D20: no total order to build a keyset cursor on)", err)
		}
	})

	t.Run("count", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		result, err := a.Count(context.Background(), adapters.CountRequest{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
		}, adapters.NewOpCtx("op-11"))
		if err != nil {
			t.Fatalf("Count: %v", err)
		}
		if result.Value != 2 || !result.Exact {
			t.Errorf("Count = %+v, want {2, true}", result)
		}
	})

	t.Run("preview never executes", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "regions")),
			Ops: []model.MutationRowOp{{
				Kind: "insert", Values: model.RowValues{{Name: "id", Value: strp("99")}, {Name: "name", Value: strp("should not land")}},
			}},
		}
		statements, err := a.Preview(plan)
		if err != nil {
			t.Fatalf("Preview: %v", err)
		}
		if len(statements) != 1 {
			t.Fatalf("statements = %v, want exactly 1", statements)
		}
		count, err := a.Count(context.Background(), adapters.CountRequest{Path: plan.Path}, adapters.NewOpCtx("op-12-count"))
		if err != nil {
			t.Fatalf("Count: %v", err)
		}
		if count.Value != 2 {
			t.Errorf("Count after Preview = %d, want unchanged at 2 (preview must never execute)", count.Value)
		}
	})

	t.Run("mutate: insert lands, affectedRows", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "regions")),
			Ops: []model.MutationRowOp{{
				Kind: "insert", Values: model.RowValues{{Name: "id", Value: strp("50")}, {Name: "name", Value: strp("LATAM")}},
			}},
		}
		result, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-13"))
		if err != nil {
			t.Fatalf("Mutate: %v", err)
		}
		if result.AffectedRows != 1 {
			t.Errorf("AffectedRows = %d, want 1", result.AffectedRows)
		}
	})

	t.Run("mutate: update/delete are E_UNSUPPORTED (D24/D25: no addressable row)", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "regions")),
			Ops:  []model.MutationRowOp{{Kind: "delete", Key: model.RowValues{{Name: "id", Value: strp("1")}}}},
		}
		_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-14"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
			t.Fatalf("got %v, want E_UNSUPPORTED", err)
		}
	})

	t.Run("mutate: unknown column is E_NOT_FOUND", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "regions")),
			Ops: []model.MutationRowOp{{
				Kind: "insert", Values: model.RowValues{{Name: "no_such_column", Value: strp("x")}},
			}},
		}
		_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-15"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeNotFound {
			t.Fatalf("got %v, want E_NOT_FOUND", err)
		}
	})

	t.Run("read-only connection cannot write", func(t *testing.T) {
		a := connectedAdapter(t, fixture.ReadOnlyConfig)
		plan := model.MutationPlan{
			Path: nodePath(fixture.ReadOnlyConfig.ID, seg("database", "kira_test"), seg("table", "regions")),
			Ops: []model.MutationRowOp{{
				Kind: "insert", Values: model.RowValues{{Name: "id", Value: strp("60")}, {Name: "name", Value: strp("nope")}},
			}},
		}
		_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-16"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
			t.Fatalf("got %v, want E_UNSUPPORTED", err)
		}
	})

	t.Run("execute: one page per statement, row-returning vs command classification", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		pages, err := a.Execute(context.Background(), model.ConsoleRequest{
			Path: nodePath(cfg.ID, seg("database", "kira_test")),
			Statements: []string{
				"SELECT id, name FROM customers ORDER BY id",
				"INSERT INTO regions (id, name) VALUES (70, 'console-insert')",
			},
		}, adapters.NewOpCtx("op-17"))
		if err != nil {
			t.Fatalf("Execute: %v", err)
		}
		if len(pages) != 2 {
			t.Fatalf("pages = %d, want 2", len(pages))
		}
		first := pages[0].(page.TabularPage)
		if first.RowCount != 2 {
			t.Errorf("first page RowCount = %d, want 2", first.RowCount)
		}
		second := pages[1].(page.TabularPage)
		if len(second.Columns) != 1 || second.Columns[0].Name != "status" {
			t.Errorf("second page columns = %+v, want a single status column", second.Columns)
		}
	})

	t.Run("execute: a failing statement rejects the whole call", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		_, err := a.Execute(context.Background(), model.ConsoleRequest{
			Path:       nodePath(cfg.ID, seg("database", "kira_test")),
			Statements: []string{"SELECT 1", "SELECT * FROM no_such_table_at_all"},
		}, adapters.NewOpCtx("op-18"))
		if err == nil {
			t.Fatal("expected the second (invalid) statement to fail the whole call")
		}
	})

	// §5.5's own three highest-weight scenarios for judging B11, combined into one read.
	t.Run("wide types: exact cell values, big integers keep every digit, NULL is not \"null\", NaN is not NULL", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		p, err := a.Read(context.Background(), adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "wide_types")),
			Sort:     &model.SortSpec{Kind: "structured", Terms: []model.SortTerm{{Column: "id", Direction: "asc"}}},
			PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-19"))
		if err != nil {
			t.Fatalf("Read(wide_types): %v", err)
		}
		tp := p.(page.TabularPage)
		colIdx := make(map[string]int, len(tp.Columns))
		for i, c := range tp.Columns {
			colIdx[c.Name] = i
		}

		en := cellAt(t, tp, colIdx["en"], 0)
		if en == nil || *en != "green" {
			t.Errorf("row0 en = %v, want \"green\"", derefStr(en))
		}
		uid := cellAt(t, tp, colIdx["uid"], 0)
		if uid == nil || *uid != "61f0c404-5cb3-11e7-907b-a6006ad3dba0" {
			t.Errorf("row0 uid = %v, want the exact UUID text", derefStr(uid))
		}
		// Decimal128(20) holds 20 fractional digits; the seed's own literal
		// ('123456789012345678.12345678901234567890') has a trailing zero beyond the type's own
		// precision, which ClickHouse itself drops on storage — this is the server's own real
		// output, confirmed against a live container, not a value this adapter reformats.
		dec := cellAt(t, tp, colIdx["dec"], 0)
		if dec == nil || *dec != "123456789012345678.1234567890123456789" {
			t.Errorf("row0 dec = %v, want every Decimal128 digit preserved", derefStr(dec))
		}
		bigUint := cellAt(t, tp, colIdx["big_uint"], 0)
		if bigUint == nil || *bigUint != "18446744073709551615" {
			t.Errorf("row0 big_uint = %v, want the exact max-UInt64 text", derefStr(bigUint))
		}

		// row 1 (id=2): nullable_val is a real NULL; row 0's own nullable_val is also a real NULL.
		nullableRow0 := cellAt(t, tp, colIdx["nullable_val"], 0)
		if nullableRow0 != nil {
			t.Errorf("row0 nullable_val = %v, want a real NULL", derefStr(nullableRow0))
		}
		nullableRow1 := cellAt(t, tp, colIdx["nullable_val"], 1)
		if nullableRow1 == nil || *nullableRow1 != "null" {
			t.Errorf(`row1 nullable_val = %v, want the four-character string "null", not NULL`, derefStr(nullableRow1))
		}
		floatRow1 := cellAt(t, tp, colIdx["float_val"], 1)
		if floatRow1 == nil || *floatRow1 != "nan" {
			t.Errorf(`row1 float_val = %v, want the three-character string "nan", not NULL`, derefStr(floatRow1))
		}
		typeClassOfNullable := tp.Columns[colIdx["nullable_val"]]
		if !typeClassOfNullable.Nullable {
			t.Error("nullable_val column must report Nullable = true")
		}
	})

	// The scenario that must not be softened (§5.3's own standard, applied here): a real slow
	// query, a real KILL QUERY from a separate side connection's own HTTP request, and — the
	// assertion that actually matters — system.processes confirms the query is gone afterward, not
	// merely that the local call returned.
	t.Run("cancel, asserted server-side", func(t *testing.T) {
		a := connectedAdapter(t, cfg)
		side := connectedAdapter(t, cfg)

		ctx, cancel := context.WithCancel(context.Background())
		op := adapters.NewOpCtx("op-cancel")

		errCh := make(chan error, 1)
		go func() {
			_, err := a.Execute(ctx, model.ConsoleRequest{
				Path:       nodePath(cfg.ID, seg("database", "kira_test")),
				Statements: []string{"SELECT sleep(3) FROM numbers(20)"},
			}, op)
			errCh <- err
		}()

		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if op.Command() != "" {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		time.Sleep(1500 * time.Millisecond) // let the statement actually reach the server
		cancel()                            // unblocks the local wait only — see query.go's own doc comment

		ok, err := a.Cancel(context.Background(), "op-cancel")
		if err != nil {
			t.Fatalf("Cancel: %v", err)
		}
		if !ok {
			t.Error("Cancel reported false, want true (a real running query)")
		}

		select {
		case <-errCh:
		case <-time.After(5 * time.Second):
			t.Fatal("Execute never returned after cancel()")
		}

		// adapter.go's own nextQueryID scheme: "kira-<opID>-<seq>", seq 0 for this op's one
		// statement — checked by query_id, not by matching the query's own SQL text: a LIKE '%...%'
		// filter on `query` would match this very checking statement's own text (its WHERE clause
		// literally contains the substring being searched for), producing a permanent false
		// positive that never clears. Caught by adding temporary debug output during this
		// milestone's own verification — the KILL QUERY mechanism itself was correct throughout.
		waitForProcessesClean(t, side, "kira-op-cancel-0", 5*time.Second)
	})
}

// waitForProcessesClean polls system.processes over a separate, already-connected adapter until the
// given query_id is gone — the real proof KILL QUERY reached the server, not just that the local
// call returned.
func waitForProcessesClean(t *testing.T, side adapters.Adapter, queryID string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		pages, err := side.Execute(context.Background(), model.ConsoleRequest{
			Statements: []string{"SELECT count() AS n FROM system.processes WHERE query_id = '" + queryID + "'"},
		}, adapters.NewOpCtx("op-processes-check"))
		if err != nil {
			t.Fatalf("system.processes check: %v", err)
		}
		tp := pages[0].(page.TabularPage)
		n := cellAt(t, tp, 0, 0)
		if n != nil && *n == "0" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("sleep(3) still present in system.processes after %s", timeout)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
