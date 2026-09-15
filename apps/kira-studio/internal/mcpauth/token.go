// Package mcpauth mints, persists and verifies both local MCP servers' static bearer tokens
// (docs/v1.5/plans/C3-mcp-repo-map-server.md §0 D8, docs/v1.7/plans/M1-db-mcp-server-core.md §2).
// Same crypto shape as internal/gitsock's own git_clients trust store (32 crypto/rand bytes,
// base64url on the wire, sha256(salt‖token) at rest) but one token per server instance, persisted
// as one small JSON file rather than a database table: the caller supplies the file's own
// identifying name (the repo-map server's own repo_id-derived slug, or the DB server's fixed
// name), so this package stays storage-shape-agnostic and importable from both internal/repomap
// and internal/dbmcp (verify) and internal/bridge (mint) with no shared database dependency.
//
// Every token now carries a 7-day expiry (TTL), rotated by remint — never mid-flight, only at a
// moment a human can read the fresh plaintext (server start, or an explicit Regenerate). See
// MintTTL/LoadOrMintTTL/Check.
package mcpauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/modelcontextprotocol/go-sdk/auth"
)

// tokenBytes/saltBytes mirror gitsock/token.go's own D6 shape exactly.
const (
	tokenBytes = 32
	saltBytes  = 16
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
// gitsock's own mintToken.
func MintTTL(ttl time.Duration) (plain string, rec Record, err error) {
	tok := make([]byte, tokenBytes)
	if _, err := rand.Read(tok); err != nil {
		return "", Record{}, fmt.Errorf("mcpauth: mint: %w", err)
	}
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", Record{}, fmt.Errorf("mcpauth: mint: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(tok), Record{
		Hash:      hashToken(tok, salt),
		Salt:      salt,
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

func hashToken(tok, salt []byte) []byte {
	sum := sha256.Sum256(append(append([]byte{}, salt...), tok...))
	return sum[:]
}

// Verify recomputes sha256(salt‖presented) and compares against rec.Hash in constant time. An
// undecodable presented token fails like any other mismatch, after still doing the comparison so
// its cost doesn't itself leak information (gitsock/token.go's own verifyToken discipline). Does
// not check expiry — Check wraps this plus the expiry test for the two-outcome distinction a
// lapsed-token response needs.
func Verify(presented string, rec Record) bool {
	tok, err := base64.RawURLEncoding.DecodeString(presented)
	if err != nil {
		tok = nil
	}
	return subtle.ConstantTimeCompare(hashToken(tok, rec.Salt), rec.Hash) == 1
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

// TokenVerifier is the auth.TokenVerifier both servers mount. load reads the server's own current
// record under its own lock, so a Regenerate mid-flight is picked up by the very next request.
// label distinguishes the two servers in the lapsed-token error text ("kira-repo-map" or
// "kira-db").
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

// Path returns the repo-map server's per-instance token file's location under home; slug is the
// caller's own stable identifier for this server instance (internal/repomap's repo_id-derived
// slug, shared with its sync-lock file's own naming, §5).
func Path(home, slug string) string {
	return PathNamed(home, "mcp-repo-map-"+slug)
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
func Save(path string, rec Record) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("mcpauth: encode %s: %w", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("mcpauth: mkdir %s: %w", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("mcpauth: write %s: %w", path, err)
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

// Slug returns the first 12 hex characters of sha256(id) — the naming convention
// `codeindex-sync-<…>.lock` already established (§5) and now owned by
// internal/codeindex.SyncLockPath (C6 S1), reused verbatim here so both names derive from one
// repo_id the same way. Keep this comment and SyncLockPath's own in sync if either changes.
func Slug(id string) string {
	sum := sha256.Sum256([]byte(id))
	return fmt.Sprintf("%x", sum[:6])
}
