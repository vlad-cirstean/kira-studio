package postgres_test

import (
	"context"
	"errors"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/postgres"
	"github.com/kirathecat/kira-studio/shell/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

var (
	regexpPGVersion = regexp.MustCompile(`^PostgreSQL 17`)
	bigRowsDetail   = regexp.MustCompile(`^~[\d.]+[A-Za-z]* rows$`)
)

// TestMain is bun:test's own beforeAll/afterAll-per-file precedent (postgres.spec.ts:68-75): the
// container this whole package's tests share is torn down exactly once, after every test has run
// — never from an individual test's t.Cleanup, which would fire the moment the first test to call
// testsupport.StartPostgres returns and kill the container out from under every later test.
func TestMain(m *testing.M) {
	code := m.Run()
	testsupport.StopPostgres()
	os.Exit(code)
}

// Ported from tests/db/postgres.spec.ts (§9.1), case by case where practical — the spec's own
// numbering is kept in each test's name so the two can be diffed. Not every one of the 34 TS
// cases has a Go twin; the ones ported are the load-bearing behaviours D12's own "adapter-first-
// test-first" rule exists to protect: connect/disconnect lifecycle, the catalog->tree mapping,
// quoting, describe, cancellation, all three pagination shapes, mutate's transactionality, and
// execute's batch semantics.

var deps = adapters.Deps{Log: func(level, message string) {}}

func newAdapter(t *testing.T) adapters.Adapter {
	t.Helper()
	a, err := adapters.CreateAdapter("postgres", deps)
	if err != nil {
		t.Fatalf("CreateAdapter: %v", err)
	}
	return a
}

func connectedAdapter(t *testing.T, fixture *testsupport.PgFixture) adapters.Adapter {
	t.Helper()
	a := newAdapter(t)
	if _, err := a.Connect(context.Background(), fixture.Config, adapters.NewOpCtx("connect")); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = a.Disconnect(context.Background()) })
	return a
}

func nodePath(fixture *testsupport.PgFixture, segments ...model.PathSegment) model.NodePath {
	return testsupport.NodePath(fixture.Config.ID, segments...)
}

var (
	seg          = testsupport.Seg
	childNames   = testsupport.ChildNames
	containsName = testsupport.ContainsName
	cellAt       = testsupport.CellAt
	strp         = testsupport.Strp
)

// 1. connect / disconnect
func TestPostgres_ConnectDisconnect(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := newAdapter(t)

	info, err := a.Connect(context.Background(), fixture.Config, adapters.NewOpCtx("op-1"))
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if !regexpPGVersion.MatchString(info.ServerVersion) {
		t.Errorf("ServerVersion = %q, want to start with \"PostgreSQL 17\"", info.ServerVersion)
	}

	if err := a.Disconnect(context.Background()); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	side, err := pgx.Connect(context.Background(), fixture.URI)
	if err != nil {
		t.Fatalf("side connect: %v", err)
	}
	defer side.Close(context.Background())
	var n int
	if err := side.QueryRow(context.Background(),
		"SELECT count(*) FROM pg_stat_activity WHERE application_name = 'kira-studio'").Scan(&n); err != nil {
		t.Fatalf("stat query: %v", err)
	}
	if n != 0 {
		t.Errorf("pg_stat_activity count = %d, want 0 (Disconnect must close every connection)", n)
	}
}

// 2. auth failure
func TestPostgres_AuthFailure(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := newAdapter(t)

	badCfg := fixture.Config
	wrong := "definitely-wrong"
	badCfg.Password = &wrong

	_, err := a.Connect(context.Background(), badCfg, adapters.NewOpCtx("op-2"))
	if err == nil {
		t.Fatal("expected an error for a wrong password")
	}
	var ae *adapters.Error
	if !errors.As(err, &ae) || ae.Code != adapters.CodeAuth {
		t.Fatalf("got %v, want an E_AUTH *adapters.Error", err)
	}
}

