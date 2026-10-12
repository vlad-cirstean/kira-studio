package memfmt

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	sourceTag   = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)
	memoryLine  = regexp.MustCompile(`^(` + FactID + `) (fact|reason|keywords): (.*)$`)
	headingLine = regexp.MustCompile(`^#{1,6} (\S.*)$`)
	dateLine    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

func splitLines(src []byte) []string {
	lines := strings.Split(string(src), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimSuffix(l, "\r")
	}
	return lines
}

func validOrigin(o string) bool { return o == "user" || o == "agent" || o == "external" }
func validScope(s string) bool  { return s == "company" || s == "project" || s == "personal" }

// commentText strips the marker of one line. ok is false when the line is not a comment of m;
// closed is false for a wrapped marker missing its closer.
func commentText(line string, m Marker) (indent, text string, closed, ok bool) {
	trim := strings.TrimLeft(line, " \t")
	indent = line[:len(line)-len(trim)]
	if !strings.HasPrefix(trim, m.Open+" ") {
		return "", "", false, false
	}
	text = trim[len(m.Open)+1:]
	if m.Close == "" {
		return indent, text, true, true
	}
	if strings.HasSuffix(text, " "+m.Close) {
		return indent, strings.TrimSuffix(text, " "+m.Close), true, true
	}
	return indent, text, false, true
}

func inScopeText(t string) bool {
	return strings.HasPrefix(t, "kira-memory ") || strings.HasPrefix(t, "km_")
}

type blockState struct {
	block   Block
	marker  Marker
	indent  string
	pending *Fact // fact line seen, reason not yet
}

type commentParser struct {
	markers  []Marker
	blocks   []Block
	problems []Problem
	cur      *blockState
	seen     map[string]int
}

func (p *commentParser) add(line int, f string, a ...any) {
	p.problems = append(p.problems, Problem{line, fmt.Sprintf(f, a...)})
}

func (p *commentParser) finish() {
	c := p.cur
	if c == nil {
		return
	}
	if c.pending != nil {
		p.add(c.pending.Line, "%s has a fact line but no reason line", c.pending.ID)
	}
	if len(c.block.Facts) == 0 && c.pending == nil {
		p.add(c.block.Line, "empty kira-memory block")
	}
	p.blocks = append(p.blocks, c.block)
	p.cur = nil
}

// ParseComments parses the kira-memory blocks of a source file. Only in-scope lines (text after
// the marker starting "kira-memory " or "km_") are read or flagged; other comments are legacy.
// An unsupported path yields nothing.
func ParseComments(path string, src []byte) ([]Block, []Problem) {
	markers, ok := MarkersFor(path)
	if !ok {
		return nil, nil
	}
	p := &commentParser{markers: markers, seen: map[string]int{}}
	for i, line := range splitLines(src) {
		p.line(i+1, line)
	}
	p.finish()
	return p.blocks, p.problems
}

func (p *commentParser) line(n int, line string) {
	for _, m := range p.markers {
		indent, text, closed, ok := commentText(line, m)
		if !ok {
			continue
		}
		if !inScopeText(text) {
			break
		}
		p.scoped(n, m, indent, text, closed)
		return
	}
	p.finish()
}

func (p *commentParser) scoped(n int, m Marker, indent, text string, closed bool) {
	if m.Close != "" {
		if !closed {
			p.add(n, "comment is not closed with %s", m.Close)
		}
		if strings.Contains(text, m.Close) {
			p.add(n, "text contains %s", m.Close)
		}
	}
	if m.NoDashes && strings.Contains(text, "--") {
		p.add(n, "text contains -- (not allowed in XML comments)")
	}
	if strings.HasPrefix(text, "kira-memory ") {
		p.finish()
		prov, msg := parseHeader(text)
		if msg != "" {
			p.add(n, "%s", msg)
		}
		p.cur = &blockState{block: Block{Provenance: prov, Line: n}, marker: m, indent: indent}
		return
	}
	sm := memoryLine.FindStringSubmatch(text)
	if sm == nil || sm[2] == "keywords" {
		p.add(n, "line must be '<id> fact: <text>' or '<id> reason: <text>'")
		return
	}
	id, kind, body := sm[1], sm[2], sm[3]
	if msg := CheckText(body); msg != "" {
		p.add(n, "%s %s: %s", id, kind, msg)
	}
	c := p.cur
	if c == nil {
		p.add(n, "fact line without kira-memory header")
		return
	}
	if m != c.marker || indent != c.indent {
		p.add(n, "marker or indentation differs from the block header")
	}
	if kind == "fact" {
		p.fact(n, id, body)
	} else {
		p.reason(n, id, body)
	}
}

