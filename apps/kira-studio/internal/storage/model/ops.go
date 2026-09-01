package model

// OpRecord mirrors src/shared/domain/ops.ts's opRecordSchema.
type OpRecord struct {
	ID           string  `json:"id"`
	ConnectionID *string `json:"connectionId"`
	TabID        *string `json:"tabId"`
	StartedAt    string  `json:"startedAt"`
	DurationMs   *int    `json:"durationMs"`
	Kind         string  `json:"kind"`
	Status       string  `json:"status"`
	Rows         *int    `json:"rows"`
	Command      *string `json:"command"`
	Error        *string `json:"error"`
}

// OpAppend is ops.ts's AppendOpInput.
type OpAppend struct {
	ID           string
	ConnectionID *string
	TabID        *string
	Kind         string
	StartedAt    string
}

// OpFinish is ops.ts's FinishOpPatch.
type OpFinish struct {
	Status     string
	DurationMs int
	Rows       *int
	Command    *string
	Error      *string
}

// opKinds mirrors ops.ts's opKindSchema. Note 'ddl' is deliberately absent (P52 §4.3 / P53 §3.1):
// the legacy 'ddl'->'definition' coercion is dropped, not ported.
var opKinds = map[string]bool{
	"connect": true, "disconnect": true, "children": true, "describe": true, "definition": true,
	"test": true, "read": true, "count": true, "mutate": true, "execute": true, "transfer": true,
}

var opStatuses = map[string]bool{
	"running": true, "ok": true, "error": true, "cancelled": true,
}

// ValidOpKind mirrors ops.ts's opKindSchema.
func ValidOpKind(v string) bool { return opKinds[v] }

// ValidOpStatus mirrors ops.ts's opStatusSchema.
func ValidOpStatus(v string) bool { return opStatuses[v] }