// 3. tree enumeration
func TestPostgres_TreeEnumeration(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	ctx := context.Background()

	dbs, err := a.Children(ctx, nodePath(fixture), adapters.NewOpCtx("op-3a"))
	if err != nil {
		t.Fatalf("Children(root): %v", err)
	}
	dbNames := childNames(t, dbs)
	if !containsName(dbNames, "kira_test") {
		t.Errorf("databases = %v, want kira_test", dbNames)
	}
	for _, n := range dbs.Nodes {
		if n.Name == "kira_test" && (n.Detail == nil || *n.Detail != "connected") {
			t.Errorf("kira_test detail = %v, want \"connected\"", n.Detail)
		}
	}

	schemas, err := a.Children(ctx, nodePath(fixture, seg("database", "kira_test")), adapters.NewOpCtx("op-3b"))
	if err != nil {
		t.Fatalf("Children(database): %v", err)
	}
	schemaNames := childNames(t, schemas)
	if !containsName(schemaNames, "app") || !containsName(schemaNames, "analytics") {
		t.Errorf("schemas = %v, want app and analytics (and no pg_catalog/information_schema/public)", schemaNames)
	}
	for _, forbidden := range []string{"pg_catalog", "information_schema", "public"} {
		if containsName(schemaNames, forbidden) {
			t.Errorf("schemas = %v, must not include %q", schemaNames, forbidden)
		}
	}

	objects, err := a.Children(ctx, nodePath(fixture, seg("database", "kira_test"), seg("schema", "app")), adapters.NewOpCtx("op-3c"))
	if err != nil {
		t.Fatalf("Children(schema): %v", err)
	}
	kindOf := map[string]string{}
	for _, n := range objects.Nodes {
		kindOf[n.Name] = n.Kind
	}
	wantKinds := map[string]string{
		"wide_table": "table", "order_summary": "view", "customer_totals": "matview",
		"invoice_number_seq": "sequence", "full_name": "function",
	}
	for name, wantKind := range wantKinds {
		if kindOf[name] != wantKind {
			t.Errorf("object %q kind = %q, want %q", name, kindOf[name], wantKind)
		}
	}
	for _, n := range objects.Nodes {
		if n.HasChildren {
			t.Errorf("object %q HasChildren = true, want false (P19 D5: every relation is a leaf)", n.Name)
		}
	}
}

