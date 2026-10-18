// Command docshistory folds finished docs chapters into docs/HISTORY.md.
//
//	go run ./scripts/docshistory units|distill|render|verify|repoint|fold [flags] <chapter...>
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

const usage = `usage: docshistory <units|render|verify|repoint> [flags] <chapter...>
  units    print the unit list and sizes (no tokens)
  render   write the chapters' blocks into the history file
  verify   write a sample report to check decisions survived
  repoint  rewrite docs/<chapter>/ references in the rest of the repo`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	if err := run(os.Args[1], os.Args[2:]); err != nil {
		fmt.Fprintln(os.Stderr, "docshistory:", err)
		os.Exit(1)
	}
}

func run(cmd string, args []string) error {
	top, err := git("rev-parse", "--show-toplevel")
	if err != nil {
		return err
	}
	if err := os.Chdir(strings.TrimSpace(top)); err != nil {
		return err
	}
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	runs := fs.String("runs", "docs/v2.6/plans/P299-runs", "runs directory")
	history := fs.String("history", "docs/HISTORY.md", "history file")
	only := fs.String("only", "", "comma-separated unit slugs")
	sampleN := fs.Int("sample", 12, "verify sample size")
	out := fs.String("out", "docs/v2.6/plans/P299-verify.md", "verify report path, - for stdout")
	dry := fs.Bool("dry-run", false, "repoint: report without writing")
	if err := fs.Parse(args); err != nil {
		return err
	}
	chapters := fs.Args()
	if len(chapters) == 0 {
		return fmt.Errorf("name at least one chapter")
	}
	for _, ch := range chapters {
		if err := checkChapter(ch); err != nil {
			return err
		}
	}
	onlySet := map[string]bool{}
	for _, s := range strings.Split(*only, ",") {
		if s = strings.TrimSpace(s); s != "" {
			onlySet[s] = true
		}
	}
	chapters = sortChapters(chapters, false)
	switch cmd {
	case "units":
		return cmdUnits(chapters, onlySet)
	case "render":
		return cmdRender(*runs, *history, chapters)
	case "verify":
		return cmdVerify(*runs, *out, *sampleN, chapters)
	case "repoint":
		return cmdRepoint(*runs, *dry, chapters)
	}
	return fmt.Errorf("unknown command %q\n%s", cmd, usage)
}

func cmdUnits(chapters []string, only map[string]bool) error {
	var nUnits, nBytes int
	for _, ch := range chapters {
		commit, err := recordedCommit(ch)
		if err != nil {
			return err
		}
		p, err := loadChapter(ch, commit)
		if err != nil {
			return err
		}
		n, size := 0, 0
		for _, u := range buildUnits(p) {
			if len(only) > 0 && !only[u.Slug] {
				continue
			}
			fmt.Printf("%s\t%d\n", u.Slug, len([]rune(u.Text)))
			if !u.Notes {
				n++
			}
			size += len(u.Text)
		}
		fmt.Printf("# %s: %d phases, %d bytes, commit %s\n", ch, n, size, commit[:12])
		nUnits += n
		nBytes += size
	}
	fmt.Printf("# total %d phases, %d bytes\n", nUnits, nBytes)
	return nil
}

func recordedCommit(ch string) (string, error) {
	if err := checkClean(ch); err != nil {
		return "", err
	}
	return chapterCommit(ch)
}
