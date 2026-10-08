package importer

import (
	"strings"
	"testing"
	"unicode"
)

func words(n int, tag string) string {
	var w []string
	for i := 0; i < n; i++ {
		w = append(w, tag+"x")
	}
	return strings.Join(w, " ")
}

func stripSpace(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
}

func TestChunking(t *testing.T) {
	small := Budget{Target: 30, Max: 60, MinFill: 15, MinTail: 1, Context: 10}
	roomy := Budget{Target: 100, Max: 200, MinFill: 15, MinTail: 1, Context: 10}
	tailBudget := Budget{Target: 30, Max: 60, MinFill: 15, MinTail: 8, Context: 10}

	cases := []struct {
		name     string
		src      string
		b        Budget
		text     bool
		title    string
		check    func(t *testing.T, cs []Chunk)
		noLoss   bool
		maxTitle bool
	}{
		{
			name: "heading path across nested levels", b: small, title: "Guide",
			src: "# Guide\n\n" + words(14, "a") + "\n\n## Setup\n\n" + words(14, "b") + "\n\n### Docker\n\n" + words(14, "c") + "\n\n## Usage\n\n" + words(14, "d"),
			check: func(t *testing.T, cs []Chunk) {
				var got []string
				for _, c := range cs {
					got = append(got, c.HeadingPath)
				}
				want := "Guide|Guide > Setup|Guide > Setup > Docker|Guide > Usage"
				if strings.Join(got, "|") != want {
					t.Errorf("paths = %q, want %q", strings.Join(got, "|"), want)
				}
			},
		},
		{
			name: "heading splits only after minimum fill", b: roomy, title: "A",
			src: "# A\n\nshort\n\n## B\n\n" + words(12, "p") + "\n\n## C\n\n" + words(12, "q"),
			check: func(t *testing.T, cs []Chunk) {
				if len(cs) != 2 || !strings.HasPrefix(cs[0].Text, "# A") || !strings.Contains(cs[0].Text, "## B") ||
					!strings.HasPrefix(cs[1].Text, "## C") {
					t.Errorf("chunks = %+v", cs)
				}
			},
		},
		{
			name: "fenced blocks never split", b: Budget{Target: 20, Max: 100, MinFill: 5, MinTail: 1, Context: 5},
			src: words(11, "a") + "\n\n```go\nfirst\n\nsecond\n```\n\n" + words(11, "b") + "\n\n~~~~\none\n\n~~~\ntwo\n\n~~~~\n\n" + words(11, "c"),
			check: func(t *testing.T, cs []Chunk) {
				for _, c := range cs {
					if strings.Contains(c.Text, "first") != strings.Contains(c.Text, "second") ||
						strings.Contains(c.Text, "one") != strings.Contains(c.Text, "two") {
						t.Errorf("fence split across chunks: %q", c.Text)
					}
				}
			},
			noLoss: true,
		},
		{
			name: "setext heading", b: roomy, title: "Title",
			src: "Title\n=====\n\n" + words(5, "a") + "\n\nSub\n---\n\n" + words(10, "b"),
			check: func(t *testing.T, cs []Chunk) {
				if len(cs) != 1 || cs[0].HeadingPath != "Title" {
					t.Errorf("chunks = %+v", cs)
				}
			},
		},
		{
			name: "oversized paragraph splits at lines, sentences, then runes", b: small,
			src: strings.Repeat(words(8, "l")+"\n", 12) + "\n" + strings.Repeat("One sentence here. Another one follows! ", 12) + "\n\n" + strings.Repeat("z", 700),
			check: func(t *testing.T, cs []Chunk) {
				if len(cs) < 5 {
					t.Errorf("chunks = %d", len(cs))
				}
			},
			noLoss: true,
		},
		{
			name: "small tail merges back", b: tailBudget,
			src: words(14, "a") + "\n\n" + words(14, "b") + "\n\ntiny tail",
			check: func(t *testing.T, cs []Chunk) {
				if last := cs[len(cs)-1]; !strings.Contains(last.Text, "tiny tail") || last.Tokens < tailBudget.MinTail {
					t.Errorf("tail not merged: %+v", cs)
				}
			},
			noLoss: true,
		},
		{
			name: "context is the previous tail cut at a line start", b: Budget{Target: 30, Max: 60, MinFill: 15, MinTail: 1, Context: 10}, title: "A",
			src: "# A\n\n" + words(14, "a") + "\nsecond line here\n\n## B\n\n" + words(14, "b"),
			check: func(t *testing.T, cs []Chunk) {
				if len(cs) != 2 || cs[0].Context != "" {
					t.Fatalf("chunks = %+v", cs)
				}
				ctx := cs[1].Context
				if ctx == "" || !strings.HasSuffix(cs[0].Text, ctx) || !strings.Contains(cs[0].Text, "\n"+ctx) {
					t.Errorf("context %q is not a line-start tail of %q", ctx, cs[0].Text)
				}
			},
		},
		{
			name: "plain text splits on blank lines only", b: small, text: true,
			src: "# not a heading\n" + words(14, "a") + "\n\n" + words(14, "b") + "\n\n" + words(14, "c"),
			check: func(t *testing.T, cs []Chunk) {
				if len(cs) < 2 {
					t.Fatalf("chunks = %+v", cs)
				}
				for _, c := range cs {
					if c.HeadingPath != "" {
						t.Errorf("text chunk has heading path %q", c.HeadingPath)
					}
				}
			},
			noLoss: true,
		},
		{
			name: "no first-level heading", b: roomy, title: "",
			src:   "## Only second\n\ntext here",
			check: func(t *testing.T, cs []Chunk) {},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var cs []Chunk
			title := ""
			if c.text {
				cs = ChunkText(c.src, c.b)
			} else {
				cs, title = ChunkMarkdown(c.src, c.b)
			}
			if title != c.title {
				t.Errorf("title = %q, want %q", title, c.title)
			}
			var all strings.Builder
			for i, ch := range cs {
				if ch.Index != i || ch.Tokens > c.b.Max {
					t.Errorf("chunk %d: index %d tokens %d (max %d)", i, ch.Index, ch.Tokens, c.b.Max)
				}
				all.WriteString(ch.Text)
			}
			if c.noLoss && stripSpace(all.String()) != stripSpace(c.src) {
				t.Errorf("text lost or duplicated:\n got %q\nwant %q", stripSpace(all.String()), stripSpace(c.src))
			}
			c.check(t, cs)
		})
	}
}