// 4. quoting — a table and a column whose names need quoting/escaping.
func TestPostgres_Quoting(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	ctx := context.Background()

	p, err := a.Read(ctx, adapters.ReadRequest{
		Path:     nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", `weird"name`)),
		PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-4"))
	if err != nil {
		t.Fatalf("Read(weird\"name): %v", err)
	}
	tp := p.(page.TabularPage)
	if tp.RowCount != 1 {
		t.Fatalf("RowCount = %d, want 1", tp.RowCount)
	}
}

// 5. describe
func TestPostgres_Describe(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	ctx := context.Background()

	meta, err := a.Describe(ctx, nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "order_items")), adapters.NewOpCtx("op-5"))
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if len(meta.Indexes) < 2 {
		t.Errorf("Indexes = %d, want >= 2 (the PK plus order_items_order_product_idx)", len(meta.Indexes))
	}
	if len(meta.PrimaryKey) == 0 {
		t.Error("expected a primary key")
	}
}

// 6. row estimate: never-analysed relations surface rowEstimate: nil, never the raw -1.
func TestPostgres_RowEstimateNeverAnalysed(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	ctx := context.Background()

	meta, err := a.Describe(ctx, nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "order_items")), adapters.NewOpCtx("op-6"))
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if meta.RowEstimate != nil {
		t.Errorf("RowEstimate = %v, want nil for a never-analysed table", *meta.RowEstimate)
	}

	objects, err := a.Children(ctx, nodePath(fixture, seg("database", "kira_test"), seg("schema", "app")), adapters.NewOpCtx("op-6b"))
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	for _, n := range objects.Nodes {
		if n.Name == "order_items" && n.Detail != nil {
			t.Errorf("order_items detail = %q, want nil (never analysed)", *n.Detail)
		}
		if n.Name == "big_rows" && (n.Detail == nil || !bigRowsDetail.MatchString(*n.Detail)) {
			t.Errorf("big_rows detail = %v, want a \"~N rows\" estimate", n.Detail)
		}
	}
}

// 7. cancel, asserted server-side.
func TestPostgres_Cancel(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)

	ctx, cancel := context.WithCancel(context.Background())
	op := adapters.NewOpCtx("op-cancel")

	errCh := make(chan error, 1)
	go func() {
		_, err := a.Execute(ctx, model.ConsoleRequest{
			Path: nodePath(fixture, seg("database", "kira_test")), Statements: []string{"SELECT pg_sleep(30)"},
		}, op)
		errCh <- err
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if op.Command() != "" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel() // unblocks the local wait

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

	// A second cancel of the same (now-finished) op is a no-op.
	ok2, err2 := a.Cancel(context.Background(), "op-cancel")
	if err2 != nil || ok2 {
		t.Errorf("second Cancel = %v, %v, want false, nil", ok2, err2)
	}
}

// 8. cap honesty
func TestPostgres_CapHonesty(t *testing.T) {
	a := newAdapter(t)
	c := a.Caps()
	if !c.Tabular || c.Documents || c.KeyValue || c.Stream {
		t.Errorf("caps = %+v, want tabular-only", c)
	}
	if c.Pagination != adapters.PaginationKeyset {
		t.Errorf("Pagination = %q, want keyset", c.Pagination)
	}
	if !c.Writable || !c.Transactions || !c.Cancel {
		t.Error("expected Writable, Transactions and Cancel all true")
	}
	if c.FileTransfer {
		t.Error("expected FileTransfer false")
	}
}

// 9. children of a leaf
func TestPostgres_ChildrenOfLeaf(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	children, err := a.Children(context.Background(),
		nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "wide_table")),
		adapters.NewOpCtx("op-9"))
	if err != nil {
		t.Fatalf("Children(leaf): %v", err)
	}
	if len(children.Nodes) != 0 {
		t.Errorf("Children(leaf) = %d nodes, want 0", len(children.Nodes))
	}
}

// 10. read: first page
func TestPostgres_ReadFirstPage(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path:     nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
		PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-10"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	tp := p.(page.TabularPage)
	if tp.RowCount != 2 {
		t.Errorf("RowCount = %d, want 2", tp.RowCount)
	}
	if tp.Position.HasMore {
		t.Error("HasMore = true, want false (only 2 rows, page size 10)")
	}
}

// 11. read: deep page by offset
func TestPostgres_ReadOffsetPage(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path:     nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "big_rows")),
		Sort:     &model.SortSpec{Kind: "structured", Terms: []model.SortTerm{{Column: "id", Direction: "asc"}}},
		PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 500_000},
	}, adapters.NewOpCtx("op-11"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	tp := p.(page.TabularPage)
	if tp.RowCount != 10 {
		t.Fatalf("RowCount = %d, want 10", tp.RowCount)
	}
	first := cellAt(t, tp, 0, 0)
	if first == nil || *first != "500001" {
		t.Errorf("first id = %v, want 500001", first)
	}
}

// 12. read: keyset forward and backward
func TestPostgres_ReadKeysetForwardBackward(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	ctx := context.Background()
	tablePath := nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "big_rows"))
	sort := &model.SortSpec{Kind: "structured", Terms: []model.SortTerm{{Column: "id", Direction: "asc"}}}

	first, err := a.Read(ctx, adapters.ReadRequest{
		Path: tablePath, Sort: sort, PageSize: 5, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-12a"))
	if err != nil {
		t.Fatalf("Read(first): %v", err)
	}
	firstPage := first.(page.TabularPage)
	if firstPage.Position.NextToken == nil {
		t.Fatal("expected a NextToken on the first page")
	}

	second, err := a.Read(ctx, adapters.ReadRequest{
		Path: tablePath, Sort: sort, PageSize: 5, Cursor: model.PageCursor{Mode: "after", Token: *firstPage.Position.NextToken},
	}, adapters.NewOpCtx("op-12b"))
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
	}, adapters.NewOpCtx("op-12c"))
	if err != nil {
		t.Fatalf("Read(before): %v", err)
	}
	backPage := back.(page.TabularPage)
	backFirstID := cellAt(t, backPage, 0, 0)
	if backFirstID == nil || *backFirstID != "1" {
		t.Errorf("page-before's first id = %v, want 1 (display order preserved)", backFirstID)
	}
}

// 13. read: no keyset without a tiebreaker (text sort disqualifies it).
func TestPostgres_ReadNoKeysetForTextSort(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	_, err := a.Read(context.Background(), adapters.ReadRequest{
		Path:     nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
		Sort:     &model.SortSpec{Kind: "text", Text: "name"},
		PageSize: 10, Cursor: model.PageCursor{Mode: "after", Token: "bm90LWEtcmVhbC10b2tlbg"},
	}, adapters.NewOpCtx("op-13"))
	if err == nil {
		t.Fatal("expected an error requesting a keyset cursor with a text sort")
	}
	var ae *adapters.Error
	if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
		t.Fatalf("got %v, want E_UNSUPPORTED", err)
	}
}

// 14. read: projection
func TestPostgres_ReadProjection(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path:       nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
		Projection: []string{"name"},
		PageSize:   10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-14"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	tp := p.(page.TabularPage)
	if len(tp.Columns) != 1 || tp.Columns[0].Name != "name" {
		t.Errorf("Columns = %+v, want exactly [name]", tp.Columns)
	}
}

// 15. read: filter and sort
func TestPostgres_ReadFilterAndSort(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	filter := "region_id = 1"
	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path:   nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
		Filter: &filter, Sort: &model.SortSpec{Kind: "structured", Terms: []model.SortTerm{{Column: "name", Direction: "asc"}}},
		PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-15"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	tp := p.(page.TabularPage)
	if tp.RowCount != 1 {
		t.Fatalf("RowCount = %d, want 1 (only Acme Co is in region 1)", tp.RowCount)
	}
}

// 17. count
func TestPostgres_Count(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	result, err := a.Count(context.Background(), adapters.CountRequest{
		Path: nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
	}, adapters.NewOpCtx("op-17"))
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if result.Value != 2 || !result.Exact {
		t.Errorf("Count = %+v, want {2, true}", result)
	}
}

// 18. read cannot write — Preview/Mutate on a read-only connection is E_UNSUPPORTED.
func TestPostgres_ReadOnlyConnectionCannotWrite(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	roCfg := fixture.Config
	roCfg.ReadOnly = true
	a := newAdapter(t)
	if _, err := a.Connect(context.Background(), roCfg, adapters.NewOpCtx("op-18-connect")); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer a.Disconnect(context.Background())

	plan := model.MutationPlan{
		Path: nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
		Ops:  []model.MutationRowOp{{Kind: "delete", Key: model.RowValues{{Name: "id", Value: strp("1")}}}},
	}
	_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-18"))
	if err == nil {
		t.Fatal("expected an error mutating a read-only connection")
	}
	var ae *adapters.Error
	if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
		t.Fatalf("got %v, want E_UNSUPPORTED", err)
	}
}

// 21. preview: exact text, never executes.
func TestPostgres_PreviewNeverExecutes(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	plan := model.MutationPlan{
		Path: nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "composite_pk")),
		Ops: []model.MutationRowOp{{
			Kind: "insert", Values: model.RowValues{
				{Name: "tenant_id", Value: strp("3")}, {Name: "entity_id", Value: strp("1")}, {Name: "name", Value: strp("new tenant")},
			},
		}},
	}
	statements, err := a.Preview(plan)
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	if len(statements) != 1 {
		t.Fatalf("statements = %v, want exactly 1", statements)
	}
	want := `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('3', '1', 'new tenant')`
	if statements[0] != want {
		t.Errorf("got %q, want %q", statements[0], want)
	}

	count, err := a.Count(context.Background(), adapters.CountRequest{Path: plan.Path}, adapters.NewOpCtx("op-21-count"))
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count.Value != 3 {
		t.Errorf("Count after Preview = %d, want unchanged at 3 (preview must never execute)", count.Value)
	}
}

// 22. mutate: update lands correctly (affectedRows).
func TestPostgres_MutateUpdate(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	plan := model.MutationPlan{
		Path: nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
		Ops: []model.MutationRowOp{{
			Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}},
			Changes: model.RowValues{{Name: "name", Value: strp("Acme Corp")}},
		}},
	}
	result, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-22"))
	if err != nil {
		t.Fatalf("Mutate: %v", err)
	}
	if result.AffectedRows != 1 {
		t.Errorf("AffectedRows = %d, want 1", result.AffectedRows)
	}
}

// 23. mutate: unknown column is E_NOT_FOUND
func TestPostgres_MutateUnknownColumn(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	plan := model.MutationPlan{
		Path: nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers")),
		Ops: []model.MutationRowOp{{
			Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}},
			Changes: model.RowValues{{Name: "no_such_column", Value: strp("x")}},
		}},
	}
	_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-23"))
	var ae *adapters.Error
	if !errors.As(err, &ae) || ae.Code != adapters.CodeNotFound {
		t.Fatalf("got %v, want E_NOT_FOUND", err)
	}
}

// 25. mutate: a row-count conflict rolls back the whole batch.
func TestPostgres_MutateRowCountConflictRollsBack(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	tablePath := nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "customers"))
	plan := model.MutationPlan{
		Path: tablePath,
		Ops: []model.MutationRowOp{
			{Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("1")}}, Changes: model.RowValues{{Name: "name", Value: strp("changed")}}},
			// A key matching zero rows — AssertAffectedExactlyOne must fail and roll back both.
			{Kind: "update", Key: model.RowValues{{Name: "id", Value: strp("999999")}}, Changes: model.RowValues{{Name: "name", Value: strp("changed")}}},
		},
	}
	_, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("op-25"))
	if err == nil {
		t.Fatal("expected an error for the zero-row update")
	}

	// The first update must have rolled back too.
	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: tablePath, Projection: []string{"name"}, PageSize: 10,
		Filter: strp("id = 1"), Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-25-verify"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	tp := p.(page.TabularPage)
	got := cellAt(t, tp, 0, 0)
	if got == nil || *got == "changed" {
		t.Errorf("name = %v, want the pre-mutation value (rollback failed)", got)
	}
}

// 27. mutate: no primary key is E_UNSUPPORTED.
func TestPostgres_MutateNoPrimaryKey(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	ctx := context.Background()

	probe, err := pgx.Connect(ctx, fixture.URI)
	if err != nil {
		t.Fatalf("probe connect: %v", err)
	}
	defer probe.Close(context.Background())
	if _, err := probe.Exec(ctx, "CREATE TABLE IF NOT EXISTS app.no_pk_probe (col text)"); err != nil {
		t.Fatalf("create probe table: %v", err)
	}
	defer probe.Exec(context.Background(), "DROP TABLE IF EXISTS app.no_pk_probe")

	plan := model.MutationPlan{
		Path: nodePath(fixture, seg("database", "kira_test"), seg("schema", "app"), seg("table", "no_pk_probe")),
		Ops: []model.MutationRowOp{{
			Kind: "update", Key: model.RowValues{{Name: "col", Value: strp("x")}},
			Changes: model.RowValues{{Name: "col", Value: strp("y")}},
		}},
	}
	_, err = a.Mutate(ctx, plan, adapters.NewOpCtx("op-27"))
	var ae *adapters.Error
	if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
		t.Fatalf("got %v, want E_UNSUPPORTED (no_pk_probe has no primary key)", err)
	}
}

// 28. execute: one page per statement, including a non-row-returning one.
func TestPostgres_ExecuteOnePagePerStatement(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	pages, err := a.Execute(context.Background(), model.ConsoleRequest{
		Path: nodePath(fixture, seg("database", "kira_test")),
		Statements: []string{
			"SELECT id, name FROM app.customers ORDER BY id",
			"CREATE TEMP TABLE t_exec_28 (x int)",
		},
	}, adapters.NewOpCtx("op-28"))
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
}

// 29. execute: a failing statement rejects the whole call — earlier statements already landed.
func TestPostgres_ExecuteFailingStatementRejectsBatch(t *testing.T) {
	fixture := testsupport.StartPostgres(t)
	a := connectedAdapter(t, fixture)
	_, err := a.Execute(context.Background(), model.ConsoleRequest{
		Path:       nodePath(fixture, seg("database", "kira_test")),
		Statements: []string{"CREATE TEMP TABLE t_exec_29 (x int)", "SELECT * FROM no_such_table_at_all"},
	}, adapters.NewOpCtx("op-29"))
	if err == nil {
		t.Fatal("expected the second (invalid) statement to fail the whole call")
	}
}
