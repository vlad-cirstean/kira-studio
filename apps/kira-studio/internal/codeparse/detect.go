package codeparse

import "strings"

// Detect resolves a repository-relative or absolute path to a language id by extension (§3.1's
// table). The second return is false for anything not enumerated — never parsed, never a row
// (§6): a lookup table, not logic worth a dedicated test (§11's "what gets nothing" list).
func Detect(path string) (ID, bool) {
	lower := strings.ToLower(path)

	// .d.ts must be checked before the plain .ts suffix, or it would match TypeScript's own
	// ".ts" entry first and never reach this dedicated (still-TypeScript) case.
	if strings.HasSuffix(lower, ".d.ts") {
		return TypeScript, true
	}

	for ext, id := range extensionMap {
		if strings.HasSuffix(lower, ext) {
			return id, true
		}
	}
	return "", false
}

// extensionMap is §3.1's table verbatim, minus .d.ts (handled above — a suffix map can't express
// "longer suffix wins" on its own).
var extensionMap = map[string]ID{
	".java":   Java,
	".py":     Python,
	".pyi":    Python,
	".js":     JavaScript,
	".jsx":    JavaScript,
	".mjs":    JavaScript,
	".cjs":    JavaScript,
	".ts":     TypeScript,
	".mts":    TypeScript,
	".cts":    TypeScript,
	".tsx":    TSX,
	".go":     Go,
	".rs":     Rust,
	".html":   HTML,
	".htm":    HTML,
	".css":    CSS,
	".json":   JSON,
	".vue":    Vue,
	".svelte": Svelte,
}
