// Package filetypes is the one extension vocabulary behind Kira Space's role as a viewer for code
// and data files: the Info.plist document types, the open-path filter and the default-app pane
// all read this table.
//
// Deliberately excluded:
//   - html, htm: the system browser is the right default; a read-only source view is worse.
//   - txt, rtf: plain prose, not code or data.
//   - .env, Dockerfile, Makefile: no extension to associate.
//   - sqlite, db: binary, Kira Studio's domain; the viewer would show "binary".
//   - ipynb, parquet, xlsx: no viewer here.
//
// The extension ts also names MPEG-2 transport streams on macOS. The darwin registry only accepts a
// type that conforms to public.text, so a machine that resolves ts as video reports it unavailable.
package filetypes

import (
	"path/filepath"
	"slices"
	"strings"
)

// Group ids.
const (
	GroupCode = "code"
	GroupData = "data"
)

// Entry is one associated extension (lower case, no dot).
type Entry struct {
	Ext         string
	Group       string
	UTI         string
	Imported    bool   // declared by the bundle as an imported type; false for a system-declared UTI
	ConformsTo  string // UTTypeConformsTo of an imported type
	Description string // UTTypeDescription of an imported type
}

const (
	sourceCode = "public.source-code"
	plainText  = "public.plain-text"
)

func sys(ext, group, uti string) Entry { return Entry{Ext: ext, Group: group, UTI: uti} }

func imp(ext, group, uti, conforms, desc string) Entry {
	return Entry{Ext: ext, Group: group, UTI: uti, Imported: true, ConformsTo: conforms, Description: desc}
}

func own(ext, desc string) Entry {
	return imp(ext, GroupCode, "com.kirathecat.kira-space."+ext, sourceCode, desc)
}

func ownData(ext, desc string) Entry {
	return imp(ext, GroupData, "com.kirathecat.kira-space."+ext, plainText, desc)
}

var entries = []Entry{
	imp("ts", GroupCode, "com.microsoft.typescript", sourceCode, "TypeScript source"),
	own("tsx", "TypeScript JSX source"),
	own("mts", "TypeScript module source"),
	own("cts", "TypeScript CommonJS source"),
	sys("js", GroupCode, "com.netscape.javascript-source"),
	own("jsx", "JavaScript JSX source"),
	own("mjs", "JavaScript module source"),
	own("cjs", "JavaScript CommonJS source"),
	own("vue", "Vue single-file component"),
	own("svelte", "Svelte component"),
	sys("py", GroupCode, "public.python-script"),
	imp("go", GroupCode, "org.golang.go-source", sourceCode, "Go source"),
	own("rs", "Rust source"),
	sys("java", GroupCode, "com.sun.java-source"),
	own("kt", "Kotlin source"),
	own("kts", "Kotlin script"),
	sys("swift", GroupCode, "public.swift-source"),
	sys("c", GroupCode, "public.c-source"),
	sys("h", GroupCode, "public.c-header"),
	sys("cpp", GroupCode, "public.c-plus-plus-source"),
	sys("cc", GroupCode, "public.c-plus-plus-source"),
	sys("cxx", GroupCode, "public.c-plus-plus-source"),
	sys("hpp", GroupCode, "public.c-plus-plus-header"),
	sys("m", GroupCode, "public.objective-c-source"),
	sys("mm", GroupCode, "public.objective-c-plus-plus-source"),
	sys("rb", GroupCode, "public.ruby-script"),
	sys("php", GroupCode, "public.php-script"),
	sys("pl", GroupCode, "public.perl-script"),
	own("lua", "Lua source"),
	sys("sh", GroupCode, "public.shell-script"),
	sys("bash", GroupCode, "public.bash-script"),
	sys("zsh", GroupCode, "public.zsh-script"),
	own("sql", "SQL source"),
	imp("graphql", GroupCode, "com.kirathecat.kira-space.graphql", sourceCode, "GraphQL source"),
	imp("gql", GroupCode, "com.kirathecat.kira-space.graphql", sourceCode, "GraphQL source"),
	own("proto", "Protocol Buffers source"),
	sys("css", GroupCode, "public.css"),
	own("scss", "SCSS source"),
	own("less", "Less source"),
	sys("md", GroupCode, "net.daringfireball.markdown"),
	sys("markdown", GroupCode, "net.daringfireball.markdown"),

	sys("json", GroupData, "public.json"),
	ownData("jsonc", "JSON with comments"),
	ownData("jsonl", "JSON lines"),
	imp("ndjson", GroupData, "com.kirathecat.kira-space.jsonl", plainText, "JSON lines"),
	sys("yaml", GroupData, "public.yaml"),
	sys("yml", GroupData, "public.yaml"),
	ownData("toml", "TOML data"),
	sys("xml", GroupData, "public.xml"),
	sys("csv", GroupData, "public.comma-separated-values-text"),
	sys("tsv", GroupData, "public.tab-separated-values-text"),
	ownData("ini", "INI configuration"),
	ownData("cfg", "Configuration file"),
	ownData("conf", "Configuration file"),
	sys("log", GroupData, "com.apple.log"),
}

// GroupInfo names a group and its Finder-facing label.
type GroupInfo struct {
	ID       string
	TypeName string
}

// Groups lists the groups in display order.
var Groups = []GroupInfo{
	{GroupCode, "Source code"},
	{GroupData, "Data file"},
}

// All returns the table in declaration order.
func All() []Entry { return slices.Clone(entries) }

// ByGroup returns one group's entries in declaration order.
func ByGroup(group string) []Entry {
	var out []Entry
	for _, e := range entries {
		if e.Group == group {
			out = append(out, e)
		}
	}
	return out
}

// Lookup finds an entry by extension, with or without the dot, any case.
func Lookup(ext string) (Entry, bool) {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	for _, e := range entries {
		if e.Ext == ext {
			return e, true
		}
	}
	return Entry{}, false
}

// Supports reports whether path's extension is in the vocabulary.
func Supports(path string) bool {
	_, ok := Lookup(filepath.Ext(path))
	return ok
}

// UTIs returns a group's distinct UTIs in first-seen order.
func UTIs(group string) []string {
	var out []string
	for _, e := range ByGroup(group) {
		if !slices.Contains(out, e.UTI) {
			out = append(out, e.UTI)
		}
	}
	return out
}

// ImportedTypes is one UTImportedTypeDeclarations dict: the extensions sharing an imported UTI.
type ImportedTypes struct {
	UTI         string
	ConformsTo  string
	Description string
	Extensions  []string
}

// Imported returns the imported declarations, grouped by UTI in first-seen order.
func Imported() []ImportedTypes {
	var out []ImportedTypes
	for _, e := range entries {
		if !e.Imported {
			continue
		}
		i := slices.IndexFunc(out, func(t ImportedTypes) bool { return t.UTI == e.UTI })
		if i < 0 {
			out = append(out, ImportedTypes{UTI: e.UTI, ConformsTo: e.ConformsTo, Description: e.Description})
			i = len(out) - 1
		}
		out[i].Extensions = append(out[i].Extensions, e.Ext)
	}
	return out
}