func (p *commentParser) fact(n int, id, body string) {
	c := p.cur
	if c.pending != nil {
		p.add(n, "%s has a fact line but no reason line", c.pending.ID)
	}
	if first, dup := p.seen[id]; dup {
		p.add(n, "%s already a fact at line %d", id, first)
	}
	p.seen[id] = n
	c.pending = &Fact{ID: id, Fact: body, Line: n}
}

func (p *commentParser) reason(n int, id, body string) {
	c := p.cur
	switch {
	case c.pending == nil:
		p.add(n, "reason line without fact line")
	case c.pending.ID != id:
		p.add(n, "reason id %s differs from fact id %s", id, c.pending.ID)
		c.pending = nil
	default:
		c.pending.Reason = body
		c.block.Facts = append(c.block.Facts, *c.pending)
		c.pending = nil
	}
}

// parseHeader reads "kira-memory origin=<o> [source=<tag>] scope=<s>".
func parseHeader(text string) (Provenance, string) {
	var p Provenance
	toks := strings.Fields(text)[1:]
	val := func(key string) (string, bool) {
		if len(toks) == 0 || !strings.HasPrefix(toks[0], key+"=") {
			return "", false
		}
		v := strings.TrimPrefix(toks[0], key+"=")
		toks = toks[1:]
		return v, true
	}
	const form = "header must be 'kira-memory origin=<user|agent|external> [source=<tag>] scope=<company|project|personal>'"
	var ok bool
	if p.Origin, ok = val("origin"); !ok || !validOrigin(p.Origin) {
		return p, form
	}
	if p.Origin == "external" {
		if p.Source, ok = val("source"); !ok || !sourceTag.MatchString(p.Source) {
			return p, "origin external needs source=<tag> of 1 to 32 characters from a-z, 0-9 and -"
		}
	} else if len(toks) > 0 && strings.HasPrefix(toks[0], "source=") {
		return p, "source is only for origin external"
	}
	if p.Scope, ok = val("scope"); !ok || !validScope(p.Scope) || len(toks) > 0 || strings.Count(text, "  ") > 0 {
		return p, form
	}
	return p, ""
}

var docKeys = []string{"group", "title", "origin", "source", "scope", "project", "session", "keywords", "updated"}

// headerValue returns why a front matter value is not YAML-safe, or "".
func headerValue(v string) string {
	switch {
	case v == "" || strings.TrimSpace(v) != v:
		return "value is empty or has leading or trailing space"
	case strings.Contains(v, ": "):
		return "value contains ': '"
	case strings.Contains(v, " #"):
		return "value contains ' #'"
	case strings.ContainsAny(v[:1], "[{&*!|>'\"%@`"):
		return "value starts with a YAML indicator"
	}
	return ""
}

func splitKeywords(v string) []string {
	var out []string
	for _, k := range strings.Split(v, ",") {
		if k = strings.TrimSpace(k); k != "" {
			out = append(out, k)
		}
	}
	return out
}

type docParser struct {
	doc      Doc
	problems []Problem
	vals     map[string]string

	section string
	cur     *Fact
	stage   int // 0 none, 1 after fact, 2 after reason, 3 after keywords
	seen    map[string]int
}

func (p *docParser) add(line int, f string, a ...any) {
	p.problems = append(p.problems, Problem{line, fmt.Sprintf(f, a...)})
}

// ParseDoc parses a doc file. inScope is false when line 1 is not "---" followed by
// "kira-memory: 1"; such a file is legacy and yields no problems.
func ParseDoc(src []byte) (Doc, bool, []Problem) {
	lines := splitLines(src)
	if len(lines) < 2 || lines[0] != "---" || lines[1] != "kira-memory: 1" {
		return Doc{}, false, nil
	}
	p := &docParser{vals: map[string]string{}, seen: map[string]int{}}
	closeAt := p.front(lines)
	if closeAt < 0 {
		p.add(len(lines), "front matter is not closed with ---")
		return p.doc, true, p.problems
	}
	p.checkFront()
	for i := closeAt + 1; i < len(lines); i++ {
		p.body(i+1, lines[i])
	}
	p.endBlock()
	return p.doc, true, p.problems
}

// front reads the front matter fields and returns the line index of the closing fence, or -1.
func (p *docParser) front(lines []string) int {
	last := -1
	for i := 2; i < len(lines); i++ {
		n := i + 1
		if lines[i] == "---" {
			return i
		}
		k, v, ok := strings.Cut(lines[i], ": ")
		idx := indexOf(docKeys, k)
		switch {
		case !ok || idx < 0:
			p.add(n, "front matter line must be '<key>: <value>' with key %s", strings.Join(docKeys, ", "))
			continue
		case idx <= last:
			p.add(n, "%s is repeated or out of order", k)
			continue
		}
		last = idx
		if msg := headerValue(v); msg != "" {
			p.add(n, "%s: %s", k, msg)
		}
		p.vals[k] = v
	}
	return -1
}

