package llmprompts

import (
	"fmt"
	"reflect"
	"strings"
)

// Part is one piece of a resolved preview: literal Text, or a substituted variable (Var, Value).
// Same JSON shape as scripts.Part.
type Part struct {
	Text  string `json:"text"`
	Var   string `json:"var"`
	Value string `json:"value"`
}

// Private-use noncharacters that frame a wrapped variable value: name, value, end.
const (
	markName  = '﷐'
	markValue = '﷑'
	markEnd   = '﷒'
)

var markerStripper = strings.NewReplacer(string(markName), "", string(markValue), "", string(markEnd), "")

// RenderParts renders entry id for v with every resolved string value marked, so a preview can chip
// the values. If marking changes the plain text (a template that compares or reshapes a string),
// it returns the plain render as one literal part.
func RenderParts(src Source, id ID, v any) ([]Part, error) {
	e := mustEntry(id)
	checkVars(e, v)
	return renderPartsWith(e, sourceText(src), v)
}

func renderPartsWith(e *entry, text textFunc, v any) ([]Part, error) {
	plain, err := renderWith(e, text, v)
	if err != nil {
		return nil, err
	}
	if e.literal {
		return literalParts(plain), nil
	}
	wrapped := wrapVars(reflect.ValueOf(v), "")
	marked, err := renderWith(e, text, wrapped.Interface())
	if err != nil {
		return literalParts(plain), nil
	}
	parts, ok := splitMarked(marked)
	if !ok || plainOf(parts) != plain {
		return literalParts(plain), nil
	}
	return parts, nil
}

func literalParts(s string) []Part {
	if s == "" {
		return []Part{}
	}
	return []Part{{Text: s}}
}

func plainOf(parts []Part) string {
	var b strings.Builder
	for _, p := range parts {
		if p.Var != "" {
			b.WriteString(p.Value)
		} else {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

// wrapVars deep-copies v with each non-empty string leaf framed by markers, naming it by field path.
func wrapVars(v reflect.Value, path string) reflect.Value {
	switch v.Kind() {
	case reflect.String:
		s := markerStripper.Replace(v.String())
		out := reflect.New(v.Type()).Elem()
		if s == "" {
			return out
		}
		out.SetString(fmt.Sprintf("%c%s%c%s%c", markName, path, markValue, s, markEnd))
		return out
	case reflect.Struct:
		out := reflect.New(v.Type()).Elem()
		for i := range v.NumField() {
			f := v.Type().Field(i)
			if !f.IsExported() {
				continue
			}
			p := f.Name
			if path != "" {
				p = path + "." + f.Name
			}
			out.Field(i).Set(wrapVars(v.Field(i), p))
		}
		return out
	case reflect.Slice:
		if v.IsNil() {
			return v
		}
		out := reflect.MakeSlice(v.Type(), v.Len(), v.Len())
		for i := range v.Len() {
			out.Index(i).Set(wrapVars(v.Index(i), path))
		}
		return out
	default:
		return v
	}
}

// splitMarked turns a marked render into parts; false when the frame is malformed.
func splitMarked(s string) ([]Part, bool) {
	parts := []Part{}
	for s != "" {
		i := strings.IndexRune(s, markName)
		if i < 0 {
			parts = append(parts, Part{Text: s})
			break
		}
		if i > 0 {
			parts = append(parts, Part{Text: s[:i]})
		}
		rest := s[i+len(string(markName)):]
		j := strings.IndexRune(rest, markValue)
		if j < 0 {
			return nil, false
		}
		name := rest[:j]
		rest = rest[j+len(string(markValue)):]
		k := strings.IndexRune(rest, markEnd)
		if k < 0 {
			return nil, false
		}
		parts = append(parts, Part{Var: name, Value: rest[:k]})
		s = rest[k+len(string(markEnd)):]
	}
	return parts, true
}
