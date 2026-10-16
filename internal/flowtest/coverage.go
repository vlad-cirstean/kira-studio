package flowtest

import (
	"bufio"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var lifecycleMethods = map[string]bool{"ServiceStartup": true, "ServiceShutdown": true, "ServiceName": true}

// BoundMethods lists "Type.Method" for every exported method Wails binds on the services.
func BoundMethods(svcs []application.Service) []string {
	var out []string
	for _, s := range svcs {
		t := reflect.TypeOf(s.Instance())
		name := strings.TrimPrefix(t.String(), "*")
		name = name[strings.LastIndex(name, ".")+1:]
		for i := 0; i < t.NumMethod(); i++ {
			if m := t.Method(i).Name; !lifecycleMethods[m] {
				out = append(out, name+"."+m)
			}
		}
	}
	return out
}

// CheckCoverage fails the test for every name that no flow test source references and no exempt
// line covers, and for every stale exempt line. names are "Type.Method" (matched as `.Method(`)
// or a bare request name (matched as a quoted string). Name match, not call-graph proof.
// flowsDir is walked for *_test.go, excluding skipDir. exemptFile lines are "name: reason".
func CheckCoverage(t *testing.T, label string, names []string, flowsDir, skipDir, exemptFile string) {
	t.Helper()
	var src strings.Builder
	err := filepath.WalkDir(flowsDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && p == skipDir {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.HasSuffix(p, "_test.go") {
			b, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			src.Write(b)
			src.WriteByte('\n')
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	text := src.String()
	exempt := readExempt(t, exemptFile)
	called := func(name string) bool {
		if i := strings.IndexByte(name, '.'); i >= 0 && !strings.HasPrefix(name, "\"") && isBoundName(name) {
			return regexp.MustCompile(`\.` + regexp.QuoteMeta(name[i+1:]) + `\(`).MatchString(text)
		}
		return strings.Contains(text, `"`+name+`"`)
	}
	known := map[string]bool{}
	var missing []string
	for _, n := range names {
		known[n] = true
		switch ok := called(n); {
		case exempt[n] != "" && ok:
			t.Errorf("%s: stale exempt line %q (now covered)", exemptFile, n)
		case exempt[n] == "" && !ok:
			missing = append(missing, n)
		}
	}
	var stale []string
	for n := range exempt {
		if !known[n] {
			stale = append(stale, n)
		}
	}
	sort.Strings(stale)
	for _, n := range stale {
		t.Errorf("%s: stale exempt line %q (no such method)", exemptFile, n)
	}
	slices.Sort(missing)
	if len(missing) > 0 {
		t.Errorf("%d %s methods never called in a flow test (call it, or add `name: reason` to %s):\n  %s",
			len(missing), label, exemptFile, strings.Join(missing, "\n  "))
	}
	t.Logf("checked %d bound methods and requests, %d exempt", len(names), len(exempt))
}

// bound names are CamelCase "Type.Method"; request names are lowercase-first "group.verb".
func isBoundName(n string) bool { return n[0] >= 'A' && n[0] <= 'Z' }

func readExempt(t *testing.T, path string) map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, reason, ok := strings.Cut(line, ": ")
		if !ok || strings.TrimSpace(reason) == "" {
			t.Fatalf("%s:%d: want `name: reason`", path, n)
		}
		out[strings.TrimSpace(name)] = strings.TrimSpace(reason)
	}
	if err := sc.Err(); err != nil {
		t.Fatal(fmt.Errorf("%s: %w", path, err))
	}
	return out
}
