package model

import "fmt"

// VariableScope discriminates which owner an api_variables row belongs to. It is computed on
// scan from which foreign key is non-null (P5 D4) — never a stored column, so there is no second
// source of the same fact to drift from the CHECK the migration already enforces.
type VariableScope string

const (
	VariableScopeCollection  VariableScope = "collection"
	VariableScopeEnvironment VariableScope = "environment"
)

// Environment is one api_environments row (P5 D3/D4). IsActive is the app-global selection — the
// repo guarantees at most one row carries it. Description is P17 D14 — app-local free text, no
// Postman round-trip question at all (unlike a variable's, F10).
type Environment struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	SortOrder   int    `json:"sortOrder"`
	IsActive    bool   `json:"isActive"`
	Description string `json:"description"`
}

// Variable is one api_variables row's **list projection** — P5 D4/D5. Value is ” whenever
// IsSecret, and the row's own encrypted-secret column is not a field of this struct at all, so
// "the list never returns a secret's plaintext or ciphertext" is a property of this type, not of a
// per-row branch somewhere that could later be forgotten. Description is P17 D14 — not a secret,
// so it does not weaken that property.
type Variable struct {
	ID          string        `json:"id"`
	Scope       VariableScope `json:"scope"`
	OwnerID     string        `json:"ownerId"`
	Name        string        `json:"name"`
	Value       string        `json:"value"`
	IsSecret    bool          `json:"isSecret"`
	SortOrder   int           `json:"sortOrder"`
	Description string        `json:"description"`
}

// VariableHistoryEntry is one api_variable_history row's list projection — the same "no secret
// column here" discipline as Variable above. apivars.Service.RevealHistory is the only path to a
// secret history entry's plaintext.
type VariableHistoryEntry struct {
	ID         string `json:"id"`
	VariableID string `json:"variableId"`
	Value      string `json:"value"`
	IsSecret   bool   `json:"isSecret"`
	RecordedAt string `json:"recordedAt"`
}

// Validate checks what SQL cannot: a non-empty name. D12: a duplicate name within one scope is
// allowed (resolved first-wins by sort_order in the renderer) — this is the only invariant the
// repo does not otherwise enforce through a constraint.
func (v Variable) Validate() error {
	if v.Name == "" {
		return fmt.Errorf("model: variable: name is required")
	}
	return nil
}
