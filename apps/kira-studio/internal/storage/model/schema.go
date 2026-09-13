package model

// ConnectionDDL mirrors packages/shared/domain/schema.ts's connectionDdlSchema — the DDL text a
// user pastes for one connection so the SQL language service can complete/diagnose/hover against
// it (P18 v1.1 D2). ConnectionID is carried on the wire type (not just used as a lookup key) so a
// SchemaService.Set broadcast can be applied by connectionId with no extra field.
type ConnectionDDL struct {
	ConnectionID string `json:"connectionId"`
	DDL          string `json:"ddl"`
	UpdatedAt    string `json:"updatedAt"`
}
