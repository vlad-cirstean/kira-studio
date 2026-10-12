// Package conventiontest guards Go-wide conventions (P266). A file a guard cannot apply to sits in
// permanentExemptions with its reason; an entry whose file no longer violates fails the test, so
// the list only shrinks.
package conventiontest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// permanentExemptions are `G<n> <path>` pairs that stay forever, each with its reason.
var permanentExemptions = map[string]string{
	"G4 apps/kira-studio/internal/flowharness/harness.go":      "test tooling writes throwaway fixtures; a torn write only fails the test run",
	"G4 apps/kira-studio/internal/flowharness/servers/ca.go":   "test tooling writes throwaway fixtures; a torn write only fails the test run",
	"G4 apps/kira-studio/internal/flowharness/servers/grpc.go": "test tooling writes throwaway fixtures; a torn write only fails the test run",
	"G4 apps/kira-studio/internal/ipcfixture/write.go":         "test tooling writes throwaway fixtures; a torn write only fails the test run",
	"G4 apps/kira-space/internal/flowharness/gitrepo.go":       "test tooling writes throwaway fixtures; no reader to protect from a torn write",
	"G4 apps/kira-space/internal/flowharness/harness.go":       "test tooling writes throwaway fixtures; no reader to protect from a torn write",
	"G4 apps/kira-space/internal/gitsession/incremental.go":    "writes temp files into a per-call os.MkdirTemp dir that is deleted before return; nothing else reads them",
	"G4 internal/flowtest/contract.go":                         "test-only harness writes fixtures straight to a temp dir; no crash-safety need",
	"G4 internal/flowtest/fakeagent/fakeagent.go":              "test-only harness writes fixtures straight to a temp dir; no crash-safety need",
}

// ipcerrMsg maps an ipcerr constructor to its message argument index.
var ipcerrMsg = map[string]int{"New": 1, "BadRequest": 0, "NotFound": 0, "Internal": 0, "SecretStore": 0}

type finding struct {
	rule string
	path string
	line int
	msg  string
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func isString(e ast.Expr) bool {
	lit, ok := e.(*ast.BasicLit)
	return ok && lit.Kind == token.STRING
}

// isFormatted reports a fmt.Sprintf or fmt.Errorf call.
func isFormatted(e ast.Expr) bool {
	call, ok := e.(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	return ok && pkg.Name == "fmt" && (sel.Sel.Name == "Sprintf" || sel.Sel.Name == "Errorf")
}

func literalMessage(e ast.Expr) bool { return isString(e) || isFormatted(e) }

func hasScopeKey(args []ast.Expr) bool {
	for _, a := range args {
		if lit, ok := a.(*ast.BasicLit); ok && lit.Kind == token.STRING && lit.Value == `"scope"` {
			return true
		}
	}
	return false
}

var slogLevels = map[string]bool{"Debug": true, "Info": true, "Warn": true, "Error": true}

func scan(t *testing.T, root, rel string) []finding {
	t.Helper()
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filepath.Join(root, rel), nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", rel, err)
	}
	inAdapters := strings.HasSuffix(filepath.ToSlash(filepath.Dir(rel)), "internal/adapters")
	inHTTPClient := strings.HasSuffix(filepath.ToSlash(filepath.Dir(rel)), "internal/httpclient")
	isCodes := filepath.ToSlash(rel) == "internal/ipcerr/codes.go"
	var out []finding
	add := func(rule string, pos token.Pos, msg string) {
		out = append(out, finding{rule, filepath.ToSlash(rel), fset.Position(pos).Line, msg})
	}
	// codes.go may only declare `Code = "E_..."` constants: a retired-code map or any other
	// code literal there is a legacy code and fails like one anywhere else.
	declared := map[token.Pos]bool{}
	if isCodes {
		ast.Inspect(f, func(n ast.Node) bool {
			if vs, ok := n.(*ast.ValueSpec); ok {
				if id, ok := vs.Type.(*ast.Ident); ok && id.Name == "Code" {
					for _, v := range vs.Values {
						declared[v.Pos()] = true
					}
				}
			}
			return true
		})
	}
	ast.Inspect(f, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.BasicLit:
			if x.Kind == token.STRING && isErrorCodeLiteral(x.Value) && !declared[x.Pos()] {
				add("G2", x.Pos(), "error code literal "+x.Value+"; use the ipcerr constant")
			}
		case *ast.CallExpr:
			checkCall(x, inAdapters, inHTTPClient, add)
		}
		return true
	})
	return out
}

func isErrorCodeLiteral(v string) bool {
	if len(v) < 5 || v[0] != '"' || !strings.HasPrefix(v[1:], "E_") {
		return false
	}
	for _, r := range v[3 : len(v)-1] {
		if (r < 'A' || r > 'Z') && r != '_' && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

func checkCall(x *ast.CallExpr, inAdapters, inHTTPClient bool, add func(string, token.Pos, string)) {
	msgArg := func(idx int) {
		if idx < len(x.Args) && literalMessage(x.Args[idx]) {
			add("G1", x.Pos(), "literal or formatted message; use a catalog key (ipcerr.T) or ipcerr.Contract")
		}
	}
	switch fun := x.Fun.(type) {
	case *ast.SelectorExpr:
		pkg, ok := fun.X.(*ast.Ident)
		if !ok {
			return
		}
		switch pkg.Name {
		case "ipcerr":
			if idx, ok := ipcerrMsg[fun.Sel.Name]; ok {
				msgArg(idx)
			}
		case "adapters":
			if fun.Sel.Name == "New" {
				msgArg(1)
			}
		case "slog", "logger":
			if slogLevels[fun.Sel.Name] && !hasScopeKey(x.Args) {
				add("G3", x.Pos(), "slog call without a \"scope\" key")
			}
		case "os":
			if fun.Sel.Name == "WriteFile" {
				add("G4", x.Pos(), "os.WriteFile; use renameio.WriteFile")
			}
		}
	case *ast.Ident:
		switch {
		case fun.Name == "setBlocker":
			msgArg(1)
		case fun.Name == "newError" && inHTTPClient:
			msgArg(1)
		case fun.Name == "New" && inAdapters:
			msgArg(1)
		}
	}
}

func goFiles(t *testing.T, root string) []string {
	t.Helper()
	var files []string
	for _, dir := range []string{"apps", "internal"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				switch d.Name() {
				case "node_modules", "testdata", "vendor":
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasSuffix(p, ".go") && !strings.HasSuffix(p, "_test.go") {
				rel, _ := filepath.Rel(root, p)
				files = append(files, rel)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return files
}

func TestGoConventions(t *testing.T) {
	root := repoRoot(t)
	hit := map[string]bool{}
	var failures []string
	for _, rel := range goFiles(t, root) {
		for _, f := range scan(t, root, rel) {
			key := f.rule + " " + f.path
			hit[key] = true
			if permanentExemptions[key] != "" {
				continue
			}
			failures = append(failures, f.path+":"+strconv.Itoa(f.line)+": "+f.rule+" "+f.msg)
		}
	}
	for key := range permanentExemptions {
		if !hit[key] {
			failures = append(failures, "stale exemption: "+key)
		}
	}
	sort.Strings(failures)
	for _, f := range failures {
		t.Error(f)
	}
}
