package memfmt

import (
	"path"
	"sort"
	"strings"
)

// Marker is a comment syntax. An empty Close is a line comment. NoDashes forbids "--" in text
// (XML comments).
type Marker struct {
	Open, Close string
	NoDashes    bool
}

var (
	slash = Marker{Open: "//"}
	hash  = Marker{Open: "#"}
	dash  = Marker{Open: "--"}
	semi  = Marker{Open: ";"}
	pct   = Marker{Open: "%"}
	html  = Marker{Open: "<!--", Close: "-->"}
	xml   = Marker{Open: "<!--", Close: "-->", NoDashes: true}
	cssM  = Marker{Open: "/*", Close: "*/"}
)

var markersByExt = map[string][]Marker{}

func init() {
	add := func(m []Marker, exts string) {
		for _, e := range strings.Fields(exts) {
			markersByExt[e] = m
		}
	}
	add([]Marker{slash}, "go ts tsx mts cts js jsx mjs cjs java kt kts scala groovy swift rs c h cc cpp hpp cs dart php zig proto jsonc scss less")
	add([]Marker{hash}, "py sh bash zsh fish rb pl r yaml yml toml tf hcl ex exs nim ps1 cmake mk dockerfile makefile")
	add([]Marker{dash}, "sql lua hs elm")
	add([]Marker{semi}, "clj cljs el lisp scm ini")
	add([]Marker{pct}, "erl tex")
	add([]Marker{html}, "html")
	add([]Marker{xml}, "xml svg")
	add([]Marker{cssM}, "css")
	add([]Marker{slash, html}, "vue svelte")
}

// extOf lowercases the extension of a path; a bare word such as "go" or ".py" is its own extension.
// Dockerfile and Makefile are matched by base name.
func extOf(p string) string {
	base := path.Base(strings.ReplaceAll(p, "\\", "/"))
	switch strings.ToLower(base) {
	case "dockerfile", "makefile":
		return strings.ToLower(base)
	}
	if i := strings.LastIndex(base, "."); i >= 0 {
		return strings.ToLower(base[i+1:])
	}
	return strings.ToLower(base)
}

// MarkersFor lists the comment syntaxes of a file path or bare extension, false when unsupported.
func MarkersFor(p string) ([]Marker, bool) {
	m, ok := markersByExt[extOf(p)]
	return m, ok
}

// IsDocPath reports whether a path is a doc file candidate (.md or .txt).
func IsDocPath(p string) bool {
	e := extOf(p)
	return e == "md" || e == "txt"
}

// Supported lists every supported extension and file name, sorted, for error messages.
func Supported() []string {
	out := make([]string, 0, len(markersByExt))
	for e := range markersByExt {
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}
