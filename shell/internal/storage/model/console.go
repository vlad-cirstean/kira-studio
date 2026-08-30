package model

// ConsoleRequest is domain/console.ts's ConsoleRequest — one execute() batch: path binds it to a
// connection and, optionally, a default database/schema; Statements is the pre-split list from
// sql-split.ts (one call covers both "Run statement" and "Run all").
type ConsoleRequest struct {
	Path       NodePath
	Statements []string
}
