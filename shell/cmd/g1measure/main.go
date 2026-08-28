// g1measure is P52 gate G1's instrument (§3.3): sums RSS across the app's whole process set —
// matched by executable path substring, per internal/metrics' own "match the bundle, not the pid
// tree" rule, since a native webview's helper processes are not children of this app in every
// sense that matters for accounting even when they are in the ppid tree — over 10 samples 1s
// apart and reports the min, the same methodology the removed tests/e2e/memory.spec.ts used
// (§2.2), so the numbers are directly comparable.
//
// Not part of the shipped app — a throwaway measurement tool, invoked manually against a running
// kira-studio-shell process for the G1 report.
package main

import (
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/metrics"
	"github.com/shirou/gopsutil/v4/process"
)

func main() {
	var needlesFlag string
	var samples int
	var intervalSec int
	flag.StringVar(&needlesFlag, "match", "kira-studio-shell,runtime/node/bin/node,webkitgtk,bwrap",
		"comma-separated executable-path substrings identifying the app's process set")
	flag.IntVar(&samples, "samples", 10, "number of samples")
	flag.IntVar(&intervalSec, "interval", 1, "seconds between samples")
	flag.Parse()

	needles := splitNonEmpty(needlesFlag, ',')
	if len(needles) == 0 {
		log.Fatal("g1measure: -match must name at least one substring")
	}

	var minRSS uint64 = ^uint64(0)
	var minSet []procInfo

	for i := 0; i < samples; i++ {
		pids, err := unionMatchingPIDs(needles)
		if err != nil {
			log.Fatalf("g1measure: %v", err)
		}
		set, total := describe(pids)
		fmt.Printf("sample %2d: %d processes, %d bytes (%.1f MB)\n", i+1, len(set), total, float64(total)/1024/1024)
		if total < minRSS {
			minRSS = total
			minSet = set
		}
		if i < samples-1 {
			time.Sleep(time.Duration(intervalSec) * time.Second)
		}
	}

	fmt.Printf("\nmin of %d samples: %d bytes (%.1f MB)\n", samples, minRSS, float64(minRSS)/1024/1024)
	fmt.Println("process set at min sample:")
	for _, p := range minSet {
		fmt.Printf("  pid=%-7d rss=%8d KB  %s\n", p.pid, p.rssKB, p.exe)
	}
}

type procInfo struct {
	pid   int32
	rssKB uint64
	exe   string
}

func describe(pids []int32) ([]procInfo, uint64) {
	out := make([]procInfo, 0, len(pids))
	var total uint64
	for _, pid := range pids {
		p, err := process.NewProcess(pid)
		if err != nil {
			continue
		}
		exe, _ := p.Exe()
		mi, err := p.MemoryInfo()
		if err != nil || mi == nil {
			continue
		}
		out = append(out, procInfo{pid: pid, rssKB: mi.RSS / 1024, exe: exe})
		total += mi.RSS
	}
	return out, total
}

func unionMatchingPIDs(needles []string) ([]int32, error) {
	seen := map[int32]bool{}
	var out []int32
	for _, n := range needles {
		pids, err := metrics.MatchingPIDs(n)
		if err != nil {
			return nil, err
		}
		for _, pid := range pids {
			if !seen[pid] {
				seen[pid] = true
				out = append(out, pid)
			}
		}
	}
	return out, nil
}

func splitNonEmpty(s string, sep rune) []string {
	var out []string
	cur := ""
	for _, r := range s {
		if r == sep {
			if cur != "" {
				out = append(out, cur)
			}
			cur = ""
			continue
		}
		cur += string(r)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
