package memfmt

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

func checkProvenance(p Provenance, doc bool) error {
	if !validOrigin(p.Origin) {
		return fmt.Errorf("origin %q must be user, agent or external", p.Origin)
	}
	if (p.Origin == "external") != (p.Source != "") {
		return errors.New("source is required for origin external and forbidden otherwise")
	}
	if p.Source != "" && !sourceTag.MatchString(p.Source) {
		return fmt.Errorf("source %q must be 1 to 32 characters from a-z, 0-9 and -", p.Source)
	}
	if !validScope(p.Scope) {
		return fmt.Errorf("scope %q must be company, project or personal", p.Scope)
	}
	if doc && (p.Scope == "project") != (p.Project != "") {
		return errors.New("project is required for scope project and forbidden otherwise")
	}
	if doc && p.Session != "" && p.Origin == "external" {
		return errors.New("session is only for origin user or agent")
	}
	return nil
}

// retiredPrefixes start a P273 line body (`<id> fact: ...`). A fact text starting with one would
// read as that retired line, so the formatter refuses it.
var retiredPrefixes = []string{"fact: ", "reason: ", "keywords: "}

func checkFact(f Fact) error {
	if !IsFactID(f.ID) {
		return fmt.Errorf("fact id %q is not a km_ id", f.ID)
	}
	if msg := CheckText(f.Fact); msg != "" {
		return fmt.Errorf("%s fact: %s", f.ID, msg)
	}
	for _, p := range retiredPrefixes {
		if strings.HasPrefix(f.Fact, p) {
			return fmt.Errorf("%s fact: text starts with %q, which reads as a retired P273 line", f.ID, p)
		}
	}
	if f.Reason != "" {
		if msg := CheckText(f.Reason); msg != "" {
			return fmt.Errorf("%s reason: %s", f.ID, msg)
		}
	}
	return nil
}

type commentWriter struct {
	m Marker
	b strings.Builder
}

func (w *commentWriter) line(text string) error {
	if w.m.Close != "" && strings.Contains(text, w.m.Close) {
		return fmt.Errorf("text contains %s, which would end the comment", w.m.Close)
	}
	if w.m.NoDashes && strings.Contains(text, "--") {
		return errors.New("text contains --, which XML comments forbid")
	}
	w.b.WriteString(w.m.Open + " " + text)
	if w.m.Close != "" {
		w.b.WriteString(" " + w.m.Close)
	}
	w.b.WriteString("\n")
	return nil
}

func (w *commentWriter) block(bl Block, seen map[string]bool) error {
	if err := checkProvenance(Provenance{Origin: bl.Origin, Source: bl.Source, Scope: bl.Scope}, false); err != nil {
		return err
	}
	if len(bl.Facts) == 0 {
		return errors.New("block has no facts")
	}
	head := "kira-memory origin=" + bl.Origin
	if bl.Source != "" {
		head += " source=" + bl.Source
	}
	if err := w.line(head + " scope=" + bl.Scope); err != nil {
		return err
	}
	for _, f := range bl.Facts {
		if err := checkFact(f); err != nil {
			return err
		}
		if seen[f.ID] {
			return fmt.Errorf("%s appears twice", f.ID)
		}
		seen[f.ID] = true
		if err := w.line(f.ID + " " + f.Fact); err != nil {
			return err
		}
		if f.Reason == "" {
			continue
		}
		if err := w.line("  " + f.Reason); err != nil {
			return err
		}
	}
	return nil
}

// FormatComment renders blocks as comment lines in marker m, one trailing newline. It errors on
// anything the parser would flag, so a formatted comment always validates.
func FormatComment(m Marker, blocks []Block) (string, error) {
	if len(blocks) == 0 {
		return "", errors.New("no blocks")
	}
	w := &commentWriter{m: m}
	seen := map[string]bool{}
	for _, bl := range blocks {
		if err := w.block(bl, seen); err != nil {
			return "", err
		}
	}
	return w.b.String(), nil
}

type docWriter struct{ b strings.Builder }

func (w *docWriter) field(k, v string, optional bool) error {
	if v == "" && optional {
		return nil
	}
	if msg := headerValue(v); msg != "" {
		return fmt.Errorf("%s: %s", k, msg)
	}
	w.b.WriteString(k + ": " + v + "\n")
	return nil
}

func (w *docWriter) front(d Doc) error {
	if !IsGroupID(d.Group) {
		return errors.New("group must be a kg_ id")
	}
	if err := checkProvenance(d.Provenance, true); err != nil {
		return err
	}
	if d.From != "" {
		if msg := headerValue(d.From); msg != "" {
			return fmt.Errorf("from: %s", msg)
		}
	}
	if d.Updated != "" {
		if _, err := time.Parse("2006-01-02", d.Updated); err != nil {
			return errors.New("updated must be YYYY-MM-DD")
		}
	}
	w.b.WriteString("---\nkira-memory: 2\n")
	for _, f := range []struct {
		key, val string
		optional bool
	}{
		{"group", d.Group, false}, {"title", d.Title, false}, {"from", d.From, true}, {"origin", d.Origin, false}, {"source", d.Source, true},
		{"scope", d.Scope, false}, {"project", d.Project, true}, {"session", d.Session, true},
		{"keywords", strings.Join(d.Keywords, ", "), true}, {"updated", d.Updated, true},
	} {
		if err := w.field(f.key, f.val, f.optional); err != nil {
			return err
		}
	}
	w.b.WriteString("---\n")
	return nil
}

func (w *docWriter) fact(f Fact) error {
	if err := checkFact(f); err != nil {
		return err
	}
	w.b.WriteString("- " + f.ID + " " + f.Fact + "\n")
	if f.Reason != "" {
		w.b.WriteString("  " + f.Reason + "\n")
	}
	return nil
}

// FormatDoc renders a doc file. Facts print in order as list items; a heading appears wherever
// Section changes.
func FormatDoc(d Doc) (string, error) {
	w := &docWriter{}
	if err := w.front(d); err != nil {
		return "", err
	}
	section, seen, started := "", map[string]bool{}, false
	for _, f := range d.Facts {
		if seen[f.ID] {
			return "", fmt.Errorf("%s appears twice", f.ID)
		}
		seen[f.ID] = true
		if f.Section != section {
			if f.Section == "" || strings.TrimSpace(f.Section) != f.Section || strings.ContainsAny(f.Section, "\r\n") {
				return "", fmt.Errorf("%s: section %q must be one trimmed line, and sections cannot end", f.ID, f.Section)
			}
			section = f.Section
			w.b.WriteString("\n## " + section + "\n\n")
		} else if !started {
			w.b.WriteString("\n")
		}
		started = true
		if err := w.fact(f); err != nil {
			return "", err
		}
	}
	return w.b.String(), nil
}
