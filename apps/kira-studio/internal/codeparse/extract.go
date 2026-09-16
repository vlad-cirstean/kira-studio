package codeparse

import (
	"sort"
	"strings"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// Point is a zero-based row/column position (§5.2). Column is a tree-sitter BYTE column;
// converting to a UTF-16 column is a caller's job (C5's), stated here so nobody converts twice.
type Point struct {
	Row    int
	Column int
}

func pointOf(p sitter.Point) Point { return Point{Row: int(p.Row), Column: int(p.Column)} }

// Symbol is one definition (§4.2). ParentIndex is this file's own containment parent, an index
// into the same slice extractSymbols returns (-1 for none) — a plain Go int rather than inventing
// a row id before storage exists, so codeindex assigns real ids only once it writes the transaction.
type Symbol struct {
	Kind       string // §4.2's closed set
	Name       string
	StartByte  int
	EndByte    int
	StartPoint Point
	EndPoint   Point

	NameStartByte int
	NameEndByte   int
	NameStart     Point

	ParentIndex int

	// BlockIndex is -1 (extractSymbols' own default: a top-level symbol, not part of any
	// injected block) unless injectBlocks overwrites it with the position of the block it was
	// extracted from (§3.2) — an index into that call's own returned []Block, not a database id.
	BlockIndex int
}

// Reference is one use (§4.2) — never a resolution target, only a name and a range. NameStartByte/
// NameEndByte/NameStart are the identifier's own range (C2 §2.4) — for a Java method_invocation or
// a JavaScript member call, the reference node's own range (StartByte/EndByte) starts before the
// name and would otherwise never match a cursor placed on it.
type Reference struct {
	// 'call' | 'type' | 'implementation' | 'import' | 'class' | 'read' | 'field' | 'receiver' |
	// 'embed' — the last two are P78's own (docs/v1.8/plans/P78-code-navigation.md §3.2): a
	// method's own receiver type, and an embedded interface/struct field's own type.
	Kind       string
	Name       string
	StartByte  int
	EndByte    int
	StartPoint Point

	NameStartByte int
	NameEndByte   int
	NameStart     Point

	// BlockIndex: see Symbol.BlockIndex.
	BlockIndex int
}

// definitionKinds/referenceKinds are §4.2's closed sets. A capture suffix outside either map is
// ignored (never an error): the whole point of a closed set is that a grammar or query upgrade
// adding a new capture cannot break a parse that predates it.
var definitionKinds = map[string]bool{
	"class": true, "interface": true, "struct": true, "enum": true, "type": true,
	"function": true, "method": true, "constructor": true, "field": true,
	"constant": true, "variable": true, "module": true, "macro": true,
}

var referenceKinds = map[string]bool{
	"call": true, "type": true, "implementation": true, "import": true, "class": true, "read": true,
	"field": true, "receiver": true, "embed": true,
}

// extractSymbols runs id's vendored tags.scm query (S2) over root and returns the file's own symbols
// (parent-linked by range containment) and references, deduplicated by (kind, name, startByte,
// endByte) — real duplicates exist upstream, e.g. Go's type_spec and type_declaration patterns
// both capturing one node (§4.2). Returns (nil, nil, nil) for a language with no symbol query
// (HasSymbolQuery false) — not an error, exactly like html/css/json/svelte's own file-only rows.
func extractSymbols(root *sitter.Node, source []byte, id ID) ([]Symbol, []Reference, error) {
	if !HasSymbolQuery(id) {
		return nil, nil, nil
	}

	query, names, err := queryFor(id)
	if err != nil {
		return nil, nil, err
	}

	cursor := sitter.NewQueryCursor()
	defer cursor.Close()

	matches := cursor.Matches(query, root, source)

	var symbols []Symbol
	var references []Reference
	seenSym := map[[4]any]bool{}
	seenRef := map[[4]any]bool{}

	for match := matches.Next(); match != nil; match = matches.Next() {
		var defKind, refKind string
		var defNode, refNode *sitter.Node
		var nameNode *sitter.Node

		for i := range match.Captures {
			capture := &match.Captures[i]
			name := names[capture.Index]
			switch {
			case name == "name":
				n := capture.Node
				nameNode = &n
			case strings.HasPrefix(name, "definition."):
				defKind = strings.TrimPrefix(name, "definition.")
				n := capture.Node
				defNode = &n
			case strings.HasPrefix(name, "reference."):
				refKind = strings.TrimPrefix(name, "reference.")
				n := capture.Node
				refNode = &n
				// "doc" and anything else (§4.1: upstream #strip!/#set-adjacent! doc captures) are
				// ignored entirely — C1 never reads doc text (§4.3).
			}
		}

		switch {
		case defNode != nil:
			if !definitionKinds[defKind] || nameNode == nil {
				continue // unknown kind, or a definition match with no @name (§4.2): skip.
			}
			sym := Symbol{
				Kind:          defKind,
				Name:          string(source[nameNode.StartByte():nameNode.EndByte()]),
				StartByte:     int(defNode.StartByte()),
				EndByte:       int(defNode.EndByte()),
				StartPoint:    pointOf(defNode.StartPosition()),
				EndPoint:      pointOf(defNode.EndPosition()),
				NameStartByte: int(nameNode.StartByte()),
				NameEndByte:   int(nameNode.EndByte()),
				NameStart:     pointOf(nameNode.StartPosition()),
				BlockIndex:    -1,
			}
			key := [4]any{sym.Kind, sym.Name, sym.StartByte, sym.EndByte}
			if !seenSym[key] {
				seenSym[key] = true
				symbols = append(symbols, sym)
			}

		case refNode != nil:
			if !referenceKinds[refKind] || nameNode == nil {
				continue
			}
			ref := Reference{
				Kind:          refKind,
				Name:          string(source[nameNode.StartByte():nameNode.EndByte()]),
				StartByte:     int(refNode.StartByte()),
				EndByte:       int(refNode.EndByte()),
				StartPoint:    pointOf(refNode.StartPosition()),
				NameStartByte: int(nameNode.StartByte()),
				NameEndByte:   int(nameNode.EndByte()),
				NameStart:     pointOf(nameNode.StartPosition()),
				BlockIndex:    -1,
			}
			key := [4]any{ref.Kind, ref.Name, ref.StartByte, ref.EndByte}
			if !seenRef[key] {
				seenRef[key] = true
				references = append(references, ref)
			}
		}
		// A match with neither a @definition.x nor a @reference.x top-level capture (e.g. Go's
		// bare `(package_clause "package" (package_identifier) @name)`) produces no row at all.
	}

	references = dropDuplicateNameRangeRefs(references)
	linkParents(symbols)
	return symbols, references, nil
}

// nameRangePriority is dropDuplicateNameRangeRefs' own closed ranking: when two patterns match one
// site under different kinds at the identical name range, the higher-priority kind is kept. Any
// kind absent from this table (import/read/class/implementation, none of which this repo's own
// queries ever double-capture at a shared name range) sorts below everything listed, same as
// priority 0's own "no more specific alternative exists" meaning for "type".
var nameRangePriority = map[string]int{
	"type": 0, "field": 1, "call": 2, "receiver": 2, "embed": 2,
}

// dropDuplicateNameRangeRefs keeps one row per name range when two patterns match one site under
// different kinds, preferring the more specific kind: a call over a field (M1c §2.6), a receiver or
// an embed over the blanket type capture (P78 §3.2). Keyed on the name range, not the node span:
// the competing patterns' spans deliberately differ (M1c's own field/call example; a receiver's own
// span is the whole method_declaration, P78 §3.2).
func dropDuplicateNameRangeRefs(references []Reference) []Reference {
	type nameRange struct{ start, end int }
	winner := map[nameRange]string{}
	for _, r := range references {
		key := nameRange{r.NameStartByte, r.NameEndByte}
		if cur, ok := winner[key]; !ok || nameRangePriority[r.Kind] > nameRangePriority[cur] {
			winner[key] = r.Kind
		}
	}
	out := references[:0]
	for _, r := range references {
		if winner[nameRange{r.NameStartByte, r.NameEndByte}] != r.Kind {
			continue
		}
		out = append(out, r)
	}
	return out
}

// linkParents computes each symbol's containment parent (§4.2: "a parent symbol computed by
// range containment over the file's own symbols sorted by start byte"), in place, sorting symbols
// by (StartByte asc, EndByte desc) so an outer definition always precedes one nested inside it.
// A stack of "still open" ranges gives an O(n log n) computation: pop anything that closed before
// the current symbol starts, and the new top (if any) is its tightest enclosing parent.
func linkParents(symbols []Symbol) {
	// Stable: two symbols can share an identical [StartByte, EndByte) range under different
	// kinds — a real upstream case, not a defect — e.g. Rust's tags.scm captures one function
	// body both as @definition.method (nested inside an impl's declaration_list) and as
	// @definition.function (the standalone top-level pattern). A stable sort keeps their
	// relative order exactly as the query produced them, so parent linkage stays deterministic
	// across runs instead of depending on sort.Slice's unspecified tiebreak.
	sort.SliceStable(symbols, func(i, j int) bool {
		if symbols[i].StartByte != symbols[j].StartByte {
			return symbols[i].StartByte < symbols[j].StartByte
		}
		return symbols[i].EndByte > symbols[j].EndByte
	})

	type open struct {
		index   int
		endByte int
	}
	var stack []open
	for i := range symbols {
		for len(stack) > 0 && stack[len(stack)-1].endByte <= symbols[i].StartByte {
			stack = stack[:len(stack)-1]
		}
		if len(stack) > 0 {
			symbols[i].ParentIndex = stack[len(stack)-1].index
		} else {
			symbols[i].ParentIndex = -1
		}
		stack = append(stack, open{index: i, endByte: symbols[i].EndByte})
	}
}
