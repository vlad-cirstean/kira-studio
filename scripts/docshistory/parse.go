package main

import (
	"regexp"
	"strings"
)

const idPattern = `[PCMG]\d+(?:\.\d+)?[a-z]*(?:\s*-\s*[PCMG]?\d+[a-z]*)?(?:\s+Part\s+\d+)?`

var (
	idRowRe     = regexp.MustCompile(`^(` + idPattern + `)\b`)
	resultHdrRe = regexp.MustCompile(`(?i)^(` + idPattern + `(?:\s*,\s*` + idPattern + `)*)\s+(?:result|landing note)\b`)
	idOnlyRe    = regexp.MustCompile(idPattern)
	idTokenRe   = regexp.MustCompile(`\b[PCMG]\d+(?:\.\d+)?[a-z]*\b`)
	planResRe   = regexp.MustCompile(`(?i)^##?\s+(?:\d+\.\s+)?result\b|^#\s+P\d+\S*\s+result\b`)
	markerRe    = regexp.MustCompile(`(?i)\b(decisions?|decided|user override|declined|rejected|instead of|rather than|supersed\w*|reverted|renumbered)\b`)
	statusTokRe = regexp.MustCompile(`\*\*(Done|Landed|Superseded[^*]*?|Dropped|Deferred)[.:]?\*\*`)
	headingRe   = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)
	partRe      = regexp.MustCompile(`(?i)\s*\bpart\s*(\d+)`)
	rangeRe     = regexp.MustCompile(`\s*-\s*`)
	spacesRe    = regexp.MustCompile(`\s+`)
	sentEndRe   = regexp.MustCompile(`[.!?](?:\s|$)`)
	listPrefix  = regexp.MustCompile(`^(?:[-*+]|\d+\.)\s+`)
)

// Phase is one table row of a chapter SPEC plus the result sections filed under its ID.
type Phase struct {
	ID, Title, Status, StatusFull string
	Cells                         []string
	Results                       []string
	Mentions                      []string
}

// Parsed is a chapter split into phases and chapter notes.
type Parsed struct {
	Chapter string
	Phases  []*Phase
	Notes   []string
	Intro   string
}

func normID(s string) string {
	s = spacesRe.ReplaceAllString(strings.TrimSpace(s), " ")
	s = partRe.ReplaceAllString(s, " Part $1")
	s = rangeRe.ReplaceAllString(s, "-")
	if s != "" {
		s = strings.ToUpper(s[:1]) + s[1:]
	}
	if i := strings.Index(s, "-"); i >= 0 && i+1 < len(s) {
		s = s[:i+1] + strings.ToUpper(s[i+1:i+2]) + s[i+2:]
	}
	return s
}

// splitRow splits a table row on unescaped pipes outside backtick spans.
func splitRow(line string) []string {
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(line, "|")
	var cells []string
	var b strings.Builder
	tick := false
	rs := []rune(line)
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		switch {
		case r == '\\' && i+1 < len(rs) && rs[i+1] == '|':
			b.WriteRune('|')
			i++
		case r == '`':
			tick = !tick
			b.WriteRune(r)
		case r == '|' && !tick:
			cells = append(cells, strings.TrimSpace(b.String()))
			b.Reset()
		default:
			b.WriteRune(r)
		}
	}
	if s := strings.TrimSpace(b.String()); s != "" {
		cells = append(cells, s)
	}
	return cells
}

func isSeparator(cells []string) bool {
	if len(cells) == 0 {
		return false
	}
	for _, c := range cells {
		if strings.Trim(c, "-: ") != "" || !strings.Contains(c, "-") {
			return false
		}
	}
	return true
}

func firstSentence(s string, max int) string {
	s = spacesRe.ReplaceAllString(strings.TrimSpace(s), " ")
	if loc := sentEndRe.FindStringIndex(s); loc != nil {
		s = s[:loc[0]+1]
	}
	return clip(s, max)
}

func clip(s string, max int) string {
	rs := []rune(s)
	if len(rs) <= max {
		return s
	}
	return strings.TrimSpace(string(rs[:max-3])) + "..."
}

type section struct {
	ids   []string
	body  []string
	level int
}

type scanner struct {
	secs    []*section
	cur     *section
	block   [][]string
	fence   bool
	onTable func(block [][]string)
	prose   func(line string)
}

