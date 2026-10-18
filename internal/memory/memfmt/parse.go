package memfmt

import (
	"cmp"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	sourceTag   = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)
	retiredLine = regexp.MustCompile(`^` + FactID + ` (fact|reason|keywords): `)
	// retiredHeader is the first line of a retired comment block, in any of its comment markers.
	retiredHeader = regexp.MustCompile(`^[ \t]*(//|#|--|;|%|<!--|/\*) kira-memory [a-z]+=`)
	docFactLine   = regexp.MustCompile(`^- (` + FactID + `) (.*)$`)
	headingLine   = regexp.MustCompile(`^#{1,6} (\S.*)$`)
	sectionLine   = regexp.MustCompile(`^### (\S.*)$`)
	dateLine      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
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

// isReasonText reports whether t is a reason line: exactly two spaces, then text.
func isReasonText(t string) bool {
	return len(t) > 2 && strings.HasPrefix(t, "  ") && t[2] != ' ' && t[2] != '\t'
}

const retiredLineMsg = "'<id> fact:' and '<id> reason:' lines are the retired P273 format; write '<id> <fact>' and an indented reason line"

const retiredBlockMsg = "kira-memory comment blocks are retired (P296); store the facts with store_memory and cite the returned km_ id in a plain comment"

// RetiredComments reports one problem per retired comment block header in a source file.
func RetiredComments(src []byte) []Problem {
	var out []Problem
	for i, line := range splitLines(src) {
		if retiredHeader.MatchString(line) {
			out = append(out, Problem{i + 1, retiredBlockMsg})
		}
	}
	return out
}

var docKeys = []string{"group", "title", "from", "origin", "source", "scope", "project", "session", "keywords", "updated"}

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

// HeaderSafe reports whether v is a legal front matter value.
func HeaderSafe(v string) bool { return headerValue(v) == "" }

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

	// category is "" before the first ## Facts or ## Rules; section is the ### heading under it.
	category string
	section  string
	cats     map[string]int
	// last: the previous line was a fact line, so an indented line is its reason.
	last bool
	seen map[string]int
}

func (p *docParser) add(line int, f string, a ...any) {
	p.problems = append(p.problems, Problem{line, fmt.Sprintf(f, a...)})
}

const (
	retiredV1Msg = "kira-memory: 1 is the retired P273 format; rewrite it as kira-memory: 3"
	retiredV2Msg = "kira-memory: 2 is retired (P297); rewrite it as kira-memory: 3 with facts under ## Facts, rules under ## Rules and source headings as ###"
)

// ParseDoc parses a doc file. inScope is false when line 1 is not "---" followed by
// "kira-memory: 3" (or "kira-memory: 2" or "1", the retired formats, which yield one problem and
// their front matter); such a file is legacy and yields no problems.
func ParseDoc(src []byte) (Doc, bool, []Problem) {
	lines := splitLines(src)
	if len(lines) < 2 || lines[0] != "---" || (lines[1] != "kira-memory: 3" && lines[1] != "kira-memory: 2" && lines[1] != "kira-memory: 1") {
		return Doc{}, false, nil
	}
	p := &docParser{vals: map[string]string{}, seen: map[string]int{}, cats: map[string]int{}}
	p.doc.Version = int(lines[1][len(lines[1])-1] - '0')
	closeAt := p.front(lines)
	if closeAt < 0 {
		p.add(len(lines), "front matter is not closed with ---")
		return p.doc, true, p.problems
	}
	p.checkFront()
	switch p.doc.Version {
	case 1:
		p.add(2, retiredV1Msg)
		return p.doc, true, p.problems
	case 2:
		p.add(2, retiredV2Msg)
		return p.doc, true, p.problems
	}
	for i := closeAt + 1; i < len(lines); i++ {
		p.body(i+1, lines[i])
	}
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
	d.Group, d.Title, d.From = vals["group"], vals["title"], vals["from"]
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

func (p *docParser) body(n int, line string) {
	reason := isReasonText(line)
	wasFact := p.last
	p.last = false
	switch {
	case line == "":
	case reason:
		if !wasFact {
			p.add(n, "reason line must directly follow a fact line")
			return
		}
		last := &p.doc.Facts[len(p.doc.Facts)-1]
		if msg := CheckText(line[2:]); msg != "" {
			p.add(n, "%s reason: %s", last.ID, msg)
		}
		last.Reason = line[2:]
	default:
		if p.heading(n, line) {
			return
		}
		if retiredLine.MatchString(line) {
			p.add(n, "%s", retiredLineMsg)
			return
		}
		sm := docFactLine.FindStringSubmatch(line)
		if sm == nil {
			p.add(n, "body allows only blank lines, headings (## Facts, ## Rules, ### <source section>), '- <id> <fact>' lines and an indented reason line")
			return
		}
		p.fact(n, sm[1], sm[2])
	}
}

// heading handles a heading line and reports whether line was one. ## Facts and ## Rules set the
// category once each; ### sets the source section inside it.
func (p *docParser) heading(n int, line string) bool {
	if headingLine.FindStringSubmatch(line) == nil {
		return false
	}
	switch kind := categoryKind(line); {
	case kind != "":
		if first, dup := p.cats[kind]; dup {
			p.add(n, "%s appears twice (first at line %d)", line, first)
		}
		p.cats[kind] = n
		p.category, p.section = kind, ""
	case sectionLine.MatchString(line):
		if p.category == "" {
			p.add(n, "source heading before ## Facts or ## Rules")
		}
		p.section = strings.TrimSpace(sectionLine.FindStringSubmatch(line)[1])
	default:
		p.add(n, "headings are ## Facts, ## Rules and ### <source section>")
	}
	return true
}

// categoryKind maps a category heading line to its kind, or "".
func categoryKind(line string) string {
	switch line {
	case "## Facts":
		return KindFact
	case "## Rules":
		return KindRule
	}
	return ""
}

func (p *docParser) fact(n int, id, text string) {
	if p.category == "" {
		p.add(n, "fact before ## Facts or ## Rules")
	}
	if msg := CheckText(text); msg != "" {
		p.add(n, "%s fact: %s", id, msg)
	}
	if first, dup := p.seen[id]; dup {
		p.add(n, "%s already a fact at line %d", id, first)
	}
	p.seen[id] = n
	p.doc.Facts = append(p.doc.Facts, Fact{ID: id, Fact: text, Kind: cmp.Or(p.category, KindFact), Line: n, Section: p.section})
	p.last = true
}

func indexOf(list []string, s string) int {
	for i, v := range list {
		if v == s {
			return i
		}
	}
	return -1
}
