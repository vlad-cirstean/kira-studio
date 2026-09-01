// Package mysqlfamily_test is the Go analogue of tests/db/{mariadb,mysql}.spec.ts: the two specs
// are ~90% the same file, so this is one shared suite function (runFamilySuite) plus two thin
// drivers (TestMariaDB/TestMySQL), in one package so one TestMain stops both containers
// (docs/v1/plans/P58b-mysql-sqlite-clickhouse.md §5.3). Not every one of the two specs' ~30
// scenarios has a Go twin — the ones ported are the load-bearing behaviours P58 D12's own
// "adapter-first-test-first" rule exists to protect, matching P58a's own postgres_test.go
// precedent.
package mysqlfamily_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/mariadb"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/mysql"
	"github.com/kirathecat/kira-studio/shell/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testsupport.StopMariadb()
	testsupport.StopMysql()
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

// flippingCtx reports ctx.Err() as nil for the first `after` calls, then as context.Canceled for
// every call after that — Done() always returns nil (never fires), so RunWithAbortRace's own
// select (abort.go) never treats a call through this ctx as cancelled mid-flight; only the
// synchronous CheckNotStarted-style pre-checks (query.go's runCommand) ever observe the flip. This
// lets a test force a cancellation to land at an exact, deterministic point in mutate()'s own
// sequence of CheckNotStarted-gated calls (the catalog lookup inside getReadTarget, then START
// TRANSACTION, then each compiled row op, then COMMIT) without any sleep or goroutine race — which
// of those calls is "START TRANSACTION" isn't part of this package's exported surface, so a test
// sweeps every plausible index instead of hardcoding one.
type flippingCtx struct {
	context.Context
	calls *int32
	after int32
}

func (c flippingCtx) Err() error {
	if atomic.AddInt32(c.calls, 1) > c.after {
		return context.Canceled
	}
	return nil
}
func (c flippingCtx) Done() <-chan struct{} { return nil }

func nodePath(connectionID string, segments ...model.PathSegment) model.NodePath {
	return testsupport.NodePath(connectionID, segments...)
}

// sideDSN builds a plain go-sql-driver DSN from cfg's own credentials — a side connection for
// test-only DDL (e.g. a throwaway no-PK probe table), not the adapter's own connection.
func sideDSN(cfg model.ResolvedConnectionConfig) string {
	mc := mysql.NewConfig()
	mc.Net = "tcp"
	host := ""
	if cfg.Host != nil {
		host = *cfg.Host
	}
	port := 3306
	if cfg.Port != nil {
		port = *cfg.Port
	}
	mc.Addr = fmt.Sprintf("%s:%d", host, port)
	if cfg.Username != nil {
		mc.User = *cfg.Username
	}
	if cfg.Password != nil {
		mc.Passwd = *cfg.Password
	}
	if cfg.Database != nil {
		mc.DBName = *cfg.Database
	}
	return mc.FormatDSN()
}

func newAdapter(t *testing.T, kind string) adapters.Adapter {
	t.Helper()
	a, err := adapters.CreateAdapter(kind, deps)
	if err != nil {
		t.Fatalf("CreateAdapter(%s): %v", kind, err)
	}
	return a
}

func connectedAdapter(t *testing.T, kind string, cfg model.ResolvedConnectionConfig) adapters.Adapter {
	t.Helper()
	a := newAdapter(t, kind)
	if _, err := a.Connect(context.Background(), cfg, adapters.NewOpCtx("connect")); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = a.Disconnect(context.Background()) })
	return a
}

func TestMariaDB(t *testing.T) {
	fixture := testsupport.StartMariadb(t)
	runFamilySuite(t, "mariadb", fixture.Config, regexp.MustCompile(`^MariaDB \d+\.`))
}

func TestMySQL(t *testing.T) {
	fixture := testsupport.StartMysql(t)
	runFamilySuite(t, "mysql", fixture.Config, regexp.MustCompile(`^MySQL 8\.`))
}

var bigRowsDetail = regexp.MustCompile(`^~[\d.]+[A-Za-z]* rows$`)