func (p *docParser) checkFront() {
	vals, d := p.vals, &p.doc
	for _, k := range []string{"group", "title", "origin", "scope"} {
		if _, ok := vals[k]; !ok {
			p.add(2, "front matter lacks %s", k)
		}
	}
	d.Group, d.Title = vals["group"], vals["title"]
	if _, ok := vals["group"]; ok && !IsGroupID(d.Group) {
		p.add(2, "group must be a kg_ id")
	}
	d.Origin, d.Source, d.Scope, d.Project, d.Session = vals["origin"], vals["source"], vals["scope"], vals["project"], vals["session"]
	if _, ok := vals["origin"]; ok {
		p.checkOrigin()
	}
	if _, ok := vals["scope"]; ok {
		p.checkScope()
	}
	if v, ok := vals["keywords"]; ok {
		d.Keywords = splitKeywords(v)
	}
	if v, ok := vals["updated"]; ok {
		d.Updated = v
		if _, err := time.Parse("2006-01-02", v); err != nil || !dateLine.MatchString(v) {
			p.add(2, "updated must be YYYY-MM-DD")
		}
	}
}

func (p *docParser) checkOrigin() {
	d := &p.doc
	_, hasSource := p.vals["source"]
	switch {
	case !validOrigin(d.Origin):
		p.add(2, "origin must be user, agent or external")
	case d.Origin == "external" && (!hasSource || !sourceTag.MatchString(d.Source)):
		p.add(2, "origin external needs source of 1 to 32 characters from a-z, 0-9 and -")
	case d.Origin != "external" && hasSource:
		p.add(2, "source is only for origin external")
	case d.Origin == "external" && d.Session != "":
		p.add(2, "session is only for origin user or agent")
	}
}

func (p *docParser) checkScope() {
	d := &p.doc
	_, hasProject := p.vals["project"]
	switch {
	case !validScope(d.Scope):
		p.add(2, "scope must be company, project or personal")
	case d.Scope == "project" && !hasProject:
		p.add(2, "scope project needs project")
	case d.Scope != "project" && hasProject:
		p.add(2, "project is only for scope project")
	}
}

func (p *docParser) endBlock() {
	if p.cur != nil && p.stage == 1 {
		p.add(p.cur.Line, "%s has a fact line but no reason line", p.cur.ID)
	}
	p.cur, p.stage = nil, 0
}

func (p *docParser) body(n int, line string) {
	if line == "" {
		p.endBlock()
		return
	}
	if hm := headingLine.FindStringSubmatch(line); hm != nil {
		p.endBlock()
		p.section = strings.TrimSpace(hm[1])
		return
	}
	sm := memoryLine.FindStringSubmatch(line)
	if sm == nil || sm[3] == "" || sm[3][0] == ' ' {
		p.add(n, "body allows only blank lines, headings and '<id> fact|reason|keywords: <text>' lines")
		p.endBlock()
		return
	}
	id, kind, text := sm[1], sm[2], sm[3]
	if msg := CheckText(text); msg != "" {
		p.add(n, "%s %s: %s", id, kind, msg)
	}
	switch kind {
	case "keywords":
		if p.cur == nil || p.stage != 2 || p.cur.ID != id {
			p.add(n, "keywords line must follow the reason line of the same fact")
			return
		}
		p.cur.Keywords = splitKeywords(text)
		p.doc.Facts[len(p.doc.Facts)-1] = *p.cur
		p.stage = 3
	case "fact":
		p.fact(n, id, text)
	default:
		if p.cur == nil || p.stage != 1 || p.cur.ID != id {
			p.add(n, "reason line must follow the fact line of the same id")
			return
		}
		p.cur.Reason = text
		p.doc.Facts = append(p.doc.Facts, *p.cur)
		p.stage = 2
	}
}

func (p *docParser) fact(n int, id, text string) {
	if p.cur != nil {
		if p.stage == 1 {
			p.add(p.cur.Line, "%s has a fact line but no reason line", p.cur.ID)
		} else {
			p.add(n, "fact blocks need a blank line or heading between them")
		}
	}
	if first, dup := p.seen[id]; dup {
		p.add(n, "%s already a fact at line %d", id, first)
	}
	p.seen[id] = n
	p.cur, p.stage = &Fact{ID: id, Fact: text, Line: n, Section: p.section}, 1
}

func indexOf(list []string, s string) int {
	for i, v := range list {
		if v == s {
			return i
		}
	}
	return -1
}
