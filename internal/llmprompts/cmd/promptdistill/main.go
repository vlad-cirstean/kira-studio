// Command promptdistill drafts a terse version of registry defaults with the memory `distill` core
// (mode instructions). Opt-in: it calls the `claude` CLI and spends tokens; never run it in hooks or CI.
// Run from the repo root.
//
//	go run ./internal/llmprompts/cmd/promptdistill -ids a,b -out drafts.jsonl -cap 1.5
//	go run ./internal/llmprompts/cmd/promptdistill -prefix memory.mcp. -min 150 -out drafts.jsonl
//
// It appends one JSON line per id {id, chars, lines, costUsd} and skips ids already in -out. It stops
// before an id once the file's summed costUsd reaches -cap.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
)

type row struct {
	ID      string   `json:"id"`
	Chars   int      `json:"chars"`
	Lines   []string `json:"lines"`
	CostUSD float64  `json:"costUsd"`
}

func main() { os.Exit(run()) }

func run() int {
	ids := flag.String("ids", "", "comma-separated entry ids")
	prefix := flag.String("prefix", "", "entries whose id starts with this")
	minChars := flag.Int("min", 150, "skip defaults shorter than this many characters")
	out := flag.String("out", "", "JSONL output file (appended; done ids are skipped)")
	capUSD := flag.Float64("cap", 1.5, "stop before an id once the file's summed costUsd reaches this")
	flag.Parse()
	if *out == "" || (*ids == "" && *prefix == "") {
		fmt.Fprintln(os.Stderr, "promptdistill: -out and one of -ids or -prefix are required")
		return 2
	}
	want := map[string]bool{}
	for _, id := range strings.Split(*ids, ",") {
		if id != "" {
			want[id] = true
		}
	}
	done, spent := readDone(*out)
	f, err := os.OpenFile(*out, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintln(os.Stderr, "promptdistill:", err)
		return 2
	}
	defer f.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	d := importer.Distiller{Runner: memory.NewCLIRunner(), Prompts: llmprompts.Defaults()}
	for _, in := range llmprompts.All() {
		id := string(in.ID)
		if !(want[id] || (*prefix != "" && strings.HasPrefix(id, *prefix))) || done[id] || utf8.RuneCountInString(in.Default) < *minChars {
			continue
		}
		if spent >= *capUSD {
			fmt.Fprintf(os.Stderr, "promptdistill: cap %.2f USD reached (%.4f spent); stopping before %s\n", *capUSD, spent, id)
			return 1
		}
		res, err := d.Distill(ctx, importer.DistillRequest{Text: in.Default, Mode: importer.ModeInstructions})
		spent += res.CostUSD
		if err != nil {
			fmt.Fprintf(os.Stderr, "promptdistill: %s: %v\n", id, err)
			return 1
		}
		b, _ := json.Marshal(row{ID: id, Chars: utf8.RuneCountInString(in.Default), Lines: res.Lines, CostUSD: res.CostUSD})
		fmt.Fprintf(f, "%s\n", b)
		fmt.Printf("%s\t%d to %d chars\t%.4f USD\n", id, utf8.RuneCountInString(in.Default), res.OutRunes, res.CostUSD)
	}
	return 0
}

func readDone(file string) (map[string]bool, float64) {
	done := map[string]bool{}
	var spent float64
	f, err := os.Open(file)
	if err != nil {
		return done, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		var r row
		if json.Unmarshal(sc.Bytes(), &r) == nil && r.ID != "" {
			done[r.ID] = true
			spent += r.CostUSD
		}
	}
	return done, spent
}
