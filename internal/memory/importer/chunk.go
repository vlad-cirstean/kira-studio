package importer

import (
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

// Budget sizes chunks in estimated tokens. Extraction recall drops as input grows while every call
// costs a fixed spawn, so chunks aim for Target, never exceed Max, and a heading starts a new chunk
// only once the current one holds MinFill.
type Budget struct {
	Target, Max, MinFill, MinTail, Context int
}

var DefaultBudget = Budget{Target: 3000, Max: 4000, MinFill: 1500, MinTail: 750, Context: 200}

// Chunk is one extraction unit. Context is the tail of the previous chunk, for reading only.
type Chunk struct {
	Index       int
	HeadingPath string
	Context     string
	Text        string
	Tokens      int
}

type unit struct {
	text    string
	tokens  int
	level   int // heading level when the unit starts with a heading, else 0
	path    string
	heading bool
}

type span struct{ start, end int }

type heading struct {
	level int
	text  string
}

// ChunkMarkdown splits Markdown at paragraph and heading boundaries without cutting fenced or
// indented code or HTML blocks. title is the first level-1 heading, empty when there is none.
func ChunkMarkdown(src string, b Budget) (chunks []Chunk, title string) {
	lines := newLineIndex(src)
	doc := goldmark.New().Parser().Parse(text.NewReader([]byte(src)))
	headings := map[int]heading{} // byte offset of the heading's line start
	var forbidden []span
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := n.(type) {
		case *ast.Heading:
			if v.Parent() == doc && v.Lines().Len() > 0 {
				headings[lines.lineStart(v.Lines().At(0).Start)] = heading{level: v.Level, text: headingText(v, src)}
			}
		case *ast.FencedCodeBlock:
			if v.Lines().Len() > 0 {
				first, last := v.Lines().At(0), v.Lines().At(v.Lines().Len()-1)
				forbidden = append(forbidden, span{lines.prevLineStart(first.Start), lines.nextLineEnd(last.Stop)})
			}
		case *ast.CodeBlock:
			if v.Lines().Len() > 0 {
				first, last := v.Lines().At(0), v.Lines().At(v.Lines().Len()-1)
				forbidden = append(forbidden, span{lines.lineStart(first.Start), lines.lineEnd(last.Stop)})
			}
		case *ast.HTMLBlock:
			if v.Lines().Len() > 0 {
				first, last := v.Lines().At(0), v.Lines().At(v.Lines().Len()-1)
				end := last.Stop
				if v.HasClosure() {
					end = v.ClosureLine.Stop
				}
				forbidden = append(forbidden, span{lines.lineStart(first.Start), lines.lineEnd(end)})
			}
		}
		return ast.WalkContinue, nil
	})
	for _, off := range sortedKeys(headings) {
		if h := headings[off]; h.level == 1 {
			title = h.text
			break
		}
	}
	return pack(buildUnits(src, lines, headings, forbidden, b), b), title
}

// ChunkText splits plain text at blank lines.
func ChunkText(src string, b Budget) []Chunk {
	return pack(buildUnits(src, newLineIndex(src), nil, nil, b), b)
}

func sortedKeys(m map[int]heading) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	return keys
}

func headingText(h *ast.Heading, src string) string {
	var parts []string
	_ = ast.Walk(h, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if t, ok := n.(*ast.Text); ok && entering {
			parts = append(parts, string(t.Segment.Value([]byte(src))))
		}
		return ast.WalkContinue, nil
	})
	return strings.TrimSpace(strings.Join(parts, " "))
}

// lineIndex maps byte offsets to line boundaries.
type lineIndex struct {
	src    string
	starts []int
}

func newLineIndex(src string) lineIndex {
	starts := []int{0}
	for i := 0; i < len(src); i++ {
		if src[i] == '\n' && i+1 < len(src) {
			starts = append(starts, i+1)
		}
	}
	return lineIndex{src: src, starts: starts}
}

func (l lineIndex) lineOf(off int) int {
	off = max(0, min(off, len(l.src)))
	return max(0, sort.SearchInts(l.starts, off+1)-1)
}

func (l lineIndex) lineStart(off int) int { return l.starts[l.lineOf(off)] }

// lineEnd is the offset just past the line holding off, newline included.
func (l lineIndex) lineEnd(off int) int {
	i := l.lineOf(off)
	if i+1 < len(l.starts) {
		return l.starts[i+1]
	}
	return len(l.src)
}

func (l lineIndex) prevLineStart(off int) int { return l.starts[max(0, l.lineOf(off)-1)] }

// nextLineEnd is the end of the line after the one holding off, or the end of that line when none follows.
func (l lineIndex) nextLineEnd(off int) int {
	i := l.lineOf(off)
	if i+1 < len(l.starts) {
		return l.lineEnd(l.starts[i+1])
	}
	return l.lineEnd(off)
}

func (l lineIndex) isBlank(i int) bool {
	end := len(l.src)
	if i+1 < len(l.starts) {
		end = l.starts[i+1]
	}
	return strings.TrimSpace(l.src[l.starts[i]:end]) == ""
}

