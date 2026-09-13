package codeparse

import (
	"testing"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// fixtures is one one-line snippet per grammar (S1): proof that grammarCtors, languageFor's ABI
// check, and the underlying cgo build all actually work, for every grammar this phase takes a
// dependency on. Vue is excluded — it has no grammar of its own (containerOf resolves it to
// HTML, exercised via the HTML case).
var fixtures = map[ID]string{
	Java:       "class A {}\n",
	Python:     "x = 1\n",
	JavaScript: "const x = 1;\n",
	TypeScript: "const x: number = 1;\n",
	TSX:        "const x = <div/>;\n",
	Go:         "package a\n",
	Rust:       "fn main() {}\n",
	HTML:       "<div>hi</div>\n",
	CSS:        "a { color: red; }\n",
	JSON:       "{\"a\": 1}\n",
	Svelte:     "<div>{count}</div>\n",
}

func TestGrammarsParseOneLineFixture(t *testing.T) {
	for id, src := range fixtures {
		t.Run(string(id), func(t *testing.T) {
			lang, err := languageFor(id)
			if err != nil {
				t.Fatalf("languageFor(%s): %v", id, err)
			}

			parser := sitter.NewParser()
			defer parser.Close()
			if err := parser.SetLanguage(lang); err != nil {
				t.Fatalf("SetLanguage(%s): %v", id, err)
			}

			tree := parser.Parse([]byte(src), nil)
			if tree == nil {
				t.Fatalf("Parse(%s) returned a nil tree", id)
			}
			defer tree.Close()

			root := tree.RootNode()
			if root == nil {
				t.Fatalf("%s: nil root node", id)
			}
			if root.HasError() {
				t.Fatalf("%s: root node reports a parse error for fixture %q", id, src)
			}
		})
	}
}

func TestLanguageForVueResolvesToHTML(t *testing.T) {
	lang, err := languageFor(Vue)
	if err != nil {
		t.Fatalf("languageFor(Vue): %v", err)
	}
	htmlLang, err := languageFor(HTML)
	if err != nil {
		t.Fatalf("languageFor(HTML): %v", err)
	}
	if lang != htmlLang {
		t.Fatal("languageFor(Vue) did not resolve to the cached HTML language")
	}
}

func TestLanguageForUnknownID(t *testing.T) {
	if _, err := languageFor(ID("cobol")); err == nil {
		t.Fatal("expected an error for an unregistered language id")
	}
}
