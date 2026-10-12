package llmprompts

import (
	"bytes"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	"text/template"
	"text/template/parse"
)

var funcs = template.FuncMap{
	// inc is 1-based numbering for {{range $i, ...}}.
	"inc":  func(i int) int { return i + 1 },
	"join": strings.Join,
}

// textFunc returns the text to use for an entry while one render or validation runs.
type textFunc func(ID) string

func defaultText(id ID) string { return mustEntry(id).Default }

func sourceText(src Source) textFunc { return func(id ID) string { return src.Resolve(id).Text } }

// Render renders entry id for v against src. v must be the entry's vars type. An override that
// fails to render falls back to the default; a default that fails renders "".
func Render(src Source, id ID, v any) string {
	e := mustEntry(id)
	checkVars(e, v)
	r := src.Resolve(id)
	if e.literal {
		return r.Text
	}
	text := sourceText(src)
	out, err := renderWith(e, text, v)
	if err == nil {
		return out
	}
	slog.Warn("llmprompts: override render failed, using default", "scope", "llmprompts", "id", string(id), "err", err)
	out, err = renderWith(e, defaultText, v)
	if err != nil {
		slog.Error("llmprompts: default render failed", "scope", "llmprompts", "id", string(id), "err", err)
		return ""
	}
	return out
}

func checkVars(e *entry, v any) {
	if t := reflect.TypeOf(v); t != e.varsType {
		panic(fmt.Sprintf("llmprompts: %s wants vars %s, got %v", e.ID, e.varsType, t))
	}
}

func renderWith(e *entry, text textFunc, v any) (string, error) {
	t, err := parseSet(e.ID, text)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, v); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// parseSet parses root and every entry it includes, transitively, into one template set.
func parseSet(root ID, text textFunc) (*template.Template, error) {
	t, err := template.New(string(root)).Funcs(funcs).Parse(text(root))
	if err != nil {
		return nil, err
	}
	seen := map[ID]bool{root: true}
	queue := []*template.Template{t}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, name := range includes(cur.Tree) {
			id := ID(name)
			if seen[id] {
				continue
			}
			seen[id] = true
			if _, ok := byID[id]; !ok {
				return nil, fmt.Errorf("template %q: no such prompt", name)
			}
			inc, err := t.New(name).Parse(text(id))
			if err != nil {
				return nil, err
			}
			queue = append(queue, inc)
		}
	}
	return t, nil
}

// includes lists the names {{template}} nodes of tr call.
func includes(tr *parse.Tree) []string {
	var out []string
	if tr == nil || tr.Root == nil {
		return nil
	}
	walk(tr.Root, func(n parse.Node) {
		if tn, ok := n.(*parse.TemplateNode); ok {
			out = append(out, tn.Name)
		}
	})
	return out
}

// walk visits every node under n.
func walk(n parse.Node, visit func(parse.Node)) {
	if n == nil || reflect.ValueOf(n).IsNil() {
		return
	}
	visit(n)
	switch x := n.(type) {
	case *parse.ListNode:
		for _, c := range x.Nodes {
			walk(c, visit)
		}
	case *parse.ActionNode:
		walk(x.Pipe, visit)
	case *parse.IfNode:
		walkBranch(&x.BranchNode, visit)
	case *parse.RangeNode:
		walkBranch(&x.BranchNode, visit)
	case *parse.WithNode:
		walkBranch(&x.BranchNode, visit)
	case *parse.TemplateNode:
		walk(x.Pipe, visit)
	case *parse.PipeNode:
		for _, c := range x.Cmds {
			walk(c, visit)
		}
	case *parse.CommandNode:
		for _, a := range x.Args {
			walk(a, visit)
		}
	case *parse.ChainNode:
		walk(x.Node, visit)
	}
}

func walkBranch(b *parse.BranchNode, visit func(parse.Node)) {
	walk(b.Pipe, visit)
	walk(b.List, visit)
	walk(b.ElseList, visit)
}

// rootFields returns the top-level vars fields a tree reads: dot outside any range or with, and $.
func rootFields(tr *parse.Tree) map[string]bool {
	used := map[string]bool{}
	if tr == nil || tr.Root == nil {
		return used
	}
	var visit func(n parse.Node, depth int)
	visitPipe := func(p *parse.PipeNode, depth int) {
		if p != nil {
			visit(p, depth)
		}
	}
	visit = func(n parse.Node, depth int) {
		if n == nil || reflect.ValueOf(n).IsNil() {
			return
		}
		switch x := n.(type) {
		case *parse.ListNode:
			for _, c := range x.Nodes {
				visit(c, depth)
			}
		case *parse.ActionNode:
			visitPipe(x.Pipe, depth)
		case *parse.IfNode:
			visitPipe(x.Pipe, depth)
			visit(x.List, depth)
			visit(x.ElseList, depth)
		case *parse.RangeNode:
			visitPipe(x.Pipe, depth)
			visit(x.List, depth+1)
			visit(x.ElseList, depth)
		case *parse.WithNode:
			visitPipe(x.Pipe, depth)
			visit(x.List, depth+1)
			visit(x.ElseList, depth)
		case *parse.TemplateNode:
			visitPipe(x.Pipe, depth)
		case *parse.PipeNode:
			for _, c := range x.Cmds {
				visit(c, depth)
			}
		case *parse.CommandNode:
			for _, a := range x.Args {
				visit(a, depth)
			}
		case *parse.ChainNode:
			visit(x.Node, depth)
		case *parse.FieldNode:
			if depth == 0 && len(x.Ident) > 0 {
				used[x.Ident[0]] = true
			}
		case *parse.VariableNode:
			if len(x.Ident) > 1 && x.Ident[0] == "$" {
				used[x.Ident[1]] = true
			}
		}
	}
	visit(tr.Root, 0)
	return used
}
