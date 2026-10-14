// Command promptsizes prints the rendered default size of every registry entry: id, characters and
// estimated tokens (ceil(runes/3), the repo estimate). Run from the repo root.
//
//	go run ./internal/llmprompts/cmd/promptsizes [-prefix memory.]
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
)

func main() {
	prefix := flag.String("prefix", "", "only entries whose id starts with this")
	flag.Parse()
	var chars, tokens int
	for _, in := range llmprompts.All() {
		if !strings.HasPrefix(string(in.ID), *prefix) {
			continue
		}
		text, err := llmprompts.RenderExample(in.ID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "promptsizes: %s: %v\n", in.ID, err)
			os.Exit(1)
		}
		n := utf8.RuneCountInString(text)
		t := (n + 2) / 3
		chars += n
		tokens += t
		fmt.Printf("%s\t%d\t%d\n", in.ID, n, t)
	}
	fmt.Printf("total\t%d\t%d\n", chars, tokens)
}
