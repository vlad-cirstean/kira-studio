package repomap

import (
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
)

// position renders a Point 1-based (§6.0's own stated convention: "positions are 1-based lines");
// column is likewise 1-based here, still a byte column (C2's own convention, unconverted — C8
// reads one line per hit to print it back, never a whole file, and deliberately still does not
// convert a byte column to a UTF-16 one; §6.1 rule 2, C8 plan §8).
func position(path string, p codegraph.Point) string {
	return fmt.Sprintf("%s:%d:%d", path, p.Row+1, p.Column+1)
}

// writeSource appends one hit's own source line, indented four spaces so it can never be mistaken
// for a hit line (every hit line starts with a path, and a repository-relative path never starts
// with a space). Nothing is written when src has no entry for path/row — a nil src (omitSource)
// included, since sourceLines.at answers false for a nil map.
func writeSource(b *strings.Builder, src sourceLines, path string, row int) {
	ln, ok := src.at(path, row)
	if !ok {
		return
	}
	b.WriteString("\n    ")
	if ln.Note != "" {
		b.WriteString("[no source: " + ln.Note + "]")
		return
	}
	if ln.Stale {
		b.WriteString("[stale] ")
	}
	b.WriteString(ln.Text)
	if ln.Truncated {
		b.WriteString("…")
	}
}

// targetLabel renders a Target's own kind/name/container — "method Index.Sync" when Container is
// set, "function New" when it is not.
func targetLabel(t codegraph.Target) string {
	if t.Container != "" {
		return fmt.Sprintf("%s %s.%s", t.Kind, t.Container, t.Name)
	}
	return fmt.Sprintf("%s %s", t.Kind, t.Name)
}

// renderTargetLine is one Target's own grep-like line: position, label, confidence, rule — §6.3's
// own honesty rule: Rule and Confidence print on every line, since C2's resolution is name-based
// and hiding its own honesty markers would make a repoWide guess read like a fact.
func renderTargetLine(t codegraph.Target) string {
	return fmt.Sprintf("%s  %s  %s  %s", position(t.Path, t.NameSpan.Start), targetLabel(t), t.Confidence, t.Rule)
}

// renderDefinitions is find_definition's own shape.
func renderDefinitions(name, resolvedFrom string, targets []codegraph.Target, src sourceLines) string {
	if len(targets) == 0 {
		return fmt.Sprintf("no definitions found for %q", name)
	}
	var b strings.Builder
	header := fmt.Sprintf("%d definition", len(targets))
	if len(targets) != 1 {
		header += "s"
	}
	header += fmt.Sprintf(" for %q", name)
	if resolvedFrom != "" {
		header += fmt.Sprintf(" (resolved from %s)", resolvedFrom)
	}
	b.WriteString(header)
	for _, t := range targets {
		b.WriteByte('\n')
		b.WriteString(renderTargetLine(t))
		writeSource(&b, src, t.Path, t.NameSpan.Start.Row)
	}
	return b.String()
}

// renderReferences is find_references' own shape — Truncated always reported with the real total
// (§6.3).
func renderReferences(name string, sites []codegraph.Site, total int, truncated bool, src sourceLines) string {
	if total == 0 {
		return fmt.Sprintf("no references found for %q", name)
	}
	var b strings.Builder
	header := fmt.Sprintf("%d reference", total)
	if total != 1 {
		header += "s"
	}
	header += fmt.Sprintf(" to %q", name)
	if truncated {
		header += fmt.Sprintf(" (showing %d)", len(sites))
	}
	b.WriteString(header)
	for _, s := range sites {
		b.WriteByte('\n')
		loc := position(s.Path, s.NameSpan.Start)
		if s.Enclosing != "" {
			b.WriteString(fmt.Sprintf("%s   %s   in %s", loc, s.Kind, s.Enclosing))
		} else {
			b.WriteString(fmt.Sprintf("%s   %s", loc, s.Kind))
		}
		writeSource(&b, src, s.Path, s.NameSpan.Start.Row)
	}
	return b.String()
}

// goImplementationsNote is §6.3's own honesty message for a Go target — C2 §6 already declined the
// capability at the graph; this is that same fact, rendered for the caller rather than silently
// returning an empty list that would read as "no implementations."
const goImplementationsNote = "Go interfaces are structural; implementations are not derivable from the index."

// renderImplementations is find_implementations' own shape.
func renderImplementations(name, language string, targets []codegraph.Target, src sourceLines) string {
	if language == "go" && len(targets) == 0 {
		return goImplementationsNote
	}
	if len(targets) == 0 {
		return fmt.Sprintf("no implementations found for %q", name)
	}
	var b strings.Builder
	header := fmt.Sprintf("%d implementation", len(targets))
	if len(targets) != 1 {
		header += "s"
	}
	header += fmt.Sprintf(" of %q", name)
	b.WriteString(header)
	for _, t := range targets {
		b.WriteByte('\n')
		b.WriteString(renderTargetLine(t))
		writeSource(&b, src, t.Path, t.NameSpan.Start.Row)
	}
	return b.String()
}