func (sc *scanner) flush() {
	if len(sc.block) > 0 && sc.onTable != nil {
		sc.onTable(sc.block)
	}
	sc.block = nil
}

func (sc *scanner) keep(line string) {
	if sc.cur != nil {
		sc.cur.body = append(sc.cur.body, line)
	}
}

func parseResultHeading(text string) []string {
	h := resultHdrRe.FindStringSubmatch(text)
	if h == nil {
		return nil
	}
	var ids []string
	for _, p := range idOnlyRe.FindAllString(h[1], -1) {
		ids = append(ids, normID(p))
	}
	return ids
}

func (sc *scanner) heading(lvl int, text, line string) {
	sc.flush()
	if sc.cur != nil && lvl <= sc.cur.level {
		sc.cur = nil
	}
	if lvl >= 2 && lvl <= 3 {
		if ids := parseResultHeading(text); ids != nil {
			sc.cur = &section{ids: ids, level: lvl}
			sc.secs = append(sc.secs, sc.cur)
			return
		}
	}
	sc.keep(line)
}

func (sc *scanner) line(raw string) {
	line := strings.TrimRight(raw, " \t\r")
	trim := strings.TrimSpace(line)
	if strings.HasPrefix(trim, "```") || strings.HasPrefix(trim, "~~~") {
		sc.flush()
		sc.fence = !sc.fence
		sc.keep(line)
		return
	}
	if sc.fence {
		sc.keep(line)
		return
	}
	if m := headingRe.FindStringSubmatch(trim); m != nil {
		sc.heading(len(m[1]), m[2], line)
		return
	}
	if strings.HasPrefix(trim, "|") {
		sc.block = append(sc.block, splitRow(trim))
		sc.keep(line)
		return
	}
	sc.flush()
	switch {
	case sc.cur != nil:
		sc.keep(line)
	case sc.prose != nil && trim != "":
		sc.prose(trim)
	}
}

// scanSpec walks one markdown file. Table blocks go to onTable, result sections are collected, and every
// other prose line outside fences and headings goes to prose.
func scanSpec(text string, onTable func(block [][]string), prose func(line string)) []*section {
	sc := &scanner{onTable: onTable, prose: prose}
	for _, raw := range strings.Split(text, "\n") {
		sc.line(raw)
	}
	sc.flush()
	return sc.secs
}

func trimBlank(lines []string) string {
	i, j := 0, len(lines)
	for i < j && strings.TrimSpace(lines[i]) == "" {
		i++
	}
	for j > i && strings.TrimSpace(lines[j-1]) == "" {
		j--
	}
	return strings.Join(lines[i:j], "\n")
}

type chapterBuilder struct {
	p   *Parsed
	idx map[string]*Phase
}

func (b *chapterBuilder) phase(id string) *Phase {
	if ph, ok := b.idx[id]; ok {
		return ph
	}
	ph := &Phase{ID: id}
	b.idx[id] = ph
	b.p.Phases = append(b.p.Phases, ph)
	return ph
}

// tableCols reads a table header: the Title and Status column indexes, and whether the table is skipped.
func tableCols(header []string) (titleCol, statusCol int, skip bool) {
	titleCol, statusCol = -1, -1
	for i, h := range header {
		switch strings.ToLower(strings.TrimSpace(h)) {
		case "title":
			titleCol = i
		case "status":
			statusCol = i
		}
		if strings.Contains(strings.ToLower(h), "status upstream") {
			skip = true
		}
	}
	return titleCol, statusCol, skip
}

func tableRows(block [][]string) (header []string, rows [][]string) {
	if len(block) >= 2 && isSeparator(block[1]) {
		return block[0], block[2:]
	}
	for _, r := range block {
		if !isSeparator(r) {
			rows = append(rows, r)
		}
	}
	return nil, rows
}

func (b *chapterBuilder) addTable(block [][]string) {
	header, rows := tableRows(block)
	titleCol, statusCol, skip := tableCols(header)
	if skip {
		return
	}
	for _, r := range rows {
		if len(r) == 0 {
			continue
		}
		first := strings.TrimSpace(strings.ReplaceAll(r[0], "**", ""))
		m := idRowRe.FindStringSubmatch(first)
		if m == nil {
			continue
		}
		id := normID(m[1])
		if _, dup := b.idx[id]; dup {
			continue
		}
		ph := b.phase(id)
		ph.fill(first[len(m[1]):], r, titleCol, statusCol)
	}
}

