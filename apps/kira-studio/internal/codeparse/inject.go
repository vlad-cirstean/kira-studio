package codeparse

import (
	"fmt"
	"strings"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// BlockKind is §5.2's closed set for file_block.kind.
type BlockKind string

const (
	BlockTemplate    BlockKind = "template"
	BlockScript      BlockKind = "script"
	BlockScriptSetup BlockKind = "script-setup"
	BlockStyle       BlockKind = "style"
)

// Unsupported marks a block whose lang attribute names a language outside this phase's set
// (scss/less/sass/stylus/pug, §3.2) — recorded honestly, never parsed with the wrong grammar.
const Unsupported ID = "unsupported"

// Block is one region an SFC/HTML container splits into (§3.2) — a plain Go struct; the tree
// parsed over its range, if any, never survives past Inject's own call (§1.4).
type Block struct {
	Kind       BlockKind
	Language   ID // the grammar actually used, or Unsupported
	StartByte  int
	EndByte    int
	StartPoint Point
}

// Inject splits containerTree (already parsed with containerLang's own grammar — html for .vue/
// .html, svelte for .svelte) into its script/style/template blocks, parses each supported
// script/style block over the SAME source buffer via SetIncludedRanges (§3.2 step 4: every
// resulting byte offset and point is already in FILE coordinates, never the block's own), and
// extracts each parsed block's own symbols/references immediately — their trees are Closed before
// this function returns, so no tree-sitter type survives into the result (§1.4).
//
// Returned Symbol/Reference values carry BlockIndex set to the position of their own block in the
// returned slice; Extract's own top-level call (never made here) leaves BlockIndex at -1.
func Inject(containerTree *sitter.Tree, source []byte, containerLang ID) ([]Block, []Symbol, []Reference, error) {
	var blocks []Block
	var symbols []Symbol
	var references []Reference
	var firstErr error

	var walk func(n *sitter.Node)
	walk = func(n *sitter.Node) {
		if firstErr != nil {
			return
		}
		switch n.Kind() {
		case "script_element", "style_element":
			processScriptOrStyle(n, source, containerLang, &blocks, &symbols, &references, &firstErr)
			return // raw_text has no children worth walking into.
		case "element":
			// A <template> block needs no injection (§3.2): its children are already parsed
			// by the container. Vue-only — a plain .html's native <template> tag means
			// something else entirely, and Svelte has no such wrapper at all.
			if containerLang == Vue {
				if st := firstNamedChildOfKind(n, "start_tag"); st != nil &&
					strings.EqualFold(tagName(st, source), "template") {
					// Language is the grammar that actually parsed this range (§5.2's own
					// schema comment) — HTML, via containerOf, since Vue has no grammar of
					// its own (§1.2) and a template needs no injection to begin with.
					blocks = append(blocks, Block{
						Kind: BlockTemplate, Language: containerOf(containerLang),
						StartByte: int(n.StartByte()), EndByte: int(n.EndByte()),
						StartPoint: pointOf(n.StartPosition()),
					})
				}
			}
		}
		count := n.NamedChildCount()
		for i := uint(0); i < count; i++ {
			walk(n.NamedChild(i))
		}
	}
	walk(containerTree.RootNode())

	if firstErr != nil {
		return nil, nil, nil, firstErr
	}
	return blocks, symbols, references, nil
}

// processScriptOrStyle handles one script_element/style_element node: resolves its language from
// a lang attribute, records its Block, and — for a supported language — parses its raw_text range
// with included ranges and extracts symbols/references from the result.
func processScriptOrStyle(
	n *sitter.Node, source []byte, containerLang ID,
	blocks *[]Block, symbols *[]Symbol, references *[]Reference, firstErr *error,
) {
	rawText := firstNamedChildOfKind(n, "raw_text")
	if rawText == nil {
		return // an empty <script></script>/<style></style> has no range worth recording.
	}
	startTag := firstNamedChildOfKind(n, "start_tag")

	var langValue string
	var langPresent bool
	if startTag != nil {
		langValue, langPresent = attrValue(startTag, source, "lang")
	}

	isStyle := n.Kind() == "style_element"
	kind := BlockScript
	var lang ID
	if isStyle {
		kind = BlockStyle
		lang = resolveStyleLang(langValue, langPresent)
	} else {
		lang = resolveScriptLang(langValue, langPresent)
		if containerLang == Vue && startTag != nil {
			if _, present := attrValue(startTag, source, "setup"); present {
				kind = BlockScriptSetup
			}
		}
	}

	blockIndex := len(*blocks)
	*blocks = append(*blocks, Block{
		Kind: kind, Language: lang,
		StartByte: int(rawText.StartByte()), EndByte: int(rawText.EndByte()),
		StartPoint: pointOf(rawText.StartPosition()),
	})

	if lang == Unsupported {
		return // recorded, deliberately not parsed (§3.2: honest and visible, not a wrong-grammar guess).
	}

	blockLang, err := languageFor(lang)
	if err != nil {
		*firstErr = err
		return
	}
	parser := sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(blockLang); err != nil {
		*firstErr = err
		return
	}
	rng := sitter.Range{
		StartByte: rawText.StartByte(), EndByte: rawText.EndByte(),
		StartPoint: rawText.StartPosition(), EndPoint: rawText.EndPosition(),
	}
	if err := parser.SetIncludedRanges([]sitter.Range{rng}); err != nil {
		*firstErr = fmt.Errorf("codeparse: set included range for %s block: %w", kind, err)
		return
	}
	blockTree := parser.Parse(source, nil)
	if blockTree == nil {
		*firstErr = fmt.Errorf("codeparse: parse %s block returned no tree", kind)
		return
	}
	defer blockTree.Close()

	syms, refs, err := Extract(blockTree.RootNode(), source, lang)
	if err != nil {
		*firstErr = err
		return
	}
	for i := range syms {
		syms[i].BlockIndex = blockIndex
	}
	for i := range refs {
		refs[i].BlockIndex = blockIndex
	}
	*symbols = append(*symbols, syms...)
	*references = append(*references, refs...)
}

// resolveScriptLang is §3.2 step 3 for a <script> block: absent or "js" (and "jsx", which the
// javascript grammar already covers, §3.1) gives javascript; "ts"/"typescript" gives typescript;
// "tsx" gives tsx; anything else is Unsupported.
func resolveScriptLang(value string, present bool) ID {
	if !present {
		return JavaScript
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "js", "jsx":
		return JavaScript
	case "ts", "typescript":
		return TypeScript
	case "tsx":
		return TSX
	default:
		return Unsupported
	}
}

// resolveStyleLang is §3.2 step 3 for a <style> block: "css" or absent gives css, anything else
// (scss/less/sass/stylus/pug, named explicitly in §3.2) is Unsupported.
func resolveStyleLang(value string, present bool) ID {
	if !present {
		return CSS
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "css":
		return CSS
	default:
		return Unsupported
	}
}

// firstNamedChildOfKind returns n's first named child whose own Kind() equals kind, or nil. Every
// node this package walks for injection (start_tag, raw_text, attribute, tag_name, ...) is named
// in both the html and svelte grammars (verified against each grammar's own node-types.json), so
// this never needs to consider unnamed (punctuation) children.
func firstNamedChildOfKind(n *sitter.Node, kind string) *sitter.Node {
	count := n.NamedChildCount()
	for i := uint(0); i < count; i++ {
		child := n.NamedChild(i)
		if child.Kind() == kind {
			return child
		}
	}
	return nil
}

// tagName reads a start_tag's own tag_name text.
func tagName(startTag *sitter.Node, source []byte) string {
	if tn := firstNamedChildOfKind(startTag, "tag_name"); tn != nil {
		return string(source[tn.StartByte():tn.EndByte()])
	}
	return ""
}

// attrValue reads one attribute's value off a start_tag by name (case-insensitive, matching HTML's
// own attribute-name convention). present is true and value is "" for a bare boolean attribute
// (e.g. Vue's `<script setup>`, with no `="..."` at all) — the distinction Inject's own setup
// detection needs, since a present-but-empty value must not be confused with an absent attribute.
func attrValue(startTag *sitter.Node, source []byte, name string) (value string, present bool) {
	count := startTag.NamedChildCount()
	for i := uint(0); i < count; i++ {
		attr := startTag.NamedChild(i)
		if attr.Kind() != "attribute" {
			continue
		}
		nameNode := firstNamedChildOfKind(attr, "attribute_name")
		if nameNode == nil || !strings.EqualFold(string(source[nameNode.StartByte():nameNode.EndByte()]), name) {
			continue
		}
		if quoted := firstNamedChildOfKind(attr, "quoted_attribute_value"); quoted != nil {
			if v := firstNamedChildOfKind(quoted, "attribute_value"); v != nil {
				return string(source[v.StartByte():v.EndByte()]), true
			}
			return "", true // quoted but empty, e.g. lang="".
		}
		if v := firstNamedChildOfKind(attr, "attribute_value"); v != nil {
			return string(source[v.StartByte():v.EndByte()]), true
		}
		return "", true // a bare boolean attribute, e.g. `setup`.
	}
	return "", false
}
