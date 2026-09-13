package codeparse

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"runtime/debug"
	"sort"
)

// fingerprintModules lists every grammar module this package's extraction contract depends on
// (§5.3) — the ten upstream grammar modules plus the binding itself. Listed explicitly rather than
// derived from debug.ReadBuildInfo's own Deps list, which has no "is this a tree-sitter grammar"
// marker to filter on.
var fingerprintModules = []string{
	"github.com/tree-sitter/go-tree-sitter",
	"github.com/tree-sitter/tree-sitter-java",
	"github.com/tree-sitter/tree-sitter-python",
	"github.com/tree-sitter/tree-sitter-javascript",
	"github.com/tree-sitter/tree-sitter-typescript",
	"github.com/tree-sitter/tree-sitter-go",
	"github.com/tree-sitter/tree-sitter-rust",
	"github.com/tree-sitter/tree-sitter-html",
	"github.com/tree-sitter/tree-sitter-css",
	"github.com/tree-sitter/tree-sitter-json",
	"github.com/tree-sitter-grammars/tree-sitter-svelte",
}

// Fingerprint hashes every grammar module version this binary actually linked (via
// debug.ReadBuildInfo — the version actually built with, not a hand-copied go.mod string that
// could drift) plus every embedded tags.scm file's own bytes (§5.3). codeindex compares this
// against its own stored meta.parser_fingerprint on open: a mismatch means the extraction contract
// changed under the stored rows, and the cache is truncated and rebuilt rather than trusted.
func Fingerprint() (string, error) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "", fmt.Errorf("codeparse: no build info available to compute a fingerprint")
	}
	versions := make(map[string]string, len(fingerprintModules))
	for _, dep := range info.Deps {
		versions[dep.Path] = dep.Version
	}

	h := sha256.New()
	for _, mod := range fingerprintModules {
		fmt.Fprintf(h, "%s@%s\n", mod, versions[mod])
	}

	paths := make([]string, 0, len(querySourcePaths))
	seen := map[string]bool{}
	for _, p := range querySourcePaths {
		if !seen[p] {
			seen[p] = true
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)
	for _, p := range paths {
		b, err := queryFS.ReadFile(p)
		if err != nil {
			return "", fmt.Errorf("codeparse: read %s for fingerprint: %w", p, err)
		}
		h.Write(b)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
