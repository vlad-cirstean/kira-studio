package ipcfixture

import (
	"fmt"
	"regexp"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/mysql"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree"
)

var mysqlServerVersion = regexp.MustCompile(`^MySQL 8\.4\.`)

func nodeByName(nodes []model.TreeNode, name string) *model.TreeNode {
	for i := range nodes {
		if nodes[i].Name == name {
			return &nodes[i]
		}
	}
	return nil
}

// TestFixture_MySQL is P58f §4.5 step 2 (one fifth of it): the same discipline as
// TestFixture_MariaDB, against tests/ipc/mysql/mysql.fixture.ts's own committed scenario —
// connect, tree (with a frozen InnoDB row-count estimate for the million-row table), a
// filter-by-value read (mysql's own D17 backtick-quoting scenario) and a console/SQL-mode
// data:execute, in place of mariadb's count-twice and cancel scenarios (mysql.backend.spec.ts
// covers different load-bearing behaviour than mariadb.backend.spec.ts, per the plan's own split).
func TestFixture_MySQL(t *testing.T) {
	fixture := testsupport.StartMysql(t)
	app := NewApp(t)
	cfg := fixture.Config

	app.SeedConnection(t, cfg.ID, fieldsOf(cfg), cfg.Password)
	rec := NewRecorder(app)

	list := rec.ConnectionsList(t)
	if len(list) != 1 || list[0].ID != cfg.ID {
		t.Fatalf("connections list = %+v, want exactly one row for %s", list, cfg.ID)
	}
	if states := rec.ConnectionsStates(t); len(states) != 0 {
		t.Fatalf("connections states = %+v, want none", states)
	}
	state := rec.ConnectionsConnect(t, cfg.ID)
	if !mysqlServerVersion.MatchString(*state.ServerVersion) {
		t.Fatalf("serverVersion = %q, want to match %s", *state.ServerVersion, mysqlServerVersion)
	}

	root := rec.TreeChildren(t, cfg.ID, "", false)
	dbNode := nodeByName(root.Nodes, *cfg.Database)
	if dbNode == nil {
		t.Fatalf("expected a database node named %s in %+v", *cfg.Database, root.Nodes)
	}

	dbChildren := rec.TreeChildren(t, cfg.ID, dbNode.Path, false)
	// D17/D20 (mysql.backend.spec.ts): information_schema.TABLES.TABLE_ROWS is InnoDB's own
	// sampled estimate, confirmed to differ between separate, identically-seeded containers for
	// the million-row table — frozen for the fixture; every other table's estimate is exact.
	rec.OverrideLastControlResponse(tree.ChildrenResult{
		Nodes: FreezeNodeDetail(dbChildren.Nodes, "big_rows", "~1M rows"), Source: dbChildren.Source, Truncated: dbChildren.Truncated,
	})
	orderItemsNode := nodeByName(dbChildren.Nodes, "order_items")
	if orderItemsNode == nil {
		t.Fatalf("expected an order_items table node in %+v", dbChildren.Nodes)
	}
	hasFunction := false
	for _, n := range dbChildren.Nodes {
		if n.Kind == "function" {
			hasFunction = true
			break
		}
	}
	if !hasFunction {
		t.Fatalf("expected at least one function-kind node under the database, got %+v", dbChildren.Nodes)
	}

	readReq := adapterhost.ReadRequestWire{
		OpID: "be-read-order-items", ConnectionID: cfg.ID, Path: orderItemsNode.Path,
		PageSize: 100, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}
	readResp := rec.DataRead(t, readReq, nil)
	logical, err := DecodePage(readResp.Page)
	if err != nil {
		t.Fatalf("decode page: %v", err)
	}
	tabular, ok := logical.(LogicalTabularPage)
	if !ok || len(tabular.Rows) == 0 {
		t.Fatalf("expected a non-empty tabular page, got %+v", logical)
	}
	idColumnIndex := -1
	for i, c := range tabular.Columns {
		if c.Name == "id" {
			idColumnIndex = i
			break
		}
	}
	if idColumnIndex < 0 {
		t.Fatalf("expected an id column in %+v", tabular.Columns)
	}
	firstID := tabular.Rows[0][idColumnIndex]
	if firstID == nil {
		t.Fatal("expected a non-null id in the first row")
	}

	// D17: a same-value filter narrows to exactly the row it came from — the load-bearing
	// assertion is the request's own backtick-quoting (mysql's dialect, tested for real by the
	// adapter's own unit suite; this layer only needs the value round-trip).
	filteredReq := readReq
	filteredReq.OpID = "be-read-order-items-filtered"
	filteredReq.Filter = strp(fmt.Sprintf("`id` = '%s'", *firstID))
	filteredResp := rec.DataRead(t, filteredReq, nil)
	if filteredResp.Page.Rows() != 1 {
		t.Fatalf("filtered read rows = %d, want 1", filteredResp.Page.Rows())
	}

	// D17's other half: console is really SQL mode.
	executeReq := adapterhost.ExecuteRequestWire{
		OpID: "be-console-select1", ConnectionID: cfg.ID, Path: dbNode.Path, Statements: []string{"SELECT 1"},
	}
	executeResp := rec.DataExecute(t, executeReq)
	if len(executeResp.Pages) != 1 {
		t.Fatalf("execute pages = %d, want 1", len(executeResp.Pages))
	}

	if maybeWriteFixture(t, rec, "mysql") {
		return
	}
	assertMatchesCommittedJSONFixture(t, rec, "testdata/mysql.fixture.json")
}
