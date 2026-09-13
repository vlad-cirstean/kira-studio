package codeparse

import (
	"os"
	"testing"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

type blockRow struct {
	kind BlockKind
	lang ID
}

// TestInjectGoldenFixtures is §11 point 4: block discovery and lang resolution across .vue,
// .svelte and a plain .html with an inline <script>, plus the unsupported-lang case (the .html
// fixture's own <style lang="scss">) and the file-coordinate property — a symbol found inside an
// injected block reports the FILE's own byte offset, not an offset relative to the block, because
// every injected parse runs SetIncludedRanges over the same buffer (§3.2 step 4).
func TestInjectGoldenFixtures(t *testing.T) {
	cases := []struct {
		id     ID
		file   string
		blocks []blockRow
		syms   []symRow // block-qualified: parent is always -1 here, no fixture nests definitions
		refs   []refRow
	}{
		{
			id: Vue, file: "testdata/inject/sample.vue",
			blocks: []blockRow{
				{BlockTemplate, HTML}, // Vue has no grammar of its own (§1.2): HTML is what actually parsed it.
				{BlockScriptSetup, JavaScript},
				{BlockStyle, CSS},
			},
			syms: []symRow{{"function", "greet", -1}},
			refs: []refRow{{"call", "helper"}},
		},
		{
			id: Svelte, file: "testdata/inject/sample.svelte",
			blocks: []blockRow{
				{BlockScript, JavaScript},
				{BlockStyle, CSS},
			},
			syms: []symRow{{"function", "greet", -1}},
			refs: []refRow{{"call", "helper"}},
		},
		{
			// The unsupported-lang case: <style lang="scss"> is recorded, honestly, as
			// language "unsupported" and never parsed with the wrong grammar (§3.2).
			id: HTML, file: "testdata/inject/sample.html",
			blocks: []blockRow{
				{BlockScript, JavaScript},
				{BlockStyle, Unsupported},
			},
			syms: []symRow{{"function", "helper", -1}},
			refs: nil,
		},
	}

	for _, c := range cases {
		t.Run(string(c.id), func(t *testing.T) {
			src, err := os.ReadFile(c.file)
			if err != nil {
				t.Fatalf("read fixture: %v", err)
			}
			lang, err := languageFor(c.id)
			if err != nil {
				t.Fatalf("languageFor: %v", err)
			}
			parser := sitter.NewParser()
			defer parser.Close()
			if err := parser.SetLanguage(lang); err != nil {
				t.Fatalf("SetLanguage: %v", err)
			}
			tree := parser.Parse(src, nil)
			defer tree.Close()

			blocks, syms, refs, err := injectBlocks(tree, src, c.id)
			if err != nil {
				t.Fatalf("Inject: %v", err)
			}

			gotBlocks := make([]blockRow, len(blocks))
			for i, b := range blocks {
				gotBlocks[i] = blockRow{b.Kind, b.Language}
			}
			if !equalBlockRows(gotBlocks, c.blocks) {
				t.Fatalf("blocks mismatch:\n got:  %+v\n want: %+v", gotBlocks, c.blocks)
			}

			gotSyms := make([]symRow, len(syms))
			for i, s := range syms {
				gotSyms[i] = symRow{s.Kind, s.Name, s.ParentIndex}
				// The file-coordinate property (§11 point 4): a symbol found inside an
				// injected block must fall within that SAME block's own file-coordinate
				// byte range, not a range relative to the block's own start.
				block := blocks[s.BlockIndex]
				if s.StartByte < block.StartByte || s.EndByte > block.EndByte {
					t.Fatalf("symbol %q byte range [%d,%d) escapes its own block's file-coordinate range [%d,%d)",
						s.Name, s.StartByte, s.EndByte, block.StartByte, block.EndByte)
				}
			}
			if !equalSymRows(gotSyms, c.syms) {
				t.Fatalf("symbols mismatch:\n got:  %+v\n want: %+v", gotSyms, c.syms)
			}

			gotRefs := make([]refRow, len(refs))
			for i, r := range refs {
				gotRefs[i] = refRow{r.Kind, r.Name}
			}
			if !equalRefRows(gotRefs, c.refs) {
				t.Fatalf("references mismatch:\n got:  %+v\n want: %+v", gotRefs, c.refs)
			}
		})
	}
}

func equalBlockRows(a, b []blockRow) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
