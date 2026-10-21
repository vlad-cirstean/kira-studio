package memcheck

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/renameio/v2"
	"github.com/kirathecat/kira-studio/internal/loginshell"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

const hookMarker = "# kira-memory-check"

// InstallCommand is the shell command that installs the pre-commit hook; run it in the repo root.
func InstallCommand(exe string) string {
	return loginshell.Quote(exe) + " memory-check --install-hook"
}

// HookLine is the line a hook manager (husky, lefthook) runs; it skips when the app is missing.
func HookLine(exe string) string {
	q := loginshell.Quote(exe)
	return "if [ -x " + q + " ]; then " + q + " memory-check --staged; fi"
}

func hookScript(exe string) string {
	return "#!/bin/sh\n" + hookMarker + ": installed by Kira Space\n" +
		"exe=" + loginshell.Quote(exe) + "\n" +
		`if [ ! -x "$exe" ]; then echo "kira-memory-check: $exe not found, skipped" >&2; exit 0; fi` + "\n" +
		`exec "$exe" memory-check --staged` + "\n"
}

// Run is the memory-check subcommand. Exit 0 is clean, 1 problems, 2 usage or git error.
func Run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("memory-check", flag.ContinueOnError)
	fs.SetOutput(stderr)
	stagedFlag := fs.Bool("staged", false, "check the staged blobs instead of the work tree")
	install := fs.Bool("install-hook", false, "write the git pre-commit hook")
	printRegex := fs.Bool("print-regex", false, "print the doc line regex and the fact id reference regex")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	ctx := context.Background()
	switch {
	case *printRegex:
		fmt.Fprintf(stdout, "doc: %s\nreference: %s\n", memfmt.DocLineSource, memfmt.FactID)
		return 0
	case *install:
		return installHook(ctx, stdout, stderr)
	}
	var src lister
	switch paths := fs.Args(); {
	case *stagedFlag:
		src = staged{}
	case inWorkTree(ctx):
		if len(paths) == 0 {
			paths = []string{"."}
		}
		src = tracked{paths}
	default:
		if len(paths) == 0 {
			paths = []string{"."}
		}
		src = walk{paths}
	}
	return runCheck(ctx, src, stdout, stderr)
}

func runCheck(ctx context.Context, src lister, stdout, stderr io.Writer) int {
	files, err := src.Files(ctx)
	if err != nil {
		fmt.Fprintln(stderr, "memory-check:", err)
		return 2
	}
	problems, facts := Check(files)
	if len(problems) == 0 {
		fmt.Fprintf(stdout, "memory-check: %d file(s), %d fact(s) ok\n", len(files), facts)
		return 0
	}
	for _, p := range problems {
		fmt.Fprintln(stderr, p)
	}
	fmt.Fprintf(stderr, "memory-check: %d problem(s)\n", len(problems))
	return 1
}

func installHook(ctx context.Context, stdout, stderr io.Writer) int {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(stderr, "memory-check:", err)
		return 2
	}
	out, err := git(ctx, "rev-parse", "--git-path", "hooks")
	if err != nil {
		fmt.Fprintln(stderr, "memory-check: not in a git repository:", err)
		return 2
	}
	dir, err := filepath.Abs(strings.TrimSpace(string(out)))
	if err != nil {
		fmt.Fprintln(stderr, "memory-check:", err)
		return 2
	}
	path := filepath.Join(dir, "pre-commit")
	if old, err := os.ReadFile(path); err == nil && !strings.Contains(string(old), hookMarker) {
		fmt.Fprintf(stderr, "memory-check: %s exists and is not a Kira hook. Add this line to it:\n%s\n", path, HookLine(exe))
		return 1
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintln(stderr, "memory-check:", err)
		return 2
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fmt.Fprintln(stderr, "memory-check:", err)
		return 2
	}
	if err := renameio.WriteFile(path, []byte(hookScript(exe)), 0o755); err != nil { //nolint:gosec // a hook must be executable
		fmt.Fprintln(stderr, "memory-check:", err)
		return 2
	}
	fmt.Fprintln(stdout, "memory-check: installed", path)
	return 0
}
