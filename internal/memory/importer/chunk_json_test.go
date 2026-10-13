package importer

import (
	"fmt"
	"strings"
	"testing"
)

func TestChunkJSON(t *testing.T) {
	b := Budget{Target: 30, Max: 60, MinFill: 15, MinTail: 1, Context: 10}
	pad := func(tag string) string { return tag + " " + strings.Repeat("word ", 18) }

	paths := func(cs []Chunk) string {
		var p []string
		for _, c := range cs {
			p = append(p, c.HeadingPath)
		}
		return strings.Join(p, "|")
	}
	cases := []struct {
		name  string
		src   string
		lines bool
		want  string // joined HeadingPath of every chunk
		check func(t *testing.T, cs []Chunk)
	}{
		{
			name: "top-level array: one unit per element",
			src:  fmt.Sprintf(`[{"m":%q},{"m":%q},{"m":%q}]`, pad("a"), pad("b"), pad("c")),
			want: "$[0]|$[1]|$[2]",
		},
		{
			name: "top-level object: one unit per member, quoted paths for odd keys",
			src:  fmt.Sprintf(`{"one":%q,"two-x":%q}`, pad("a"), pad("b")),
			want: `$.one|$["two-x"]`,
			check: func(t *testing.T, cs []Chunk) {
				if !strings.HasPrefix(cs[0].Text, `"one": "a `) || !strings.HasPrefix(cs[1].Text, `"two-x": "b `) {
					t.Errorf("members not rendered as key: value: %q / %q", cs[0].Text, cs[1].Text)
				}
			},
		},
		{
			name: "over-size element recurses into its children",
			src:  fmt.Sprintf(`[{"issues":[%q,%q,%q,%q]}]`, pad("a"), pad("b"), pad("c"), pad("d")),
			want: "$[0].issues[0]|$[0].issues[1]|$[0].issues[2]|$[0].issues[3]",
		},
		{
			name: "over-size string splits as text",
			src:  fmt.Sprintf(`[{"body":%q}]`, strings.Repeat("sentence. ", 80)),
			check: func(t *testing.T, cs []Chunk) {
				if len(cs) < 2 {
					t.Fatalf("string not split: %d chunks", len(cs))
				}
				for _, c := range cs {
					if c.HeadingPath != "$[0].body" {
						t.Errorf("path = %q", c.HeadingPath)
					}
				}
			},
		},
		{
			name: "key order and number spelling survive",
			src:  `{"zeta":1.50,"alpha":1e3,"mid":{"b":2,"a":1}}`,
			check: func(t *testing.T, cs []Chunk) {
				all := cs[0].Text
				for i, want := range []string{`"zeta": 1.50`, `"alpha": 1e3`, `"b": 2`, `"a": 1`} {
					at := strings.Index(all, want)
					if at < 0 || (i > 0 && at < strings.Index(all, []string{`"zeta": 1.50`, `"alpha": 1e3`, `"b": 2`}[i-1])) {
						t.Errorf("%q missing or out of order in %q", want, all)
					}
				}
			},
		},
		{
			name: "JSON Lines skips blank lines and numbers the rest",
			src:  fmt.Sprintf("{\"m\":%q}\n\n{\"m\":%q}\n", pad("a"), pad("b")), lines: true,
			want: "line 1|line 3",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var cs []Chunk
			var err error
			if tc.lines {
				cs, err = ChunkJSONLines(tc.src, b)
			} else {
				cs, err = ChunkJSON(tc.src, b)
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, c := range cs {
				if c.Tokens > b.Max {
					t.Errorf("chunk %d has %d tokens, over Max %d", c.Index, c.Tokens, b.Max)
				}
			}
			if tc.want != "" && paths(cs) != tc.want {
				t.Errorf("paths = %q, want %q", paths(cs), tc.want)
			}
			if tc.check != nil {
				tc.check(t, cs)
			}
		})
	}

	t.Run("invalid input names the byte or line", func(t *testing.T) {
		if _, err := ChunkJSON(`{"a": 1,, "b": 2}`, b); err == nil || !strings.Contains(err.Error(), "Invalid JSON at byte ") {
			t.Errorf("error = %v", err)
		}
		if _, err := ChunkJSONLines("{\"a\":1}\n{oops}\n", b); err == nil || !strings.Contains(err.Error(), "line 2") {
			t.Errorf("error = %v", err)
		}
	})
}
