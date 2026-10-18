package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const preamble = `# Kira Studio history

Built by ` + "`go run ./scripts/docshistory`" + `; never hand-edit. Phase IDs are chapter-local before v1.6.
Deleted chapter files: ` + "`git show <commit>:docs/<chapter>/<file>`" + ` with the commit named in each chapter header.
Lines distilled by the memory MCP ` + "`ingest_files`" + ` distill mode, one phase per input.
`

var chapterBlockRe = regexp.MustCompile(`(?s)<!-- chapter (\S+) -->\n(.*?)<!-- /chapter \S+ -->\n`)

func readBlocks(path string) (map[string]string, error) {
	blocks := map[string]string{}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return blocks, nil
	}
	if err != nil {
		return nil, err
	}
	for _, m := range chapterBlockRe.FindAllStringSubmatch(string(raw), -1) {
		blocks[m[1]] = m[2]
	}
	return blocks, nil
}

func writeBlocks(path string, blocks map[string]string) (int, error) {
	chs := make([]string, 0, len(blocks))
	for ch := range blocks {
		chs = append(chs, ch)
	}
	var b strings.Builder
	b.WriteString(preamble)
	for _, ch := range sortChapters(chs, false) {
		b.WriteString("\n<!-- chapter " + ch + " -->\n" + blocks[ch] + "<!-- /chapter " + ch + " -->\n")
	}
	return b.Len(), os.WriteFile(path, []byte(b.String()), 0o644)
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func recLines(u Unit, r Record) []string {
	if r.State != stateOK {
		return fallbackLines(u, r)
	}
	var out []string
	for _, l := range r.Lines {
		if l = oneLine(l); l != "" {
			out = append(out, l)
		}
	}
	return out
}

func phaseHeading(ch string, u Unit) string {
	head := fmt.Sprintf("### %s %s", ch, u.ID)
	if t := clip(oneLine(strings.ReplaceAll(u.Title, "**", "")), 120); t != "" {
		head += " " + t
	}
	if u.Status != "" {
		head += " (" + oneLine(u.Status) + ")"
	}
	return head
}

func renderChapter(ch string, p *Parsed, recs map[string]Record, commit string) string {
	units := buildUnits(p)
	var b strings.Builder
	var pending []string
	nPhases := 0
	for _, u := range units {
		if !u.Notes {
			nPhases++
			if _, ok := recs[u.Slug]; !ok {
				pending = append(pending, u.ID)
			}
		}
	}
	fmt.Fprintf(&b, "## %s\nSource: docs/%s/ at %s. %d phases.\n", ch, ch, commit[:12], nPhases)
	for _, u := range units {
		if r, ok := recs[u.Slug]; ok && u.Notes {
			for _, l := range recLines(u, r) {
				b.WriteString(l + "\n")
			}
		}
	}
	if len(pending) > 0 {
		b.WriteString("Not distilled yet: " + strings.Join(pending, ", ") + ".\n")
	}
	for _, u := range units {
		r, ok := recs[u.Slug]
		if u.Notes || !ok {
			continue
		}
		b.WriteString("\n" + phaseHeading(ch, u) + "\n")
		for _, l := range recLines(u, r) {
			b.WriteString(l + "\n")
		}
	}
	return b.String()
}

func fallbackLines(u Unit, r Record) []string {
	var out []string
	if u.Phase != nil {
		row := u.Phase.Title
		if len(row) < 60 && len(u.Phase.Cells) > 0 {
			row += " " + u.Phase.Cells[0]
		}
		if s := firstSentence(strings.ReplaceAll(row, "**", ""), 180); s != "" {
			out = append(out, s)
		}
	}
	for _, l := range markerLines(u.Text) {
		out = append(out, clip(oneLine(l), 200))
	}
	return append(out, "(not distilled: "+r.Reason+")")
}

// cmdRender writes the given chapters' blocks into the history file and prints sizes.
func cmdRender(runs, history string, chapters []string) error {
	blocks, err := readBlocks(history)
	if err != nil {
		return err
	}
	for _, ch := range chapters {
		recs, err := loadRecords(filepath.Join(runs, ch+".jsonl"))
		if err != nil {
			return err
		}
		if len(recs) == 0 {
			if _, ok := blocks[ch]; ok {
				continue
			}
			return fmt.Errorf("%s: no runs recorded and no block in %s", ch, history)
		}
		commit := ""
		for _, r := range recs {
			commit = r.SourceCommit
			break
		}
		p, err := loadChapter(ch, commit)
		if err != nil {
			return err
		}
		blocks[ch] = renderChapter(ch, p, recs, commit)
	}
	total, err := writeBlocks(history, blocks)
	if err != nil {
		return err
	}
	var chs []string
	for ch := range blocks {
		chs = append(chs, ch)
	}
	sort.Strings(chs)
	for _, ch := range sortChapters(chs, false) {
		fmt.Printf("%s %d bytes, %d lines\n", ch, len(blocks[ch]), strings.Count(blocks[ch], "\n"))
	}
	fmt.Printf("total %d bytes\n", total)
	return nil
}
