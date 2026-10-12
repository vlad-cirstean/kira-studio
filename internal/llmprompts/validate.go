package llmprompts

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"text/template"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

// MaxTextBytes bounds one prompt text.
const MaxTextBytes = 32 << 10

// Problem is one validation finding for a prompt. Line and Col are 1-based; 0 when unknown.
type Problem struct {
	ID      ID     `json:"id"`
	Message string `json:"message"`
	Line    int    `json:"line"`
	Col     int    `json:"col"`
}

// tmplErrPos matches the "template: name:line[:col]: " prefix of a text/template error.
var tmplErrPos = regexp.MustCompile(`^template: ([^:]+):(\d+)(?::(\d+))?: `)

func problem(id ID, key string, params map[string]string) Problem {
	return Problem{ID: id, Message: i18n.T(key, params)}
}

// templateProblem converts a parse or execute error of entry id; a position inside an included
// entry is not a position in id's text.
func templateProblem(id ID, key string, err error) Problem {
	msg := err.Error()
	p := Problem{ID: id}
	if m := tmplErrPos.FindStringSubmatch(msg); m != nil {
		if m[1] == string(id) {
			p.Line, _ = strconv.Atoi(m[2])
			p.Col, _ = strconv.Atoi(m[3])
		}
		msg = msg[len(m[0]):]
	}
	p.Message = i18n.T(key, map[string]string{"cause": strings.TrimSuffix(msg, ".")})
	return p
}

// validateText checks text as the effective text of id; texts supplies every other entry.
func validateText(id ID, text string, texts textFunc) []Problem {
	e := mustEntry(id)
	switch {
	case text == "":
		return []Problem{problem(id, "backend.llmPrompts.empty.body", nil)}
	case len(text) > MaxTextBytes:
		return []Problem{problem(id, "backend.llmPrompts.tooLong.body", map[string]string{"max": strconv.Itoa(MaxTextBytes)})}
	case !utf8.ValidString(text):
		return []Problem{problem(id, "backend.llmPrompts.badEncoding.body", nil)}
	case e.literal:
		return nil
	}
	with := func(x ID) string {
		if x == id {
			return text
		}
		return texts(x)
	}
	set, err := parseSet(id, with)
	if err != nil {
		return []Problem{templateProblem(id, "backend.llmPrompts.parse.body", err)}
	}
	var out []Problem
	used := rootFields(set.Tree)
	for _, name := range e.required {
		if !used[name] {
			out = append(out, problem(id, "backend.llmPrompts.missingVar.body", map[string]string{"name": "." + name}))
		}
	}
	direct := includes(set.Tree)
	for _, f := range e.RequiredFragments {
		if !slices.Contains(direct, string(f)) {
			out = append(out, problem(id, "backend.llmPrompts.missingFragment.body", map[string]string{"name": string(f)}))
		}
	}
	rendered, err := renderWith(e, with, e.example)
	switch {
	case err != nil:
		out = append(out, templateProblem(id, "backend.llmPrompts.render.body", err))
	case strings.TrimSpace(rendered) == "":
		out = append(out, problem(id, "backend.llmPrompts.renderEmpty.body", nil))
	}
	return out
}

// directIncludes lists the entries text includes; a text that does not parse includes nothing.
func directIncludes(text string) []ID {
	t, err := template.New("x").Funcs(funcs).Parse(text)
	if err != nil {
		return nil
	}
	var out []ID
	for _, n := range includes(t.Tree) {
		out = append(out, ID(n))
	}
	return out
}

// reaches reports whether entry id includes any of targets, directly or through other entries.
func reaches(id ID, texts textFunc, targets map[ID]bool) bool {
	seen := map[ID]bool{}
	var visit func(ID) bool
	visit = func(x ID) bool {
		for _, inc := range directIncludes(texts(x)) {
			if targets[inc] {
				return true
			}
			if _, ok := byID[inc]; ok && !seen[inc] {
				seen[inc] = true
				if visit(inc) {
					return true
				}
			}
		}
		return false
	}
	return visit(id)
}

// validateChanges validates a set of new texts against texts, and every other entry that includes
// a changed one: an edited fragment must not break its includers.
func validateChanges(changed map[ID]string, texts textFunc) []Problem {
	merged := func(id ID) string {
		if t, ok := changed[id]; ok {
			return t
		}
		return texts(id)
	}
	ids := make([]ID, 0, len(changed))
	for id := range changed {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	var out []Problem
	targets := map[ID]bool{}
	for _, id := range ids {
		if ps := validateText(id, changed[id], merged); len(ps) > 0 {
			out = append(out, ps...)
			continue
		}
		targets[id] = true
	}
	for _, e := range registry {
		if _, ok := changed[e.ID]; ok || e.literal || !reaches(e.ID, merged, targets) {
			continue
		}
		for _, p := range validateText(e.ID, merged(e.ID), merged) {
			via := firstIncluded(e.ID, merged, ids)
			out = append(out, Problem{ID: via, Message: i18n.T("backend.llmPrompts.breaks.body", map[string]string{"name": string(e.ID), "cause": strings.TrimSuffix(p.Message, ".")})})
			break
		}
	}
	return out
}

// firstIncluded is the first of ids that entry id includes, directly or not.
func firstIncluded(id ID, texts textFunc, ids []ID) ID {
	for _, x := range ids {
		if reaches(id, texts, map[ID]bool{x: true}) {
			return x
		}
	}
	return ids[0]
}