func (ph *Phase) fill(rest string, r []string, titleCol, statusCol int) {
	ph.Title = strings.TrimLeft(strings.TrimSpace(rest), ": \t—")
	if ph.Title == "" && titleCol > 0 && titleCol < len(r) {
		ph.Title = strings.ReplaceAll(r[titleCol], "**", "")
	}
	if statusCol > 0 && statusCol < len(r) {
		ph.StatusFull = r[statusCol]
		ph.Status = firstSentence(r[statusCol], 80)
	} else if t := statusTokRe.FindStringSubmatch(strings.Join(r, " | ")); t != nil {
		ph.Status = strings.TrimSpace(t[1])
	}
	for i := 1; i < len(r); i++ {
		if i != titleCol && i != statusCol && strings.TrimSpace(r[i]) != "" {
			ph.Cells = append(ph.Cells, r[i])
		}
	}
}

// Parse builds a chapter from its SPEC text, README text, extra markdown files and plan files whose
// Result sections belong to phases (name to text).
func Parse(chapter, spec, readme string, extras, plans map[string]string) *Parsed {
	b := &chapterBuilder{p: &Parsed{Chapter: chapter}, idx: map[string]*Phase{}}
	var proseLines []string
	secs := scanSpec(spec, b.addTable, func(l string) {
		if markerRe.MatchString(l) {
			proseLines = append(proseLines, l)
		}
	})
	for _, s := range secs {
		body := trimBlank(s.body)
		for _, id := range s.ids {
			ph := b.phase(id)
			ph.Results = append(ph.Results, body)
		}
	}
	for _, name := range sortedKeys(plans) {
		id := planID(name)
		if id == "" {
			continue
		}
		if body := planResult(plans[name]); body != "" {
			ph := b.phase(id)
			ph.Results = append(ph.Results, body)
		}
	}
	b.p.Intro = firstParagraph(readme)
	seen := map[string]bool{}
	add := func(l string) {
		l = listPrefix.ReplaceAllString(l, "")
		if seen[l] {
			return
		}
		seen[l] = true
		b.p.Notes = append(b.p.Notes, l)
		for _, tok := range idTokenRe.FindAllString(l, -1) {
			if ph, ok := b.idx[normID(tok)]; ok {
				ph.Mentions = appendUnique(ph.Mentions, l)
			}
		}
	}
	for _, l := range proseLines {
		add(l)
	}
	for _, name := range sortedKeys(extras) {
		scanSpec(extras[name], nil, func(l string) {
			if markerRe.MatchString(l) {
				add(l)
			}
		})
	}
	return b.p
}

var planNameRe = regexp.MustCompile(`^(P\d+[a-z]?)(?:-part(\d+))?-`)

func planID(name string) string {
	m := planNameRe.FindStringSubmatch(name)
	if m == nil {
		return ""
	}
	if m[2] != "" {
		return m[1] + " Part " + m[2]
	}
	return m[1]
}

func planResult(text string) string {
	var body []string
	in := false
	fence := false
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(raw, " \t\r")
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "```") {
			fence = !fence
		}
		if !fence {
			if m := headingRe.FindStringSubmatch(trim); m != nil && len(m[1]) <= 2 {
				if in {
					break
				}
				if planResRe.MatchString(trim) {
					in = true
					continue
				}
			}
		}
		if in {
			body = append(body, line)
		}
	}
	return trimBlank(body)
}

func firstParagraph(text string) string {
	var para []string
	fence := false
	for _, raw := range strings.Split(text, "\n") {
		t := strings.TrimSpace(raw)
		if strings.HasPrefix(t, "```") {
			fence = !fence
			continue
		}
		if fence || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "|") {
			if len(para) > 0 {
				break
			}
			continue
		}
		if t == "" {
			if len(para) > 0 {
				break
			}
			continue
		}
		para = append(para, t)
	}
	return strings.Join(para, " ")
}

func appendUnique(s []string, v string) []string {
	for _, x := range s {
		if x == v {
			return s
		}
	}
	return append(s, v)
}
