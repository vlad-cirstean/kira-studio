package importer

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/memory"
)

const (
	maxFactsPerChunk = 40
	maxEvidenceLen   = 200
	extractTimeout   = 180 * time.Second
	extractBudget    = "0.50"
)

const extractPrompt = `You extract durable facts from one chunk of a document for a developer's long-term memory. Output only the schema.

` + memory.DataHygiene + `

Input: "document" (path, title), "chunk" (index, count, headingPath), "context" and "text".
"text" is the only source of facts. "context" is the end of the previous chunk: read it to understand references, never extract a fact from it.

Extract atomic facts:
- One claim per fact, written as one complete sentence of at most 300 characters.
- Keep durable knowledge only: decisions and the reasons for them, conventions, configuration and names, ownership, relationships between components, constraints, how things work.
- Skip navigation, tables of contents, boilerplate, licence text, examples copied verbatim, step-by-step commands and time-bound chatter.
- Make a fact standalone only where the text itself makes its subject certain: name the service instead of "it" when the text names it. When the text leaves the subject or a reference open, keep the original wording and say what is missing in "unresolved" (for example: which service "it" means). Leave "unresolved" empty otherwise.
- Never invent or infer beyond the text. Never include a secret (password, token, API key, private key).
- "evidence" quotes the supporting words from "text", at most 200 characters. "section" is the heading path of the chunk.
- At most 40 facts. Return none when the chunk holds nothing durable.`

const extractSchema = `{
  "type": "object", "additionalProperties": false, "required": ["facts"],
  "properties": {"facts": {"type": "array", "items": {
    "type": "object", "additionalProperties": false,
    "required": ["fact", "evidence", "section", "unresolved"],
    "properties": {
      "fact": {"type": "string"}, "evidence": {"type": "string"},
      "section": {"type": "string"}, "unresolved": {"type": "string"}
    }}}}
}`

type extractDoc struct {
	Path  string `json:"path"`
	Title string `json:"title"`
}

type extractChunk struct {
	Index       int    `json:"index"`
	Count       int    `json:"count"`
	HeadingPath string `json:"headingPath"`
}

type extractWire struct {
	Document extractDoc   `json:"document"`
	Chunk    extractChunk `json:"chunk"`
	Context  string       `json:"context"`
	Text     string       `json:"text"`
}

// ClaudeAgent drives both steps through Claude Code (memory.CLIRunner).
type ClaudeAgent struct {
	Runner *memory.CLIRunner
	// Executable and Home start the kira-memory MCP server the finalize step uses.
	Executable string
	Home       string
	// Env is extra environment for that server (tests only).
	Env map[string]string
}

func (a ClaudeAgent) Available() error { return a.Runner.Available() }

func (a ClaudeAgent) Extract(ctx context.Context, in ExtractInput) (ExtractOutput, error) {
	input, err := json.Marshal(extractWire{
		Document: extractDoc{Path: in.Path, Title: in.Title},
		Chunk:    extractChunk{Index: in.Index + 1, Count: in.Count, HeadingPath: in.HeadingPath},
		Context:  in.Context, Text: in.Text,
	})
	if err != nil {
		return ExtractOutput{}, err
	}
	res, err := a.Runner.RunResult(ctx, memory.Call{
		System: extractPrompt, Input: string(input), Schema: json.RawMessage(extractSchema),
		Timeout: extractTimeout, Budget: extractBudget,
	})
	out := ExtractOutput{CostUSD: res.CostUSD}
	if err != nil {
		return out, err
	}
	var parsed struct{ Facts []Fact }
	if err := json.Unmarshal(res.Output, &parsed); err != nil {
		return out, memory.ErrClaudeOutput
	}
	out.Facts = cleanFacts(parsed.Facts)
	return out, nil
}

// cleanFacts trims, drops empty and over-long facts, bounds evidence and caps the count.
func cleanFacts(in []Fact) []Fact {
	out := make([]Fact, 0, len(in))
	for _, f := range in {
		f.Fact = strings.TrimSpace(f.Fact)
		if n := utf8.RuneCountInString(f.Fact); n == 0 || n > memory.MaxFactLen {
			continue
		}
		f.Evidence = truncateRunes(strings.TrimSpace(f.Evidence), maxEvidenceLen)
		f.Section = strings.TrimSpace(f.Section)
		f.Unresolved = strings.TrimSpace(f.Unresolved)
		out = append(out, f)
		if len(out) == maxFactsPerChunk {
			break
		}
	}
	return out
}

func truncateRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
