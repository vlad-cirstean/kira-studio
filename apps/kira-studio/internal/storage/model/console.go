package model

// ConsoleRequest is domain/console.ts's ConsoleRequest — one execute() batch: path binds it to a
// connection and, optionally, a default database/schema; Statements is the pre-split list from
// sql-split.ts (one call covers both "Run statement" and "Run all").
type ConsoleRequest struct {
	Path       NodePath
	Statements []string
}

// MongoConsoleMethods mirrors domain/console.ts's MONGO_CONSOLE_METHODS — the ten shell methods
// mongo/console.go dispatches. The renderer's own completion source (TypeScript, unaffected by
// P58c) reads the TS list directly; this is the single Go-side copy every native Mongo console
// caller shares, so the method set is never spelled out twice within the Go codebase either
// (P18 addendum D21).
var MongoConsoleMethods = []string{
	"find",
	"findOne",
	"insertOne",
	"insertMany",
	"updateOne",
	"updateMany",
	"deleteOne",
	"deleteMany",
	"countDocuments",
	"aggregate",
}
