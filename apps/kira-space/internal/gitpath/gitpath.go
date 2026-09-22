// Package gitpath is the git module's single Unicode-canonicalisation point (docs/v1.3/plans/
// G27-unicode-path-normalization.md D2/D4). It exists because five otherwise-unrelated packages
// (gitclient, gitclient/porcelain, gitrpc, gitreview, and any future one) each need the same
// one-line normalization and share no existing common import without inverting the layering:
// gitclient/porcelain imports only "bytes", and gitreview imports no git package at all.
//
// The provenance rule this package exists to serve (G27 D2) is not "is this a path?" but "where
// did these bytes come from, and where are they going?":
//   - Tier 1 — absolute/directory paths (RepoID, Root, GitDir, CommonDir, worktree directories,
//     filesystem-event paths, every client-supplied directory parameter) are normalized to NFC at
//     ingestion, always. They are only ever used as map/registry/DB keys, comparands, chdir
//     targets, or os.Stat operands, and filesystem access by path is normalization-insensitive on
//     both APFS and HFS+ (G27 F9), so normalizing them carries zero functional risk.
//   - Tier 2 — repository-relative FILE paths (porcelain's status/diff-tree/diff/stash-show
//     output) are NEVER normalized. Every one of them is handed back to git as a pathspec or a
//     <rev>:<path> catfile operand, where git does a byte comparison against tree and index
//     entries: probe P7 shows an NFC spelling of an NFD tree entry resolves to
//     `fatal: path 'café.txt' does not exist in 'HEAD'`, or a silently empty `git diff
//     --name-only`. Never call this package's functions on a tier-2 path.
package gitpath

import (
	"path/filepath"

	"golang.org/x/text/unicode/norm"
)

// NFC returns p in Unicode Normalization Form C — composed, not decomposed; canonical, not
// compatibility. Applied ONLY to absolute/directory paths (G27 D2 tier 1); never to a
// repository-relative path (see the package doc comment and probe P7).
//
// Unguarded on purpose: norm.NFC.String is 46.5ns/0 allocs on an already-NFC input and returns it
// unchanged (P11), while an `if !norm.NFC.IsNormalString(s)` guard measured 58.7ns/1 alloc (P12)
// — strictly worse, because norm.NFC.String already has its own fast path. Do not add the guard
// back; it has been measured, not merely reasoned about.
//
// Byte-transparent for invalid UTF-8 (P9: a lone 0xff, a truncated multi-byte sequence, an
// invalid continuation byte, and a CESU-8 surrogate all pass through unchanged), so it has no
// failure mode and returns no error.
func NFC(p string) string { return norm.NFC.String(p) }

// CleanNFC is filepath.Clean composed with NFC, in that order — the form every absolute path in
// this module is stored and compared in. Clean runs first because it is a pure ASCII-separator
// operation (probe P10: NFC creates and destroys no "/"), so the two commute; fixing the order
// makes call sites and test goldens deterministic.
func CleanNFC(p string) string { return NFC(filepath.Clean(p)) }
