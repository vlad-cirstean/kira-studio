// Package mcpauth mints, persists and verifies the repo-map MCP server's static bearer token
// (docs/v1.5/plans/C3-mcp-repo-map-server.md §0 D8). Same crypto shape as internal/gitsock's own
// git_clients trust store (32 crypto/rand bytes, base64url on the wire, sha256(salt‖token) at
// rest) but one token per server instance, persisted as one small JSON file rather than a
// database table: the caller supplies the file's own identifying slug (the server's own repo_id
// hash, D8), so this package stays storage-shape-agnostic and importable from both
// internal/repomap (verify) and internal/bridge (mint) with no shared database dependency.
package mcpauth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// tokenBytes/saltBytes mirror gitsock/token.go's own D6 shape exactly.
const (
	tokenBytes = 32
	saltBytes  = 16
)

// Record is the at-rest shape: hash+salt only, the plaintext is never written to disk (D8).
type Record struct {
	Hash []byte `json:"hash"`
	Salt []byte `json:"salt"`
}

// Mint returns a fresh token in both forms D8 needs: plain (rendered into the registration command
// exactly once) and the Record (what gets persisted). A short read or any crypto/rand error is a
// hard failure — never a weaker token, mirroring gitsock's own mintToken.
func Mint() (plain string, rec Record, err error) {
	tok := make([]byte, tokenBytes)
	if _, err := rand.Read(tok); err != nil {
		return "", Record{}, fmt.Errorf("mcpauth: mint: %w", err)
	}
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", Record{}, fmt.Errorf("mcpauth: mint: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(tok), Record{Hash: hashToken(tok, salt), Salt: salt}, nil
}

func hashToken(tok, salt []byte) []byte {
	sum := sha256.Sum256(append(append([]byte{}, salt...), tok...))
	return sum[:]
}

// Verify recomputes sha256(salt‖presented) and compares against rec.Hash in constant time. An
// undecodable presented token fails like any other mismatch, after still doing the comparison so
// its cost doesn't itself leak information (gitsock/token.go's own verifyToken discipline).
func Verify(presented string, rec Record) bool {
	tok, err := base64.RawURLEncoding.DecodeString(presented)
	if err != nil {
		tok = nil
	}
	return subtle.ConstantTimeCompare(hashToken(tok, rec.Salt), rec.Hash) == 1
}

// Path returns the per-instance token file's location under home — home is normally KIRA_HOME;
// slug is the caller's own stable identifier for this server instance (internal/repomap's
// repo_id-derived slug, shared with its sync-lock file's own naming, §5).
func Path(home, slug string) string {
	return filepath.Join(home, "mcp-repo-map-"+slug+"-token.json")
}

// Load reads path's Record. A missing file returns ok=false with no error — there is nothing wrong
// with a server instance that has never been enabled or started before.
func Load(path string) (Record, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Record{}, false, nil
		}
		return Record{}, false, fmt.Errorf("mcpauth: read %s: %w", path, err)
	}
	var rec Record
	if err := json.Unmarshal(data, &rec); err != nil {
		return Record{}, false, fmt.Errorf("mcpauth: parse %s: %w", path, err)
	}
	return rec, true, nil
}

// Save writes rec to path, mode 0600 — hash+salt only, never the plaintext (D8).
func Save(path string, rec Record) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("mcpauth: encode %s: %w", path, err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("mcpauth: write %s: %w", path, err)
	}
	return nil
}

// LoadOrMint loads path's existing Record, or mints and persists a fresh one if none exists yet —
// the headless instance's own startup path (§3.1) and the embedded instance's app-boot-with-the-
// leaf-already-true path (§3.2/D8): neither is an explicit "toggle turned on" event, so neither
// forces a fresh token over one that might already be authenticating a previously-registered
// command. minted reports whether a fresh mint happened (plain is "" when it did not — a hash
// cannot be reversed).
func LoadOrMint(path string) (plain string, rec Record, minted bool, err error) {
	rec, ok, err := Load(path)
	if err != nil {
		return "", Record{}, false, err
	}
	if ok {
		return "", rec, false, nil
	}
	plain, rec, err = Mint()
	if err != nil {
		return "", Record{}, false, err
	}
	if err := Save(path, rec); err != nil {
		return "", Record{}, false, err
	}
	return plain, rec, true, nil
}

// Slug returns the first 12 hex characters of sha256(id) — the naming convention
// `codeindex-sync-<…>.lock` already established (§5), reused verbatim here and by
// internal/repomap's own sync-lock file so both names derive from one repo_id the same way.
func Slug(id string) string {
	sum := sha256.Sum256([]byte(id))
	return fmt.Sprintf("%x", sum[:6])
}
