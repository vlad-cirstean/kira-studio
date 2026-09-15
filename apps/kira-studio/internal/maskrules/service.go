// Package maskrules is M5's own rule-management service (docs/v1.7/plans/M5-anonymization-masking.md
// §4.6): the layer between storage (repos.MaskRulesRepo/MaskKeysRepo) and this rule set's two
// consumers — internal/dbmcp's render path (through the MaskSetFor seam it consumer-declares) and
// internal/bridge's IPC surface for the connection dialog's Privacy tab and the grid's header menu.
package maskrules

import (
	"encoding/hex"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mask"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// Service holds the two repos M5's rules span (the rule table, and the cipher-backed key column —
// SecretsRepo's own split, mirrored here) plus a small per-connection read cache: MaskSetFor is on
// dbmcp's own run_query hot path (§4.3), and re-querying + re-folding the rule set on every call
// would cost a query per row rendered across a busy connection for no benefit, since a rule set
// changes only through this same Service's own write methods.
type Service struct {
	rules *repos.MaskRulesRepo
	keys  *repos.MaskKeysRepo

	mu    sync.Mutex
	cache map[string]mask.Set // connectionID -> resolved Set; cleared for a connection on any write to it
}

// New constructs a Service over the two repos it owns.
func New(rules *repos.MaskRulesRepo, keys *repos.MaskKeysRepo) *Service {
	return &Service{rules: rules, keys: keys, cache: map[string]mask.Set{}}
}

// List returns every rule on connectionID, repo order (lower(table_name), lower(column_name)).
func (s *Service) List(connectionID string) ([]model.MaskRule, error) {
	return s.rules.ListForConnection(connectionID)
}

// Upsert validates and writes one rule, forcing correlate=false for a `number` rule regardless of
// what the caller passed (§2.3: "A number never carries a correlation tag" — a bucket is
// many-to-one, so tagging it would be dishonest; internal/mask.Apply enforces the same rule again,
// defensively, so this is belt-and-suspenders, not the only place it holds). table_name defaults to
// "*" (any table) when left blank — the header menu's own common case, marking a column PII without
// the user needing to know or care which table it came from.
func (s *Service) Upsert(connectionID string, f model.MaskRuleFields) (model.MaskRule, error) {
	if !model.ValidMaskKind(string(f.Kind)) {
		return model.MaskRule{}, fmt.Errorf("maskrules: invalid kind %q", f.Kind)
	}
	if strings.TrimSpace(f.ColumnName) == "" {
		return model.MaskRule{}, fmt.Errorf("maskrules: column name is required")
	}
	if strings.TrimSpace(f.TableName) == "" {
		f.TableName = "*"
	}
	if f.Kind == model.MaskKindNumber {
		f.Correlate = false
	}
	rec, err := s.rules.Upsert(uuid.NewString(), connectionID, f, model.NowISO())
	if err != nil {
		return model.MaskRule{}, err
	}
	s.invalidate(connectionID)
	return rec, nil
}

// Remove deletes one rule by id — idempotent (removing an already-gone rule is not an error, the
// grid header menu's own "Not PII" action can race a concurrent edit harmlessly).
func (s *Service) Remove(id string) error {
	existing, err := s.rules.Get(id)
	if err != nil {
		return err
	}
	if err := s.rules.Remove(id); err != nil {
		return err
	}
	if existing != nil {
		s.invalidate(existing.ConnectionID)
	}
	return nil
}

// RegenerateKey mints a brand-new correlation key for connectionID, discarding whatever existed
// before (plan §2.5's own "manual and explicit... never automatic" rotation). Every masked
// correlation tag for this connection changes as a result.
func (s *Service) RegenerateKey(connectionID string) error {
	if err := s.keys.Regenerate(connectionID); err != nil {
		return err
	}
	s.invalidate(connectionID)
	return nil
}

// Counts returns every connection id with at least one rule, mapped to its rule count — the
// Settings glance's own backend (§7.5).
func (s *Service) Counts() (map[string]int, error) {
	return s.rules.CountByConnection()
}

// MaskSetFor resolves connectionID's own folded rule set and Masker (§4.2/§4.6) — what dbmcp's
// render path consumes through the MaskRules interface it consumer-declares. A connection with no
// rules returns a Set with an empty Rules map (never nil pointer confusion — dbmcp itself decides
// whether an empty Set behaves as "no masking configured").
func (s *Service) MaskSetFor(connectionID string) (mask.Set, error) {
	s.mu.Lock()
	if cached, ok := s.cache[connectionID]; ok {
		s.mu.Unlock()
		return cached, nil
	}
	s.mu.Unlock()

	rows, err := s.rules.ListForConnection(connectionID)
	if err != nil {
		return mask.Set{}, err
	}
	if len(rows) == 0 {
		set := mask.Set{Masker: mask.New(nil)}
		s.store(connectionID, set)
		return set, nil
	}

	// §4.2's conflict fold: two rules matching the same column name (under different table_name
	// values) collapse to the stricter one, mask.Stricter's own ranking.
	folded := map[string]mask.Rule{}
	for _, row := range rows {
		r := mask.Rule{Kind: mask.Kind(row.Kind), KeepHint: row.KeepHint, Correlate: row.Correlate}
		key := strings.ToLower(row.ColumnName)
		if existing, ok := folded[key]; ok {
			folded[key] = mask.Stricter(existing, r)
		} else {
			folded[key] = r
		}
	}

	// §2.5's own lazy creation: a key is minted only if some folded rule actually correlates —
	// a connection with every rule set to redact-only, or only `number` rules, never gets one.
	needsKey := false
	for _, r := range folded {
		if r.Correlate {
			needsKey = true
			break
		}
	}
	var key []byte
	if needsKey {
		k, err := s.keys.EnsureKey(connectionID)
		if err != nil {
			return mask.Set{}, err
		}
		key = k
	}

	set := mask.Set{Masker: mask.New(key), Rules: folded}
	s.store(connectionID, set)
	return set, nil
}

// CorrelationKeyHex returns connectionID's own correlation key, hex-encoded, minting one first
// (§2.5's own lazy creation) if the connection has at least one correlating rule and none exists
// yet. "" means the connection needs no key at all. This is NOT one of the plan's originally named
// bridge methods (§4.6 lists List/Upsert/Remove/RegenerateKey/Counts) — it is added because §6.3's
// own design (the grid preview computing tags locally via Web Crypto, to match MCP's output
// byte-for-byte) is otherwise impossible: the renderer has no other way to obtain the raw key. Per
// §6.1, the renderer is not the adversary the MCP path defends against — exposing the key to it
// mirrors how a connection password already reaches the renderer for editing (connections.Reveal)
// — but this is still the one seam that ever sends the key outside this process, so it must never
// be reachable from anything but the grid preview's own local tag computation.
//
// Folding is deliberately NOT applied before checking "does anything correlate": a raw rule with
// correlate=true that later loses a §4.2 fold to a stricter, non-correlating rule on the same
// column still triggers a mint here. That mints a key that ends up unused for that particular
// column — harmless (an unused key sitting in the store, never surfaced anywhere) rather than a
// correctness bug, and far simpler than re-deriving the fold just to decide whether to mint.
func (s *Service) CorrelationKeyHex(connectionID string) (string, error) {
	rows, err := s.rules.ListForConnection(connectionID)
	if err != nil {
		return "", err
	}
	needsKey := false
	for _, r := range rows {
		if r.Correlate {
			needsKey = true
			break
		}
	}
	if !needsKey {
		return "", nil
	}
	key, err := s.keys.EnsureKey(connectionID)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(key), nil
}

func (s *Service) store(connectionID string, set mask.Set) {
	s.mu.Lock()
	s.cache[connectionID] = set
	s.mu.Unlock()
}

func (s *Service) invalidate(connectionID string) {
	s.mu.Lock()
	delete(s.cache, connectionID)
	s.mu.Unlock()
}