// buildUnits cuts src at every heading line and every non-blank line that follows a blank one,
// except inside forbidden spans, then splits any unit larger than Max.
func buildUnits(src string, lines lineIndex, headings map[int]heading, forbidden []span, b Budget) []unit {
	if strings.TrimSpace(src) == "" {
		return nil
	}
	hasTop := false
	for _, h := range headings {
		if h.level <= 2 {
			hasTop = true
			break
		}
	}
	inForbidden := func(off int) bool {
		return slices.ContainsFunc(forbidden, func(s span) bool { return off > s.start && off < s.end })
	}
	cuts := []int{0}
	for i := 1; i < len(lines.starts); i++ {
		off := lines.starts[i]
		_, isHeading := headings[off]
		if !isHeading && (lines.isBlank(i) || !lines.isBlank(i-1)) {
			continue
		}
		if !inForbidden(off) {
			cuts = append(cuts, off)
		}
	}
	cuts = append(cuts, len(src))

	var stack []heading
	var units []unit
	for i := 0; i+1 < len(cuts); i++ {
		raw := src[cuts[i]:cuts[i+1]]
		if strings.TrimSpace(raw) == "" {
			continue
		}
		u := unit{}
		if h, ok := headings[cuts[i]]; ok {
			for len(stack) > 0 && stack[len(stack)-1].level >= h.level {
				stack = stack[:len(stack)-1]
			}
			stack = append(stack, h)
			u.level = h.level
			u.heading = h.level <= 2 || !hasTop
		}
		names := make([]string, len(stack))
		for j, h := range stack {
			names[j] = h.text
		}
		u.path = strings.Join(names, " > ")
		if tokens := EstimateTokens(raw); tokens <= b.Max {
			u.text, u.tokens = raw, tokens
			units = append(units, u)
			continue
		}
		for j, piece := range splitOversize(raw, b.Target*3) {
			p := u
			if j > 0 {
				p.level, p.heading = 0, false
			}
			p.text, p.tokens = piece, EstimateTokens(piece)
			units = append(units, p)
		}
	}
	return units
}

// splitOversize cuts text into pieces of at most limit runes: at line ends first, then sentence
// ends inside a long line, then a hard cut.
func splitOversize(s string, limit int) []string {
	var atoms []string
	for _, line := range strings.SplitAfter(s, "\n") {
		if line == "" {
			continue
		}
		if utf8.RuneCountInString(line) <= limit {
			atoms = append(atoms, line)
			continue
		}
		for _, sent := range splitSentences(line) {
			atoms = append(atoms, hardCut(sent, limit)...)
		}
	}
	var out []string
	var cur strings.Builder
	n := 0
	for _, a := range atoms {
		r := utf8.RuneCountInString(a)
		if n > 0 && n+r > limit {
			out = append(out, cur.String())
			cur.Reset()
			n = 0
		}
		cur.WriteString(a)
		n += r
	}
	if n > 0 {
		out = append(out, cur.String())
	}
	return out
}

func splitSentences(line string) []string {
	var out []string
	rs := []rune(line)
	start := 0
	for i, r := range rs {
		if (r == '.' || r == '!' || r == '?') && (i+1 == len(rs) || rs[i+1] == ' ' || rs[i+1] == '\n') {
			end := i + 1
			if end < len(rs) && rs[end] == ' ' {
				end++
			}
			out = append(out, string(rs[start:end]))
			start = end
		}
	}
	if start < len(rs) {
		out = append(out, string(rs[start:]))
	}
	return out
}

func hardCut(s string, limit int) []string {
	rs := []rune(s)
	if len(rs) <= limit {
		return []string{s}
	}
	var out []string
	for len(rs) > limit {
		out = append(out, string(rs[:limit]))
		rs = rs[limit:]
	}
	return append(out, string(rs))
}

// pack groups units greedily in document order, then fills in headings and context.
func pack(units []unit, b Budget) []Chunk {
	type group struct {
		units  []unit
		tokens int
	}
	var groups []group
	var cur group
	flush := func() {
		if len(cur.units) == 0 {
			return
		}
		var carry []unit
		// A heading never ends a chunk: it moves on with the text it introduces.
		if last := cur.units[len(cur.units)-1]; len(cur.units) > 1 && last.level > 0 {
			carry = []unit{last}
			cur.units = cur.units[:len(cur.units)-1]
			cur.tokens -= last.tokens
		}
		groups = append(groups, cur)
		cur = group{}
		for _, u := range carry {
			cur.units = append(cur.units, u)
			cur.tokens += u.tokens
		}
	}
	for _, u := range units {
		if len(cur.units) > 0 {
			sum := cur.tokens + u.tokens
			if sum > b.Max || (sum > b.Target && cur.tokens >= b.MinFill) || (u.heading && cur.tokens >= b.MinFill) {
				flush()
			}
		}
		cur.units = append(cur.units, u)
		cur.tokens += u.tokens
	}
	if len(cur.units) > 0 {
		groups = append(groups, cur)
	}
	if n := len(groups); n > 1 && groups[n-1].tokens < b.MinTail && groups[n-2].tokens+groups[n-1].tokens <= b.Max {
		groups[n-2].units = append(groups[n-2].units, groups[n-1].units...)
		groups[n-2].tokens += groups[n-1].tokens
		groups = groups[:n-1]
	}

	chunks := make([]Chunk, 0, len(groups))
	for i, g := range groups {
		var sb strings.Builder
		for _, u := range g.units {
			sb.WriteString(u.text)
		}
		body := strings.Trim(sb.String(), "\n")
		c := Chunk{Index: i, HeadingPath: g.units[0].path, Text: body, Tokens: EstimateTokens(body)}
		if i > 0 {
			c.Context = tailContext(chunks[i-1].Text, b.Context)
		}
		chunks = append(chunks, c)
	}
	return chunks
}

// tailContext is the last tokens of prev, cut forward to a line start (or, in a single long line,
// a word start) when the cut lands mid-line.
func tailContext(prev string, tokens int) string {
	rs := []rune(prev)
	limit := tokens * 3
	if len(rs) <= limit {
		return prev
	}
	tail := string(rs[len(rs)-limit:])
	if rs[len(rs)-limit-1] != '\n' {
		for _, sep := range []string{"\n", " "} {
			if i := strings.Index(tail, sep); i >= 0 && i+1 < len(tail) {
				return tail[i+1:]
			}
		}
	}
	return tail
}
