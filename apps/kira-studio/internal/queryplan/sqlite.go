package queryplan

import (
	"fmt"
	"regexp"
	"strings"
)

// sqlite.go ports planParsers/sqlite.ts verbatim: SQLite's `EXPLAIN QUERY PLAN` — N rows x 4
// columns (id, parent, notused, detail), no cost and no row estimate whatsoever, so
// EstimatedRowsRead/OverThreshold stay unset/false here (D14). sqlite.org/eqp.html: "The output
// format may change between SQLite releases" — taken as binding (D16): detail is matched on a
// small set of leading tokens for issue detection and otherwise shown verbatim, never re-parsed
// more deeply.

type sqliteExplainRow struct {
	id     int
	parent int
	detail string
}

var sqliteRelationRE = regexp.MustCompile(`^(?:SCAN|SEARCH) (\S+)`)

func sqliteNodeForRow(detail string) Node {
	node := Node{Label: detail, Detail: detail, Metrics: []Metric{}, Issues: []Issue{}, Children: []Node{}}
	if m := sqliteRelationRE.FindStringSubmatch(detail); m != nil {
		node.Relation = m[1]
	}

	// D15: full scan — SCAN (as opposed to SEARCH, which narrows via an index or rowid).
	if strings.HasPrefix(detail, "SCAN ") {
		node.Issues = append(node.Issues, Issue{
			Severity: "warn", Code: "full-scan",
			Message: fmt.Sprintf("%s — a full scan, no index narrowed the read", detail),
		})
	}
	if strings.Contains(detail, "USE TEMP B-TREE FOR ") {
		node.Issues = append(node.Issues, Issue{Severity: "warn", Code: "temp-btree", Message: detail})
	}
	// D15 (info): a covering index avoids a second lookup into the table itself.
	if strings.Contains(detail, "USING COVERING INDEX") {
		node.Issues = append(node.Issues, Issue{Severity: "info", Code: "covering-index", Message: detail})
	}
	return node
}

// sqliteBuilderNode is a pointer-based scratch tree — attachment (a child row arriving, in any
// order, at any depth relative to its parent row) mutates a *sqliteBuilderNode in place. Only
// once every row has been attached does finalizeSqliteNode copy the tree into the value-typed
// Node shape once (plan.go's own note on why a Node value, once copied into a parent's Children
// slice, must never be mutated through a stray pointer afterward — building via pointers first and
// converting exactly once avoids that trap for a tree whose row order does not match its nesting
// order).
type sqliteBuilderNode struct {
	base     Node
	children []*sqliteBuilderNode
}

func finalizeSqliteNode(b *sqliteBuilderNode) Node {
	n := b.base
	n.Children = make([]Node, 0, len(b.children))
	for _, c := range b.children {
		n.Children = append(n.Children, finalizeSqliteNode(c))
	}
	return n
}

func parseSqlitePlan(rows []sqliteExplainRow) Plan {
	builders := make(map[int]*sqliteBuilderNode, len(rows))
	for _, row := range rows {
		builders[row.id] = &sqliteBuilderNode{base: sqliteNodeForRow(row.detail)}
	}

	root := &sqliteBuilderNode{base: Node{Label: "Query plan", Metrics: []Metric{}, Issues: []Issue{}}}
	rawLines := make([]string, 0, len(rows))
	for _, row := range rows {
		rawLines = append(rawLines, fmt.Sprintf("%d\t%d\t%s", row.id, row.parent, row.detail))
		b, ok := builders[row.id]
		if !ok {
			continue
		}
		parent := root
		if row.parent != 0 {
			if p, ok := builders[row.parent]; ok {
				parent = p
			}
		}
		parent.children = append(parent.children, b)
	}

	rootNode := finalizeSqliteNode(root)
	return Plan{
		Kind: "sqlite", Root: rootNode, Issues: rollupIssues(&rootNode), OverThreshold: false,
		Raw: strings.Join(rawLines, "\n"),
	}
}
