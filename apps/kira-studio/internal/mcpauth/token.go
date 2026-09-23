// Package mcpauth mints, persists and verifies the DB MCP server's static bearer token
// (docs/v1.7/plans/M1-db-mcp-server-core.md §2). Same crypto shape as internal/gitsock's own
// git_clients trust store (32 crypto/rand bytes, base64url on the wire, sha256(salt‖token) at
// rest) but one token per server instance, persisted as one small JSON file rather than a database
// table: the caller supplies the file's own identifying name (the DB server's fixed name), so this
// package stays storage-shape-agnostic and importable from both internal/dbmcp (verify) and
// internal/bridge (mint) with no shared database dependency.
//
// Every token now carries a 7-day expiry (TTL), rotated by remint — never mid-flight, only at a
// moment a human can read the fresh plaintext (server start, or an explicit Regenerate). See
// MintTTL/LoadOrMintTTL/Check.
package mcpauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/kirathecat/kira-studio/internal/tokenauth"
	"github.com/modelcontextprotocol/go-sdk/auth"
)

// TTL is every token's fixed lifetime, applied uniformly to both servers (M1 §2.1).
const TTL = 7 * 24 * time.Hour

// Record is the at-rest shape: hash+salt only, the plaintext is never written to disk (D8).
// ExpiresAt's zero value means "no expiry recorded yet" — exactly what every pre-M1 file on disk
// already means, so a stamp-on-load (LoadOrMintTTL) can apply the property retroactively with no
// migration and no file-format version (M1 §2.1/§2.4).
type Record struct {
	Hash      []byte    `json:"hash"`
	Salt      []byte    `json:"salt"`
	ExpiresAt time.Time `json:"expiresAt,omitempty"`
}

// MintTTL returns a fresh token in both forms D8 needs: plain (rendered into the registration
// command exactly once) and the Record (what gets persisted), with ExpiresAt set to now+ttl. A
// short read or any crypto/rand error is a hard failure — never a weaker token, mirroring
// gitsock's own mintToken (internal/tokenauth, P107 I2-29).
func MintTTL(ttl time.Duration) (plain string, rec Record, err error) {
	plain, hash, salt, err := tokenauth.Mint()
	if err != nil {
		return "", Record{}, fmt.Errorf("mcpauth: mint: %w", err)
	}
	return plain, Record{
		Hash:      hash,
		Salt:      salt,
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

// Verify recomputes sha256(salt‖presented) and compares against rec.Hash in constant time. Does
// not check expiry — Check wraps this plus the expiry test for the two-outcome distinction a
// lapsed-token response needs.
func Verify(presented string, rec Record) bool {
	return tokenauth.Verify(presented, rec.Hash, rec.Salt)
}

// Expired reports whether rec has lapsed as of now. A zero ExpiresAt (a pre-M1 file not yet
// stamped) never expires.
func Expired(rec Record, now time.Time) bool {
	return !rec.ExpiresAt.IsZero() && !now.Before(rec.ExpiresAt)
}

// Outcome distinguishes the three cases a bearer check can land in — a lapsed token must not be
// reported as a wrong one, since the remedies differ (M1 §2.5).
type Outcome int

const (
	OutcomeValid Outcome = iota
	OutcomeExpired
	OutcomeInvalid
)

// Check compares hashes first and only then tests expiry, so a wrong token never learns the real
// one's expiry instant.
func Check(presented string, rec Record, now time.Time) Outcome {
	if !Verify(presented, rec) {
		return OutcomeInvalid
	}
	if Expired(rec, now) {
		return OutcomeExpired
	}
	return OutcomeValid
}

// TokenVerifier is the auth.TokenVerifier the DB MCP server mounts. load reads the server's own
// current record under its own lock, so a Regenerate mid-flight is picked up by the very next
// request. label names the server in the lapsed-token error text ("kira-db").
func TokenVerifier(label string, load func() Record) auth.TokenVerifier {
	return func(_ context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
		rec := load()
		switch Check(token, rec, time.Now()) {
		case OutcomeValid:
			return &auth.TokenInfo{}, nil
		case OutcomeExpired:
			return nil, fmt.Errorf("%w: the %s MCP token expired at %s. Kira Studio mints a fresh one when the server restarts or when you press Regenerate in Settings; re-register this server with the command it shows.",
				auth.ErrInvalidToken, label, rec.ExpiresAt.Format(time.RFC3339))
		default:
			return nil, auth.ErrInvalidToken
		}
	}
}

// PathNamed returns name's token file location under home — home is normally KIRA_HOME.
func PathNamed(home, name string) string {
	return filepath.Join(home, name+"-token.json")
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

// Save writes rec to path, mode 0600 — hash+salt only, never the plaintext (D8). Creates path's
// parent directory first (mode 0700) — a machine where KIRA_HOME does not exist yet otherwise
// fails outright on the very first mint (M1 §2.6).
//
// Writes via a temp file + rename rather than truncating path in place (M7 finding): a crash or a
// full disk mid-write used to leave a truncated token file that Load then fails to parse, taking
// the whole server down at next start with no path forward but deleting a file the user has no
// reason to know about. Rename is atomic on both target platforms (POSIX same-filesystem rename;
// this repo's own KIRA_HOME layout keeps the temp file alongside the real one, so it is), so a
// reader only ever sees the old complete file or the new complete file, never a partial one.
func Save(path string, rec Record) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("mcpauth: encode %s: %w", path, err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("mcpauth: mkdir %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("mcpauth: create temp for %s: %w", path, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename below succeeds
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("mcpauth: chmod %s: %w", tmpName, err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("mcpauth: write %s: %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("mcpauth: close %s: %w", tmpName, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("mcpauth: rename %s to %s: %w", tmpName, path, err)
	}
	return nil
}

// LoadOrMintTTL loads path's existing Record, or mints and persists a fresh one with the given ttl
// if none exists yet or the stored one has lapsed — the headless instance's own startup path and
// the embedded instance's app-boot-with-the-leaf-already-true path: neither is an explicit "toggle
// turned on" event, so neither forces a fresh token over one that might already be authenticating
// a previously-registered command, except when that token can no longer work at all (§2.3: remint
// only at a moment a human can read the new plaintext — server start is one of the two). minted
// reports whether a fresh mint happened (plain is "" when it did not — a hash cannot be reversed).
//
// A loaded record whose ExpiresAt is zero (a pre-M1 file, minted before rotation existed) is
// stamped instead of reminted: ExpiresAt is set to now+ttl and re-saved with the same Hash/Salt,
// reported as a load (minted=false, plain=""), so every existing registration gets exactly one
// ordinary TTL window before rotation starts applying to it (M1 §2.4). Stamping happens once — the
// next load sees a non-zero ExpiresAt and leaves it alone, so the clock is not reset by restarts.
func LoadOrMintTTL(path string, ttl time.Duration) (plain string, rec Record, minted bool, err error) {
	rec, ok, err := Load(path)
	if err != nil {
		return "", Record{}, false, err
	}
	if ok && rec.ExpiresAt.IsZero() {
		rec.ExpiresAt = time.Now().Add(ttl)
		if err := Save(path, rec); err != nil {
			return "", Record{}, false, err
		}
		return "", rec, false, nil
	}
	if ok && !Expired(rec, time.Now()) {
		return "", rec, false, nil
	}
	plain, rec, err = MintTTL(ttl)
	if err != nil {
		return "", Record{}, false, err
	}
	if err := Save(path, rec); err != nil {
		return "", Record{}, false, err
	}
	return plain, rec, true, nil
}