// renderSymbolSearch is search_symbols' own shape.
func renderSymbolSearch(query string, targets []codegraph.Target, src sourceLines) string {
	if len(targets) == 0 {
		return fmt.Sprintf("no symbols matching %q", query)
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("%d symbol", len(targets)))
	if len(targets) != 1 {
		b.WriteString("s")
	}
	b.WriteString(fmt.Sprintf(" matching %q", query))
	for _, t := range targets {
		b.WriteByte('\n')
		b.WriteString(renderTargetLine(t))
		writeSource(&b, src, t.Path, t.NameSpan.Start.Row)
	}
	return b.String()
}

// renderFileSearch is search_files' own shape.
func renderFileSearch(query string, hits []codegraph.FileHit) string {
	if len(hits) == 0 {
		return fmt.Sprintf("no files matching %q", query)
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("%d file", len(hits)))
	if len(hits) != 1 {
		b.WriteString("s")
	}
	b.WriteString(fmt.Sprintf(" matching %q", query))
	for _, h := range hits {
		b.WriteByte('\n')
		b.WriteString(fmt.Sprintf("%s  %s  %d", h.Path, h.Language, h.LineCount))
	}
	return b.String()
}

// maxOutlineNodes is outline_file's own cap (§6.3): "capped at 500 nodes with a truncation line."
const maxOutlineNodes = 500

// renderOutline renders path's definition tree, indented, capped at maxOutlineNodes total nodes
// across the whole tree. The caller guarantees path is an indexed file (P68b: outlineFile routes
// the absent-file case to absentFileReason before ever reaching here) — an empty nodes here always
// means a real, indexed file with zero definitions, never "no such file".
func renderOutline(path string, nodes []codegraph.Node) string {
	if len(nodes) == 0 {
		return fmt.Sprintf("%s has no indexed definitions", path)
	}
	var b strings.Builder
	b.WriteString(path)
	count := 0
	truncated := false
	var walk func(nodes []codegraph.Node, depth int)
	walk = func(nodes []codegraph.Node, depth int) {
		for _, n := range nodes {
			if truncated {
				return
			}
			if count >= maxOutlineNodes {
				truncated = true
				return
			}
			count++
			b.WriteByte('\n')
			b.WriteString(strings.Repeat("  ", depth))
			b.WriteString(fmt.Sprintf("%s %s  %s", n.Kind, n.Name, position(path, n.NameSpan.Start)))
			walk(n.Children, depth+1)
		}
	}
	walk(nodes, 0)
	if truncated {
		b.WriteString(fmt.Sprintf("\n… truncated at %d nodes", maxOutlineNodes))
	}
	return b.String()
}

// positionRange renders a Span's own start/end rows as one grep-like `path:N-M` position (P64
// §3.4) — read_symbol's own header carries a line range, never the single line every other
// renderer's position() prints.
func positionRange(path string, start, end codegraph.Point) string {
	return fmt.Sprintf("%s:%d-%d", path, start.Row+1, end.Row+1)
}

// renderSymbolHeader is renderTargetLine's own read_symbol counterpart: identical shape, but the
// position is a range and a stale file is marked inline rather than by writeSource's own prefix
// convention (P64 §3.4) — there is no separate continuation line here to prefix.
func renderSymbolHeader(t codegraph.Target, stale bool) string {
	header := fmt.Sprintf("%s  %s  %s  %s", positionRange(t.Path, t.Span.Start, t.Span.End), targetLabel(t), t.Confidence, t.Rule)
	if stale {
		header += "  [stale]"
	}
	return header
}

// renderSymbolSource is read_symbol's own shape (P64 §3.4): a doc-comment block (if any), one
// header line carrying the declaration's own line range, then its body verbatim — unindented and
// untrimmed, a deliberate divergence from writeSource's four-space hit-continuation indent, since
// this is source, not a hit continuation. Several blocks print in sequence, blank-line separated,
// only when DefinitionOf itself resolves to more than one candidate — locatorFields' own
// several-exact-symbol-matches case is already handled by Server.resolve before this is ever
// reached. Every body's own failure (D5's safe-failure table) prints as one `[no source: …]` line
// instead of a body, never a tool error.
func renderSymbolSource(targets []codegraph.Target, bodies []symbolSource) string {
	var b strings.Builder
	for i, t := range targets {
		if i > 0 {
			b.WriteString("\n\n")
		}
		body := bodies[i]
		if body.Note != "" {
			b.WriteString(renderSymbolHeader(t, false))
			b.WriteString("\n[no source: " + body.Note + "]")
			continue
		}
		for _, doc := range body.DocLines {
			b.WriteString(doc)
			b.WriteByte('\n')
		}
		b.WriteString(renderSymbolHeader(t, body.Stale))
		for _, line := range body.Lines {
			b.WriteByte('\n')
			b.WriteString(line)
		}
		if body.Truncated {
			full := t.Span.End.Row - t.Span.Start.Row + 1
			b.WriteString(fmt.Sprintf("\n… truncated at %d lines (symbol spans %d)", len(body.Lines), full))
		}
	}
	return b.String()
}

// renderAmbiguous is §6.1 rule 4's several-exact-hits case: candidates plus one line telling the
// caller to re-call with file — no silent pick of the top hit.
func renderAmbiguous(symbol string, candidates []codegraph.Target, src sourceLines) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("%d symbols named %q — re-call with file or languages set to one of these:", len(candidates), symbol))
	for _, t := range candidates {
		b.WriteByte('\n')
		b.WriteString(renderTargetLine(t))
		writeSource(&b, src, t.Path, t.NameSpan.Start.Row)
	}
	return b.String()
}
