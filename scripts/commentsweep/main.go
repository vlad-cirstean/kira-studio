// Command commentsweep rewrites long code comments through the memory MCP rewrite path (ingest_files with
// distill and mode rewrite), one comment per call, and splices the accepted text back byte for byte.
// Run from the repo root. `run` spends tokens and needs an authenticated claude on PATH.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

const usage = `usage: go run ./scripts/commentsweep <cmd> [flags]
  scan   [--min-chars 300] [--force]    extract comments, write the manifest and units, no tokens
  run    --max-usd X [--jobs 4] [--lang go|ts|vue] [--limit N] [--files a,b]   rewrite the units (costs tokens, resumable)
  apply  --lang go|ts|vue [--files a,b] [--dry-run]   splice rewritten units, check the code is unchanged; never commits
  restore --ids a,b                      put the original text back for named units
  report --not-applied [--out docs/v2.8/plans/P320-not-applied.md]   every comment that did not make it, by status
  report --sample 120 --seed 320 --out docs/v2.8/plans/P320-report.md   sampled before/after for the judge
  status                                 units, outcomes, spend, applied files`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "commentsweep:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		fmt.Println(usage)
		return nil
	}
	fs := flag.NewFlagSet(args[0], flag.ContinueOnError)
	switch args[0] {
	case "scan":
		minChars := fs.Int("min-chars", 300, "smallest eligible comment, in characters")
		force := fs.Bool("force", false, "scan with a dirty tree")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		return runScan(*minChars, *force)
	case "run":
		maxUSD := fs.Float64("max-usd", 0, "spend cap in USD, summed across runs (required)")
		jobs := fs.Int("jobs", 4, "calls in flight")
		lang := fs.String("lang", "", "go, ts or vue; default all in that order")
		binary := fs.String("binary", "", "prebuilt kira-space binary")
		limit := fs.Int("limit", 0, "stop after N units")
		files := fs.String("files", "", "only files with these path prefixes")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *maxUSD <= 0 {
			return fmt.Errorf("--max-usd is required")
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return runCmd(ctx, runOpts{maxUSD: *maxUSD, jobs: *jobs, lang: *lang, binary: *binary, limit: *limit, prefixes: splitList(*files)})
	case "apply":
		lang := fs.String("lang", "", "go, ts or vue (required)")
		files := fs.String("files", "", "only files with these path prefixes")
		dry := fs.Bool("dry-run", false, "check and print, write nothing")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *lang == "" {
			return fmt.Errorf("--lang is required")
		}
		return runApply(applyOpts{lang: *lang, prefixes: splitList(*files), dry: *dry})
	case "restore":
		ids := fs.String("ids", "", "comma-separated unit ids")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		return runRestore(splitList(*ids))
	case "report":
		notApplied := fs.Bool("not-applied", false, "list every comment that did not make it")
		sample := fs.Int("sample", 0, "sampled units per language for the judge")
		seed := fs.Int64("seed", 320, "sample seed")
		out := fs.String("out", "", "output file")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		switch {
		case *notApplied:
			return runNotApplied(*out)
		case *sample > 0 && *out != "":
			return runSample(*sample, *seed, *out)
		}
		return fmt.Errorf("report needs --not-applied, or --sample N --out FILE")
	case "status":
		return runStatus()
	}
	fmt.Println(usage)
	return fmt.Errorf("unknown command %q", args[0])
}