// runFamilySuite is the ~27 scenarios tests/db/mariadb.spec.ts and tests/db/mysql.spec.ts share.
func runFamilySuite(t *testing.T, kind string, cfg model.ResolvedConnectionConfig, versionRE *regexp.Regexp) {
	t.Run("connect/disconnect, real server version", func(t *testing.T) {
		a := newAdapter(t, kind)
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
		a := newAdapter(t, kind)
		bad := cfg
		wrong := "definitely-wrong"
		bad.Password = &wrong
		_, err := a.Connect(context.Background(), bad, adapters.NewOpCtx("op-2"))
		if err == nil {
			t.Fatal("expected an error for a wrong password")
		}
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeAuth {
			t.Fatalf("got %v, want an E_AUTH *adapters.Error", err)
		}
	})

	t.Run("tree enumeration", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		ctx := context.Background()

		dbs, err := a.Children(ctx, nodePath(cfg.ID), adapters.NewOpCtx("op-3a"))
		if err != nil {
			t.Fatalf("Children(root): %v", err)
		}
		dbNames := childNames(t, dbs)
		if !containsName(dbNames, "kira_test") || !containsName(dbNames, "kira_analytics") {
			t.Errorf("databases = %v, want kira_test and kira_analytics", dbNames)
		}
		for _, n := range dbs.Nodes {
			if n.Name == "kira_test" && (n.Detail == nil || *n.Detail != "connected") {
				t.Errorf("kira_test detail = %v, want \"connected\"", n.Detail)
			}
		}

		objects, err := a.Children(ctx, nodePath(cfg.ID, seg("database", "kira_test")), adapters.NewOpCtx("op-3b"))
		if err != nil {
			t.Fatalf("Children(database): %v", err)
		}
		kindOf := map[string]string{}
		for _, n := range objects.Nodes {
			kindOf[n.Name] = n.Kind
		}
		if kindOf["orders"] != "table" || kindOf["order_summary"] != "view" || kindOf["full_name"] != "function" {
			t.Errorf("object kinds = %+v, want orders=table order_summary=view full_name=function", kindOf)
		}
		for _, n := range objects.Nodes {
			if n.HasChildren {
				t.Errorf("object %q HasChildren = true, want false (P19 D5: every relation is a leaf)", n.Name)
			}
		}
	})

	t.Run("describe", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		meta, err := a.Describe(context.Background(), nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "order_items")), adapters.NewOpCtx("op-5"))
		if err != nil {
			t.Fatalf("Describe: %v", err)
		}
		if len(meta.PrimaryKey) == 0 {
			t.Error("expected a primary key")
		}
		if len(meta.ForeignKeys) == 0 {
			t.Error("expected at least one foreign key (order_items references orders/products)")
		}
	})

	// P2 R2: a MySQL/MariaDB constraint name only has to be unique within its own schema — two
	// unrelated tables in two different databases legitimately reusing the same constraint name
	// (a very plausible thing to do) must not be folded into one merged, corrupted entry. The
	// grouping logic itself (groupForeignKeys) has its own unconditional, engine-independent
	// white-box coverage in catalog_internal_test.go; this is the live, end-to-end reproduction.
	if kind == "mariadb" {
		t.Skip("MariaDB's information_schema.REFERENTIAL_CONSTRAINTS doesn't surface a row for a " +
			"schema the connected user only holds a db-level wildcard GRANT SELECT on (confirmed via " +
			"a standalone probe: KEY_COLUMN_USAGE sees kira_analytics fine, REFERENTIAL_CONSTRAINTS " +
			"returns zero rows for it) — a separate, pre-existing MariaDB limitation unrelated to this " +
			"fix, not reproducible under this fixture's own deliberately-restricted `kira` user")
	}
	t.Run("describe: referencedBy from two databases with a colliding constraint name are not merged", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		ctx := context.Background()

		// A root connection, not sideDSN's own `kira` user: kira only ever holds GRANT SELECT on
		// kira_analytics (seedMysqlExtras/seedMariadbExtras), deliberately no DDL rights there — the
		// very scenario this bug lives in is an app user with read-only cross-database visibility.
		host := ""
		if cfg.Host != nil {
			host = *cfg.Host
		}
		port := 3306
		if cfg.Port != nil {
			port = *cfg.Port
		}
		probeDB, err := sql.Open("mysql", testsupport.RootMysqlDSN(host, port, ""))
		if err != nil {
			t.Fatalf("probe connect: %v", err)
		}
		defer probeDB.Close()

		if _, err := probeDB.ExecContext(ctx,
			"CREATE TABLE IF NOT EXISTS kira_test.fk_collision_a (id INT PRIMARY KEY, customer_id INT, "+
				"CONSTRAINT fk_dup FOREIGN KEY (customer_id) REFERENCES kira_test.customers (id))",
		); err != nil {
			t.Fatalf("create fk_collision_a: %v", err)
		}
		defer probeDB.ExecContext(context.Background(), "DROP TABLE IF EXISTS kira_test.fk_collision_a")

		if _, err := probeDB.ExecContext(ctx,
			"CREATE TABLE IF NOT EXISTS kira_analytics.fk_collision_b (id INT PRIMARY KEY, customer_id INT, "+
				"CONSTRAINT fk_dup FOREIGN KEY (customer_id) REFERENCES kira_test.customers (id))",
		); err != nil {
			t.Fatalf("create fk_collision_b: %v", err)
		}
		defer probeDB.ExecContext(context.Background(), "DROP TABLE IF EXISTS kira_analytics.fk_collision_b")

		meta, err := a.Describe(ctx, nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")), adapters.NewOpCtx("op-91-referencedby"))
		if err != nil {
			t.Fatalf("Describe: %v", err)
		}

		aPath := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "kira_test"}, {Kind: "table", Name: "fk_collision_a"}})
		bPath := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "kira_analytics"}, {Kind: "table", Name: "fk_collision_b"}})
		var fromA, fromB *model.ForeignKeyMeta
		for i := range meta.ReferencedBy {
			fk := &meta.ReferencedBy[i]
			if fk.Name != "fk_dup" {
				continue
			}
			switch fk.ReferencedPath {
			case aPath:
				fromA = fk
			case bPath:
				fromB = fk
			}
		}
		if fromA == nil || fromB == nil {
			t.Fatalf("expected two separate fk_dup entries, one per database, got %+v", meta.ReferencedBy)
		}
		if len(fromA.ReferencedColumns) != 1 || fromA.ReferencedColumns[0] != "customer_id" {
			t.Errorf("fk_collision_a entry ReferencedColumns = %v, want [customer_id] (not merged with fk_collision_b's)", fromA.ReferencedColumns)
		}
		if len(fromB.ReferencedColumns) != 1 || fromB.ReferencedColumns[0] != "customer_id" {
			t.Errorf("fk_collision_b entry ReferencedColumns = %v, want [customer_id] (not merged with fk_collision_a's)", fromB.ReferencedColumns)
		}
	})

	t.Run("row estimate on big_rows", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		objects, err := a.Children(context.Background(), nodePath(cfg.ID, seg("database", "kira_test")), adapters.NewOpCtx("op-6"))
		if err != nil {
			t.Fatalf("Children: %v", err)
		}
		for _, n := range objects.Nodes {
			if n.Name == "big_rows" && (n.Detail == nil || !bigRowsDetail.MatchString(*n.Detail)) {
				t.Errorf("big_rows detail = %v, want a \"~N rows\" estimate", n.Detail)
			}
		}
	})

	t.Run("definition renders SHOW CREATE TABLE", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		def, err := a.Definition(context.Background(), nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")), adapters.NewOpCtx("op-7"))
		if err != nil {
			t.Fatalf("Definition: %v", err)
		}
		if len(def.Statements) != 1 || def.Statements[0] == "" {
			t.Fatalf("Statements = %v, want exactly one non-empty CREATE TABLE", def.Statements)
		}
	})

	t.Run("quoting: a table whose name needs backtick-doubling", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		p, err := a.Read(context.Background(), adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "weird`name")),
			PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-8"))
		if err != nil {
			t.Fatalf("Read(weird`name): %v", err)
		}
		tp := p.(page.TabularPage)
		if tp.RowCount != 1 {
			t.Fatalf("RowCount = %d, want 1", tp.RowCount)
		}
	})

	t.Run("read: first page", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		p, err := a.Read(context.Background(), adapters.ReadRequest{
			Path:     nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-9"))
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		tp := p.(page.TabularPage)
		if tp.RowCount != 2 {
			t.Errorf("RowCount = %d, want 2", tp.RowCount)
		}
	})

	t.Run("read: keyset forward and back over big_rows", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		ctx := context.Background()
		tablePath := nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "big_rows"))
		sort := &model.SortSpec{Kind: "structured", Terms: []model.SortTerm{{Column: "id", Direction: "asc"}}}

		first, err := a.Read(ctx, adapters.ReadRequest{
			Path: tablePath, Sort: sort, PageSize: 5, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
		}, adapters.NewOpCtx("op-10a"))
		if err != nil {
			t.Fatalf("Read(first): %v", err)
		}
		firstPage := first.(page.TabularPage)
		if firstPage.Position.NextToken == nil {
			t.Fatal("expected a NextToken on the first page")
		}
		if firstPage.Position.Strategy != "keyset" {
			t.Errorf("Position.Strategy = %q, want keyset", firstPage.Position.Strategy)
		}

		second, err := a.Read(ctx, adapters.ReadRequest{
			Path: tablePath, Sort: sort, PageSize: 5, Cursor: model.PageCursor{Mode: "after", Token: *firstPage.Position.NextToken},
		}, adapters.NewOpCtx("op-10b"))
		if err != nil {
			t.Fatalf("Read(after): %v", err)
		}
		secondPage := second.(page.TabularPage)
		secondFirstID := cellAt(t, secondPage, 0, 0)
		if secondFirstID == nil || *secondFirstID != "6" {
			t.Errorf("second page's first id = %v, want 6", secondFirstID)
		}
		if secondPage.Position.PrevToken == nil {
			t.Fatal("expected a PrevToken on the second page")
		}

		back, err := a.Read(ctx, adapters.ReadRequest{
			Path: tablePath, Sort: sort, PageSize: 5, Cursor: model.PageCursor{Mode: "before", Token: *secondPage.Position.PrevToken},
		}, adapters.NewOpCtx("op-10c"))
		if err != nil {
			t.Fatalf("Read(before): %v", err)
		}
		backPage := back.(page.TabularPage)
		backFirstID := cellAt(t, backPage, 0, 0)
		if backFirstID == nil || *backFirstID != "1" {
			t.Errorf("page-before's first id = %v, want 1 (display order preserved)", backFirstID)
		}

		// P2 R1 regression: a "before" page is fetched in descending (fetch) order and reversed to
		// ascending (display) order — the streaming readPage must swap its tracked first/last raw
		// rows along with builder.Reverse(), or this page's own NextToken (built from
		// CellAt(rowCount-1,...), the last *displayed* row) would be built from the wrong row's
		// keyset value entirely.
		if backPage.Position.NextToken == nil {
			t.Fatal("expected a NextToken on the page-before result")
		}
		forwardAgain, err := a.Read(ctx, adapters.ReadRequest{
			Path: tablePath, Sort: sort, PageSize: 5, Cursor: model.PageCursor{Mode: "after", Token: *backPage.Position.NextToken},
		}, adapters.NewOpCtx("op-10d"))
		if err != nil {
			t.Fatalf("Read(after, from page-before's NextToken): %v", err)
		}
		forwardAgainPage := forwardAgain.(page.TabularPage)
		forwardAgainFirstID := cellAt(t, forwardAgainPage, 0, 0)
		if forwardAgainFirstID == nil || *forwardAgainFirstID != "6" {
			t.Errorf("page after page-before's NextToken: first id = %v, want 6", forwardAgainFirstID)
		}
	})

	t.Run("count", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
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
		a := connectedAdapter(t, kind, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			Ops: []model.MutationRowOp{{
				Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}},
				Changes: model.RowValues{{Name: "name", Value: strp("should not land")}},
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

	t.Run("preview escapes backslash in literal values", func(t *testing.T) {
		// P2 R1 regression: MySQL/MariaDB treat \ as a string-literal escape character (unlike
		// Postgres/SQLite), so an unescaped backslash in a preview literal would mis-render what
		// the dialect actually parses — e.g. a trailing \' would escape the closing quote instead
		// of ending the string. preview() never executes, so this only checks the rendered text.
		a := connectedAdapter(t, kind, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			Ops: []model.MutationRowOp{{
				Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}},
				Changes: model.RowValues{{Name: "name", Value: strp(`C:\temp\'; DROP TABLE customers; --`)}},
			}},
		}
		statements, err := a.Preview(plan)
		if err != nil {
			t.Fatalf("Preview: %v", err)
		}
		if len(statements) != 1 {
			t.Fatalf("statements = %v, want exactly 1", statements)
		}
		want := `'C:\\temp\\''; DROP TABLE customers; --'`
		if !strings.Contains(statements[0], want) {
			t.Errorf("statement = %q, want it to contain %q (backslash doubled before quote escaping)", statements[0], want)
		}
	})

	t.Run("mutate: update lands, affectedRows", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			Ops: []model.MutationRowOp{{
				Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}},
				Changes: model.RowValues{{Name: "name", Value: strp("Acme Corp")}},
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

	// P2 R2: without CLIENT_FOUND_ROWS, MySQL/MariaDB report an UPDATE's "rows changed" count, not
	// "rows matched" — setting a column back to the value it already holds affects 0 rows on the
	// wire, which AssertAffectedExactlyOne then rejected as a failed update. Two mutates to the same
	// value, back to back: the second must land exactly like the first, not roll back as if the row
	// were never found.
	t.Run("mutate: update setting a column to its own current value still reports affectedRows=1", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			Ops: []model.MutationRowOp{{
				Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("2")}},
				Changes: model.RowValues{{Name: "name", Value: strp("Globex Noop")}},
			}},
		}
		if _, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-13-noop-setup")); err != nil {
			t.Fatalf("Mutate (setup): %v", err)
		}
		result, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-13-noop"))
		if err != nil {
			t.Fatalf("Mutate (no-op update): %v", err)
		}
		if result.AffectedRows != 1 {
			t.Errorf("AffectedRows = %d, want 1", result.AffectedRows)
		}
	})

	t.Run("mutate: unknown column is E_NOT_FOUND", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			Ops: []model.MutationRowOp{{
				Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}},
				Changes: model.RowValues{{Name: "no_such_column", Value: strp("x")}},
			}},
		}
		_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-14"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeNotFound {
			t.Fatalf("got %v, want E_NOT_FOUND", err)
		}
	})

	// P2 R2: a cancellation landing between START TRANSACTION and COMMIT left neither COMMIT nor
	// the compensating ROLLBACK ever reaching the server — both are gated by the same
	// CheckNotStarted check COMMIT itself is, so an already-observed-as-cancelled ctx short-
	// circuits ROLLBACK exactly like it does COMMIT. Because this adapter's *sql.Conn is pinned
	// for its whole lifetime (SetMaxOpenConns(1)), the server session was then left inside that
	// still-open transaction indefinitely: the next Mutate's own START TRANSACTION landed inside
	// it, so its COMMIT silently committed the earlier cancelled write too — worse than a hang.
	// flippingCtx sweeps every plausible cancellation point and, for whichever ones actually
	// trigger (an error from Mutate), proves the transaction was really rolled back: a clean
	// follow-up Mutate on a different row must succeed quickly and must not also commit the
	// earlier row's cancelled change.
	t.Run("mutate: a cancellation between START TRANSACTION and COMMIT does not leak an open transaction", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		tablePath := nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "order_items"))

		readQuantity := func(id string) string {
			t.Helper()
			p, err := a.Read(context.Background(), adapters.ReadRequest{
				Path: tablePath, Projection: []string{"quantity"}, PageSize: 10,
				Filter: strp("id = " + id), Cursor: model.PageCursor{Mode: "offset", Offset: 0},
			}, adapters.NewOpCtx("op-15-verify-"+id))
			if err != nil {
				t.Fatalf("Read(id=%s): %v", id, err)
			}
			got := cellAt(t, p.(page.TabularPage), 0, 0)
			if got == nil {
				t.Fatalf("Read(id=%s): no row", id)
			}
			return *got
		}
		baseline := readQuantity("1")

		for after := int32(1); after <= 12; after++ {
			plan := model.MutationPlan{
				Path: tablePath,
				Ops: []model.MutationRowOp{
					{Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}}, Changes: model.RowValues{{Name: "quantity", Value: strp("77")}}},
				},
			}
			var calls int32
			ctx := flippingCtx{Context: context.Background(), calls: &calls, after: after}
			_, err := a.Mutate(ctx, plan, adapters.NewOpCtx("op-15-cancel"))
			if err == nil {
				// This `after` fell past every CheckNotStarted check mutate() makes (COMMIT
				// included) — the mutate ran to completion normally. Reset row 1 and move on.
				if got := readQuantity("1"); got != "77" {
					t.Fatalf("after=%d: Mutate reported success but quantity = %s, want 77", after, got)
				}
				if _, err := a.Mutate(context.Background(), model.MutationPlan{
					Path: tablePath,
					Ops: []model.MutationRowOp{
						{Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}}, Changes: model.RowValues{{Name: "quantity", Value: strp(baseline)}}},
					},
				}, adapters.NewOpCtx("op-15-reset")); err != nil {
					t.Fatalf("after=%d: reset Mutate: %v", after, err)
				}
				continue
			}

			// A cancellation landed somewhere at or before COMMIT. The load-bearing assertion: a
			// completely unrelated follow-up Mutate, on a real ctx, must complete quickly rather
			// than hang behind a stale open transaction on the pinned connection...
			verifyCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, err = a.Mutate(verifyCtx, model.MutationPlan{
				Path: tablePath,
				Ops: []model.MutationRowOp{
					{Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("2")}}, Changes: model.RowValues{{Name: "quantity", Value: strp("55")}}},
				},
			}, adapters.NewOpCtx("op-15-followup"))
			cancel()
			if err != nil {
				t.Fatalf("after=%d: follow-up Mutate on a different row: %v (the earlier cancellation left a stale open transaction)", after, err)
			}
			// ...and it must not silently commit row 1's own cancelled write along with it — proof
			// the cancelled transaction was actually rolled back, not left dangling for this
			// commit to close.
			if got := readQuantity("1"); got != baseline {
				t.Fatalf("after=%d: row 1 quantity = %s after a cancelled Mutate + unrelated follow-up, want unchanged %s (the cancelled write leaked into the follow-up's commit)", after, got, baseline)
			}
			// Restore row 2 for the next iteration.
			if _, err := a.Mutate(context.Background(), model.MutationPlan{
				Path: tablePath,
				Ops: []model.MutationRowOp{
					{Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("2")}}, Changes: model.RowValues{{Name: "quantity", Value: strp("1")}}},
				},
			}, adapters.NewOpCtx("op-15-reset-2")); err != nil {
				t.Fatalf("after=%d: reset row 2: %v", after, err)
			}
		}
	})

	t.Run("mutate: no primary key is E_UNSUPPORTED", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		ctx := context.Background()

		probeDB, err := sql.Open("mysql", sideDSN(cfg))
		if err != nil {
			t.Fatalf("probe connect: %v", err)
		}
		defer probeDB.Close()
		if _, err := probeDB.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS no_pk_probe (col VARCHAR(255))"); err != nil {
			t.Fatalf("create probe table: %v", err)
		}
		defer probeDB.ExecContext(context.Background(), "DROP TABLE IF EXISTS no_pk_probe")

		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "no_pk_probe")),
			Ops: []model.MutationRowOp{{
				Kind: "update", Key: model.RowValues{{Name: "col", Value: strp("x")}},
				Changes: model.RowValues{{Name: "col", Value: strp("y")}},
			}},
		}
		_, err = a.Mutate(ctx, plan, adapters.NewOpCtx("op-15"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
			t.Fatalf("got %v, want E_UNSUPPORTED (no_pk_probe has no primary key)", err)
		}
	})

	// P2 R1: a VARBINARY column's edited value arrives from the grid still spelled in the app's
	// own "0x<hex>" display convention (read.go's own cellText) — Mutate must decode it back into
	// raw bytes before binding it as a parameter, not hand the driver that ASCII text as if it
	// were the new column content.
	t.Run("mutate: VARBINARY column edit round-trips as bytes, not its own hex text", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		ctx := context.Background()

		probeDB, err := sql.Open("mysql", sideDSN(cfg))
		if err != nil {
			t.Fatalf("probe connect: %v", err)
		}
		defer probeDB.Close()
		if _, err := probeDB.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS blob_rw (id INT PRIMARY KEY, data VARBINARY(255))"); err != nil {
			t.Fatalf("create probe table: %v", err)
		}
		defer probeDB.ExecContext(context.Background(), "DROP TABLE IF EXISTS blob_rw")
		if _, err := probeDB.ExecContext(ctx, "INSERT INTO blob_rw (id, data) VALUES (1, ?)", []byte{0x01, 0x02, 0x03}); err != nil {
			t.Fatalf("seed probe table: %v", err)
		}

		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "blob_rw")),
			Ops: []model.MutationRowOp{{
				Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}},
				Changes: model.RowValues{{Name: "data", Value: strp("0x0405")}},
			}},
		}
		result, err := a.Mutate(ctx, plan, adapters.NewOpCtx("op-blob-rw"))
		if err != nil {
			t.Fatalf("Mutate: %v", err)
		}
		if result.AffectedRows != 1 {
			t.Errorf("AffectedRows = %d, want 1", result.AffectedRows)
		}

		var stored []byte
		if err := probeDB.QueryRowContext(ctx, "SELECT data FROM blob_rw WHERE id = 1").Scan(&stored); err != nil {
			t.Fatalf("probe read back: %v", err)
		}
		want := []byte{0x04, 0x05}
		if string(stored) != string(want) {
			t.Errorf("stored bytes = %#v, want %#v (got the display text instead of decoded bytes?)", stored, want)
		}
	})

	t.Run("read-only connection cannot write", func(t *testing.T) {
		ro := cfg
		ro.ReadOnly = true
		a := newAdapter(t, kind)
		if _, err := a.Connect(context.Background(), ro, adapters.NewOpCtx("op-16-connect")); err != nil {
			t.Fatalf("Connect: %v", err)
		}
		defer a.Disconnect(context.Background())
		plan := model.MutationPlan{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "customers")),
			Ops:  []model.MutationRowOp{{Kind: "delete", Key: model.RowValues{{Name: "id", Value: strp("1")}}}},
		}
		_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-16"))
		var ae *adapters.Error
		if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
			t.Fatalf("got %v, want E_UNSUPPORTED", err)
		}
	})

	// P2 R2: client.go's own SET SESSION TRANSACTION READ ONLY only governs transactions not yet
	// started, so a console statement could flip it back for whatever ran after it in the same
	// batch. execute() now wraps the whole batch in START TRANSACTION READ ONLY, which — confirmed
	// against a real server — MariaDB/MySQL refuse to let any statement lift mid-transaction
	// ("Transaction characteristics can't be changed while a transaction is in progress").
	//
	// Targets order_items rather than customers: customers is referenced by orders' own FK, so a
	// DELETE against it fails with a foreign-key error regardless of read-only enforcement — a
	// false pass that doesn't actually exercise the guard. order_items has no dependents, so a
	// DELETE against it only fails if the read-only guard itself is doing its job.
	t.Run("read-only connection execute cannot escape read-only transaction", func(t *testing.T) {
		ro := cfg
		ro.ReadOnly = true
		a := newAdapter(t, kind)
		if _, err := a.Connect(context.Background(), ro, adapters.NewOpCtx("op-ro-connect")); err != nil {
			t.Fatalf("Connect: %v", err)
		}
		defer a.Disconnect(context.Background())

		before, err := a.Count(context.Background(), adapters.CountRequest{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "order_items")),
		}, adapters.NewOpCtx("op-ro-count-before"))
		if err != nil {
			t.Fatalf("Count: %v", err)
		}

		attempts := [][]string{
			{"SET SESSION TRANSACTION READ WRITE", "DELETE FROM order_items"},
			{"SET TRANSACTION READ WRITE", "DELETE FROM order_items"},
			{"COMMIT", "START TRANSACTION", "DELETE FROM order_items"},
		}
		for _, statements := range attempts {
			_, err := a.Execute(context.Background(), model.ConsoleRequest{
				Path:       nodePath(cfg.ID, seg("database", "kira_test")),
				Statements: statements,
			}, adapters.NewOpCtx("op-ro-escape"))
			if err == nil {
				t.Fatalf("Execute(%v) succeeded on a read-only connection, want an error", statements)
			}
		}

		after, err := a.Count(context.Background(), adapters.CountRequest{
			Path: nodePath(cfg.ID, seg("database", "kira_test"), seg("table", "order_items")),
		}, adapters.NewOpCtx("op-ro-count-after"))
		if err != nil {
			t.Fatalf("Count: %v", err)
		}
		if after.Value != before.Value {
			t.Fatalf("order_items row count = %d after read-only Execute attempts, want unchanged %d", after.Value, before.Value)
		}

		if _, err := a.Execute(context.Background(), model.ConsoleRequest{
			Path:       nodePath(cfg.ID, seg("database", "kira_test")),
			Statements: []string{"SELECT 1"},
		}, adapters.NewOpCtx("op-ro-still-usable")); err != nil {
			t.Fatalf("Execute(SELECT 1) after failed escape attempts: %v", err)
		}
	})

	t.Run("execute: one page per statement", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		pages, err := a.Execute(context.Background(), model.ConsoleRequest{
			Path: nodePath(cfg.ID, seg("database", "kira_test")),
			Statements: []string{
				"SELECT id, name FROM customers ORDER BY id",
				"CREATE TEMPORARY TABLE t_exec_17 (x INT)",
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
			t.Errorf("second page columns = %+v, want a single status column (a non-row-returning statement's generic OK page)", second.Columns)
		}
	})

	t.Run("execute: a failing statement rejects the whole call", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		_, err := a.Execute(context.Background(), model.ConsoleRequest{
			Path:       nodePath(cfg.ID, seg("database", "kira_test")),
			Statements: []string{"CREATE TEMPORARY TABLE t_exec_18 (x INT)", "SELECT * FROM no_such_table_at_all"},
		}, adapters.NewOpCtx("op-18"))
		if err == nil {
			t.Fatal("expected the second (invalid) statement to fail the whole call")
		}
	})

	// "The scenario that must not be softened" (§5.3): a real SELECT SLEEP, KILL QUERY from a real
	// side connection, and — the assertion that actually matters — SHOW PROCESSLIST confirms the
	// query is gone afterward, not merely that the local call returned.
	t.Run("cancel, asserted server-side", func(t *testing.T) {
		a := connectedAdapter(t, kind, cfg)
		side := connectedAdapter(t, kind, cfg)

		ctx, cancel := context.WithCancel(context.Background())
		op := adapters.NewOpCtx("op-cancel")

		errCh := make(chan error, 1)
		go func() {
			_, err := a.Execute(ctx, model.ConsoleRequest{
				Path:       nodePath(cfg.ID, seg("database", "kira_test")),
				Statements: []string{"SELECT SLEEP(30)"},
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
		time.Sleep(200 * time.Millisecond) // let the statement actually reach the server
		cancel()                           // unblocks the local wait only — see query.go's own doc comment

		ok, err := a.Cancel(context.Background(), "op-cancel")
		if err != nil {
			t.Fatalf("Cancel: %v", err)
		}
		if !ok {
			t.Error("Cancel reported false, want true (a real running query)")
		}

		select {
		case err := <-errCh:
			if err == nil {
				t.Error("expected Execute to fail once cancelled")
			}
		case <-time.After(5 * time.Second):
			t.Fatal("Execute never returned after Cancel")
		}

		waitForProcesslistClean(t, side, 2*time.Second)
	})
}

// waitForProcesslistClean polls SHOW PROCESSLIST over a separate, already-connected adapter until
// no SLEEP(30) command is running — the real proof KILL QUERY reached the server, not just that
// the local call returned.
func waitForProcesslistClean(t *testing.T, side adapters.Adapter, timeout time.Duration) {
	t.Helper()
	// Executed through Execute() so it goes over the same adapter path everything else in this
	// suite uses — no direct driver access needed here.
	deadline := time.Now().Add(timeout)
	for {
		pages, err := side.Execute(context.Background(), model.ConsoleRequest{
			Statements: []string{"SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'SELECT SLEEP%'"},
		}, adapters.NewOpCtx("op-processlist-check"))
		if err != nil {
			t.Fatalf("SHOW PROCESSLIST check: %v", err)
		}
		tp := pages[0].(page.TabularPage)
		n := cellAt(t, tp, 0, 0)
		if n != nil && *n == "0" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("pg_sleep still present in PROCESSLIST after %s", timeout)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
