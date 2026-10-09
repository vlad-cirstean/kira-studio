// Package coverage fails when a Wails-bound method or git request has no call in any flow test.
// Name match, not call-graph proof. Exemptions go in exempt.txt as `name: reason`.
package coverage_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest"
)

func TestMain(m *testing.M) { os.Exit(flowharness.Main(m)) }

// gitRequests reads the request names the git router serves: the requestHandlers keys plus the
// Stream cases. The table is unexported, so parse the source rather than export it for a test.
func gitRequests(t *testing.T) []string {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), "../../gitrpc/handlers.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	add := func(e ast.Expr) {
		if l, ok := e.(*ast.BasicLit); ok && l.Kind == token.STRING {
			s, _ := strconv.Unquote(l.Value)
			out = append(out, s)
		}
	}
	ast.Inspect(f, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.ValueSpec:
			if len(x.Names) == 1 && x.Names[0].Name == "requestHandlers" && len(x.Values) == 1 {
				if cl, ok := x.Values[0].(*ast.CompositeLit); ok {
					for _, e := range cl.Elts {
						add(e.(*ast.KeyValueExpr).Key)
					}
				}
			}
		case *ast.CaseClause:
			for _, e := range x.List {
				add(e)
			}
		}
		return true
	})
	if len(out) < 20 {
		t.Fatalf("parsed %d git requests from handlers.go, parser out of date", len(out))
	}
	return out
}

func TestEveryBoundMethodAndRequestHasAFlow(t *testing.T) {
	app := flowharness.New(t)
	names := append(flowtest.BoundMethods(app.W.Bound()), gitRequests(t)...)
	flowtest.CheckCoverage(t, "bound", names, "..", ".", "exempt.txt")
}
