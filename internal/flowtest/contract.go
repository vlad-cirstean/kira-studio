package flowtest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// EnvContract set to "write" rewrites contract fixtures instead of comparing against them.
const EnvContract = "KIRA_CONTRACT"

var (
	uuidRe = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	timeRe = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})`)

	contractMu sync.Mutex
)

// ContractOption tunes one Contract call.
type ContractOption func(*contractCfg)

type contractCfg struct {
	replace [][2]string
	mask    map[string]bool
}

// Replace rewrites every occurrence of from inside string values with the placeholder to. Longer
// from values win, so nest paths before their parents' prefixes.
func Replace(from, to string) ContractOption {
	return func(c *contractCfg) {
		if from != "" {
			c.replace = append(c.replace, [2]string{from, to})
		}
	}
}

// Mask replaces the value under each named object key, at any depth, with "<masked>": durations,
// pids, ports and other volatile fields the automatic rules miss.
func Mask(keys ...string) ContractOption {
	return func(c *contractCfg) {
		for _, k := range keys {
			c.mask[k] = true
		}
	}
}

// Contract compares got, as the bridge would marshal it, against key in <dir>/<scenario>.json and
// fails on any difference. With KIRA_CONTRACT=write it stores got there instead. The UI specs
// read the same file as the mock answer for that call, so a changed Go shape fails here until the
// file is regenerated, and a regenerated file shows the UI specs the new shape.
//
// Normalisation keeps the file stable and machine independent: UUIDs become <id:n> and RFC3339
// timestamps <time:n>, numbered by first appearance in the value (equal inputs stay equal); Replace
// swaps paths and URLs for placeholders.
func Contract(t testing.TB, dir, scenario, key string, got any, opts ...ContractOption) {
	t.Helper()
	norm := NormalizeContract(t, got, opts...)
	path := filepath.Join(dir, scenario+".json")
	contractMu.Lock()
	defer contractMu.Unlock()
	doc := map[string]any{}
	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("contract %s: %v", path, err)
		}
	case !os.IsNotExist(err):
		t.Fatalf("contract %s: %v", path, err)
	}
	if os.Getenv(EnvContract) == "write" {
		doc[key] = norm
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, encodeContract(t, doc), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, ok := doc[key]
	if !ok {
		t.Fatalf("contract %s has no key %q; regenerate with %s=write", path, key, EnvContract)
	}
	if diff := cmp.Diff(want, norm); diff != "" {
		t.Fatalf("contract %s key %q drifted (-fixture +actual); regenerate with %s=write if intended:\n%s", path, key, EnvContract, diff)
	}
}

// NormalizeContract returns got marshalled, decoded and normalised the way Contract stores it.
func NormalizeContract(t testing.TB, got any, opts ...ContractOption) any {
	t.Helper()
	cfg := contractCfg{mask: map[string]bool{}}
	for _, o := range opts {
		o(&cfg)
	}
	sort.SliceStable(cfg.replace, func(i, j int) bool { return len(cfg.replace[i][0]) > len(cfg.replace[j][0]) })
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("contract: marshal: %v", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("contract: decode: %v", err)
	}
	n := &normalizer{cfg: cfg, ids: map[string]int{}, times: map[string]int{}}
	return n.walk(v)
}

type normalizer struct {
	cfg   contractCfg
	ids   map[string]int
	times map[string]int
}

func (n *normalizer) walk(v any) any {
	switch x := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(x))
		for _, k := range keys {
			if n.cfg.mask[k] {
				out[k] = "<masked>"
				continue
			}
			out[k] = n.walk(x[k])
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = n.walk(e)
		}
		return out
	case string:
		return n.str(x)
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return x.String()
		}
		return f
	default:
		return v
	}
}

func (n *normalizer) str(s string) string {
	for _, r := range n.cfg.replace {
		s = strings.ReplaceAll(s, r[0], r[1])
	}
	s = uuidRe.ReplaceAllStringFunc(s, func(m string) string { return number(n.ids, "id", strings.ToLower(m)) })
	return timeRe.ReplaceAllStringFunc(s, func(m string) string { return number(n.times, "time", m) })
}

func number(seen map[string]int, kind, m string) string {
	i, ok := seen[m]
	if !ok {
		i = len(seen) + 1
		seen[m] = i
	}
	return fmt.Sprintf("<%s:%d>", kind, i)
}

func encodeContract(t testing.TB, doc map[string]any) []byte {
	t.Helper()
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(doc); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
